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
  SHELVES,
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

/* --------------------------------------------------------------------------
 * The library half: shelves, scores, covers and dates
 *
 * These arrived on 2026-09-16 with 87 books from Goodreads. They are all
 * optional — a record with none of them is a citation and still valid — so
 * every test here is about a field that is present and wrong, plus the one
 * warning that had to change meaning when the registry stopped being only a
 * list of things he had quoted.
 * ------------------------------------------------------------------------ */

const registryOf = (work) => ({
  works: [{ title: 'A', author: 'B', subject: 'philosophy', year: 1900, ...work }],
});

test('a shelf outside the four is refused', () => {
  for (const shelf of SHELVES) {
    const { errors } = validateWorks(registryOf({ shelf }), { quotes: [] });
    assert.deepEqual(errors, [], `${shelf} should be a shelf`);
  }
  const { errors } = validateWorks(registryOf({ shelf: 'want-to-read' }), { quotes: [] });
  assert.ok(errors.some((error) => /unknown shelf "want-to-read"/.test(error)));
});

test('rating and want are whole numbers from 0 to 10', () => {
  for (const score of [0, 5, 10]) {
    assert.deepEqual(validateWorks(registryOf({ rating: score }), { quotes: [] }).errors, []);
    assert.deepEqual(validateWorks(registryOf({ want: score }), { quotes: [] }).errors, []);
  }
  // 11 and -1 are off the end; 7.5 and "8" would each need a different reader
  // on the page than the number control writes.
  for (const bad of [11, -1, 7.5, '8']) {
    const rating = validateWorks(registryOf({ rating: bad }), { quotes: [] }).errors;
    const want = validateWorks(registryOf({ want: bad }), { quotes: [] }).errors;
    assert.ok(rating.some((error) => /rating must be a whole number/.test(error)), `rating ${bad}`);
    assert.ok(want.some((error) => /want must be a whole number/.test(error)), `want ${bad}`);
  }
});

test('a cover is a path inside the repo, not a link somewhere else', () => {
  assert.deepEqual(
    validateWorks(registryOf({ cover: 'assets/covers/crime-and-punishment.webp' }), { quotes: [] }).errors,
    [],
  );
  for (const bad of [
    'https://covers.openlibrary.org/b/id/123.jpg',
    'assets/covers/Crime.webp',
    'assets/covers/crime.jpg',
    '../assets/covers/crime.webp',
  ]) {
    const { errors } = validateWorks(registryOf({ cover: bad }), { quotes: [] });
    assert.ok(errors.some((error) => /cover must be assets\/covers/.test(error)), bad);
  }
});

test('coverSize is two whole pixel counts, so the page can reserve the box', () => {
  assert.deepEqual(validateWorks(registryOf({ coverSize: [333, 500] }), { quotes: [] }).errors, []);
  for (const bad of [[333], [333, 500, 2], ['333', 500], [0, 500], [333.5, 500], '333x500', 500]) {
    const { errors } = validateWorks(registryOf({ coverSize: bad }), { quotes: [] });
    assert.ok(errors.some((error) => /coverSize must be/.test(error)), JSON.stringify(bad));
  }
});

test('added and read are real calendar days', () => {
  assert.deepEqual(validateWorks(registryOf({ added: '2026-09-16', read: '2023-10-30' }), { quotes: [] }).errors, []);
  for (const bad of ['16-09-2026', '2026-9-1', '2026-02-30', 2026]) {
    const { errors } = validateWorks(registryOf({ added: bad }), { quotes: [] });
    assert.ok(errors.some((error) => /added must be an ISO date/.test(error)), String(bad));
  }
});

test('pages is a positive whole number', () => {
  assert.deepEqual(validateWorks(registryOf({ pages: 368 }), { quotes: [] }).errors, []);
  for (const bad of [0, -5, 12.5, '368']) {
    const { errors } = validateWorks(registryOf({ pages: bad }), { quotes: [] });
    assert.ok(errors.some((error) => /pages must be a positive whole number/.test(error)), String(bad));
  }
});

test('a goodreads link must be https, like every other link the page follows', () => {
  const { errors } = validateWorks(
    registryOf({ goodreads: { id: '1', isbn: '', url: 'http://www.goodreads.com/book/show/1' } }),
    { quotes: [] },
  );
  assert.ok(errors.some((error) => /goodreads.url must be https/.test(error)));
});

test('a shelved book with no quotes is a library, not a leftover', () => {
  // Most of a library is books nobody has pulled a line out of yet, so the
  // "no quotes" warning would fire 66 times on the real file and stop meaning
  // anything. Without a shelf it still fires: that is a citation left behind.
  const shelved = validateWorks(registryOf({ shelf: 'to-read' }), { quotes: [] });
  assert.deepEqual(shelved.errors, []);
  assert.deepEqual(shelved.warnings.filter((warning) => /has no quotes/.test(warning)), []);

  const unshelved = validateWorks(registryOf({}), { quotes: [] });
  assert.ok(unshelved.warnings.some((warning) => /"A" is in the registry but has no quotes/.test(warning)));
});

test('the shipped registry carries his library, and it is internally consistent', async () => {
  const registry = await read('works.json');
  const shelved = registry.works.filter((work) => work.shelf);

  // 87 books came off Goodreads on 2026-09-16: 30 read, 48 to-read,
  // 3 currently reading, 6 did not finish.
  assert.equal(shelved.length, 87);
  const counts = {};
  for (const work of shelved) counts[work.shelf] = (counts[work.shelf] ?? 0) + 1;
  assert.deepEqual(counts, { read: 30, 'to-read': 48, reading: 3, abandoned: 6 });

  // Every rating came from a Goodreads star count, so every one is even.
  const rated = registry.works.filter((work) => work.rating != null);
  assert.equal(rated.length, 21);
  assert.deepEqual(rated.filter((work) => work.rating % 2 !== 0), []);

  // Nothing is rated that he has not read, and nothing shelved lost its date.
  for (const work of shelved) {
    assert.ok(work.added, `${work.title} has no added date`);
    assert.ok(work.goodreads?.id, `${work.title} has no Goodreads id`);
    if (work.read) assert.ok(work.shelf === 'read', `${work.title} has a read date but is ${work.shelf}`);
  }

  // Every book has a cover, and every cover file is where the record says.
  const covers = new Set();
  for (const work of registry.works.filter((work) => work.kind === 'book')) {
    assert.ok(work.cover, `${work.title} has no cover`);
    assert.ok(!covers.has(work.cover), `two works share ${work.cover}`);
    covers.add(work.cover);
    assert.equal(work.cover, `assets/covers/${slug(work.title)}.webp`);
    await assert.doesNotReject(
      readFile(path.join(REPO_ROOT, work.cover)),
      `${work.cover} is in the registry but not in the repository`,
    );
    assert.ok(work.coverSource, `${work.title} has a cover but no record of where it came from`);

    // The page reserves each cover's box from this, so it has to be there and
    // it has to be the shape of a book.
    const [width, height] = work.coverSize ?? [];
    assert.ok(Number.isInteger(width) && Number.isInteger(height), `${work.title} has no coverSize`);
    assert.ok(height >= 500, `${work.title} cover is ${width}x${height}`);
    assert.ok(width / height >= 0.55 && width / height <= 0.8, `${work.title} cover is ${width}x${height}`);
  }
});

test('nothing but a book stands on a shelf, and every shelved book has its length', async () => {
  const registry = await read('works.json');

  // A talk, an essay or a podcast has no shelf: the page puts those in their
  // own section with a typographic cover, and a shelf status on one of them
  // would put the same work in two places at once.
  const oddities = registry.works.filter((work) => work.shelf && work.kind !== 'book');
  assert.deepEqual(oddities.map((work) => `${work.title} (${work.kind})`), []);

  // Page counts drive the drawn height of a book on the shelf, and the page
  // draws nothing rather than guessing one. Exactly one of the 87 has none:
  // Goodreads left it blank and Open Library's own figure for it is a
  // placeholder, so it stays absent rather than being invented. Named here
  // rather than tolerated, so a second one cannot appear unnoticed.
  const unmeasured = registry.works.filter((work) => work.shelf && work.pages == null);
  assert.deepEqual(
    unmeasured.map((work) => work.title),
    ['Power and Progress: Our Thousand-Year Struggle Over Technology and Prosperity'],
  );
});
