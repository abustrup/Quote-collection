/**
 * Tests for what the Worker will take in.
 *
 * The Worker is the one place a stranger's request meets the collection, so
 * what it refuses matters as much as what it keeps. On 2026-11-15 its quote
 * intake grew: a link with a timestamp, a place in it, a kind of work, themes, a
 * subject, a language and a claim about how well the quote was checked, so the
 * video library can file a quote straight into the collection.
 *
 * Two layers are tested, both under plain Node:
 *
 *   `readQuotePayload` is the validation as a pure function. Every field, every
 *   limit, every refusal.
 *
 *   `worker.fetch` is the Worker itself, over a real SQLite database built from
 *   the real `worker/schema.sql`. Cloudflare's D1 is SQLite, so the statements
 *   the Worker runs are run for real, which a hand-made fake of D1 could not
 *   say. Needs `node:sqlite` (Node 22.13 or later); where it is missing those
 *   tests are skipped, not failed.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { quoteId } from '../assets/quote-core.js';
import worker from '../worker/src/index.mjs';
import { BadRequest, INTAKE_STATUSES, LIMITS, addressProblem, readQuotePayload } from '../worker/src/intake.mjs';

const OLD_BODY = {
  text: 'One must still have chaos in oneself to give birth to a dancing star.',
  author: 'Friedrich Nietzsche',
  work: 'Thus Spoke Zarathustra',
  year: 1883,
  note: 'A note.',
  tags: ['chaos', ' stars '],
};

const refused = (body, pattern) => assert.throws(
  () => readQuotePayload(body),
  (error) => error instanceof BadRequest && pattern.test(error.message),
  `expected a refusal matching ${pattern}`,
);
const withField = (extra) => ({ text: 'A line.', author: 'Someone', ...extra });

/* ---------------------------------------------------------------------------
 * The validation, as a pure function
 * ------------------------------------------------------------------------- */

test('an old payload gives exactly the payload it always gave, with nothing new in it', () => {
  const payload = readQuotePayload(OLD_BODY);
  assert.deepEqual(payload, {
    text: OLD_BODY.text, author: 'Friedrich Nietzsche', work: 'Thus Spoke Zarathustra',
    note: 'A note.', year: 1883, tags: ['chaos', 'stars'],
  });
  assert.deepEqual(Object.keys(payload), ['text', 'author', 'work', 'note', 'year', 'tags']);

  // Only the two required fields: the optional ones come out empty, as before.
  assert.deepEqual(readQuotePayload({ text: 'A line.', author: 'Someone' }), {
    text: 'A line.', author: 'Someone', work: null, note: null, year: null, tags: [],
  });
});

test('the old refusals are unchanged', () => {
  refused({ author: 'X' }, /text is missing/);
  refused({ text: 'X' }, /author is missing/);
  refused({ text: 'x'.repeat(LIMITS.text + 1), author: 'X' }, /text is too long/);
  refused(withField({ year: 'later' }), /year looks wrong/);
  refused(withField({ year: 2500 }), /year looks wrong/);
  refused(withField({ work: 42 }), /work must be text/);
});

test('every new field is kept when it is valid', () => {
  const payload = readQuotePayload(withField({
    url: 'https://youtu.be/ABCDEFGHIJK?t=754',
    locator: '12:34',
    workKind: 'interview',
    themes: ['technology', 'work'],
    subject: 'technology',
    lang: 'da',
    verification: { status: 'reported', note: 'Heard in the video.' },
  }));
  assert.equal(payload.url, 'https://youtu.be/ABCDEFGHIJK?t=754');
  assert.equal(payload.locator, '12:34');
  assert.equal(payload.workKind, 'interview');
  assert.deepEqual(payload.themes, ['technology', 'work']);
  assert.equal(payload.subject, 'technology');
  assert.equal(payload.lang, 'da');
  assert.deepEqual(payload.verification, { status: 'reported', note: 'Heard in the video.' });
});

test('fields it does not know are ignored, not refused and not stored', () => {
  const payload = readQuotePayload(withField({
    favorite: true, id: 'q_000000000000', source: { kind: 'curated', url: 'https://x.org' }, addedAt: '1999-01-01', surprise: 1,
  }));
  assert.deepEqual(Object.keys(payload), ['text', 'author', 'work', 'note', 'year', 'tags']);
});

test('a link must be https, short, free of spaces and logins, and may carry a timestamp', () => {
  for (const good of [
    'https://youtu.be/ABCDEFGHIJK?t=754',
    'https://www.youtube.com/watch?v=ABCDEFGHIJK&t=754s',
    'https://example.org/essay#section-2',
    `https://example.org/${'a'.repeat(LIMITS.url - 'https://example.org/'.length)}`,
  ]) {
    assert.equal(readQuotePayload(withField({ url: good })).url, good, good);
  }
  assert.equal(readQuotePayload(withField({ url: '  https://example.org/x  ' })).url, 'https://example.org/x', 'trimmed');
  assert.equal('url' in readQuotePayload(withField({ url: '' })), false);
  assert.equal('url' in readQuotePayload(withField({ url: null })), false);

  refused(withField({ url: 'http://example.org/x' }), /https/);
  refused(withField({ url: 'javascript:alert(1)' }), /https/);
  refused(withField({ url: 'data:text/html,hello' }), /https/);
  refused(withField({ url: 'ftp://example.org/x' }), /https/);
  refused(withField({ url: 'https://' }), /web address/);
  refused(withField({ url: 'example.org/x' }), /web address/);
  refused(withField({ url: 'https://example.org/a b' }), /spaces/);
  refused(withField({ url: 'https://example.org/a\nb' }), /spaces/);
  refused(withField({ url: 'https://someone:secret@example.org/x' }), /login/);
  refused(withField({ url: `https://example.org/${'a'.repeat(LIMITS.url)}` }), /too long/);
  refused(withField({ url: 42 }), /must be text/);
});

test('a link must say https:// in so many words, because the URL parser alone says yes to more than that', () => {
  // `new URL()` reads each of these as an https address. The registry's
  // validator and register-work.py ask for a literal "https://", so the intake
  // holds the same line on the text itself.
  refused(withField({ url: 'https:evil.example' }), /start with https/);
  refused(withField({ url: 'https:/evil.example/x' }), /start with https/);
  refused(withField({ url: 'https:\\\\evil.example' }), /start with https/);
  // A capital letter in the scheme is a typing habit, not a different address.
  // It is accepted and filed with the scheme in lower case.
  assert.equal(readQuotePayload(withField({ url: 'HTTPS://EXAMPLE.COM/x' })).url, 'https://EXAMPLE.COM/x');
  assert.equal(readQuotePayload(withField({ url: ' Https://youtu.be/ABC?t=5 ' })).url, 'https://youtu.be/ABC?t=5');
  assert.equal(addressProblem('https://example.org/x'), null);
  assert.match(addressProblem('https:evil.example'), /start with https/);
});

test('a locator is free text up to 200 characters', () => {
  assert.equal(readQuotePayload(withField({ locator: ' ch. 3, p. 45 ' })).locator, 'ch. 3, p. 45');
  assert.equal(readQuotePayload(withField({ locator: 'x'.repeat(LIMITS.locator) })).locator.length, LIMITS.locator);
  assert.equal('locator' in readQuotePayload(withField({ locator: '   ' })), false);
  refused(withField({ locator: 'x'.repeat(LIMITS.locator + 1) }), /locator is too long/);
  refused(withField({ locator: 12 }), /locator must be text/);
});

test('the kind of work is one of the eleven, case and spaces forgiven', () => {
  for (const kind of ['book', 'essay', 'paper', 'speech', 'interview', 'film', 'poem', 'letter', 'document', 'song', 'other']) {
    assert.equal(readQuotePayload(withField({ workKind: kind })).workKind, kind);
  }
  assert.equal(readQuotePayload(withField({ workKind: ' Interview ' })).workKind, 'interview');
  refused(withField({ workKind: 'podcast' }), /workKind must be one of book, essay/);
  refused(withField({ workKind: 7 }), /workKind must be text/);
});

test('themes: only the controlled ones, unknown ones dropped, at most four', () => {
  assert.deepEqual(
    readQuotePayload(withField({ themes: ['technology', 'astrology', 'Work', 'ai', 'power', 'time', 'truth'] })).themes,
    ['technology', 'work', 'power', 'time'],
    'unknown words fall away and the first four known ones stay',
  );
  assert.deepEqual(readQuotePayload(withField({ themes: ['truth', 'truth', 'time'] })).themes, ['truth', 'time'], 'no repeats');
  assert.deepEqual(readQuotePayload(withField({ themes: 'truth, time' })).themes, ['truth', 'time'], 'a comma-separated string works too');
  assert.equal('themes' in readQuotePayload(withField({ themes: ['astrology'] })), false, 'nothing known left means nothing stored');
  assert.equal('themes' in readQuotePayload(withField({ themes: [] })), false);
  assert.deepEqual(readQuotePayload(withField({ themes: [1, null, 'love'] })).themes, ['love']);
  refused(withField({ themes: { a: 1 } }), /themes must be a list/);
});

test('the subject is one of the fourteen the page filters on', () => {
  for (const subject of ['literature', 'philosophy', 'ethics', 'politics', 'economics', 'psychology', 'sociology',
    'science', 'technology', 'history', 'military', 'religion', 'law', 'education']) {
    assert.equal(readQuotePayload(withField({ subject })).subject, subject);
  }
  assert.equal(readQuotePayload(withField({ subject: ' Technology ' })).subject, 'technology');
  refused(withField({ subject: 'astrology' }), /subject must be one of literature, philosophy/);
  refused(withField({ subject: ['technology'] }), /subject must be text/);
});

test('the language is two letters', () => {
  assert.equal(readQuotePayload(withField({ lang: 'DA' })).lang, 'da');
  refused(withField({ lang: 'english' }), /lang must be two letters/);
  refused(withField({ lang: 'e' }), /lang must be two letters/);
  refused(withField({ lang: 'e1' }), /lang must be two letters/);
});

test('nothing stronger than reported passes the intake: verified and disputed are refused', () => {
  assert.deepEqual(INTAKE_STATUSES, ['reported', 'unverified']);
  assert.deepEqual(readQuotePayload(withField({ verification: { status: 'unverified' } })).verification, { status: 'unverified' });
  assert.deepEqual(readQuotePayload(withField({ verification: { status: 'Reported' } })).verification, { status: 'reported' });
  assert.deepEqual(readQuotePayload(withField({ verification: { note: 'Just a note.' } })).verification, { status: 'unverified', note: 'Just a note.' });

  refused(withField({ verification: { status: 'verified' } }), /verification\.status must be reported or unverified/);
  refused(withField({ verification: { status: 'VERIFIED', note: 'I checked it.' } }), /reported or unverified/);
  refused(withField({ verification: { status: 'disputed' } }), /reported or unverified/);
  refused(withField({ verification: { status: 'checked' } }), /reported or unverified/);
  refused(withField({ verification: { status: 1 } }), /must be text/);
  refused(withField({ verification: 'verified' }), /verification must be an object/);
  refused(withField({ verification: ['verified'] }), /verification must be an object/);
});

test('the note on how a quote was checked is at most 500 characters', () => {
  const note = 'n'.repeat(LIMITS.verificationNote);
  assert.equal(readQuotePayload(withField({ verification: { status: 'reported', note } })).verification.note.length, 500);
  refused(withField({ verification: { status: 'reported', note: `${note}n` } }), /verification\.note is too long/);
});

/* ---------------------------------------------------------------------------
 * The Worker, over a real SQLite database
 * ------------------------------------------------------------------------- */

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch { /* an older Node: the tests below are skipped */ }
const sqlite = { skip: DatabaseSync ? false : 'node:sqlite is not available in this Node' };

const KEY = 'a-throwaway-key-for-tests';
const schema = await readFile(new URL('../worker/schema.sql', import.meta.url), 'utf8');

/** D1's small surface, over SQLite: prepare, bind, run, first, all. */
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      const api = {
        bind(...values) { args = values; return api; },
        async run() { const info = statement.run(...args); return { success: true, meta: { changes: Number(info.changes) } }; },
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
      };
      return api;
    },
  };
}

function ask(env, method, path, body, { key = KEY } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const init = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return worker.fetch(new Request(`https://quote-shelf.test${path}`, init), env);
}
const postQuote = (env, body, options) => ask(env, 'POST', '/quote', body, options);
const readState = async (env) => (await ask(env, 'GET', '/state', undefined, { key: null })).json();

test('the Worker files an old payload as it always did, and says where the quote will be', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  const response = await postQuote(env, OLD_BODY);
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.ok, true);
  assert.match(reply.id, /^[0-9a-f-]{36}$/);
  assert.match(reply.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(reply.quoteId, quoteId(OLD_BODY.text), 'the id the quote will have in data/quotes.json');

  const { pending } = await readState(env);
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].payload, {
    text: OLD_BODY.text, author: 'Friedrich Nietzsche', work: 'Thus Spoke Zarathustra',
    note: 'A note.', year: 1883, tags: ['chaos', 'stars'],
  });
});

test('the Worker stores every new field and nothing it does not know', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  const response = await postQuote(env, withField({
    work: 'Building Claude Code', year: 2026, url: 'https://youtu.be/ABCDEFGHIJK?t=754', locator: '12:34',
    workKind: 'interview', themes: ['technology', 'work', 'bogus'], subject: 'technology', lang: 'en',
    verification: { status: 'reported', note: 'Heard in the video.' }, favorite: true, id: 'q_000000000000',
  }));
  assert.equal(response.status, 200);

  const { pending } = await readState(env);
  assert.deepEqual(pending[0].payload, {
    text: 'A line.', author: 'Someone', work: 'Building Claude Code', note: null, year: 2026, tags: [],
    url: 'https://youtu.be/ABCDEFGHIJK?t=754', locator: '12:34', workKind: 'interview',
    themes: ['technology', 'work'], subject: 'technology', lang: 'en',
    verification: { status: 'reported', note: 'Heard in the video.' },
  });
});

test('the Worker refuses a request that claims verified, and files nothing', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  const response = await postQuote(env, withField({ verification: { status: 'verified' } }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /reported or unverified/);
  assert.deepEqual((await readState(env)).pending, []);
});

test('the Worker answers a bad field with a 400 and a sentence, never a stack trace', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  for (const [extra, pattern] of [
    [{ url: 'http://example.org/x' }, /https/],
    [{ url: 'https:evil.example' }, /start with https/],
    [{ url: `https://example.org/${'a'.repeat(500)}` }, /too long/],
    [{ locator: 'x'.repeat(201) }, /locator is too long/],
    [{ workKind: 'podcast' }, /workKind must be one of/],
    [{ subject: 'astrology' }, /subject must be one of/],
    [{ lang: 'english' }, /lang must be two letters/],
    [{ themes: { a: 1 } }, /themes must be a list/],
    [{ verification: 'verified' }, /verification must be an object/],
  ]) {
    const response = await postQuote(env, withField(extra));
    const reply = await response.json();
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.match(reply.error, pattern);
    assert.deepEqual(Object.keys(reply), ['error']);
  }
  assert.deepEqual((await readState(env)).pending, []);
});

test('the Worker still wants the key, and still says so differently when none is set', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  assert.equal((await postQuote(env, OLD_BODY, { key: null })).status, 401);
  assert.equal((await postQuote(env, OLD_BODY, { key: 'not-the-key' })).status, 401);
  assert.equal((await postQuote({ DB: database() }, OLD_BODY)).status, 503);
  assert.equal((await postQuote(env, '{ not json')).status, 400);
  assert.equal((await ask(env, 'GET', '/quote')).status, 405);
});

test('a star is stored, an un-star is stored as an off and not deleted, and the state shows both', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  const id = quoteId(OLD_BODY.text);
  assert.equal((await ask(env, 'POST', '/favorite', { id, on: true })).status, 200);
  assert.equal((await readState(env)).favorites[id].on, true);
  assert.equal((await ask(env, 'POST', '/favorite', { id, on: false })).status, 200);
  const { favorites } = await readState(env);
  assert.equal(favorites[id].on, false, 'an explicit off, because the repository may still say true');
  assert.equal((await ask(env, 'POST', '/favorite', { id: 'not-an-id', on: true })).status, 400);
  assert.equal((await ask(env, 'POST', '/favorite', { id, on: 'yes' })).status, 400);
});

test('an acknowledged quote leaves the pending list', sqlite, async () => {
  const env = { DB: database(), EDIT_KEY: KEY };
  const { id } = await (await postQuote(env, OLD_BODY)).json();
  assert.equal((await readState(env)).pending.length, 1);
  const acked = await (await ask(env, 'POST', '/ack', { ids: [id] })).json();
  assert.equal(acked.acked, 1);
  assert.deepEqual((await readState(env)).pending, []);
});
