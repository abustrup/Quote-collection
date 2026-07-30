#!/usr/bin/env node
/**
 * Remove or correct quotes, from an issue.
 *
 * Deliberately a separate program from `ingest.mjs`. Adding a quote is
 * recoverable by deleting it; removing one destroys the only copy, and the two
 * jobs should not share a code path where a mistake in one can reach the other.
 *
 * ## Why removals leave a tombstone
 *
 * A quote's id is a hash of its own text, which is what makes importing
 * idempotent. It also means deletion alone does not work: drop a quote from
 * `data/quotes.json` and the next morning's Goodreads sync computes the same id
 * from the same text, finds it absent, and files it again. Deleting the same
 * line every day is not a feature.
 *
 * So a removal writes the id into `data/removed.json` and every importer
 * consults that list. The tombstone also keeps the text, which makes the
 * deletion reversible: taking an entry out of `removed.json` and re-running the
 * sync brings the quote back with its original id and its original permalink.
 *
 * Usage:
 *   node scripts/curate.mjs --mode remove --body-env ISSUE_BODY
 *   node scripts/curate.mjs --mode edit --body-file body.md --dry-run
 */

import { appendFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCHEMA_VERSION,
  THEMES,
  VERIFICATION_STATUSES,
  canonicalAuthor,
  canonicalWork,
  cleanQuoteText,
  quoteId,
  tidyWhitespace,
  validateCollection,
} from '../assets/quote-core.js';

import { IngestError, serializeCollection, splitSections } from './ingest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NO_RESPONSE = /^_no response_$/i;

/**
 * Keys are the `label:` values in the YAML forms. `tests/curate.test.mjs`
 * asserts these match the forms on disk, so a renamed label fails CI rather
 * than silently dropping a field.
 */
const REMOVE_FIELDS = {
  'quote ids': 'ids',
  reason: 'reason',
  'what these are': 'context',
};

const EDIT_FIELDS = {
  'quote id': 'id',
  quote: 'text',
  author: 'author',
  work: 'work',
  year: 'year',
  themes: 'themes',
  note: 'note',
  verification: 'verification',
};

/* ---------------------------------------------------------------------------
 * Reading the forms
 * ------------------------------------------------------------------------- */

/**
 * One field out of a split issue body, or null when it was left blank.
 *
 * `splitSections` already keys its result by field name and already turns
 * GitHub's `_No response_` into an empty string, so the only work left here is
 * unwrapping a code fence and collapsing "empty" to null — which is what lets
 * an edit form treat a blank field as "leave this alone".
 */
function readField(sections, key) {
  const value = sections.get(key);
  if (value == null) return null;
  const trimmed = String(value).trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim();
  if (!trimmed || NO_RESPONSE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Pull quote ids out of whatever the form was given.
 *
 * The site prefills one id per line, but a person typing by hand will use
 * commas, or paste a permalink, or include the surrounding text the site put
 * in the context field. Scanning for the id shape rather than parsing a list
 * handles all of those without asking anyone to format anything.
 */
function readIds(body) {
  const sections = splitSections(body, REMOVE_FIELDS);
  const raw = readField(sections, 'ids');
  if (!raw) {
    throw new IngestError(
      'No quote ids in the issue.',
      'Each one looks like `q_1a2b3c4d5e6f`. The Curate button on the site fills them in for you.',
    );
  }

  const ids = [...new Set(raw.match(/q_[0-9a-f]{12}/g) ?? [])];
  if (!ids.length) {
    throw new IngestError(
      'I could not find a quote id in that.',
      'An id looks like `q_1a2b3c4d5e6f`. On the collection, press **Curate**, tick the quotes and use the Remove button.',
    );
  }
  return { ids, reason: readField(sections, 'reason') };
}

function readEdit(body) {
  const sections = splitSections(body, EDIT_FIELDS);
  const id = (readField(sections, 'id') ?? '').match(/q_[0-9a-f]{12}/)?.[0];
  if (!id) {
    throw new IngestError(
      'No quote id in the issue.',
      'The Edit link on the collection fills this in. It looks like `q_1a2b3c4d5e6f`.',
    );
  }

  const year = readField(sections, 'year');
  const parsedYear = year == null ? undefined : Number.parseInt(year.replace(/[^0-9-]/g, ''), 10);
  if (year != null && !Number.isInteger(parsedYear)) {
    throw new IngestError(`I could not read "${year}" as a year.`, 'Write it as a number, such as 1949 or -350.');
  }

  const themes = readField(sections, 'themes');
  const status = readField(sections, 'verification');
  if (status != null && !VERIFICATION_STATUSES.includes(status.toLowerCase())) {
    throw new IngestError(
      `"${status}" is not a verification status.`,
      `It has to be one of: ${VERIFICATION_STATUSES.join(', ')}.`,
    );
  }

  // `undefined` means "the issue said nothing about this field, leave it".
  // `null` is never produced here, so a field can only be changed, not cleared
  // by accident — clearing is a deliberate act, and the form says so.
  const changes = {};
  const text = readField(sections, 'text');
  if (text != null) changes.text = cleanQuoteText(text);
  const author = readField(sections, 'author');
  if (author != null) changes.author = canonicalAuthor(author);
  const work = readField(sections, 'work');
  if (work != null) changes.work = canonicalWork(work);
  if (year != null) changes.year = parsedYear;
  if (themes != null) {
    const wanted = themes.split(/[,\n]/).map((theme) => tidyWhitespace(theme).toLowerCase()).filter(Boolean);
    const unknown = wanted.filter((theme) => !THEMES.includes(theme));
    if (unknown.length) {
      throw new IngestError(
        `Not a theme in the list: ${unknown.join(', ')}.`,
        `The list is: ${THEMES.join(', ')}.`,
      );
    }
    changes.themes = [...new Set(wanted)];
  }
  const note = readField(sections, 'note');
  if (note != null) changes.note = note;
  if (status != null) changes.verificationStatus = status.toLowerCase();

  if (!Object.keys(changes).length) {
    throw new IngestError(
      'The issue does not change anything.',
      'Fill in at least one field other than the id.',
    );
  }
  return { id, changes };
}

/* ---------------------------------------------------------------------------
 * Files
 * ------------------------------------------------------------------------- */

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new IngestError(`${path.basename(file)} is not valid JSON.`, error.message);
  }
}

async function writeAtomic(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
}

function serializeTombstones(list) {
  const lines = list.removed.map((entry) => `    ${JSON.stringify(entry)}`);
  return `{
  "schemaVersion": ${SCHEMA_VERSION},
  "note": "Quotes deliberately taken out of the collection. Every importer consults this list, which is what stops the next Goodreads sync putting a deleted quote straight back. Deleting an entry here and re-running the sync restores the quote with its original id and permalink.",
  "removed": [
${lines.join(',\n')}
  ]
}
`;
}

/* ---------------------------------------------------------------------------
 * The operations
 * ------------------------------------------------------------------------- */

export async function remove(body, options = {}) {
  const { ids, reason } = readIds(body);
  const removedAt = options.removedAt ?? new Date().toISOString().slice(0, 10);

  const dataFile = options.data ?? path.join(REPO_ROOT, 'data', 'quotes.json');
  const tombFile = options.removedFile ?? path.join(REPO_ROOT, 'data', 'removed.json');

  const collection = await readJson(dataFile, { schemaVersion: SCHEMA_VERSION, quotes: [] });
  const tombstones = await readJson(tombFile, { schemaVersion: SCHEMA_VERSION, removed: [] });

  const byId = new Map(collection.quotes.map((quote) => [quote.id, quote]));
  const alreadyGone = new Set(tombstones.removed.map((entry) => entry.id));

  const gone = [];
  const missing = [];
  for (const id of ids) {
    const quote = byId.get(id);
    if (quote) gone.push(quote);
    else if (!alreadyGone.has(id)) missing.push(id);
  }

  if (!gone.length) {
    throw new IngestError(
      missing.length
        ? `None of those ids are in the collection: ${missing.join(', ')}.`
        : 'Those were already removed, so nothing changed.',
      missing.length
        ? 'Check the id against the one shown under the quote in Curate mode.'
        : null,
    );
  }

  const quotes = collection.quotes.filter((quote) => !byId.has(quote.id) || !gone.includes(quote));
  const removed = [
    ...tombstones.removed,
    ...gone.map((quote) => ({
      id: quote.id,
      text: quote.text,
      author: quote.author,
      ...(quote.work ? { work: quote.work } : {}),
      removedAt,
      ...(reason ? { reason } : {}),
    })),
  ];

  const next = { ...collection, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), quotes };
  const { errors } = validateCollection(next);
  if (errors.length) {
    throw new IngestError(
      'Removing these would leave the collection in a state that does not validate.',
      `${errors.slice(0, 5).join('\n')}\n\nNothing was written.`,
    );
  }

  return {
    mode: 'remove',
    removed: gone,
    missing,
    changed: true,
    files: [
      { file: dataFile, contents: serializeCollection(next) },
      { file: tombFile, contents: serializeTombstones({ removed }) },
    ],
    totalCount: quotes.length,
    existingCount: collection.quotes.length,
  };
}

export async function edit(body, options = {}) {
  const { id, changes } = readEdit(body);
  const dataFile = options.data ?? path.join(REPO_ROOT, 'data', 'quotes.json');
  const collection = await readJson(dataFile, { schemaVersion: SCHEMA_VERSION, quotes: [] });

  const index = collection.quotes.findIndex((quote) => quote.id === id);
  if (index === -1) {
    throw new IngestError(
      `There is no quote with the id ${id}.`,
      'Ids are shown under each quote in Curate mode on the collection.',
    );
  }

  const before = collection.quotes[index];
  const after = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'verificationStatus') after.verification = { ...before.verification, status: value };
    else after[key] = value;
  }

  // Identity is a hash of the text, so correcting the wording can mint a new id
  // and retire the old permalink. That is the honest outcome — the old link
  // pointed at words the collection no longer claims — but it has to be
  // reported rather than discovered.
  //
  // Not every text edit does it, and the difference matters. `quoteId`
  // normalises away case, punctuation and quote style, so adding a missing full
  // stop or straightening an apostrophe leaves the id exactly where it was.
  // Announcing a "new link" that is the old link would train the owner to
  // ignore the one warning that is sometimes real.
  if (after.text !== before.text) after.id = quoteId(after.text);
  const retitled = after.id !== before.id;

  const quotes = [...collection.quotes];
  quotes[index] = after;

  const next = { ...collection, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), quotes };
  const { errors } = validateCollection(next);
  if (errors.length) {
    throw new IngestError(
      'That edit would leave the collection in a state that does not validate.',
      `${errors.slice(0, 5).join('\n')}\n\nNothing was written.`,
    );
  }

  const fields = Object.keys(changes).map((key) => (key === 'verificationStatus' ? 'verification' : key));
  return {
    mode: 'edit',
    before,
    after,
    fields,
    newId: retitled ? after.id : null,
    changed: JSON.stringify(before) !== JSON.stringify(after),
    files: [{ file: dataFile, contents: serializeCollection(next) }],
    totalCount: quotes.length,
    existingCount: collection.quotes.length,
  };
}

/* ---------------------------------------------------------------------------
 * Reporting
 * ------------------------------------------------------------------------- */

function siteBaseUrl() {
  const configured = process.env.SITE_BASE_URL;
  if (configured) return configured.endsWith('/') ? configured : `${configured}/`;
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository && repository.includes('/')) {
    const [owner, name] = repository.split('/');
    return `https://${owner.toLowerCase()}.github.io/${name}/`;
  }
  return 'https://abustrup.github.io/Quote-collection/';
}

function opening(quote, limit = 72) {
  return quote.text.length > limit ? `${quote.text.slice(0, limit).trimEnd()}…` : quote.text;
}

export function summarize(result, { dryRun = false } = {}) {
  const lines = [];

  if (result.mode === 'remove') {
    lines.push(
      result.removed.length === 1
        ? 'Removed from the collection.'
        : `Removed ${result.removed.length} quotes from the collection.`,
      '',
      ...result.removed.map((quote) => `- ${opening(quote)} — ${quote.author}`),
      '',
      `The collection now holds ${result.totalCount} quotes, down from ${result.existingCount}.`,
      '',
      'Each one is recorded in `data/removed.json`, which is what stops the next '
      + 'Goodreads sync putting it back. Deleting its entry there restores the quote '
      + 'with its original link.',
    );
    if (result.missing.length) {
      lines.push('', `Not found, so left alone: ${result.missing.join(', ')}.`);
    }
  } else {
    lines.push(`Updated ${result.fields.join(', ')}.`, '', `> ${result.after.text}`, `>`, `> — ${result.after.author}`);
    if (result.newId) {
      lines.push(
        '',
        `**The wording changed, so this quote has a new link.** Its id moved from `
        + `\`${result.before.id}\` to \`${result.newId}\`, because a quote's identity is a `
        + `hash of its own text. The old link no longer resolves.`,
        '',
        `[Open it](${siteBaseUrl()}#${result.after.id})`,
      );
    } else {
      lines.push('', `[Open it](${siteBaseUrl()}#${result.after.id})`);
    }
  }

  if (dryRun) lines.push('', '_Dry run — nothing was written._');
  return `${lines.join('\n')}\n`;
}

function failureSummary(error) {
  const lines = ['I could not do that.', '', `**${error.message}**`];
  if (error.hint) lines.push('', error.hint);
  lines.push('', 'Edit the issue and I will try again straight away.');
  return `${lines.join('\n')}\n`;
}

function setOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

async function publishSummary(markdown, summaryFile) {
  if (summaryFile) await writeFile(summaryFile, markdown, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = { mode: null, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    switch (flag) {
      case '--mode': options.mode = value(); break;
      case '--body-file': options.bodyFile = value(); break;
      case '--body-env': options.bodyEnv = value(); break;
      case '--data': options.data = path.resolve(value()); break;
      case '--removed': options.removedFile = path.resolve(value()); break;
      case '--summary-file': options.summaryFile = path.resolve(value()); break;
      case '--dry-run': options.dryRun = true; break;
      case '--quiet': options.quiet = true; break;
      default: throw new Error(`Unknown option ${flag}`);
    }
  }
  if (!['remove', 'edit'].includes(options.mode)) {
    throw new Error(`--mode must be remove or edit (got ${options.mode})`);
  }
  return options;
}

async function readBody(options) {
  if (options.bodyFile) return readFile(path.resolve(options.bodyFile), 'utf8');
  if (options.bodyEnv) {
    const body = process.env[options.bodyEnv];
    if (body === undefined) throw new Error(`Environment variable ${options.bodyEnv} is not set`);
    return body;
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let result;
  try {
    const body = await readBody(options);
    if (!String(body).trim()) {
      throw new IngestError('The issue is empty.', 'Use one of the issue forms so I know what to read.');
    }
    result = options.mode === 'remove'
      ? await remove(body, options)
      : await edit(body, options);
  } catch (error) {
    if (error instanceof IngestError) {
      const summary = failureSummary(error);
      await publishSummary(summary, options.summaryFile);
      setOutputs({ ok: 'false', changed: 'false' });
      process.stderr.write(`${summary}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (result.changed && !options.dryRun) {
    for (const { file, contents } of result.files) await writeAtomic(file, contents);
  }

  const summary = summarize(result, { dryRun: options.dryRun });
  await publishSummary(summary, options.summaryFile);
  setOutputs({
    ok: 'true',
    changed: String(result.changed && !options.dryRun),
    total: String(result.totalCount),
  });

  if (!options.quiet) {
    process.stdout.write(
      result.mode === 'remove'
        ? `Removed ${result.removed.length}; the collection holds ${result.totalCount} (was ${result.existingCount}).\n`
        : `Edited ${result.before.id}: ${result.fields.join(', ')}.\n`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`curate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { REMOVE_FIELDS, EDIT_FIELDS, readIds, readEdit, serializeTombstones };
