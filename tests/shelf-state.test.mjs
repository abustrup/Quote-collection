/**
 * Tests for the sync that carries the site's edits back into the repository.
 *
 * This is the one piece of the write path where a mistake is expensive. The
 * Worker can be wrong and the site simply looks stale; this script rewrites the
 * two data files that are the archive, unattended, every three hours. So the
 * cases here are the ones that would hurt: a change applied to the wrong book,
 * a clear that does not clear, a quote that was deleted on purpose walking back
 * in, and — least visible of all — a second run that writes something after the
 * first run already wrote everything, which would put a commit in the history
 * every three hours forever.
 *
 * Every test runs against fixtures in a temp directory. The real data files are
 * never opened.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyShelfStateToFiles } from '../scripts/apply-shelf-state.mjs';
import { makeQuote } from '../assets/quote-core.js';

const TODAY = '2026-09-16';

const EXISTING_TEXT = 'The only way to deal with an unfree world is to become so absolutely free that your very existence is an act of rebellion.';
const REPEAT_TEXT = 'A man who has not passed through the inferno of his passions has never overcome them.';
const REMOVED_TEXT = 'Convictions are more dangerous enemies of truth than lies.';

/** A small registry and collection on disk, valid by the project's own rules. */
async function workspace({ removedTexts = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shelf-state-'));
  await mkdir(dir, { recursive: true });

  const registry = {
    schemaVersion: 1,
    works: [
      { title: 'Crime and Punishment', author: 'Fyodor Dostoevsky', year: 1866, kind: 'book', subject: 'literature', rating: 8 },
      { title: 'The Myth of Sisyphus', author: 'Albert Camus', year: 1942, kind: 'book', subject: 'philosophy' },
    ],
  };

  const quotes = [
    makeQuote({
      text: EXISTING_TEXT,
      author: 'Albert Camus',
      work: 'The Myth of Sisyphus',
      addedAt: '2026-07-29',
    }),
    // Deliberately missing its work, so a pending quote carrying one can be
    // seen to merge into it rather than to duplicate it.
    makeQuote({ text: REPEAT_TEXT, author: 'Carl Jung', addedAt: '2026-07-29' }),
  ];

  const collection = { schemaVersion: 1, updatedAt: '2026-09-01T00:00:00.000Z', quotes };
  const removed = {
    schemaVersion: 1,
    removed: removedTexts.map((text) => ({ id: makeQuote({ text, author: 'Someone' }).id, text })),
  };

  const files = {
    worksFile: path.join(dir, 'works.json'),
    quotesFile: path.join(dir, 'quotes.json'),
    removedFile: path.join(dir, 'removed.json'),
  };
  await writeFile(files.worksFile, `${JSON.stringify(registry, null, 2)}\n`);
  await writeFile(files.quotesFile, `${JSON.stringify(collection, null, 2)}\n`);
  await writeFile(files.removedFile, `${JSON.stringify(removed, null, 2)}\n`);
  return { dir, ...files };
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const findWork = (registry, title) => registry.works.find((work) => work.title === title);
const apply = (state, files) => applyShelfStateToFiles(state, { ...files, today: TODAY });

test('a rating and a shelf land on the right book', async () => {
  const files = await workspace();
  const result = await apply({
    works: { 'the-myth-of-sisyphus': { rating: 9, shelf: 'read', updatedAt: '2026-09-16T10:00:00.000Z' } },
  }, files);

  assert.equal(result.changed, true);
  assert.equal(result.errors.length, 0);

  const registry = await readJson(files.worksFile);
  const sisyphus = findWork(registry, 'The Myth of Sisyphus');
  assert.equal(sisyphus.rating, 9);
  assert.equal(sisyphus.shelf, 'read');
  // The other book is untouched, which is the part a wrong join would break.
  assert.equal(findWork(registry, 'Crime and Punishment').rating, 8);
});

test('null clears a field it had before', async () => {
  const files = await workspace();
  const result = await apply({
    works: { 'crime-and-punishment': { rating: null, shelf: 'reading' } },
  }, files);

  assert.equal(result.changed, true);
  const registry = await readJson(files.worksFile);
  const book = findWork(registry, 'Crime and Punishment');
  assert.equal('rating' in book, false);
  assert.equal(book.shelf, 'reading');
});

test('a want of 0 is kept, not mistaken for nothing', async () => {
  const files = await workspace();
  await apply({ works: { 'crime-and-punishment': { want: 0 } } }, files);
  const registry = await readJson(files.worksFile);
  assert.equal(findWork(registry, 'Crime and Punishment').want, 0);
});

test('an unknown slug is reported and ignored', async () => {
  const files = await workspace();
  const before = await readFile(files.worksFile, 'utf8');
  const result = await apply({ works: { 'a-book-nobody-registered': { rating: 7 } } }, files);

  assert.equal(result.changed, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /a-book-nobody-registered/);
  assert.equal(await readFile(files.worksFile, 'utf8'), before);
});

test('a bad value is refused rather than written', async () => {
  const files = await workspace();
  const result = await apply({
    works: { 'crime-and-punishment': { rating: 42, shelf: 'somewhere-else' } },
  }, files);

  assert.equal(result.changed, false);
  assert.equal(result.warnings.length, 2);
  assert.equal(findWork(await readJson(files.worksFile), 'Crime and Punishment').rating, 8);
});

test('a favourite lands on the quote it names', async () => {
  const files = await workspace();
  const collection = await readJson(files.quotesFile);
  const id = collection.quotes[0].id;

  const result = await apply({ favorites: { [id]: { on: true, updatedAt: '2026-09-16T10:00:00.000Z' } } }, files);
  assert.equal(result.changed, true);

  const after = await readJson(files.quotesFile);
  assert.equal(after.quotes.find((quote) => quote.id === id).favorite, true);
  assert.equal(after.quotes[1].favorite, false);
});

test('a favourite for a quote nobody has is reported, not invented', async () => {
  const files = await workspace();
  const result = await apply({ favorites: { q_000000000000: { on: true } } }, files);
  assert.equal(result.changed, false);
  assert.match(result.warnings[0], /q_000000000000/);
});

test('a pending quote is appended with a real id and today’s date', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [{
      id: '5f4e3d2c-1b0a-4f3e-9d8c-7b6a5f4e3d2c',
      payload: { text: 'One must still have chaos in oneself to give birth to a dancing star.', author: 'Friedrich Nietzsche', work: 'Thus Spoke Zarathustra', tags: ['chaos'] },
      createdAt: '2026-09-16T09:00:00.000Z',
    }],
  }, files);

  assert.equal(result.counts.added, 1);
  assert.deepEqual(result.ackIds, ['5f4e3d2c-1b0a-4f3e-9d8c-7b6a5f4e3d2c']);

  const after = await readJson(files.quotesFile);
  assert.equal(after.quotes.length, 3);
  const fresh = after.quotes[2];
  assert.match(fresh.id, /^q_[0-9a-f]{12}$/);
  assert.equal(fresh.id, makeQuote({ text: 'One must still have chaos in oneself to give birth to a dancing star.', author: 'x' }).id);
  assert.equal(fresh.source.kind, 'manual');
  assert.equal(fresh.verification.status, 'unverified');
  assert.equal(fresh.addedAt, TODAY);
  assert.equal(fresh.work, 'Thus Spoke Zarathustra');
  assert.deepEqual(fresh.tags, ['chaos']);
});

test('a pending quote already in the collection merges instead of duplicating', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [{
      id: 'aaaa1111-2222-4333-8444-555566667777',
      payload: { text: REPEAT_TEXT, author: 'Carl Jung', work: 'Memories, Dreams, Reflections' },
      createdAt: '2026-09-16T09:00:00.000Z',
    }],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.enriched, 1);

  const after = await readJson(files.quotesFile);
  assert.equal(after.quotes.length, 2);
  // The gap the existing record had is filled; nothing else about it moved.
  assert.equal(after.quotes[1].work, 'Memories, Dreams, Reflections');
  assert.equal(after.quotes[1].addedAt, '2026-07-29');
});

test('a quote that was removed on purpose cannot come back', async () => {
  const files = await workspace({ removedTexts: [REMOVED_TEXT] });
  const result = await apply({
    pending: [{
      id: 'bbbb1111-2222-4333-8444-555566667777',
      payload: { text: REMOVED_TEXT, author: 'Friedrich Nietzsche' },
      createdAt: '2026-09-16T09:00:00.000Z',
    }],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.refused, 1);
  assert.match(result.warnings.join(' '), /removed on purpose/);
  assert.equal((await readJson(files.quotesFile)).quotes.length, 2);
  // Acked all the same: leaving it pending would offer it again every run.
  assert.deepEqual(result.ackIds, ['bbbb1111-2222-4333-8444-555566667777']);
});

test('running the same state twice changes nothing the second time', async () => {
  const files = await workspace();
  const state = {
    works: { 'the-myth-of-sisyphus': { rating: 9, shelf: 'read' }, 'crime-and-punishment': { want: 6 } },
    favorites: {},
    pending: [{
      id: 'cccc1111-2222-4333-8444-555566667777',
      payload: { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche' },
      createdAt: '2026-09-16T09:00:00.000Z',
    }],
  };

  const collection = await readJson(files.quotesFile);
  state.favorites[collection.quotes[0].id] = { on: true };

  const first = await apply(state, files);
  assert.equal(first.changed, true);

  const worksAfter = await readFile(files.worksFile, 'utf8');
  const quotesAfter = await readFile(files.quotesFile, 'utf8');

  const second = await apply(state, files);
  assert.equal(second.changed, false);
  assert.deepEqual(second.wrote, []);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksAfter);
  assert.equal(await readFile(files.quotesFile, 'utf8'), quotesAfter);
});

test('a dry run says what would happen and writes nothing', async () => {
  const files = await workspace();
  const before = await readFile(files.worksFile, 'utf8');
  const result = await applyShelfStateToFiles(
    { works: { 'crime-and-punishment': { rating: 10 } } },
    { ...files, today: TODAY, dryRun: true },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.wrote, []);
  assert.equal(await readFile(files.worksFile, 'utf8'), before);
});

test('an empty state is not a change', async () => {
  const files = await workspace();
  const result = await apply({ works: {}, favorites: {}, pending: [] }, files);
  assert.equal(result.changed, false);
  assert.deepEqual(result.warnings, []);
});
