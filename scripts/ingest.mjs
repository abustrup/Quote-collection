#!/usr/bin/env node
/**
 * Turn a GitHub issue into quotes.
 *
 * This is the only path by which the collection grows once the owner is away
 * from a computer: he fills in an issue form on his phone, GitHub Actions runs
 * this script, and `data/quotes.json` gains a record. There is no terminal in
 * that loop and no way to inspect a stack trace from a train, so every failure
 * has to arrive back as a sentence a person can act on.
 *
 * Two shapes of issue are understood:
 *
 *   single  one quote, typed into `.github/ISSUE_TEMPLATE/add-quote.yml`
 *   bulk    a JSON array pasted from `import.html` into `bulk-import.yml`
 *
 * Usage:
 *   node scripts/ingest.mjs --mode auto --body-file body.md
 *   node scripts/ingest.mjs --mode bulk --body-env ISSUE_BODY --dry-run
 *
 * Options:
 *   --mode single|bulk|auto   which form to expect (default: auto, by heading)
 *   --body-file PATH          read the issue body from a file
 *   --body-env NAME           read the issue body from an environment variable
 *                             (preferred in CI: nothing passes through a shell)
 *   --data PATH               collection file (default: data/quotes.json)
 *   --proposals PATH          the board, for board picks (default: data/proposals.json)
 *   --summary-file PATH       write the Markdown comment body here
 *   --dry-run                 report what would change, write nothing
 *   --quiet                   suppress the human summary on stdout
 *
 * Exit code 0 means the collection is in a good state — including the case
 * where the quote was already there. Exit code 1 means nothing was written.
 *
 * Zero dependencies on purpose: the Action should keep working in five years
 * without an `npm install` that may no longer resolve.
 */

import { appendFileSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readTombstones, withoutRemoved } from './tombstones.mjs';

import {
  SCHEMA_VERSION,
  THEMES,
  WORK_KINDS,
  VERIFICATION_STATUSES,
  cleanQuoteText,
  makeQuote,
  mergeQuotes,
  quoteId,
  validateCollection,
} from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A problem with the *input*, phrased for the person who filled in the form. */
class IngestError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'IngestError';
    this.hint = hint ?? null;
  }
}

/* ---------------------------------------------------------------------------
 * Issue form fields
 *
 * The keys of these tables are the `label:` values in the YAML forms, and the
 * two must stay in step — `tests/ingest.test.mjs` asserts that they do, so a
 * renamed label fails CI instead of silently dropping a field months later.
 * ------------------------------------------------------------------------- */

const SINGLE_FIELDS = {
  quote: 'text',
  author: 'author',
  work: 'work',
  'kind of work': 'workKind',
  year: 'year',
  themes: 'themes',
  tags: 'tags',
  language: 'lang',
  'source url': 'sourceUrl',
  note: 'note',
  favourite: 'favourite',
};

const BULK_FIELDS = {
  quotes: 'json',
};

/**
 * The board hands over ids, not quotes.
 *
 * A prefilled issue link carrying whole records blows past what a URL can hold
 * after four or five picks — measured at 6.2 KB for five — and the fallback is
 * asking someone to paste 11 KB of JSON on a phone. Ids are ~14 characters
 * each, so the link works whether one line is ticked or forty, and the records
 * come from `data/proposals.json`, which the scout wrote and CI can read.
 */
const BOARD_FIELDS = {
  picks: 'ids',
  // Listed although nothing reads it: a heading absent from this map is not a
  // boundary, so the section below it would be swallowed into the ids and every
  // pick would fail on a line of prose.
  'what these are': 'context',
};

/** GitHub's placeholder for an optional field the author left alone. */
const NO_RESPONSE = /^_no response_$/i;

/**
 * Compare headings loosely.
 *
 * GitHub prints the label verbatim, so an exact match would work today — but a
 * label gaining a question mark or a capital letter is exactly the sort of
 * harmless edit that should not break the owner's only way of adding a quote.
 */
function normalizeLabel(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Split an issue-form body into its fields.
 *
 * Sections are `### Label` headings, but only headings whose text is a field we
 * know about: a quotation may itself contain a Markdown heading, and losing the
 * second half of a quote to a stray `###` would be both silent and permanent.
 */
function splitSections(body, fields) {
  const known = new Map(Object.keys(fields).map((label) => [normalizeLabel(label), label]));
  const sections = new Map();

  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections.set(current, buffer.join('\n'));
    buffer = [];
  };

  for (const line of String(body).replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^###\s+(.*\S)\s*$/.exec(line);
    const label = heading ? known.get(normalizeLabel(heading[1])) : undefined;
    if (label !== undefined) {
      flush();
      current = label;
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();

  const values = new Map();
  for (const [label, raw] of sections) {
    const trimmed = raw.trim();
    values.set(fields[label], NO_RESPONSE.test(trimmed) ? '' : trimmed);
  }
  return values;
}

/** Unwrap the fenced block that a `render:`-ed textarea puts around its value. */
function stripCodeFence(value) {
  const match = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(value.trim());
  return match ? match[1] : value;
}

/**
 * Remove Markdown blockquote markers, but only when every line carries one.
 *
 * Pasting a quotation from a phone often brings `> ` along. Stripping it
 * unconditionally would eat the first character of a quote that genuinely
 * begins with an angle bracket, so an unmarked line anywhere cancels the strip.
 */
function stripBlockquote(value) {
  const lines = value.split('\n');
  const meaningful = lines.filter((line) => line.trim() !== '');
  if (meaningful.length === 0) return value;
  if (!meaningful.every((line) => /^\s*>\s?/.test(line))) return value;
  return lines.map((line) => line.replace(/^\s*>\s?/, '')).join('\n');
}

function splitList(value) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * Field coercion
 *
 * Every one of these either returns a clean value or throws an IngestError with
 * the sentence the owner will read in the issue comment. `makeQuote` is more
 * forgiving — it quietly drops a theme it does not recognise — which is right
 * for a bulk import in the browser and wrong at this door, where a silently
 * dropped field means a quote that is subtly wrong forever.
 * ------------------------------------------------------------------------- */

const YEAR_FORMS = [
  [/^(-?\d{1,4})$/, (m) => Number(m[1])],
  [/^(\d{1,4})\s*(?:bce?|f\.?\s*kr\.?)$/i, (m) => -Number(m[1])],
  [/^(?:ad\s*|e\.?\s*kr\.?\s*)?(\d{1,4})\s*(?:ce|ad|e\.?\s*kr\.?)?$/i, (m) => Number(m[1])],
];

function parseYear(value) {
  if (!value) return null;
  const raw = value.trim();
  for (const [pattern, read] of YEAR_FORMS) {
    const match = pattern.exec(raw);
    if (match) return assertYearInRange(read(match), raw);
  }
  throw new IngestError(
    `I could not read "${raw}" as a year.`,
    'Write a plain number — 1951 — or 350 BC (also written "350 f.Kr.") for an ancient text.',
  );
}

function assertYearInRange(year, raw) {
  if (!Number.isInteger(year) || year < -800 || year > 2100) {
    throw new IngestError(
      `The year ${raw} is outside the range the collection accepts.`,
      'Years run from 800 BC to 2100.',
    );
  }
  return year;
}

function parseThemes(value) {
  const themes = splitList(value).map((theme) => theme.toLowerCase());
  const unknown = themes.filter((theme) => !THEMES.includes(theme));
  if (unknown.length > 0) {
    throw new IngestError(
      `Not a theme in this collection: ${unknown.join(', ')}.`,
      `Themes are a fixed vocabulary: ${THEMES.join(', ')}.`,
    );
  }
  return [...new Set(themes)];
}

function parseWorkKind(value) {
  if (!value) return null;
  const kind = value.trim().toLowerCase();
  if (!WORK_KINDS.includes(kind)) {
    throw new IngestError(
      `"${value.trim()}" is not a kind of work I know.`,
      `Pick one of: ${WORK_KINDS.join(', ')}.`,
    );
  }
  return kind;
}

/** Language comes from a dropdown labelled `Danish (da)`; the code is the point. */
function parseLang(value) {
  if (!value) return 'en';
  const match = /\(([a-z]{2})\)\s*$/i.exec(value.trim()) ?? /^([a-z]{2})$/i.exec(value.trim());
  if (!match) {
    throw new IngestError(
      `I could not read "${value.trim()}" as a language.`,
      'Use the dropdown, or write a two-letter code such as da or en.',
    );
  }
  return match[1].toLowerCase();
}

function parseSourceUrl(value) {
  if (!value) return null;
  const url = value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new IngestError(
      `"${url}" does not look like a web address.`,
      'It should start with http:// or https://. Leave it empty if the quote came from paper.',
    );
  }
  return url;
}

/** A checkbox renders as a list item; ticked is `- [X]`. */
function parseCheckbox(value) {
  return /^\s*[-*]\s*\[[xX]\]/m.test(value);
}

/* ---------------------------------------------------------------------------
 * The two forms
 * ------------------------------------------------------------------------- */

function readSingleQuote(body, addedAt) {
  const fields = splitSections(body, SINGLE_FIELDS);

  if (fields.size === 0) {
    throw new IngestError(
      'This issue does not look like it came from the "Add a quote" form.',
      'Open a new issue with the form rather than writing the body by hand, and I will pick it up.',
    );
  }

  const rawText = stripBlockquote(fields.get('text') ?? '');
  const text = cleanQuoteText(rawText);
  if (text.length < 2) {
    throw new IngestError(
      'The quote itself is empty.',
      'Put the quotation in the first field — just the words, without quotation marks or the author.',
    );
  }

  const author = (fields.get('author') ?? '').trim();
  if (!author) {
    throw new IngestError(
      'The quote has no author.',
      'If you genuinely do not know who said it, write Unknown.',
    );
  }

  return makeQuote({
    text,
    author,
    work: (fields.get('work') ?? '').trim() || null,
    workKind: parseWorkKind(fields.get('workKind') ?? ''),
    year: parseYear(fields.get('year') ?? ''),
    themes: parseThemes(fields.get('themes') ?? ''),
    tags: splitList(fields.get('tags') ?? ''),
    lang: parseLang(fields.get('lang') ?? ''),
    source: { kind: 'manual', url: parseSourceUrl(fields.get('sourceUrl') ?? ''), locator: null },
    favorite: parseCheckbox(fields.get('favourite') ?? ''),
    note: (fields.get('note') ?? '').trim(),
    addedAt,
  });
}

function readBulkQuotes(body, addedAt) {
  const fields = splitSections(body, BULK_FIELDS);
  const raw = stripCodeFence(fields.get('json') ?? '').trim();

  if (!raw) {
    throw new IngestError(
      'The import is empty — I found no JSON in the issue.',
      'Paste the array that import.html gives you into the "Quotes" field, brackets included.',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new IngestError(
      `That is not valid JSON: ${error.message}`,
      'Copy the whole block from import.html — starting at [ and ending at ] — without editing it.',
    );
  }

  const entries = Array.isArray(parsed) ? parsed : parsed?.quotes;
  if (!Array.isArray(entries)) {
    throw new IngestError(
      'The JSON is valid but it is not a list of quotes.',
      'I expect an array — [ { "text": "…", "author": "…" }, … ] — or an object with a "quotes" array.',
    );
  }
  if (entries.length === 0) {
    throw new IngestError('The list of quotes is empty.', 'Nothing to import.');
  }

  const warnings = [];
  const quotes = entries.map((entry, index) => readBulkEntry(entry, index, addedAt, warnings));
  return { quotes, warnings };
}

/**
 * Turn a list of ids ticked on the board into the quotes they stand for.
 *
 * Everything is resolved before anything is built, so a single unknown id fails
 * the whole issue rather than half-importing a selection — the reader ticked a
 * set, and getting back a different set silently is worse than being told.
 */
async function readBoardPicks(body, addedAt, proposalsFile) {
  const fields = splitSections(body, BOARD_FIELDS);
  const ids = splitList(stripCodeFence(fields.get('ids') ?? ''))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);

  if (!ids.length) {
    throw new IngestError(
      'No lines were ticked, so there is nothing to add.',
      'Go back to the board, tick what you want, and press "Add to the collection" again.',
    );
  }

  const file = proposalsFile ?? path.join(REPO_ROOT, 'data', 'proposals.json');
  let board;
  try {
    board = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new IngestError(
      `I could not read the board (${error.message}).`,
      'The picks are stored as ids, so the board file has to be readable to turn them back into quotes.',
    );
  }

  const byId = new Map((board?.proposals ?? []).map((proposal) => [proposal.id, proposal]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    throw new IngestError(
      unknown.length === 1
        ? `The board has no line with the id ${unknown[0]}.`
        : `The board has no lines with these ids: ${unknown.join(', ')}.`,
      'This happens if the board was replaced between opening the page and submitting. Reload the board and tick again.',
    );
  }

  const warnings = [];
  const quotes = ids.map((id, index) => {
    // The scout's own bookkeeping is not part of the quote and must not travel
    // into the collection with it.
    const { why, shownOn, status, ...record } = byId.get(id);
    return readBulkEntry(record, index, addedAt, warnings);
  });
  return { quotes, warnings };
}

function readBulkEntry(entry, index, addedAt, warnings) {
  const where = `Entry ${index + 1}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new IngestError(`${where} is not a quote object.`, 'Every item in the array must be { "text": …, "author": … }.');
  }

  const text = cleanQuoteText(entry.text);
  if (text.length < 2) {
    throw new IngestError(`${where} has no text.`, 'Every quote needs the words themselves.');
  }

  // A well-formed id that disagrees with its own text would break the permalink
  // for that quote forever, and `makeQuote` trusts any id that merely looks
  // right. Catch the disagreement here, where it can still be explained.
  if (typeof entry.id === 'string' && /^q_[0-9a-f]{12}$/.test(entry.id) && entry.id !== quoteId(text)) {
    throw new IngestError(
      `${where} carries an id that does not match its text.`,
      'Re-export from import.html rather than editing ids by hand.',
    );
  }

  const author = typeof entry.author === 'string' ? entry.author.trim() : '';
  if (!author) warnings.push(`${where} has no author and will be filed under Unknown.`);

  const status = entry.verification?.status;
  if (status !== undefined && !VERIFICATION_STATUSES.includes(status)) {
    throw new IngestError(
      `${where} has an unknown verification status "${status}".`,
      `Use one of: ${VERIFICATION_STATUSES.join(', ')}.`,
    );
  }

  const themes = Array.isArray(entry.themes) ? entry.themes : [];
  const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];

  // Free-text fields have to be strings. Pasted JSON is not a form, so nothing
  // upstream has already coerced them, and `makeQuote` passes an object or an
  // array straight through — producing a data file that violates the
  // repository's own schema while the validator still calls it fine.
  const asText = (value, field) => {
    if (value == null) return null;
    if (typeof value === 'string') return value;
    throw new IngestError(
      `"${field}" has to be text, but the pasted JSON has ${Array.isArray(value) ? 'a list' : typeof value}.`,
      'Check that field in the JSON you copied out of the importer.',
    );
  };

  return makeQuote({
    ...entry,
    text,
    author: author || 'Unknown',
    work: asText(entry.work, 'work'),
    note: asText(entry.note, 'note') ?? '',
    workKind: entry.workKind == null ? null : parseWorkKind(String(entry.workKind)),
    year: entry.year == null ? null : parseYear(String(entry.year)),
    themes: parseThemes(themes.join(',')),
    tags,
    lang: entry.lang == null ? 'en' : parseLang(String(entry.lang)),
    source: {
      kind: entry.source?.kind ?? 'import',
      // The same rule as the typed-in form. Without this the bulk door accepts
      // a `javascript:` address into a file the published site reads, which is
      // inert today only because nothing renders source.url as a link.
      url: parseSourceUrl(asText(entry.source?.url, 'source.url')),
      locator: asText(entry.source?.locator, 'source.locator'),
    },
    verification: {
      status: entry.verification?.status,
      note: asText(entry.verification?.note, 'verification.note') ?? undefined,
      checkedAt: asText(entry.verification?.checkedAt, 'verification.checkedAt') ?? undefined,
    },
    addedAt: typeof entry.addedAt === 'string' && entry.addedAt ? entry.addedAt : addedAt,
  });
}

/* ---------------------------------------------------------------------------
 * Reading and writing the collection
 * ------------------------------------------------------------------------- */

const QUOTE_KEYS = [
  'id', 'text', 'author', 'work', 'workKind', 'year', 'source', 'tags', 'themes',
  'lang', 'verification', 'favorite', 'note', 'addedAt',
];
const SOURCE_KEYS = ['kind', 'url', 'locator'];
const VERIFICATION_KEYS = ['status', 'note', 'checkedAt'];

/**
 * Rebuild an object with its keys in a fixed order.
 *
 * The data file is read by a person as often as by a program: it is checked
 * into git, reviewed in diffs on a phone, and occasionally edited by hand. A
 * stable key order means a diff shows what actually changed and nothing else.
 * Unknown keys are kept, sorted, rather than dropped — losing data to tidiness
 * would be a poor trade.
 */
function ordered(object, keys) {
  const result = {};
  for (const key of keys) {
    if (object[key] !== undefined) result[key] = object[key];
  }
  for (const key of Object.keys(object).sort()) {
    if (!(key in result)) result[key] = object[key];
  }
  return result;
}

function serializeCollection(collection) {
  const quotes = collection.quotes.map((quote) => {
    const record = ordered(quote, QUOTE_KEYS);
    if (record.source && typeof record.source === 'object') {
      record.source = ordered(record.source, SOURCE_KEYS);
    }
    if (record.verification && typeof record.verification === 'object') {
      record.verification = ordered(record.verification, VERIFICATION_KEYS);
    }
    return record;
  });

  // Quotes keep the order they arrived in. Sorting would read tidier once and
  // then make every future import a thousand-line diff.
  return `${JSON.stringify(ordered({ ...collection, quotes }, ['schemaVersion', 'updatedAt', 'quotes']), null, 2)}\n`;
}

async function readCollection(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    // A collection that does not exist yet is simply an empty one. The summary
    // says "was 0", which is the only signal anybody needs.
    if (error.code === 'ENOENT') return { schemaVersion: SCHEMA_VERSION, quotes: [] };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Not the author's fault and not something they can fix from a phone, so
    // this is a hard stop rather than an issue comment about their input.
    throw new Error(`${file} is not valid JSON (${error.message}). Fix the file before importing.`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.quotes)) {
    throw new Error(`${file} does not hold a quote collection.`);
  }
  return parsed;
}

/** Write via a temporary file so an interrupted run cannot truncate the data. */
async function writeAtomic(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
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

function permalink(quote) {
  return `${siteBaseUrl()}#${quote.id}`;
}

/** One quote, described the way it will read in the issue comment. */
function describe(quote) {
  const attribution = [quote.author, quote.work ? `*${quote.work}*` : null]
    .filter(Boolean)
    .join(', ');
  const dated = quote.year == null ? attribution : `${attribution} (${quote.year})`;
  return `> ${quote.text}\n>\n> — ${dated}\n\n[Open in the collection](${permalink(quote)})`;
}

function listLinks(quotes, limit = 10) {
  const shown = quotes.slice(0, limit).map((quote) => {
    const opening = quote.text.length > 72 ? `${quote.text.slice(0, 72).trimEnd()}…` : quote.text;
    return `- [${opening}](${permalink(quote)}) — ${quote.author}`;
  });
  if (quotes.length > limit) shown.push(`- …and ${quotes.length - limit} more`);
  return shown.join('\n');
}

function successSummary({ added, enriched, unchanged, warnings, dryRun }) {
  const lines = [];
  const total = added.length + enriched.length + unchanged.length;

  if (added.length === 1 && total === 1) {
    lines.push('Added to the collection.', '', describe(added[0]));
  } else if (added.length === 0 && enriched.length === 0) {
    lines.push(
      total === 1
        ? 'This one was already in the collection, so nothing changed.'
        : `All ${total} of these were already in the collection, so nothing changed.`,
    );
    if (unchanged.length > 0) lines.push('', listLinks(unchanged));
  } else {
    const counts = [
      `${added.length} added`,
      enriched.length > 0 ? `${enriched.length} filled out with new details` : null,
      unchanged.length > 0 ? `${unchanged.length} already present` : null,
    ].filter(Boolean);
    lines.push(`${counts.join(', ')}.`);
    if (added.length > 0) lines.push('', listLinks(added));
  }

  if (warnings.length > 0) {
    lines.push('', 'Worth a look:', ...warnings.map((warning) => `- ${warning}`));
  }
  if (dryRun) lines.push('', '_Dry run — nothing was written._');
  return `${lines.join('\n')}\n`;
}

function failureSummary(error) {
  const lines = ['I could not add this one.', '', `**${error.message}**`];
  if (error.hint) lines.push('', error.hint);
  lines.push('', 'Edit the issue and I will try again straight away.');
  return `${lines.join('\n')}\n`;
}

function setOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const payload = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  appendFileSync(file, `${payload}\n`);
}

async function publishSummary(markdown, summaryFile) {
  if (summaryFile) await writeFile(summaryFile, markdown, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = {
    mode: 'auto',
    bodyFile: null,
    bodyEnv: null,
    data: path.join(REPO_ROOT, 'data', 'quotes.json'),
    proposals: path.join(REPO_ROOT, 'data', 'proposals.json'),
    summaryFile: null,
    dryRun: false,
    quiet: false,
  };

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
      case '--proposals': options.proposals = path.resolve(value()); break;
      case '--summary-file': options.summaryFile = path.resolve(value()); break;
      case '--dry-run': options.dryRun = true; break;
      case '--quiet': options.quiet = true; break;
      default: throw new Error(`Unknown option ${flag}`);
    }
  }

  if (!['auto', 'single', 'bulk', 'board'].includes(options.mode)) {
    throw new Error(`--mode must be auto, single, bulk or board (got ${options.mode})`);
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

/**
 * Which form filled this in, read from the headings it left behind: `### Picks`
 * is the board, `### Quotes` is the importer, anything else is the typed form.
 */
function detectMode(body) {
  if (splitSections(body, BOARD_FIELDS).has('ids')) return 'board';
  return splitSections(body, BULK_FIELDS).size > 0 ? 'bulk' : 'single';
}

export async function ingest(body, options = {}) {
  const addedAt = options.addedAt ?? new Date().toISOString().slice(0, 10);
  const mode = options.mode && options.mode !== 'auto' ? options.mode : detectMode(body);

  if (!String(body).trim()) {
    throw new IngestError('The issue is empty.', 'Use one of the issue forms so I know what to read.');
  }

  let read;
  let warnings;
  if (mode === 'board') {
    ({ quotes: read, warnings } = await readBoardPicks(body, addedAt, options.proposals));
  } else if (mode === 'bulk') {
    ({ quotes: read, warnings } = readBulkQuotes(body, addedAt));
  } else {
    read = [readSingleQuote(body, addedAt)];
    warnings = [];
  }

  // A bulk import is a machine re-reading a source, so anything deliberately
  // removed stays removed. Typing a quote into the single form is a person
  // asking for that quote specifically, which is a decision that outranks an
  // earlier deletion — so it revives, and the comment says that it did. Ticking
  // a line on the board is the same kind of decision: the scout only proposes,
  // and the tick is the person choosing, so a pick revives too.
  const removed = await readTombstones(options.removedFile);
  const { kept: incoming, skipped } = mode === 'bulk'
    ? withoutRemoved(read, removed)
    : { kept: read, skipped: [] };
  const revived = mode === 'bulk' ? [] : read.filter((quote) => removed.has(quote.id));

  if (mode === 'bulk' && !incoming.length && skipped.length) {
    throw new IngestError(
      skipped.length === 1
        ? 'That quote was removed from the collection on purpose, so I left it out.'
        : `All ${skipped.length} of those were removed from the collection on purpose, so I left them out.`,
      'To bring one back, delete its entry from `data/removed.json`.',
    );
  }

  const dataFile = options.data ?? path.join(REPO_ROOT, 'data', 'quotes.json');
  const existing = await readCollection(dataFile);
  const { quotes, added, enriched } = mergeQuotes(existing.quotes, incoming);

  const touched = new Set([...added, ...enriched].map((quote) => quote.id));
  const unchanged = incoming.filter((quote) => !touched.has(quote.id));

  const changed = added.length > 0 || enriched.length > 0;
  const collection = {
    ...existing,
    schemaVersion: SCHEMA_VERSION,
    quotes,
    ...(changed ? { updatedAt: new Date().toISOString() } : {}),
  };

  // The last line of defence: a merge that would produce an invalid collection
  // never reaches the disk, whatever combination of inputs led to it.
  const { errors, warnings: structural } = validateCollection(collection);
  if (errors.length > 0) {
    throw new IngestError(
      'Adding this would leave the collection in a state that does not validate.',
      `${errors.slice(0, 5).join('\n')}\n\nNothing was written.`,
    );
  }

  const notices = [
    skipped.length
      ? `${skipped.length} ${skipped.length === 1 ? 'quote was' : 'quotes were'} left out because ${skipped.length === 1 ? 'it was' : 'they were'} removed from the collection on purpose.`
      : null,
    revived.length
      ? `${revived.length} of these had been removed before. Adding ${revived.length === 1 ? 'it' : 'them'} by hand brings ${revived.length === 1 ? 'it' : 'them'} back; the entry in data/removed.json is now stale.`
      : null,
  ].filter(Boolean);

  return {
    mode,
    added,
    enriched,
    unchanged,
    changed,
    skipped,
    revived,
    warnings: [...warnings, ...structural, ...notices],
    contents: serializeCollection(collection),
    dataFile,
    existingCount: existing.quotes.length,
    totalCount: quotes.length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let result;
  try {
    const body = await readBody(options);
    result = await ingest(body, { mode: options.mode, data: options.data });
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
    await writeAtomic(result.dataFile, result.contents);
  }

  const summary = successSummary({ ...result, dryRun: options.dryRun });
  await publishSummary(summary, options.summaryFile);

  // The one quote worth linking to from the outside: whatever this issue was about.
  const focus = result.added[0] ?? result.enriched[0] ?? result.unchanged[0];
  setOutputs({
    ok: 'true',
    changed: String(result.changed && !options.dryRun),
    added: String(result.added.length),
    enriched: String(result.enriched.length),
    total: String(result.totalCount),
    permalink: focus ? permalink(focus) : siteBaseUrl(),
  });

  if (!options.quiet) {
    const verb = options.dryRun ? 'would hold' : 'holds';
    const relative = path.relative(REPO_ROOT, result.dataFile);
    const where = relative.startsWith('..') ? result.dataFile : relative;
    process.stdout.write(
      `${result.mode === 'bulk' ? 'Bulk import' : 'Quote'}: `
      + `${result.added.length} added, ${result.enriched.length} enriched, `
      + `${result.unchanged.length} unchanged.\n`
      + `${where} ${verb} ${result.totalCount} quotes (was ${result.existingCount}).\n`,
    );
    for (const warning of result.warnings) process.stdout.write(`  warning: ${warning}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`ingest failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  IngestError,
  readSingleQuote,
  readBulkQuotes,
  serializeCollection,
  splitSections,
  normalizeLabel,
  parseYear,
  SINGLE_FIELDS,
  BULK_FIELDS,
};
