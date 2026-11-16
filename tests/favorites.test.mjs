/**
 * Tests for where a favourite lives and which copy wins.
 *
 * On 2026-11-15 it turned out that none of his favourites had ever been saved
 * anywhere durable. The page kept them in the browser unless editing had been
 * unlocked on that device, no unlocked device ever starred one, and so the
 * repository held none and the Worker held none; the 21 he had were found by
 * reading them out of a Chrome. These tests pin the rules that came out of it.
 *
 *   - A favourite that the repository flags is shown as one with an empty
 *     browser and a Worker that knows nothing. That is the whole point.
 *   - The Worker's explicit "off" takes a star off a quote the repository has
 *     starred. Nothing else can, from another device.
 *   - A locked device can still star and un-star, on that device, and the
 *     newest press wins over an older word from the Worker.
 *   - Unlocking carries what was pressed while locked up to the Worker, and
 *     only that: not what the repository already says, not quotes the page does
 *     not have.
 *
 * `store.js` is a browser module, so each test gets its own copy of it and its
 * own pretend localStorage. No network is touched: `fetch` is replaced.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const A = 'q_aaaaaaaaaaaa';
const B = 'q_bbbbbbbbbbbb';
const C = 'q_cccccccccccc';
const D = 'q_dddddddddddd';

/** A localStorage that lives in a Map, installed for the length of one test. */
function installStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  globalThis.localStorage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
  return map;
}

let copies = 0;
/** A fresh copy of the store, with none of the last test's state in its memory. */
async function freshStore() {
  copies += 1;
  return import(`../assets/store.js?copy=${copies}`);
}

const NOTHING = { works: {}, favorites: {}, pending: [], generatedAt: null };
const quotes = (flagged, plain = []) => [
  ...flagged.map((id) => ({ id, favorite: true })),
  ...plain.map((id) => ({ id, favorite: false })),
];

/* ---------------------------------------------------------------------------
 * The rules, as a pure function
 * ------------------------------------------------------------------------- */

test('the repository flags alone are the favourites', async () => {
  const { mergeFavorites } = await freshStore();
  assert.deepEqual([...mergeFavorites({ repo: [A, B] })].sort(), [A, B]);
});

test('the Worker adds a star, and its explicit off takes away one the repository has', async () => {
  const { mergeFavorites } = await freshStore();
  const set = mergeFavorites({
    repo: [A, B],
    worker: { [B]: { on: false, updatedAt: '2026-11-15T10:00:00.000Z' }, [C]: { on: true, updatedAt: '2026-11-15T10:00:00.000Z' } },
  });
  assert.deepEqual([...set].sort(), [A, C]);
});

test('the old browser list adds stars, and the Worker still has the last word over it', async () => {
  const { mergeFavorites } = await freshStore();
  const set = mergeFavorites({
    legacy: [A, B],
    worker: { [B]: { on: false, updatedAt: '2026-11-15T10:00:00.000Z' } },
  });
  assert.deepEqual([...set], [A]);
});

test('a local un-star removes a star the repository has, on this device', async () => {
  const { mergeFavorites } = await freshStore();
  const set = mergeFavorites({
    repo: [A, B],
    choices: { [A]: { on: false, at: '2026-11-15T10:00:00.000Z' }, [C]: { on: true, at: '2026-11-15T10:00:00.000Z' } },
  });
  assert.deepEqual([...set].sort(), [B, C]);
});

test('the newer word wins between a local press and the Worker', async () => {
  const { mergeFavorites } = await freshStore();
  const worker = { [A]: { on: false, updatedAt: '2026-11-15T10:00:00.000Z' }, [B]: { on: true, updatedAt: '2026-11-15T10:00:00.000Z' } };

  // Pressed after the Worker was told: the press stands.
  const newer = mergeFavorites({
    repo: [A], worker,
    choices: { [A]: { on: true, at: '2026-11-15T11:00:00.000Z' }, [B]: { on: false, at: '2026-11-15T11:00:00.000Z' } },
  });
  assert.deepEqual([...newer], [A]);

  // Pressed before it (or at the same moment): the Worker stands.
  const older = mergeFavorites({
    repo: [A], worker,
    choices: { [A]: { on: true, at: '2026-11-15T09:00:00.000Z' }, [B]: { on: false, at: '2026-11-15T10:00:00.000Z' } },
  });
  assert.deepEqual([...older], [B]);
});

test('ids the page does not have are dropped when it says what it has, so the count matches the stars', async () => {
  const { mergeFavorites } = await freshStore();
  const set = mergeFavorites({ repo: [A], legacy: [B], worker: { [C]: { on: true } }, known: new Set([A, C]) });
  assert.deepEqual([...set].sort(), [A, C]);
  // Not told yet: nothing is dropped.
  assert.equal(mergeFavorites({ repo: [A], legacy: [B], known: new Set() }).size, 2);
});

/* ---------------------------------------------------------------------------
 * The store, reading its layers
 * ------------------------------------------------------------------------- */

test('an empty browser and a Worker that knows nothing still show every repository favourite', async () => {
  installStorage();
  const store = await freshStore();
  store.setCollection(quotes([A, B], [C, D]));
  assert.deepEqual([...store.favorites()].sort(), [A, B]);
});

test('the layers read from storage are laid over the repository', async () => {
  installStorage({
    'quotes-favorites': [C],
    'shelf-state': { ...NOTHING, favorites: { [B]: { on: false, updatedAt: '2026-11-15T10:00:00.000Z' } } },
    'quotes-favorites-choices': { [A]: { on: false, at: '2026-11-15T12:00:00.000Z' } },
  });
  const store = await freshStore();
  store.setCollection(quotes([A, B], [C, D]));
  // A: the repository starred it and a later local press un-starred it.
  // B: the repository starred it and the Worker says off.
  // C: starred in the old browser list.
  assert.deepEqual([...store.favorites()], [C]);
});

test('a star on a quote that was removed from the collection is not counted', async () => {
  installStorage({ 'quotes-favorites': [A, 'q_ffffffffffff'] });
  const store = await freshStore();
  store.setCollection(quotes([], [A, B]));
  assert.deepEqual([...store.favorites()], [A]);
});

test('a press while locked is kept on this device, with its time, and in the old list', async () => {
  const map = installStorage();
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));

  let told = 0;
  store.onChange(() => { told += 1; });
  assert.equal(store.setLocalFavorite(B, true), true, 'it says it kept the press');
  assert.equal(store.setLocalFavorite(A, false), true);

  assert.deepEqual([...store.favorites()], [B]);
  assert.equal(told, 2, 'the page is told after each press');
  assert.deepEqual(JSON.parse(map.get('quotes-favorites')), [B]);
  const choices = JSON.parse(map.get('quotes-favorites-choices'));
  assert.equal(choices[B].on, true);
  assert.equal(choices[A].on, false);
  assert.match(choices[A].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('a press while locked beats the Worker\'s earlier word even when this device\'s clock runs behind', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  installStorage({ 'shelf-state': { ...NOTHING, favorites: { [B]: { on: false, updatedAt: tomorrow } } } });
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));
  assert.deepEqual([...store.favorites()], [A], 'the Worker says B is off');

  store.setLocalFavorite(B, true);
  assert.deepEqual([...store.favorites()].sort(), [A, B], 'the press stands, whatever the clocks say');
});

test('a press the browser will not store is reported as not kept, and nothing pretends otherwise', async () => {
  // Site data blocked: every read and every write throws.
  const refuse = () => { throw new Error('SecurityError: storage is blocked'); };
  globalThis.localStorage = { getItem: refuse, setItem: refuse, removeItem: refuse };
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));

  let told = 0;
  store.onChange(() => { told += 1; });
  assert.equal(store.setLocalFavorite(B, true), false, 'not kept, so the page must not say it was');
  assert.equal(told, 1, 'the page is still told, so the star goes back to what is really stored');
  assert.deepEqual([...store.favorites()], [A], 'the press left no trace');

  // A full quota refuses writes but still reads: the same answer.
  installStorage();
  globalThis.localStorage.setItem = refuse;
  const full = await freshStore();
  full.setCollection(quotes([A], [B]));
  assert.equal(full.setLocalFavorite(B, true), false);
});

/* ---------------------------------------------------------------------------
 * Unlocking carries the local presses up
 * ------------------------------------------------------------------------- */

/** A Worker that says yes to everything and remembers what it was asked. */
function pretendWorker() {
  const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    if (text.endsWith('/ping')) return new Response('{}', { status: 200 });
    if (text.endsWith('/favorite')) {
      posts.push({ body: JSON.parse(init.body), auth: init.headers?.authorization });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 }); // data/sources.json, the state: not needed here
  };
  return posts;
}

async function settle(posts, count) {
  for (let i = 0; i < 100 && posts.length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 30)); // and a moment for anything that should not arrive
}

test('unlocking sends the Worker what was pressed while locked, and nothing the repository already says', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  installStorage({
    // C: starred here, not known to anyone else. A: starred here and already
    // flagged in the repository. D: not in the collection any more.
    'quotes-favorites': [A, C, D],
    // B: the repository's star, un-starred here. A second press on C.
    'quotes-favorites-choices': {
      [B]: { on: false, at: '2026-11-15T10:00:00.000Z' },
      [C]: { on: true, at: '2026-11-15T10:00:01.000Z' },
      [A]: { on: true, at: '2026-11-15T10:00:02.000Z' },
    },
  });
  const posts = pretendWorker();
  const store = await freshStore();
  store.setCollection(quotes([A, B], [C]));

  assert.equal(await store.unlock('the-test-code'), true);
  await settle(posts, 2);

  const sent = Object.fromEntries(posts.map((post) => [post.body.id, post.body.on]));
  assert.deepEqual(sent, { [B]: false, [C]: true }, 'the un-star and the new star, and no more');
  assert.ok(posts.every((post) => post.auth === 'Bearer the-test-code'), 'sent with the key, as a header');

  // Held by the Worker now, so the local choices have nothing left to say.
  assert.equal(JSON.parse(localStorage.getItem('quotes-favorites-choices') ?? '{}')[B], undefined);
  assert.equal(store.state().favorites[C].on, true);
  assert.equal(store.state().favorites[B].on, false);
  assert.deepEqual([...store.favorites()].sort(), [A, C]);
});

test('unlocking with nothing pressed sends nothing', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  installStorage();
  const posts = pretendWorker();
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));

  assert.equal(await store.unlock('the-test-code'), true);
  await settle(posts, 1);
  assert.equal(posts.length, 0);
});

test('a refused key keeps what was pressed on this device and sends nothing', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  installStorage({ 'quotes-favorites-choices': { [B]: { on: true, at: '2026-11-15T10:00:00.000Z' } } });
  globalThis.fetch = async (url) => (String(url).endsWith('/ping') ? new Response('', { status: 401 }) : new Response('', { status: 404 }));
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));

  assert.equal(await store.unlock('wrong'), false);
  assert.equal(localStorage.getItem('shelf-edit-code'), null, 'a code that did not work is not remembered');
  assert.deepEqual([...store.favorites()].sort(), [A, B]);
});

test('starring while unlocked goes to the Worker and clears the local press it replaces', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  installStorage({
    'shelf-edit-code': 'the-test-code',
    'quotes-favorites-choices': { [B]: { on: false, at: '2026-11-15T10:00:00.000Z' } },
  });
  const posts = pretendWorker();
  const store = await freshStore();
  store.setCollection(quotes([A], [B]));

  await store.setFavorite(B, true);
  assert.deepEqual(posts.map((post) => post.body), [{ id: B, on: true }]);
  assert.deepEqual(JSON.parse(localStorage.getItem('quotes-favorites-choices')), {});
  assert.deepEqual([...store.favorites()].sort(), [A, B]);
});

/* ---------------------------------------------------------------------------
 * Pending quotes, as the page draws them
 * ------------------------------------------------------------------------- */

const row = (id, payload, createdAt = '2026-11-15T09:00:00.000Z') => ({ id, payload, createdAt });

test('a pending quote keeps its source link, its place in it and everything else it was sent with', async () => {
  const { pendingQuotes } = await freshStore();
  const [record] = pendingQuotes([row('w1', {
    text: 'The bottleneck is not the models.', author: 'Boris Cherny', work: 'Building Claude Code', year: 2026,
    url: 'https://youtu.be/ABC?t=754', locator: '12:34', workKind: 'interview', themes: ['technology'], lang: 'en',
    subject: 'technology', verification: { status: 'reported', note: 'Heard in the video.' }, tags: ['ai'], note: 'Noted.',
  })]);

  assert.deepEqual(record.source, { kind: 'manual', url: 'https://youtu.be/ABC?t=754', locator: '12:34' });
  assert.equal(record.workKind, 'interview');
  assert.deepEqual(record.themes, ['technology']);
  assert.equal(record.lang, 'en');
  assert.deepEqual(record.verification, { status: 'reported', note: 'Heard in the video.' });
  assert.equal(record.work, 'Building Claude Code');
  assert.equal(record._pending, true);
  assert.equal(record._subjectHint, 'technology');
  assert.match(record.id, /^q_[0-9a-f]{12}$/);
});

test('an old pending quote is drawn as it always was', async () => {
  const { pendingQuotes } = await freshStore();
  const [record] = pendingQuotes([row('w1', { text: 'Only the old fields.', author: 'X', work: 'Y', year: 1999, tags: ['a'] })]);
  assert.deepEqual(record.source, { kind: 'manual', url: null, locator: null });
  assert.deepEqual(record.themes, []);
  assert.equal(record.workKind, null);
  assert.equal(record._subjectHint, '');
  assert.deepEqual(record.verification, { status: 'unverified' });
});

test('a work the registry does not know takes its subject from the sender, and shares it between quotes', async () => {
  const { pendingQuotes } = await freshStore();
  const records = pendingQuotes([
    row('w1', { text: 'First line from the talk.', author: 'X', work: 'A New Talk', year: 2020, subject: 'economics' }),
    row('w2', { text: 'Second line from the talk.', author: 'X', work: 'A New Talk' }),
    row('w3', { text: 'A line from another talk.', author: 'X', work: 'Another Talk', year: 2021, subject: 'astrology' }),
  ]);
  assert.deepEqual(records.map((record) => record._subjectHint), ['economics', 'economics', ''],
    'the second quote shares the first one\'s subject; a subject that is not on the list is not used');
});

test('a subject with no year is not trusted, because the sync will not register the work without one', async () => {
  const { pendingQuotes } = await freshStore();
  const records = pendingQuotes([
    row('w1', { text: 'A line from a talk with no known year.', author: 'X', work: 'An Undated Talk', subject: 'economics' }),
    // The year can come on a later quote of the same work: that one is what the sync would register it from.
    row('w2', { text: 'Another line from a talk with no known year.', author: 'X', work: 'An Undated Talk', year: 2020, subject: 'law' }),
    row('w3', { text: 'A line from a talk that has a year.', author: 'X', work: 'A Dated Talk', year: 2020, subject: 'technology' }),
  ]);
  assert.deepEqual(records.map((record) => record._subjectHint), ['law', 'law', 'technology']);

  const [alone] = pendingQuotes([row('w1', { text: 'A line from a talk with no known year.', author: 'X', work: 'An Undated Talk', subject: 'economics' })]);
  assert.equal(alone._subjectHint, '', 'nothing to show it under, so the quote stays unclassified until someone gives the work a year');
});

test('a title that differs from the registry only in case is read as the registry spells it', async () => {
  const { pendingQuotes } = await freshStore();
  const titles = new Map([['the myth of sisyphus', 'The Myth of Sisyphus']]);
  const [record] = pendingQuotes([row('w1', { text: 'One must imagine Sisyphus happy.', author: 'Camus', work: ' the myth of SISYPHUS ' })], { titles });
  assert.equal(record.work, 'The Myth of Sisyphus');
});

test('a pending quote the page already has is not drawn twice, and an empty one is not drawn at all', async () => {
  const { pendingQuotes } = await freshStore();
  const { quoteId } = await import('../assets/quote-core.js');
  const text = 'Already in the repository.';
  const records = pendingQuotes([
    row('w1', { text, author: 'X' }),
    row('w2', { text: '   ', author: 'X' }),
    row('w3', { text: 'Sent twice by a double press.', author: 'X' }),
    row('w4', { text: 'Sent twice by a double press.', author: 'X' }),
    row('w5', null),
  ], { known: new Set([quoteId(text)]) });
  assert.deepEqual(records.map((record) => record.text), ['Sent twice by a double press.']);
});
