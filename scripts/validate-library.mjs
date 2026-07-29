#!/usr/bin/env node
/**
 * Check data/library.json, the works the recommender may suggest.
 *
 * This exists because nothing checked it. `validate.mjs` only understands quote
 * collections, so the library was the one data file in the repository with no
 * guard at all — and it drifted exactly where you would expect: three entries
 * carried a `kind` of "lecture", a value the shared vocabulary has never had.
 * Nobody noticed, because nothing reads `kind`.
 *
 * The rule this encodes is worth stating plainly: a controlled field that no
 * check enforces is a suggestion, and a suggestion in a data file decays.
 *
 * Usage: node scripts/validate-library.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { THEMES, WORK_KINDS, slug } from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY_FILE = path.join(REPO_ROOT, 'data', 'library.json');
const DIFFICULTIES = ['accessible', 'demanding', 'hard'];

const errors = [];
const warnings = [];

function check(condition, message, list = errors) {
  if (!condition) list.push(message);
}

async function main() {
  let library;
  try {
    library = JSON.parse(await readFile(LIBRARY_FILE, 'utf8'));
  } catch (error) {
    process.stderr.write(`data/library.json could not be read: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const works = library.works ?? [];
  check(Array.isArray(works) && works.length > 0, 'library.works must be a non-empty array');
  if (!Array.isArray(works)) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  const ids = new Set();

  for (const [index, work] of works.entries()) {
    const where = `works[${index}] (${work.id ?? 'no id'})`;

    check(typeof work.id === 'string' && work.id === slug(work.id), `${where}: id is missing or not a slug`);
    check(!ids.has(work.id), `${where}: duplicate id`);
    ids.add(work.id);

    check(typeof work.title === 'string' && work.title.trim().length > 0, `${where}: title is missing`);
    check(typeof work.author === 'string' && work.author.trim().length > 0, `${where}: author is missing`);
    check(typeof work.why === 'string' && work.why.trim().length > 20,
      `${where}: why is missing or too short — it is the whole point of the entry`);

    check(work.kind == null || WORK_KINDS.includes(work.kind),
      `${where}: kind "${work.kind}" is not in the shared vocabulary`);
    check(work.difficulty == null || DIFFICULTIES.includes(work.difficulty),
      `${where}: difficulty "${work.difficulty}" is not one of ${DIFFICULTIES.join(', ')}`);
    check(work.year == null || (Number.isInteger(work.year) && work.year >= -800 && work.year <= 2100),
      `${where}: implausible year ${work.year}`);

    for (const theme of work.themes ?? []) {
      check(THEMES.includes(theme), `${where}: theme "${theme}" is not in the shared vocabulary`);
    }
  }

  // A pairsWith pointing at nothing is a recommendation the reader never sees.
  for (const work of works) {
    for (const other of work.pairsWith ?? []) {
      check(ids.has(other), `${work.id}: pairsWith "${other}" does not exist`);
    }
  }

  // adjacentTo is matched by slug against author names elsewhere, so a name
  // written two ways is a bonus that silently never fires.
  const authorSlugs = new Set(works.map((work) => slug(work.author)));
  const named = new Map();
  for (const work of works) {
    for (const other of work.adjacentTo ?? []) named.set(slug(other), other);
  }
  for (const [key, name] of named) {
    if (!authorSlugs.has(key)) continue;
    const exact = works.find((work) => slug(work.author) === key && work.author !== name);
    if (exact) {
      warnings.push(`adjacentTo "${name}" is spelled "${exact.author}" elsewhere — pick one form`);
    }
  }

  const label = `data/library.json (${works.length} works)`;
  if (errors.length) {
    process.stdout.write(`bad ${label}\n`);
    for (const error of errors) process.stdout.write(`      error   ${error}\n`);
    for (const warning of warnings) process.stdout.write(`      warning ${warning}\n`);
    process.stdout.write(`\n${errors.length} error${errors.length === 1 ? '' : 's'}.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`ok  ${label}\n`);
  for (const warning of warnings) process.stdout.write(`      warning ${warning}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
