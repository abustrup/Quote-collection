#!/usr/bin/env node
/**
 * Fold the shelf Worker's state into the repository.
 *
 * The site can be edited from a phone — a rating, a shelf, a starred quote, a
 * whole new quote — and those changes land in a small Cloudflare Worker (see
 * `worker/`) rather than in git, because a static page has no way to write to a
 * repository. This script is the other half: it reads the Worker's state and
 * writes it into `data/works.json` and `data/quotes.json`, so the repository
 * stays what the README promises it is — plain files anyone can read, with the
 * whole history in git rather than in somebody's database.
 *
 * It runs every three hours from `.github/workflows/sync-shelf.yml`, and it is
 * safe to run by hand at any time:
 *
 *   node scripts/apply-shelf-state.mjs                  # from the live Worker
 *   node scripts/apply-shelf-state.mjs --dry-run        # say what it would do
 *   node scripts/apply-shelf-state.mjs --from state.json
 *
 * Two things it deliberately does not do.
 *
 * It does not delete the Worker's overrides after applying them. The same
 * override applied twice changes nothing, and dropping the row would make a
 * rating disappear from his other devices in the gap between the change and
 * the next sync.
 *
 * It does not resurrect a quote that was removed on purpose. `data/removed.json`
 * is checked for every pending quote, for the same reason every other importer
 * checks it: a quote's id is a hash of its own words, so a deleted quote would
 * otherwise walk back in through the next door.
 *
 * A pending quote can carry more than its words (2026-11-15): a source link and
 * a place in it, a kind of work, themes, a language, a subject, and a claim
 * about how well it was checked. They become the record's own fields. The
 * subject belongs to the work, not the quote, so when the quote names a work
 * the registry has never heard of and a subject came with it, the work is
 * registered in `data/works.json` too, in the registry's own order. Without
 * that the quote reads fine and is invisible under every subject filter.
 *
 * A work is registered only for a quote that was filed, or whose work this
 * quote supplied, and only when a year came with it. The registry's era filter
 * needs the year: the repository's own test says every work the collection
 * quotes has a subject and an era, `register-work.py` insists on a year for the
 * same reason, and a work with no year would turn that test red at the next
 * human push with a message nobody on a phone can read. With no year the quote is
 * still filed, the work is left unregistered, and a line in the warnings says
 * so. A quote refused as removed registers nothing, and neither does one that
 * only repeats words the collection already has.
 *
 * Nothing stronger than `reported` ever comes through here. The Worker refuses
 * a request that claims `verified`, and this script holds the line again for
 * anything that got into the database some other way: it files the quote as
 * `unverified` and says so.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serializeCollection } from './ingest.mjs';
import { readTombstones } from './tombstones.mjs';

import {
  SCHEMA_VERSION,
  SUBJECTS,
  THEMES,
  WORK_KINDS,
  makeQuote,
  mergeQuotes,
  slug,
  validateCollection,
  validateWorks,
} from '../assets/quote-core.js';
// The Worker's own rules, so a stored payload is held to the very same ones
// again: the same ceilings, the same two verification statuses, and the same
// reading of what counts as an https address. One copy, so they cannot drift.
import { INTAKE_STATUSES, LIMITS, addressProblem, filedAddress } from '../worker/src/intake.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHELVES = ['read', 'reading', 'to-read', 'abandoned'];
const SCORES = ['rating', 'want'];

const MAX_URL = LIMITS.url;
const MAX_LOCATOR = LIMITS.locator;
const MAX_VERIFICATION_NOTE = LIMITS.verificationNote;
const MAX_THEMES = LIMITS.themes;

const defaults = () => ({
  worksFile: path.join(REPO_ROOT, 'data', 'works.json'),
  quotesFile: path.join(REPO_ROOT, 'data', 'quotes.json'),
  removedFile: path.join(REPO_ROOT, 'data', 'removed.json'),
  sourcesFile: path.join(REPO_ROOT, 'data', 'sources.json'),
});

/* ---------------------------------------------------------------------------
 * Reading the state
 * ------------------------------------------------------------------------- */

export async function readState({ from, url, sourcesFile = defaults().sourcesFile, timeoutMs = 15000 } = {}) {
  if (from) return JSON.parse(await readFile(from, 'utf8'));

  let base = url;
  if (!base) {
    const sources = JSON.parse(await readFile(sourcesFile, 'utf8'));
    base = sources?.shelfApi?.url;
  }
  if (!base) {
    const error = new Error('no shelf API url: set shelfApi.url in data/sources.json, or pass --url');
    error.waiting = true;
    throw error;
  }

  const endpoint = `${String(base).replace(/\/+$/, '')}/state`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Applying it
 * ------------------------------------------------------------------------- */

function validScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10;
}

/**
 * Overrides onto the registry, matched by the slug of the title.
 *
 * The slug is the join, because it is what the site already uses in every link
 * (`./?work=crime-and-punishment`) and what the Worker therefore receives. An
 * override whose slug matches nothing is reported and skipped rather than
 * silently dropped: it means a title was renamed here, or a book was never
 * registered, and both are worth someone's attention.
 */
function applyWorks(registry, overrides, notes) {
  const bySlug = new Map();
  for (const work of registry.works ?? []) {
    const key = slug(work.title);
    if (!bySlug.has(key)) bySlug.set(key, work);
  }

  let changed = 0;
  for (const [key, override] of Object.entries(overrides ?? {})) {
    const work = bySlug.get(key);
    if (!work) {
      notes.warnings.push(`no work with the slug "${key}" in the registry, so its change was ignored`);
      continue;
    }

    for (const field of SCORES) {
      if (!(field in override)) continue;
      const value = override[field];
      if (value === null) {
        if (work[field] !== undefined) {
          delete work[field];
          changed += 1;
          notes.applied.push(`${work.title}: ${field} cleared`);
        }
        continue;
      }
      if (!validScore(value)) {
        notes.warnings.push(`${work.title}: ignored ${field} ${JSON.stringify(value)}, which is not 0–10`);
        continue;
      }
      if (work[field] !== value) {
        work[field] = value;
        changed += 1;
        notes.applied.push(`${work.title}: ${field} ${value}`);
      }
    }

    if ('shelf' in override) {
      const value = override.shelf;
      if (value === null) {
        if (work.shelf !== undefined) {
          delete work.shelf;
          changed += 1;
          notes.applied.push(`${work.title}: shelf cleared`);
        }
      } else if (!SHELVES.includes(value)) {
        notes.warnings.push(`${work.title}: ignored shelf ${JSON.stringify(value)}`);
      } else if (work.shelf !== value) {
        work.shelf = value;
        changed += 1;
        notes.applied.push(`${work.title}: shelf ${value}`);
      }
    }
  }
  return changed;
}

/** Favourites onto the quotes that already exist. */
function applyFavorites(quotes, favorites, notes) {
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  let changed = 0;
  for (const [id, entry] of Object.entries(favorites ?? {})) {
    const quote = byId.get(id);
    if (!quote) {
      notes.warnings.push(`favourite for ${id}, which is not in the collection`);
      continue;
    }
    const on = Boolean(entry?.on);
    if (Boolean(quote.favorite) !== on) {
      quote.favorite = on;
      changed += 1;
      notes.applied.push(`${on ? 'favourited' : 'unfavourited'} ${id}`);
    }
  }
  return changed;
}

/* ---------------------------------------------------------------------------
 * What a pending quote may carry besides its words
 *
 * Each of these takes whatever is in the stored payload and returns something
 * safe to put in the collection, or nothing. A bad value never fails the run:
 * one odd pending row must not be able to stop every sync after it, so the
 * field is dropped, a line goes in the warnings, and the quote is filed.
 * ------------------------------------------------------------------------- */

/**
 * https only, written out as `https://`, no spaces, no login, at most 500
 * characters: the Worker's own rule, from `worker/src/intake.mjs`. The scheme
 * is filed in lower case, as the Worker files it.
 */
function cleanUrl(value, id, notes) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_URL || addressProblem(text)) {
    notes.warnings.push(`pending quote ${id}: the source link was not a plain https address, so it was left out`);
    return null;
  }
  return filedAddress(text);
}

function cleanLocator(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, MAX_LOCATOR) : null;
}

/** The known themes, in the order sent, at most four. The collection's own `makeQuote` drops unknown ones too. */
function cleanThemes(value) {
  if (!Array.isArray(value)) return [];
  const kept = [];
  for (const item of value) {
    const theme = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (THEMES.includes(theme) && !kept.includes(theme)) kept.push(theme);
    if (kept.length === MAX_THEMES) break;
  }
  return kept;
}

/**
 * `reported` or `unverified`, nothing else. Anything stronger is filed as
 * `unverified` with a warning, so a stored row that never passed the Worker's
 * checks cannot give a quote a trust it has not earned.
 */
function cleanVerification(value, id, notes) {
  const asked = typeof value?.status === 'string' ? value.status.trim().toLowerCase() : 'unverified';
  const note = typeof value?.note === 'string' ? value.note.trim().slice(0, MAX_VERIFICATION_NOTE) : '';
  let status = asked;
  if (!INTAKE_STATUSES.includes(asked)) {
    notes.warnings.push(`pending quote ${id} asked to be "${asked}", which the site cannot grant, so it was filed as unverified`);
    status = 'unverified';
  }
  return note ? { status, note } : { status };
}

/**
 * The link to put on the work itself, from the link on the quote.
 *
 * A quote filed from a video carries a link to the moment it was said
 * (`youtu.be/ID?t=754`); the work is the whole video, so the time and the
 * sharing parameters come off. Other addresses are kept as they were.
 */
export function workUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || addressProblem(text)) return null;
  const parsed = new URL(text);
  const host = parsed.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
    for (const name of ['t', 'start', 'time_continue', 'si', 'feature']) parsed.searchParams.delete(name);
    parsed.hash = '';
  }
  return parsed.href;
}

/**
 * Turn the pending quotes into records the collection can hold.
 *
 * Same building blocks as `scripts/ingest.mjs` on purpose — `makeQuote` for the
 * record, `mergeQuotes` for the merge, the tombstones for the refusal — so a
 * quote typed into the site and a quote filed through a GitHub issue end up
 * byte-identical, and neither route can invent a field the other does not have.
 *
 * Returns one row per pending quote that can be filed, `{ id, quote, subject }`,
 * in the order they were sent. The subject its sender gave for the work stays on
 * the row, beside the quote and not on it, because a subject is not part of a
 * quote: it is the registry's. It is kept per row (the Worker's own id for the
 * request) and not per quote id: two rows that carry the same words but name
 * different works are two requests, and each keeps its own subject.
 */
function preparePending(pending, removed, today, notes) {
  const rows = [];
  const acked = [];

  for (const item of pending ?? []) {
    const id = item?.id;
    const payload = item?.payload ?? {};
    if (!id) continue;

    let quote;
    try {
      quote = makeQuote({
        text: payload.text,
        author: payload.author,
        work: payload.work ?? null,
        workKind: WORK_KINDS.includes(payload.workKind) ? payload.workKind : null,
        year: Number.isInteger(payload.year) ? payload.year : null,
        note: payload.note ?? '',
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        themes: cleanThemes(payload.themes),
        lang: payload.lang,
        source: {
          kind: 'manual',
          url: cleanUrl(payload.url, id, notes),
          locator: cleanLocator(payload.locator),
        },
        verification: cleanVerification(payload.verification, id, notes),
        addedAt: today,
      });
    } catch (error) {
      notes.warnings.push(`pending quote ${id} could not be read: ${error.message}`);
      acked.push(id); // Nothing here will ever parse; offering it again forever helps nobody.
      continue;
    }

    if (!quote.text) {
      notes.warnings.push(`pending quote ${id} has no text, so it was dropped`);
      acked.push(id);
      continue;
    }
    // A quote has to pass the collection's own checks to be filed. One that does
    // not (a single character is not a quotation, and the Worker only asks for
    // some text) would fail the whole collection at the validation below and
    // stop every sync after it, with every rating and star that is waiting
    // behind it. So it is set aside with a line in the warnings, and acked so it
    // is not offered again.
    const { errors: unfit } = validateCollection({ schemaVersion: SCHEMA_VERSION, quotes: [quote] });
    if (unfit.length) {
      notes.warnings.push(`pending quote ${id} was not filed: ${unfit[0].replace(/^quotes\[0\]: /, '')}`);
      acked.push(id);
      continue;
    }
    if (removed.has(quote.id)) {
      // Deliberately removed once is deliberately removed. Acked all the same,
      // so it stops coming back round; the line below is the record that it was
      // refused rather than lost.
      notes.warnings.push(`pending quote ${id} matches ${quote.id}, which was removed on purpose — refused`);
      acked.push(id);
      continue;
    }

    let subject = '';
    if (payload.subject !== undefined && payload.subject !== null && payload.subject !== '') {
      if (SUBJECTS.includes(payload.subject)) subject = payload.subject;
      else notes.warnings.push(`pending quote ${id}: "${payload.subject}" is not a subject in this collection, so it was ignored`);
    }

    rows.push({ id, quote, subject });
    acked.push(id);
  }

  return { rows, acked };
}

/**
 * The registry, looked up the way the page looks things up.
 *
 * The page finds a work by its exact title, and tells works apart by the slug of
 * the title (`./?work=crime-and-punishment`). So a title that differs from a
 * registered one only in case, spacing or punctuation is the registered work to
 * it, and `tests/works.test.mjs` fails a registry that holds both. A title with
 * no letters or digits slugs to nothing and says nothing, so it is nobody's twin.
 *
 * New records go in at their place in the registry's order (by title, ignoring
 * case), the order `register-work.py` keeps, so a registered work is a one-line
 * diff and not a reshuffle.
 */
function registryIndex(registry) {
  const byTitle = new Map();
  const bySlug = new Map();
  const remember = (work) => {
    const title = String(work.title).trim().toLowerCase();
    if (!byTitle.has(title)) byTitle.set(title, work);
    const key = slug(work.title);
    if (key && !bySlug.has(key)) bySlug.set(key, work);
  };
  for (const work of registry.works) remember(work);

  return {
    find: (title) => byTitle.get(String(title).trim().toLowerCase()) ?? bySlug.get(slug(title)) ?? null,
    add(record) {
      const key = String(record.title).toLowerCase();
      const at = registry.works.findIndex((work) => String(work.title).toLowerCase() > key);
      registry.works.splice(at === -1 ? registry.works.length : at, 0, record);
      remember(record);
    },
  };
}

/**
 * File the pending quotes one by one, and settle the registry as each lands.
 *
 * One at a time, because what a row means depends on what is already there: the
 * same words may be in the collection, or in the row before it, and only the
 * merge knows what became of this one. Each row is merged on its own with
 * `mergeQuotes`, and the registry is touched only for a row that did something
 * to its quote's work: it filed a new quote, or it supplied the work of a quote
 * that had none. A row that only repeats words the collection already has
 * registers nothing, whatever work it names, because that work would have no
 * quote under it. If the record already has a different work, the repeat gives
 * it no year and no kind of work either, since those belong to the work it named.
 *
 * For a row that did something to its quote's work, the work is settled in two
 * ways.
 *
 * The page finds a work by its exact title, so a quote that says "crime and
 * punishment" while the registry says "Crime and Punishment" would sit outside
 * every subject and era filter. A match by title or slug is therefore the same
 * work, and the quote is given the registry's spelling.
 *
 * A work the registry has never heard of is added when the sender gave a
 * subject and a year, and only then. A work with no subject is a registry entry
 * that fails its own validator, and a work with no year has no era, which fails
 * `tests/works.test.mjs` ("every work the collection quotes has a subject and an
 * era") and is something `register-work.py` refuses too. In both cases the quote
 * is filed unclassified, as it always was, and the build warns.
 */
function fileQuotes(existing, rows, registry, notes) {
  const index = Array.isArray(registry.works) ? registryIndex(registry) : null;
  let quotes = existing;
  const added = [];
  const enriched = [];
  let registered = 0;

  // The same work, as the page would see it: the same title in any case, the
  // same slug, or two spellings the registry resolves to one record.
  const sameWork = (a, b) => {
    if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) return true;
    if (slug(a) && slug(a) === slug(b)) return true;
    const known = index?.find(a);
    return Boolean(known && known === index.find(b));
  };

  for (const { id, quote, subject } of rows) {
    const before = quotes.find((candidate) => candidate.id === quote.id) ?? null;
    // The same words, already in the collection under another work. The merge
    // fills a record's empty fields from its repeat, and a year or a kind of
    // work belongs to a work, not to the words: left alone, a repeat sent from a
    // 2020 interview would stamp 2020 on a quote from a 1932 novel. This row
    // says nothing about the work the record has, so it gives no year and no kind.
    if (before?.work && quote.work && !sameWork(before.work, quote.work)) {
      notes.warnings.push(
        `pending quote ${id} repeats words the collection holds under "${before.work}" but names "${quote.work}", `
        + 'so its year and kind of work were not used',
      );
      quote.year = null;
      quote.workKind = null;
    }
    const step = mergeQuotes(quotes, [quote]);
    quotes = step.quotes;
    added.push(...step.added);
    enriched.push(...step.enriched);
    for (const filed of step.added) notes.applied.push(`new quote ${filed.id} by ${filed.author}`);
    for (const filled of step.enriched) notes.applied.push(`filled gaps in ${filled.id}`);

    // The record this row left behind, if it left one: a new quote, or an
    // existing one that this row gave a work to. A row that changed nothing, or
    // only added a tag, left nothing to register a work for.
    const record = step.added[0] ?? step.enriched[0] ?? null;
    const gaveTheWork = record && (step.added.length > 0 || (before?.work == null && record.work != null));
    if (!gaveTheWork || !record.work || !index) continue;

    const known = index.find(record.work);
    if (known) {
      if (record.work !== known.title) {
        notes.applied.push(`${record.id}: work "${record.work}" is "${known.title}" in the registry`);
        record.work = known.title;
      }
      continue;
    }

    if (!subject) continue;
    if (!Number.isInteger(record.year)) {
      notes.warnings.push(
        `pending quote ${id} names the new work "${record.work}" and a subject, but no year came with it, so the work was not `
        + 'registered and the quote is filed unclassified (the registry needs a year for the era filter)',
      );
      continue;
    }

    const work = { title: record.work, author: record.author, year: record.year };
    work.kind = record.workKind ?? 'other';
    work.subject = subject;
    // The link to the whole work comes from this row's own link, not from the
    // link of a quote it was merged into.
    const url = workUrl(quote.source?.url);
    if (url) work.url = url;

    const { errors } = validateWorks({ works: [work] }, { quotes: [] });
    if (errors.length) {
      notes.warnings.push(`could not register "${work.title}": ${errors[0]}`);
      continue;
    }

    index.add(work);
    registered += 1;
    notes.applied.push(`registered work "${work.title}" (${work.author}, ${work.subject})`);
  }

  return { quotes, added, enriched, registered };
}

/**
 * The whole job, on data rather than on files, so the tests can drive it.
 * Returns what changed and what should be written; writes nothing itself.
 */
export function applyShelfState(state, { registry, collection, removed = new Set(), today }) {
  const notes = { applied: [], warnings: [] };
  const day = today ?? new Date().toISOString().slice(0, 10);

  const worksChanges = applyWorks(registry, state?.works, notes);

  const { rows, acked } = preparePending(state?.pending, removed, day, notes);
  const { quotes, added, enriched, registered } = fileQuotes(collection.quotes ?? [], rows, registry, notes);

  // Favourites go on last, over the merged list, so a star pressed on a quote
  // that only arrived in this very run lands now and not three hours later.
  const favoriteChanges = applyFavorites(quotes, state?.favorites, notes);

  const quotesChanged = favoriteChanges > 0 || added.length > 0 || enriched.length > 0;
  const nextCollection = {
    ...collection,
    schemaVersion: SCHEMA_VERSION,
    quotes,
    ...(quotesChanged ? { updatedAt: new Date().toISOString() } : {}),
  };

  const { errors } = validateCollection(nextCollection);

  const worksChanged = worksChanges > 0 || registered > 0;

  return {
    changed: worksChanged || quotesChanged,
    worksChanged,
    quotesChanged,
    counts: {
      works: worksChanges,
      registered,
      favorites: favoriteChanges,
      added: added.length,
      enriched: enriched.length,
      refused: acked.length - rows.length,
    },
    ackIds: acked,
    applied: notes.applied,
    warnings: notes.warnings,
    errors,
    registry,
    collection: nextCollection,
  };
}

/* ---------------------------------------------------------------------------
 * The file-shaped version
 * ------------------------------------------------------------------------- */

export async function applyShelfStateToFiles(state, options = {}) {
  const files = { ...defaults(), ...options };
  const registry = JSON.parse(await readFile(files.worksFile, 'utf8'));
  const collection = JSON.parse(await readFile(files.quotesFile, 'utf8'));
  const removed = await readTombstones(files.removedFile);

  const result = applyShelfState(state, { registry, collection, removed, today: options.today });
  if (result.errors.length) return { ...result, wrote: [] };

  const wrote = [];
  if (!options.dryRun && result.worksChanged) {
    await writeFile(files.worksFile, `${JSON.stringify(result.registry, null, 2)}\n`, 'utf8');
    wrote.push(files.worksFile);
  }
  if (!options.dryRun && result.quotesChanged) {
    await writeFile(files.quotesFile, serializeCollection(result.collection), 'utf8');
    wrote.push(files.quotesFile);
  }
  return { ...result, wrote };
}

/* ---------------------------------------------------------------------------
 * Command line
 * ------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i += 1];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--from') options.from = next();
    else if (arg === '--url') options.url = next();
    else if (arg === '--ack-file') options.ackFile = next();
    else if (arg === '--works') options.worksFile = next();
    else if (arg === '--quotes') options.quotesFile = next();
    else if (arg === '--removed') options.removedFile = next();
    else if (arg === '--today') options.today = next();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

const HELP = `Apply the shelf Worker's state to the data files.

  --from <file>      read the state from a file instead of the Worker
  --url <url>        the Worker's base url (default: shelfApi.url in data/sources.json)
  --dry-run          say what would change, write nothing
  --ack-file <path>  write the ids of the pending quotes that were applied
  --works/--quotes/--removed <path>   point at other data files (for tests)
  --today <date>     the addedAt date for new quotes (default: today, UTC)
`;

function setOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  // Appended rather than written: other steps in the same job write here too.
  return writeFile(file, lines, { flag: 'a' });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  let state;
  try {
    state = await readState(options);
  } catch (error) {
    if (error.waiting) {
      process.stdout.write(`${error.message}\n`);
      await setOutputs({ changed: 'false', waiting: 'true' });
      return;
    }
    throw error;
  }

  const result = await applyShelfStateToFiles(state, options);

  for (const line of result.applied) process.stdout.write(`  ${line}\n`);
  for (const line of result.warnings) process.stdout.write(`  warning: ${line}\n`);

  if (result.errors.length) {
    process.stderr.write('Applying this would leave the collection invalid, so nothing was written:\n');
    for (const error of result.errors.slice(0, 10)) process.stderr.write(`  ${error}\n`);
    process.exitCode = 1;
    await setOutputs({ changed: 'false', failed: 'true' });
    return;
  }

  if (options.ackFile && !options.dryRun) {
    await writeFile(options.ackFile, `${JSON.stringify({ ids: result.ackIds }, null, 2)}\n`, 'utf8');
  }

  const { counts } = result;
  if (!result.changed) {
    process.stdout.write('nothing changed\n');
  } else {
    process.stdout.write(
      `${options.dryRun ? 'would apply' : 'applied'}: `
      + `${counts.works} work ${counts.works === 1 ? 'field' : 'fields'}, `
      + `${counts.favorites} ${counts.favorites === 1 ? 'favourite' : 'favourites'}, `
      + `${counts.added} new ${counts.added === 1 ? 'quote' : 'quotes'}`
      + `${counts.registered ? `, ${counts.registered} ${counts.registered === 1 ? 'work' : 'works'} registered` : ''}`
      + `${counts.refused ? `, ${counts.refused} refused` : ''}.\n`,
    );
    if (result.wrote.length) {
      process.stdout.write(`wrote ${result.wrote.map((file) => path.relative(REPO_ROOT, file)).join(', ')}\n`);
    }
  }

  await setOutputs({
    changed: String(result.changed && !options.dryRun),
    works: String(counts.works),
    registered: String(counts.registered),
    favorites: String(counts.favorites),
    added: String(counts.added),
    refused: String(counts.refused),
    acked: String(result.ackIds.length),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`apply-shelf-state failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
