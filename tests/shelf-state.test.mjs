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

import { applyShelfStateToFiles, workUrl } from '../scripts/apply-shelf-state.mjs';
import { SUBJECTS, eraFor, makeQuote, quoteId, slug, validateCollection, validateWorks } from '../assets/quote-core.js';
import { BadRequest, readQuotePayload } from '../worker/src/intake.mjs';

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

/* ---------------------------------------------------------------------------
 * The richer intake (2026-11-15)
 *
 * A quote sent from the video library carries more than its words: a link to
 * the moment, a place in it, a kind of work, themes, a language, a subject, and
 * a claim about how well it was checked. These tests follow a request from the
 * Worker's validation to the record in the file, because the two halves are
 * only correct together: the Worker decides what may be stored, and the sync
 * decides what that becomes.
 * ------------------------------------------------------------------------- */

const VIDEO_TEXT = 'The bottleneck is not the models, it is how fast people learn to use them.';
const VIDEO_BODY = {
  text: VIDEO_TEXT,
  author: 'Boris Cherny',
  work: 'Building Claude Code',
  year: 2026,
  url: 'https://youtu.be/ABCDEFGHIJK?t=754',
  locator: '12:34',
  workKind: 'interview',
  themes: ['technology', 'work'],
  subject: 'technology',
  lang: 'en',
  verification: { status: 'reported', note: 'Heard in the video.' },
};
const entry = (id, payload) => ({ id, payload, createdAt: '2026-11-15T09:00:00.000Z' });
const ID1 = 'aaaa0000-0000-4000-8000-000000000001';
const ID2 = 'aaaa0000-0000-4000-8000-000000000002';
const ID3 = 'aaaa0000-0000-4000-8000-000000000003';
const ID4 = 'aaaa0000-0000-4000-8000-000000000004';

test('a quote sent with every new field is filed with all of them, and its work is registered', async () => {
  const files = await workspace();
  const result = await apply({ pending: [entry(ID1, readQuotePayload(VIDEO_BODY))] }, files);

  assert.equal(result.errors.length, 0);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.registered, 1);
  assert.equal(result.worksChanged, true);
  assert.ok(result.wrote.includes(files.worksFile) && result.wrote.includes(files.quotesFile));

  const after = await readJson(files.quotesFile);
  const record = after.quotes.find((quote) => quote.id === quoteId(VIDEO_TEXT));
  assert.deepEqual(record.source, { kind: 'manual', url: 'https://youtu.be/ABCDEFGHIJK?t=754', locator: '12:34' });
  assert.equal(record.workKind, 'interview');
  assert.deepEqual(record.themes, ['technology', 'work']);
  assert.equal(record.lang, 'en');
  assert.deepEqual(record.verification, { status: 'reported', note: 'Heard in the video.' });
  assert.equal(record.work, 'Building Claude Code');
  assert.equal(record.year, 2026);

  // The subject lives on the work, so the work is what was registered: with the
  // quote's author and year, the kind it was sent with, and the link to the
  // video itself, not to the moment in it.
  const registry = await readJson(files.worksFile);
  assert.deepEqual(findWork(registry, 'Building Claude Code'), {
    title: 'Building Claude Code',
    author: 'Boris Cherny',
    year: 2026,
    kind: 'interview',
    subject: 'technology',
    url: 'https://youtu.be/ABCDEFGHIJK',
  });

  // Both files still pass their own validators, and the quoted work is no
  // longer "quoted but not in the registry", which is the warning that means a
  // quote is invisible under every subject and era filter.
  assert.deepEqual(validateCollection(after).errors, []);
  const checked = validateWorks(registry, after);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.warnings.some((line) => line.includes('Building Claude Code')), false);
});

test('an old-style payload is filed exactly as it always was', async () => {
  const body = {
    text: 'One must still have chaos in oneself to give birth to a dancing star.',
    author: 'Friedrich Nietzsche', work: 'Thus Spoke Zarathustra', year: 1883, note: 'A note.', tags: ['chaos'],
  };
  const payload = readQuotePayload(body);
  // Nothing new appears in what is stored unless it was sent.
  assert.deepEqual(Object.keys(payload), ['text', 'author', 'work', 'note', 'year', 'tags']);

  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({ pending: [entry(ID1, payload)] }, files);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.registered, 0);

  const record = (await readJson(files.quotesFile)).quotes.at(-1);
  assert.deepEqual(record.source, { kind: 'manual', url: null, locator: null });
  assert.equal(record.workKind, null);
  assert.deepEqual(record.themes, []);
  assert.equal(record.lang, 'en');
  assert.deepEqual(record.verification, { status: 'unverified' });
  assert.equal(record.favorite, false);
  // No subject came, so no work was invented for it.
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore);
});

test('a quote with no subject is filed, and no work is registered for it', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const { subject, ...withoutSubject } = VIDEO_BODY;
  void subject;
  const result = await apply({ pending: [entry(ID1, readQuotePayload(withoutSubject))] }, files);

  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.registered, 0);
  assert.equal(result.worksChanged, false);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore, 'the registry file was not even rewritten');
});

test('a registered work is not registered again, and a case difference takes the registry spelling', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: 'Man is condemned to be free, because once thrown into the world he is responsible.',
      author: 'Jean-Paul Sartre', work: 'the myth of sisyphus', subject: 'philosophy',
    }))],
  }, files);

  assert.equal(result.counts.registered, 0);
  const registry = await readJson(files.worksFile);
  assert.equal(registry.works.length, 2);
  // The page finds a work by its exact title, so the quote is given the
  // registry's spelling or it would sit outside every subject filter.
  const record = (await readJson(files.quotesFile)).quotes.at(-1);
  assert.equal(record.work, 'The Myth of Sisyphus');
  assert.match(result.applied.join('\n'), /"the myth of sisyphus" is "The Myth of Sisyphus" in the registry/);
});

test('a new work goes into the registry in its place by title, not at the end', async () => {
  const files = await workspace();
  await apply({
    pending: [entry(ID1, readQuotePayload({
      text: 'I can resist everything except temptation to quote this line.',
      author: 'Fyodor Dostoevsky', work: 'Notes from Underground', year: 1864, subject: 'literature', workKind: 'book',
    }))],
  }, files);

  const titles = (await readJson(files.worksFile)).works.map((work) => work.title);
  // Crime and Punishment, Notes from Underground, The Myth of Sisyphus: by
  // title ignoring case, which is the order register-work.py keeps.
  assert.deepEqual(titles, ['Crime and Punishment', 'Notes from Underground', 'The Myth of Sisyphus']);
});

test('two quotes from the same new work register it once', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      entry(ID1, readQuotePayload({ ...VIDEO_BODY })),
      entry(ID2, readQuotePayload({ ...VIDEO_BODY, text: 'Verification is the single most important thing you can give the model.', url: 'https://youtu.be/ABCDEFGHIJK?t=1500', locator: '25:00' })),
    ],
  }, files);

  assert.equal(result.counts.added, 2);
  assert.equal(result.counts.registered, 1);
  const registry = await readJson(files.worksFile);
  assert.equal(registry.works.filter((work) => work.title === 'Building Claude Code').length, 1);
});

test('a quote refused as removed registers nothing, however much it carries', async () => {
  const files = await workspace({ removedTexts: [REMOVED_TEXT] });
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: REMOVED_TEXT, author: 'Friedrich Nietzsche', work: 'A Work Only This Quote Names', year: 1886,
      subject: 'philosophy', workKind: 'book', url: 'https://example.org/essay', themes: ['truth'],
    }))],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.refused, 1);
  assert.equal(result.counts.registered, 0);
  assert.match(result.warnings.join(' '), /removed on purpose/);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore, 'the refused quote left no work behind');
  assert.deepEqual(result.ackIds, [ID1]);
});

test('nothing stronger than reported comes through, even from a row that skipped the Worker', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [entry(ID1, { text: VIDEO_TEXT, author: 'Boris Cherny', verification: { status: 'verified', note: 'I checked.' } })],
  }, files);

  const record = (await readJson(files.quotesFile)).quotes.at(-1);
  assert.equal(record.verification.status, 'unverified');
  assert.equal(record.verification.note, 'I checked.');
  assert.match(result.warnings.join(' '), /asked to be "verified"/);
});

test('a stored value that is not allowed is dropped with a line in the warnings, and the quote is still filed', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({
    pending: [entry(ID1, {
      text: VIDEO_TEXT, author: 'Boris Cherny', work: 'Building Claude Code',
      url: 'http://insecure.example.org/video', locator: 'x'.repeat(300), workKind: 'podcast',
      themes: ['technology', 'astrology', 'work', 'ai', 'power', 'time', 'truth'], lang: 'english', subject: 'astrology',
    })],
  }, files);

  assert.equal(result.counts.added, 1);
  const record = (await readJson(files.quotesFile)).quotes.at(-1);
  assert.equal(record.source.url, null);
  assert.equal(record.source.locator.length, 200);
  assert.equal(record.workKind, null);
  assert.deepEqual(record.themes, ['technology', 'work', 'power', 'time'], 'the first four known themes');
  assert.equal(record.lang, 'en');
  const said = result.warnings.join('\n');
  assert.match(said, /not a plain https address/);
  assert.match(said, /"astrology" is not a subject/);
  // A subject nobody can use registers no work.
  assert.equal(result.counts.registered, 0);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore);
});

test('a registered work gets kind "other" when no kind was sent', async () => {
  const files = await workspace();
  await apply({
    pending: [entry(ID1, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', work: 'An Untyped Talk', year: 2026, subject: 'technology' }))],
  }, files);

  assert.deepEqual(findWork(await readJson(files.worksFile), 'An Untyped Talk'), {
    title: 'An Untyped Talk', author: 'Boris Cherny', year: 2026, kind: 'other', subject: 'technology',
  });
});

/**
 * The repository's own rule, from tests/works.test.mjs: every work a quote
 * names is in the registry with a subject and an era. Repeated here so the sync
 * can be held to it on the data it has just written.
 */
const unclassified = (registry, collection) => {
  const byTitle = new Map(registry.works.map((work) => [work.title, work]));
  return collection.quotes
    .filter((quote) => quote.work)
    .filter((quote) => {
      const record = byTitle.get(quote.work);
      return !record || !SUBJECTS.includes(record.subject) || eraFor(record.year) === null;
    })
    .map((quote) => quote.work);
};

test('a new work is registered only when a year came with it, so the repository\'s own era rule still holds', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      entry(ID1, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', work: 'A Talk With A Year', year: 2026, subject: 'technology' })),
    ],
  }, files);
  assert.equal(result.counts.registered, 1);
  assert.deepEqual(unclassified(await readJson(files.worksFile), await readJson(files.quotesFile)), [],
    'every quoted work has a subject and an era after the sync');
});

test('a new work with a subject but no year is not registered, and the quote is filed unclassified with a warning', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', work: 'An Undated Talk', workKind: 'speech', subject: 'technology' }))],
  }, files);

  // The registry would hold a work with no era, which the era rule above
  // forbids; and register-work.py refuses it for the same reason.
  assert.equal(result.counts.added, 1, 'the quote itself is filed');
  assert.equal(result.counts.registered, 0);
  assert.equal(result.worksChanged, false);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore, 'no year-less record was written');
  assert.match(result.warnings.join('\n'), new RegExp(`pending quote ${ID1} names the new work "An Undated Talk" and a subject, but no year came with it`));
  assert.equal((await readJson(files.quotesFile)).quotes.at(-1).work, 'An Undated Talk');
  assert.deepEqual(result.errors, []);
});

test('a subject with no work, or a work already registered, asks for no year and says nothing', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      // A remembered subject on a quote with no work at all.
      entry(ID1, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', subject: 'technology' })),
      // A work the registry has: the subject is the registry's business, not the quote's.
      entry(ID2, readQuotePayload({ text: 'Man is condemned to be free, because once thrown into the world he is responsible.', author: 'Jean-Paul Sartre', work: 'The Myth of Sisyphus', subject: 'technology' })),
    ],
  }, files);
  assert.equal(result.counts.added, 2);
  assert.equal(result.counts.registered, 0);
  assert.deepEqual(result.warnings, []);
});

test('the work gets the link to the whole video, with the time and the sharing parameters taken off', () => {
  assert.equal(workUrl('https://youtu.be/ABC?t=754'), 'https://youtu.be/ABC');
  assert.equal(workUrl('https://youtu.be/ABC?si=xyz&t=61'), 'https://youtu.be/ABC');
  assert.equal(workUrl('https://www.youtube.com/watch?v=ABC&t=754s'), 'https://www.youtube.com/watch?v=ABC');
  assert.equal(workUrl('https://www.youtube.com/watch?v=ABC&list=PL1&t=9'), 'https://www.youtube.com/watch?v=ABC&list=PL1');
  assert.equal(workUrl('https://www.youtube.com/watch?v=ABC#t=40'), 'https://www.youtube.com/watch?v=ABC');
  // Other addresses are kept as they were.
  assert.equal(workUrl('https://www.dwarkesh.com/p/andrej-karpathy'), 'https://www.dwarkesh.com/p/andrej-karpathy');
  assert.equal(workUrl('https://example.org/essay?t=1'), 'https://example.org/essay?t=1');
  assert.equal(workUrl('http://example.org/essay'), null);
  assert.equal(workUrl('not a link'), null);
  assert.equal(workUrl(undefined), null);
});

test('with the new fields, running the same state twice still changes nothing the second time', async () => {
  const files = await workspace();
  const state = { pending: [entry(ID1, readQuotePayload(VIDEO_BODY))] };
  const first = await apply(state, files);
  assert.equal(first.changed, true);

  const worksAfter = await readFile(files.worksFile, 'utf8');
  const quotesAfter = await readFile(files.quotesFile, 'utf8');
  const second = await apply(state, files);
  assert.equal(second.changed, false);
  assert.deepEqual(second.wrote, []);
  assert.equal(second.counts.registered, 0);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksAfter);
  assert.equal(await readFile(files.quotesFile, 'utf8'), quotesAfter);
});

test('a dry run counts the registration and writes neither file', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const quotesBefore = await readFile(files.quotesFile, 'utf8');
  const result = await applyShelfStateToFiles(
    { pending: [entry(ID1, readQuotePayload(VIDEO_BODY))] },
    { ...files, today: TODAY, dryRun: true },
  );

  assert.equal(result.counts.registered, 1);
  assert.deepEqual(result.wrote, []);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore);
  assert.equal(await readFile(files.quotesFile, 'utf8'), quotesBefore);
});

test('a star pressed on a quote that arrives in the same run lands in that run', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [entry(ID1, readQuotePayload(VIDEO_BODY))],
    favorites: { [quoteId(VIDEO_TEXT)]: { on: true, updatedAt: '2026-11-15T09:05:00.000Z' } },
  }, files);

  assert.equal(result.counts.favorites, 1);
  assert.deepEqual(result.warnings, []);
  const record = (await readJson(files.quotesFile)).quotes.find((quote) => quote.id === quoteId(VIDEO_TEXT));
  assert.equal(record.favorite, true);
});

test('an explicit off in the Worker takes a star off a quote the repository had starred', async () => {
  const files = await workspace();
  const collection = await readJson(files.quotesFile);
  const id = collection.quotes[0].id;
  collection.quotes[0].favorite = true;
  await writeFile(files.quotesFile, `${JSON.stringify(collection, null, 2)}\n`);

  const result = await apply({ favorites: { [id]: { on: false, updatedAt: '2026-11-15T09:00:00.000Z' } } }, files);
  assert.equal(result.counts.favorites, 1);
  assert.equal((await readJson(files.quotesFile)).quotes[0].favorite, false);
});

test('a quote starred in the repository keeps its star when the same words are filed again', async () => {
  const files = await workspace();
  const collection = await readJson(files.quotesFile);
  collection.quotes[1].favorite = true;
  await writeFile(files.quotesFile, `${JSON.stringify(collection, null, 2)}\n`);

  const result = await apply({
    pending: [entry(ID1, readQuotePayload({ text: REPEAT_TEXT, author: 'Carl Jung', work: 'Memories, Dreams, Reflections' }))],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal((await readJson(files.quotesFile)).quotes[1].favorite, true);
  assert.equal(result.counts.favorites, 0, 'and nothing was counted as a change to the star');
});

test('a quote too short to be a quotation is set aside, and does not stop the ones behind it', async () => {
  const files = await workspace();
  const result = await apply({
    works: { 'crime-and-punishment': { rating: 10 } },
    pending: [
      entry(ID1, { text: 'a', author: 'Someone' }),
      entry(ID2, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny' })),
    ],
  }, files);

  // Left in, the one-character quote fails the collection's own validation, and
  // a sync that fails closed never acks anything, so it would stop every run
  // after this one, ratings and stars included.
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), new RegExp(`pending quote ${ID1} was not filed: text is missing or too short`));
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.refused, 1);
  assert.deepEqual(result.ackIds.sort(), [ID1, ID2], 'both are acked, so neither is offered again');
  assert.ok(result.wrote.includes(files.worksFile) && result.wrote.includes(files.quotesFile));
  assert.equal(findWork(await readJson(files.worksFile), 'Crime and Punishment').rating, 10, 'the rating behind it still landed');
  assert.equal((await readJson(files.quotesFile)).quotes.some((quote) => quote.text === 'a'), false);
});

test('a title that slugs like a registered one is the registered work, not a second one the filters cannot tell apart', async () => {
  const files = await workspace();
  const registry = await readJson(files.worksFile);
  registry.works.unshift({ title: 'A.I. Superpowers', author: 'Kai-Fu Lee', year: 2018, kind: 'book', subject: 'technology' });
  // A registered title in another script slugs to nothing at all, which must
  // not make it the twin of every other title in that script.
  registry.works.push({ title: 'ウォルデン', author: 'Henry David Thoreau', year: 1854, kind: 'book', subject: 'literature' });
  await writeFile(files.worksFile, `${JSON.stringify(registry, null, 2)}\n`);

  const result = await apply({
    pending: [
      entry(ID1, readQuotePayload({ text: 'The age of implementation is giving way to the age of discovery, said no one yet.', author: 'Kai-Fu Lee', work: 'A I Superpowers', year: 2018, subject: 'technology' })),
      // A title with no letters or digits slugs to nothing, and is nobody's twin.
      entry(ID2, readQuotePayload({ text: 'An untitled work in another script can still be filed by its subject.', author: 'Someone', work: '日本語', year: 2001, subject: 'literature' })),
      // Two new titles that slug alike, in the same run: the first is registered, the second is it.
      entry(ID3, readQuotePayload({ text: 'The first line quoted from a talk that nobody has registered yet.', author: 'Pat Example', work: 'Brand New Talk', year: 2024, subject: 'technology' })),
      entry(ID4, readQuotePayload({ text: 'A second line from the same talk, whose title was typed with a dash.', author: 'Pat Example', work: 'Brand-New Talk!', year: 2024, subject: 'technology' })),
    ],
  }, files);

  assert.equal(result.counts.registered, 2, 'the Japanese title and Brand New Talk, once each');
  const after = await readJson(files.worksFile);
  assert.equal(after.works.filter((work) => work.title === 'A.I. Superpowers').length, 1);
  assert.equal(after.works.some((work) => work.title === 'A I Superpowers'), false);
  assert.equal(after.works.some((work) => work.title === '日本語'), true);
  assert.equal(after.works.filter((work) => slug(work.title) === 'brand-new-talk').length, 1);
  const quotes = (await readJson(files.quotesFile)).quotes;
  assert.equal(quotes.find((quote) => quote.author === 'Kai-Fu Lee').work, 'A.I. Superpowers');
  assert.deepEqual(quotes.filter((quote) => quote.author === 'Pat Example').map((quote) => quote.work), ['Brand New Talk', 'Brand New Talk']);
  assert.deepEqual(validateWorks(after, { quotes }).errors, []);
});

/* ---------------------------------------------------------------------------
 * A work is registered for a quote that was filed, and for no other
 *
 * The first version looked at every pending row, filed or not, and kept one
 * subject per quote id. A row that only repeated words the collection already
 * had registered a work with no quote under it, and two rows with the same
 * words but different works lent each other their subject.
 * ------------------------------------------------------------------------- */

test('a row that only repeats words the collection already has registers no work for them', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: EXISTING_TEXT, author: 'Albert Camus', work: 'A Work Named By A Duplicate', year: 2020, workKind: 'book', subject: 'technology',
    }))],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.registered, 0);
  assert.equal(result.changed, false);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore, 'no registry entry with no quote under it');
  assert.equal((await readJson(files.quotesFile)).quotes[0].work, 'The Myth of Sisyphus', 'the existing record keeps its own work');
  assert.deepEqual(result.ackIds, [ID1], 'and the row is still taken, so it is not offered again');
});

test('a repeat under another work does not stamp its year or kind of work on the quote the collection already has', async () => {
  const files = await workspace();
  const before = (await readJson(files.quotesFile)).quotes[0];
  assert.equal(before.year, null);
  assert.equal(before.workKind, null);

  // The same words, sent from a 2020 interview. The record is a quote from
  // The Myth of Sisyphus, and 2020 is not its year.
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: EXISTING_TEXT, author: 'Albert Camus', work: 'An Interview About Camus', year: 2020, workKind: 'interview', subject: 'philosophy',
    }))],
  }, files);

  assert.equal(result.changed, false, 'nothing about the record changed');
  const after = (await readJson(files.quotesFile)).quotes[0];
  assert.equal(after.year, null);
  assert.equal(after.workKind, null);
  assert.equal(after.work, 'The Myth of Sisyphus');
  assert.match(result.warnings.join('\n'), /repeats words the collection holds under "The Myth of Sisyphus" but names "An Interview About Camus"/);
});

test('a repeat under the same work, however it is spelled, still fills what the record lacks', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: EXISTING_TEXT, author: 'Albert Camus', work: 'the myth of  SISYPHUS', year: 1942, workKind: 'book',
    }))],
  }, files);

  assert.equal(result.counts.enriched, 1);
  const after = (await readJson(files.quotesFile)).quotes[0];
  assert.equal(after.year, 1942);
  assert.equal(after.workKind, 'book');
  assert.equal(after.work, 'The Myth of Sisyphus');
  assert.deepEqual(result.warnings, []);
});

test('two rows with the same words and different works: the first is filed, the second registers nothing and does not lend its subject', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      entry(ID1, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', work: 'Abn Work Five', year: 2026, subject: 'history' })),
      entry(ID2, readQuotePayload({ text: VIDEO_TEXT, author: 'Boris Cherny', work: 'Abn Work Five Again', year: 2026, subject: 'law' })),
    ],
  }, files);

  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.registered, 1);
  const registry = await readJson(files.worksFile);
  assert.equal(findWork(registry, 'Abn Work Five').subject, 'history', 'the first row\'s subject, for the first row\'s work');
  assert.equal(findWork(registry, 'Abn Work Five Again'), undefined);
  const quotes = (await readJson(files.quotesFile)).quotes;
  assert.equal(quotes.filter((quote) => quote.text === VIDEO_TEXT).length, 1);
  assert.equal(quotes.at(-1).work, 'Abn Work Five');
  const checked = validateWorks(registry, { quotes });
  assert.equal(checked.warnings.some((line) => line.includes('Abn Work') && line.includes('has no quotes')), false, 'no work left without a quote');
});

test('a row that gives a work to a quote that had none registers that work, with the row\'s own subject and year', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({
      text: REPEAT_TEXT, author: 'Carl Jung', work: 'Memories, Dreams, Reflections', year: 1962, workKind: 'book', subject: 'psychology',
    }))],
  }, files);

  assert.equal(result.counts.added, 0);
  assert.equal(result.counts.enriched, 1);
  assert.equal(result.counts.registered, 1);
  assert.deepEqual(findWork(await readJson(files.worksFile), 'Memories, Dreams, Reflections'), {
    title: 'Memories, Dreams, Reflections', author: 'Carl Jung', year: 1962, kind: 'book', subject: 'psychology',
  });
  const after = await readJson(files.quotesFile);
  assert.equal(after.quotes[1].work, 'Memories, Dreams, Reflections');
  assert.deepEqual(unclassified(await readJson(files.worksFile), after), []);
});

test('a row that gives a work to a quote that had none, with no year, registers nothing and says so', async () => {
  const files = await workspace();
  const worksBefore = await readFile(files.worksFile, 'utf8');
  const result = await apply({
    pending: [entry(ID1, readQuotePayload({ text: REPEAT_TEXT, author: 'Carl Jung', work: 'Memories, Dreams, Reflections', subject: 'psychology' }))],
  }, files);

  assert.equal(result.counts.enriched, 1, 'the work still goes onto the quote');
  assert.equal(result.counts.registered, 0);
  assert.equal(await readFile(files.worksFile, 'utf8'), worksBefore);
  assert.match(result.warnings.join('\n'), /no year came with it/);
});

test('two different quotes from one new work register it once, with the subject of the first', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      entry(ID1, readQuotePayload({ ...VIDEO_BODY, subject: 'technology' })),
      entry(ID2, readQuotePayload({ ...VIDEO_BODY, text: 'Verification is the single most important thing you can give the model.', subject: 'law' })),
    ],
  }, files);

  assert.equal(result.counts.registered, 1);
  assert.equal(findWork(await readJson(files.worksFile), 'Building Claude Code').subject, 'technology');
});

test('a repeat of a quote the collection already has changes nothing in it, not even the spelling of its work', async () => {
  const files = await workspace();
  const collection = await readJson(files.quotesFile);
  collection.quotes[0].work = 'the myth of sisyphus';
  await writeFile(files.quotesFile, `${JSON.stringify(collection, null, 2)}\n`);

  const result = await apply({
    pending: [entry(ID1, readQuotePayload({ text: EXISTING_TEXT, author: 'Albert Camus', work: 'The Myth of Sisyphus', subject: 'philosophy' }))],
  }, files);
  assert.equal(result.changed, false);
  assert.equal((await readJson(files.quotesFile)).quotes[0].work, 'the myth of sisyphus');
});

/* ---------------------------------------------------------------------------
 * A stored link is held to the Worker's own rule
 * ------------------------------------------------------------------------- */

test('a stored link must be written out as https://, and is filed with its scheme in lower case', async () => {
  const files = await workspace();
  const result = await apply({
    pending: [
      // The URL parser reads these as https addresses; the registry's validator and register-work.py do not.
      entry(ID1, { text: 'A line with a link that has no slashes after the scheme.', author: 'A. One', url: 'https:evil.example/path' }),
      entry(ID2, { text: 'A line with a link that has one slash after the scheme.', author: 'B. Two', url: 'https:/evil.example/path' }),
      entry(ID3, {
        text: 'A line with a link whose scheme is in capitals, and a work to go with it.', author: 'C. Three',
        work: 'A Capital Work', year: 2020, subject: 'technology', url: 'HTTPS://Example.com/Path?t=5',
      }),
    ],
  }, files);

  const quotes = (await readJson(files.quotesFile)).quotes;
  assert.equal(quotes.find((quote) => quote.author === 'A. One').source.url, null);
  assert.equal(quotes.find((quote) => quote.author === 'B. Two').source.url, null);
  assert.equal(quotes.find((quote) => quote.author === 'C. Three').source.url, 'https://Example.com/Path?t=5');
  assert.equal(result.warnings.filter((line) => /not a plain https address/.test(line)).length, 2);
  assert.equal(findWork(await readJson(files.worksFile), 'A Capital Work').url, 'https://example.com/Path?t=5');
  assert.deepEqual(result.errors, []);
});
