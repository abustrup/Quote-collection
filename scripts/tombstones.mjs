/**
 * The list of quotes deliberately taken out of the collection.
 *
 * This exists because a quote's id is a hash of its own text. That is what
 * makes importing idempotent, and it is also what makes plain deletion useless:
 * drop a quote from `data/quotes.json` and the next morning's Goodreads sync
 * derives the same id from the same words, finds it absent, and files it again.
 *
 * So every importer asks this module first. Kept in its own file rather than in
 * `curate.mjs` so the importers do not have to depend on the program that
 * deletes things.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TOMBSTONE_FILE = path.join(REPO_ROOT, 'data', 'removed.json');

/** The set of ids that must not come back. Missing file means nothing is barred. */
export async function readTombstones(file = TOMBSTONE_FILE) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return new Set((parsed.removed ?? []).map((entry) => entry.id).filter(Boolean));
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

/**
 * Drop anything that has been removed, and say how many.
 *
 * Returning the count rather than filtering silently is the point: an import
 * that quietly discards nine of ten quotes looks identical to an import that
 * found only one, and the difference matters when something has gone wrong.
 */
export function withoutRemoved(quotes, removed) {
  if (!removed.size) return { kept: quotes, skipped: [] };
  const kept = [];
  const skipped = [];
  for (const quote of quotes) {
    if (quote.id && removed.has(quote.id)) skipped.push(quote);
    else kept.push(quote);
  }
  return { kept, skipped };
}
