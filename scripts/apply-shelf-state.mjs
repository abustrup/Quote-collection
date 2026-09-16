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
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serializeCollection } from './ingest.mjs';
import { readTombstones } from './tombstones.mjs';

import {
  SCHEMA_VERSION,
  makeQuote,
  mergeQuotes,
  slug,
  validateCollection,
} from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHELVES = ['read', 'reading', 'to-read', 'abandoned'];
const SCORES = ['rating', 'want'];

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

/**
 * Turn the pending quotes into records the collection can hold.
 *
 * Same building blocks as `scripts/ingest.mjs` on purpose — `makeQuote` for the
 * record, `mergeQuotes` for the merge, the tombstones for the refusal — so a
 * quote typed into the site and a quote filed through a GitHub issue end up
 * byte-identical, and neither route can invent a field the other does not have.
 */
function preparePending(pending, removed, today, notes) {
  const incoming = [];
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
        year: Number.isInteger(payload.year) ? payload.year : null,
        note: payload.note ?? '',
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        source: { kind: 'manual', url: null, locator: null },
        verification: { status: 'unverified' },
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
    if (removed.has(quote.id)) {
      // Deliberately removed once is deliberately removed. Acked all the same,
      // so it stops coming back round; the line below is the record that it was
      // refused rather than lost.
      notes.warnings.push(`pending quote ${id} matches ${quote.id}, which was removed on purpose — refused`);
      acked.push(id);
      continue;
    }

    incoming.push(quote);
    acked.push(id);
  }

  return { incoming, acked };
}

/**
 * The whole job, on data rather than on files, so the tests can drive it.
 * Returns what changed and what should be written; writes nothing itself.
 */
export function applyShelfState(state, { registry, collection, removed = new Set(), today }) {
  const notes = { applied: [], warnings: [] };
  const day = today ?? new Date().toISOString().slice(0, 10);

  const worksChanges = applyWorks(registry, state?.works, notes);
  const favoriteChanges = applyFavorites(collection.quotes ?? [], state?.favorites, notes);

  const { incoming, acked } = preparePending(state?.pending, removed, day, notes);
  const { quotes, added, enriched } = mergeQuotes(collection.quotes ?? [], incoming);
  for (const quote of added) notes.applied.push(`new quote ${quote.id} by ${quote.author}`);
  for (const quote of enriched) notes.applied.push(`filled gaps in ${quote.id}`);

  const quotesChanged = favoriteChanges > 0 || added.length > 0 || enriched.length > 0;
  const nextCollection = {
    ...collection,
    schemaVersion: SCHEMA_VERSION,
    quotes,
    ...(quotesChanged ? { updatedAt: new Date().toISOString() } : {}),
  };

  const { errors } = validateCollection(nextCollection);

  return {
    changed: worksChanges > 0 || quotesChanged,
    worksChanged: worksChanges > 0,
    quotesChanged,
    counts: {
      works: worksChanges,
      favorites: favoriteChanges,
      added: added.length,
      enriched: enriched.length,
      refused: acked.length - incoming.length,
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
      + `${counts.refused ? `, ${counts.refused} refused` : ''}.\n`,
    );
    if (result.wrote.length) {
      process.stdout.write(`wrote ${result.wrote.map((file) => path.relative(REPO_ROOT, file)).join(', ')}\n`);
    }
  }

  await setOutputs({
    changed: String(result.changed && !options.dryRun),
    works: String(counts.works),
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
