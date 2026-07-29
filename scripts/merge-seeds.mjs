#!/usr/bin/env node
/**
 * Fold the curated seed files into the collection.
 *
 * `data/seed/*.json` are hand-curated sets, each an array of partial quotes
 * grouped by where they came from — the AI essays, the philosophy reading, and
 * so on. Keeping them as separate files rather than pasting them straight into
 * `data/quotes.json` means a set can be revised, re-checked, or dropped as a
 * unit long after it was written.
 *
 * Merging is additive and idempotent: existing records win on every field they
 * already fill, so re-running this never overwrites a correction, a note, or a
 * verification someone did the work to earn. Run it as often as you like.
 *
 * Usage:
 *   node scripts/merge-seeds.mjs [--dry-run]
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, makeQuote, mergeQuotes, validateCollection } from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(REPO_ROOT, 'data', 'seed');
const DATA_FILE = path.join(REPO_ROOT, 'data', 'quotes.json');

const dryRun = process.argv.includes('--dry-run');

/**
 * Order the collection so that the file's diff is about the quotes and not
 * about where the tooling happened to append them. Author first, then the text
 * itself, so a new quote by an author already present lands next to their
 * others rather than at the bottom.
 */
function sortQuotes(quotes) {
  return [...quotes].sort((a, b) =>
    a.author.localeCompare(b.author, 'en') ||
    (a.work ?? '').localeCompare(b.work ?? '', 'en') ||
    a.text.localeCompare(b.text, 'en'));
}

async function main() {
  let seedFiles = [];
  try {
    seedFiles = (await readdir(SEED_DIR)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    console.log('No data/seed directory — nothing to merge.');
    return;
  }

  const existing = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  let collection = existing.quotes ?? [];
  const before = collection.length;
  const report = [];

  for (const name of seedFiles) {
    const raw = JSON.parse(await readFile(path.join(SEED_DIR, name), 'utf8'));
    const incoming = (Array.isArray(raw) ? raw : raw.quotes ?? []).map((quote) => makeQuote(quote));
    const result = mergeQuotes(collection, incoming);
    collection = result.quotes;
    report.push(`${name.padEnd(24)} ${String(incoming.length).padStart(4)} read  ${String(result.added.length).padStart(4)} new  ${String(result.enriched.length).padStart(4)} enriched`);
  }

  const merged = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    quotes: sortQuotes(collection),
  };

  const { errors, warnings } = validateCollection(merged);

  console.log(report.join('\n'));
  console.log(`\n${before} -> ${merged.quotes.length} quotes`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);

  if (errors.length) {
    console.error('\nRefusing to write — the merged collection is not valid:');
    for (const error of errors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    return;
  }

  await writeFile(DATA_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${path.relative(REPO_ROOT, DATA_FILE)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
