/**
 * Tests for the Add dialog's address-bar prefill.
 *
 * A link such as `?add=1&text=…&author=…` opens the dialog filled in. It is the
 * fallback from the video library, and it is also a way for anybody who can
 * make a link to put words in front of him, so the rules are strict: what is
 * read is capped and checked, it is handed on as plain text, it is taken out of
 * the address so a reload does not do it twice, and no secret is read from it.
 *
 * The dialog itself is checked in a real browser by the acceptance run; these
 * are the parts that can be checked without one.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PREFILL_PARAMS, capturePrefill, parsePrefill, takePrefill, withoutPrefill } from '../assets/add-prefill.js';

const FULL = new URLSearchParams({
  add: '1',
  text: 'The mind that can hold two ideas at once.',
  author: 'Boris Cherny',
  work: 'Building Claude Code',
  year: '2026',
  url: 'https://youtu.be/ABCDEFGHIJK?t=754',
  locator: '12:34',
  kind: 'interview',
  subject: 'technology',
});

test('a link that does not ask for the dialog opens nothing and is left alone', () => {
  assert.equal(parsePrefill(''), null);
  assert.equal(parsePrefill('?author=george-orwell&work=1984&subject=literature'), null,
    'these are the collection page\'s own filters, and must keep working');
  assert.equal(parsePrefill('?add=0&text=x'), null);
  assert.equal(parsePrefill('?add=true&text=x'), null);
  assert.equal(parsePrefill(undefined), null);
});

test('every field in the link is read', () => {
  assert.deepEqual(parsePrefill(FULL), {
    text: 'The mind that can hold two ideas at once.',
    author: 'Boris Cherny',
    work: 'Building Claude Code',
    year: 2026,
    url: 'https://youtu.be/ABCDEFGHIJK?t=754',
    locator: '12:34',
    kind: 'interview',
    subject: 'technology',
  });
  assert.deepEqual(parsePrefill(`?${FULL}`), parsePrefill(FULL), 'with or without the question mark');
});

test('a link may carry only some of the fields', () => {
  assert.deepEqual(parsePrefill('?add=1&text=Just%20the%20words'), {
    text: 'Just the words', author: '', work: '', year: null, url: '', locator: '', kind: '', subject: '',
  });
  assert.equal(parsePrefill('?add=1').text, '');
});

test('what is read is capped at what the Worker would accept', () => {
  const read = parsePrefill(new URLSearchParams({
    add: '1', text: 'x'.repeat(9000), author: 'a'.repeat(500), work: 'w'.repeat(900), locator: 'l'.repeat(600),
  }));
  assert.equal(read.text.length, 4000);
  assert.equal(read.author.length, 200);
  assert.equal(read.work.length, 300);
  assert.equal(read.locator.length, 200);
});

test('a link too long to keep is dropped, not cut in half', () => {
  const url = `https://example.org/${'a'.repeat(500)}`;
  assert.equal(parsePrefill(new URLSearchParams({ add: '1', url })).url, '');
  const fits = `https://example.org/${'a'.repeat(480)}`;
  assert.equal(parsePrefill(new URLSearchParams({ add: '1', url: fits })).url, fits);
});

test('a year, kind, subject or link that is not valid is dropped, and the rest still arrive', () => {
  const read = parsePrefill(new URLSearchParams({
    add: '1', text: 'Words', year: '99999', kind: 'podcast', subject: 'astrology', url: 'javascript:alert(1)',
  }));
  assert.equal(read.text, 'Words');
  assert.equal(read.year, null);
  assert.equal(read.kind, '');
  assert.equal(read.subject, '');
  assert.equal(read.url, '');

  for (const url of ['http://example.org/x', 'data:text/html,hi', 'ftp://example.org/x', 'https://', 'https://a b.org',
    'https://someone:secret@example.org/x', '//example.org/x', 'example.org']) {
    assert.equal(parsePrefill(new URLSearchParams({ add: '1', url })).url, '', url);
  }
  for (const year of ['abc', '1e3', '2101', '-801', '', '12345']) {
    assert.equal(parsePrefill(new URLSearchParams({ add: '1', year })).year, null, `year "${year}"`);
  }
  assert.equal(parsePrefill(new URLSearchParams({ add: '1', year: '-350' })).year, -350, 'an ancient text');
});

test('kind and subject are matched ignoring case', () => {
  const read = parsePrefill(new URLSearchParams({ add: '1', kind: 'Interview', subject: ' TECHNOLOGY ' }));
  assert.equal(read.kind, 'interview');
  assert.equal(read.subject, 'technology');
});

test('markup in a link stays text: it comes back unchanged, to be set as a value and never as HTML', () => {
  const nasty = '<img src=x onerror=alert(1)> <script>alert(2)</script> "quoted" & more';
  const read = parsePrefill(new URLSearchParams({ add: '1', text: nasty, author: '<b>A</b>', work: '</textarea><svg onload=1>' }));
  assert.equal(read.text, nasty);
  assert.equal(read.author, '<b>A</b>');
  assert.equal(read.work, '</textarea><svg onload=1>');
});

test('control characters are stripped, line breaks in the words are kept', () => {
  const read = parsePrefill(new URLSearchParams({ add: '1', text: 'one\ntwo\u0000\u0007\tthree', author: 'A\u001bB' }));
  assert.equal(read.text, 'one\ntwo\tthree');
  assert.equal(read.author, 'AB');
});

test('no secret is read: there is no parameter for the edit code, and nothing else is returned', () => {
  const read = parsePrefill(new URLSearchParams({ add: '1', text: 'Words', code: 'the-edit-code', key: 'k', token: 't', password: 'p', secret: 's' }));
  assert.deepEqual(Object.keys(read).sort(), ['author', 'kind', 'locator', 'subject', 'text', 'url', 'work', 'year']);
  assert.equal(JSON.stringify(read).includes('the-edit-code'), false);
  for (const name of ['code', 'key', 'token', 'password', 'secret']) {
    assert.equal(PREFILL_PARAMS.includes(name), false, `${name} is not a prefill parameter`);
  }
});

test('the prefill\'s parameters come out of the address and every other one stays, in order', () => {
  assert.equal(withoutPrefill(`?${FULL}`), '');
  assert.equal(withoutPrefill(`?theme=truth&${FULL}&sort=year`), '?theme=truth&sort=year');
  assert.equal(withoutPrefill('?theme=truth'), '?theme=truth');
  assert.equal(withoutPrefill(''), '');
});

test('capturing reads the address once and rewrites it, keeping the path, the other parameters and the hash', () => {
  const calls = [];
  const history = { state: { n: 1 }, replaceState: (...args) => calls.push(args) };
  const where = { pathname: '/Quote-collection/', search: `?theme=truth&${FULL}`, hash: '#q_8aae042207e6' };

  const read = capturePrefill(where, history);
  assert.equal(read.author, 'Boris Cherny');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [{ n: 1 }, '', '/Quote-collection/?theme=truth#q_8aae042207e6']);
});

test('capturing a link that does not ask for the dialog touches nothing', () => {
  const calls = [];
  const history = { state: null, replaceState: (...args) => calls.push(args) };
  assert.equal(capturePrefill({ pathname: '/', search: '?author=george-orwell', hash: '' }, history), null);
  assert.equal(capturePrefill({ pathname: '/', search: '', hash: '' }, history), null);
  assert.equal(capturePrefill(undefined, history), null);
  assert.deepEqual(calls, []);
});

test('a browser that refuses to rewrite the address does not stop the dialog opening', () => {
  const history = { state: null, replaceState: () => { throw new Error('SecurityError'); } };
  const read = capturePrefill({ pathname: '/', search: '?add=1&text=Words', hash: '' }, history);
  assert.equal(read.text, 'Words');
});

test('outside a browser there is nothing to take, and taking twice gives nothing the second time', () => {
  assert.equal(takePrefill(), null);
  assert.equal(takePrefill(), null);
});

test('the collection page loads the capture before it reads its own filters from the address', async () => {
  // The prefill reuses `author`, `work` and `subject`, which the page also reads
  // as filters. Taking them out of the address first is what stops a link from
  // the video library showing a filtered, empty list behind the dialog. That
  // order holds only while app.js imports store.js and store.js imports the
  // capture, so an "unused" import being tidied away would break it silently.
  const store = await readFile(new URL('../assets/store.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
  assert.match(store, /^import '\.\/add-prefill\.js';$/m, 'store.js imports add-prefill.js for what it does when it loads');
  assert.match(app, /from '\.\/store\.js';/, 'app.js imports store.js');
});

/* ---------------------------------------------------------------------------
 * Two rules that exist only because of how a phone treats the page. Neither can
 * be seen without a browser, so these pin the lines that carry them. Both were
 * found on 2026-11-15 in the iOS Simulator, in iOS Safari.
 * ------------------------------------------------------------------------- */

test('the dialog\'s fields are 16px on a touch screen, so iOS does not zoom the page when one is focused', async () => {
  // Under 16px, iOS Safari zooms in when a field gets focus and leaves the page
  // zoomed, with the dialog cut off at the right edge. The unlock code field
  // was 13.6px, so it did exactly that on the way to typing the code.
  const source = await readFile(new URL('../assets/add-quote.js', import.meta.url), 'utf8');
  assert.match(source, /@media \(pointer: coarse\) \{[^}]*dialog\.add-dialog input,[^}]*font-size: 16px;/s);
  assert.match(source, /dialog\.add-dialog textarea,/);
  assert.match(source, /dialog\.add-dialog select \{ font-size: 16px; \}/);
});

test('the shelf page\'s unlock card has the same 16px rule on a touch screen', async () => {
  // The same zoom, on the shelf page's own unlock card (found by looking, on
  // 2026-11-16, when that card was given its username field).
  const css = await readFile(new URL('../assets/shelf.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.unlock-card input \{ font-size: 16px; \}/);
});

test('a toast that holds a button takes the width it needs, instead of half the screen', async () => {
  // A plain toast is as wide as the half of the screen to the right of its
  // centre line allows. With a sentence and a button in it, that was a narrow
  // tower of four lines on a phone.
  const source = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
  assert.match(source, /\.toast:has\(> button\) \{ width: max-content; max-width: calc\(100vw - 2rem\);/);
});
