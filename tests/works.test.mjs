/**
 * Tests for the objective facets: the work registry, subjects and eras.
 *
 * The point of moving classification from the quote to the work is that it can
 * be checked. So these tests check it — that the registry covers everything the
 * collection quotes, that no subject is invented on the way in, and that era is
 * arithmetic rather than opinion.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ERAS,
  SUBJECTS,
  WORK_ALIASES,
  canonicalWork,
  eraFor,
  slug,
  validateWorks,
} from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = async (file) => JSON.parse(await readFile(path.join(REPO_ROOT, 'data', file), 'utf8'));

/* --------------------------------------------------------------------------
 * Eras are computed, not assigned
 * ------------------------------------------------------------------------ */

test('a year lands in exactly one era', () => {
  for (const year of [-500, -350, 180, 1637, 1739, 1859, 1900, 1901, 2000, 2001, 2026]) {
    const matches = ERAS.filter((era) => year >= era.from && year <= era.to);
    assert.equal(matches.length, 1, `${year} matched ${matches.length} eras`);
  }
});

test('the era boundaries do not have an off-by-one', () => {
  assert.equal(eraFor(1900), 'c19');
  assert.equal(eraFor(1901), 'c20');
  assert.equal(eraFor(2000), 'c20');
  assert.equal(eraFor(2001), 'contemporary');
  assert.equal(eraFor(500), 'antiquity');
  assert.equal(eraFor(501), 'medieval');
});

test('no year means no era, rather than a guessed one', () => {
  assert.equal(eraFor(null), null);
  assert.equal(eraFor(undefined), null);
  assert.equal(eraFor('1949'), null);
  assert.equal(eraFor(1949.5), null);
});

/* --------------------------------------------------------------------------
 * One title per work
 * ------------------------------------------------------------------------ */

test('a title with an alias resolves to the one the collection uses', () => {
  assert.equal(canonicalWork('Notes from the Underground'), 'Notes from Underground');
  assert.equal(canonicalWork('NOTES FROM THE UNDERGROUND'), 'Notes from Underground');
  assert.equal(canonicalWork('The Myth of Sisyphus and Other Essays'), 'The Myth of Sisyphus');
});

test('a title with no alias is left exactly as it is', () => {
  assert.equal(canonicalWork('War and Peace'), 'War and Peace');
  assert.equal(canonicalWork('  Meditations  '), 'Meditations');
  assert.equal(canonicalWork(''), null);
  assert.equal(canonicalWork(null), null);
});

test('no alias points at another alias, which would need two passes to resolve', () => {
  for (const target of WORK_ALIASES.values()) {
    assert.ok(
      !WORK_ALIASES.has(target.toLowerCase()),
      `"${target}" is both an alias target and an alias`,
    );
  }
});

/* --------------------------------------------------------------------------
 * The registry against the real data
 * ------------------------------------------------------------------------ */

test('the shipped registry and collection agree', async () => {
  const { errors } = validateWorks(await read('works.json'), await read('quotes.json'));

  // Errors only. A registry entry left behind when its last quote is removed is
  // a warning by design — tidying it is housekeeping, not a broken build, and
  // failing here would mean every removal had to be followed by a registry edit
  // before anything else could merge.
  assert.deepEqual(errors, []);
});

test('every work the collection quotes has a subject and an era', async () => {
  const registry = await read('works.json');
  const collection = await read('quotes.json');
  const byTitle = new Map(registry.works.map((work) => [work.title, work]));

  const orphans = [];
  for (const quote of collection.quotes) {
    if (!quote.work) continue;
    const record = byTitle.get(quote.work);
    if (!record || !SUBJECTS.includes(record.subject) || eraFor(record.year) === null) {
      orphans.push(`${quote.work} (${quote.id})`);
    }
  }
  assert.deepEqual(orphans, [], 'these quotes would vanish from the subject and era filters');
});

test('no two works slug to the same filter value', async () => {
  const registry = await read('works.json');
  const seen = new Map();
  for (const work of registry.works) {
    const key = slug(work.title);
    assert.ok(!seen.has(key), `"${work.title}" and "${seen.get(key)}" both filter as ?work=${key}`);
    seen.set(key, work.title);
  }
});

test('the registry only uses subjects from the controlled list', async () => {
  const registry = await read('works.json');
  for (const work of registry.works) {
    assert.ok(SUBJECTS.includes(work.subject), `${work.title} has subject "${work.subject}"`);
  }
});

test('a work quoted but not registered is reported, and does not fail the build', () => {
  const registry = { works: [{ title: 'A', author: 'B', subject: 'philosophy', year: 1900 }] };
  const collection = { quotes: [{ work: 'A' }, { work: 'Nowhere' }] };
  const { errors, warnings } = validateWorks(registry, collection);

  // Deliberately a warning. Adding a quote from an unclassified book is a
  // normal thing to do from a phone, and it must not be able to turn CI red —
  // that would make the only no-terminal way in capable of breaking the repo.
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((warning) => /Nowhere.*not in the registry/.test(warning)));
});

test('a registry url must be https, since the page links straight out to it', () => {
  const registry = {
    works: [{ title: 'A', author: 'B', subject: 'philosophy', url: 'javascript:alert(1)' }],
  };
  const { errors } = validateWorks(registry, { quotes: [{ work: 'A' }] });
  assert.ok(errors.some((error) => /url must be https/.test(error)));
});
