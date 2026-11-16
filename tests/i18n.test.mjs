/**
 * Tests for the language layer.
 *
 * The interesting part of `assets/i18n.js` is not the browser half — that is
 * checked by `npm run check:ui` in real Chrome — but the half that decides what
 * text comes back: the lookup, what happens when a translation is missing, and
 * the substitution of a live number into a sentence. All three run here with no
 * browser at all, which is also the standing proof that the module imports
 * cleanly under Node: `document`, `localStorage` and `navigator` are absent for
 * every line below.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  T,
  fmtDate,
  hydrate,
  lang,
  langToggle,
  locale,
  register,
  setLang,
  t,
} from '../assets/i18n.js';

/** Every test leaves the module in English, whatever it did in between. */
const inDanish = (fn) => {
  setLang('da');
  try { fn(); } finally { setLang('en'); }
};

test('it imports under Node and starts in English', () => {
  assert.equal(lang(), 'en');
  assert.equal(locale(), 'en-GB');
});

test('setLang switches, and locale follows it', () => {
  inDanish(() => {
    assert.equal(lang(), 'da');
    assert.equal(locale(), 'da-DK');
  });
  assert.equal(lang(), 'en');
  assert.equal(setLang('klingon'), 'en', 'anything that is not Danish is English');
});

test('the seeded strings answer in both languages', () => {
  assert.equal(t('shelf.to-read'), 'Want to read');
  assert.equal(t('rating.good'), 'How good was it');
  assert.equal(t('nav.shelf'), 'The shelf');
  inDanish(() => {
    assert.equal(t('shelf.to-read'), 'Vil læse');
    assert.equal(t('shelf.abandoned'), 'Ikke færdig');
    assert.equal(t('rating.want'), 'Hvor meget vil jeg læse den');
  });
});

test('every seeded string carries both languages', () => {
  const missing = Object.entries(T)
    .filter(([, pair]) => !pair.en || !pair.da)
    .map(([id]) => id);
  assert.deepEqual(missing, [], `ids missing a language: ${missing.join(', ')}`);
});

test('the language toggle names the other language, not the current one', () => {
  // The button reads "DA" in English, so its tooltip has to be readable by
  // someone who does not read English — and the other way round.
  assert.equal(t('lang.title'), 'Skift til dansk');
  inDanish(() => assert.equal(t('lang.title'), 'Switch to English'));
});

test('register merges more strings without touching the shared ones', () => {
  register({ 'test.page': { en: 'A page', da: 'En side' } });
  assert.equal(t('test.page'), 'A page');
  assert.equal(t('nav.quotes'), 'Quotes', 'registering did not disturb the seed');
  inDanish(() => assert.equal(t('test.page'), 'En side'));

  // Registering the same id again sharpens it rather than duplicating it.
  register({ 'test.page': { en: 'A better page' } });
  assert.equal(t('test.page'), 'A better page');
  inDanish(() => assert.equal(t('test.page'), 'En side', 'the untouched half survives'));
});

test('a missing translation falls back to the other language, never to blank', () => {
  register({ 'test.onlyDanish': { da: 'Kun på dansk' } });
  assert.equal(t('test.onlyDanish'), 'Kun på dansk');

  register({ 'test.onlyEnglish': { en: 'English only' } });
  inDanish(() => assert.equal(t('test.onlyEnglish'), 'English only'));
});

test('an id nobody registered comes back as the id', () => {
  // Visible and greppable beats silently empty: a stray "shelf.nothing" in the
  // interface is a bug anyone can report.
  assert.equal(t('shelf.nothing'), 'shelf.nothing');
});

test('{placeholders} take their values, and keep their place when they have none', () => {
  register({
    'test.count': { en: '{n} books on {shelf}', da: '{n} bøger på {shelf}' },
  });
  assert.equal(t('test.count', { n: 87, shelf: 'the shelf' }), '87 books on the shelf');
  assert.equal(t('test.count', { n: 0, shelf: 'x' }), '0 books on x', 'zero is a value');
  assert.equal(t('test.count', { n: 3 }), '3 books on {shelf}', 'a missing value stays visible');
  assert.equal(t('test.count'), '{n} books on {shelf}', 'no vars at all is not an error');
  inDanish(() => assert.equal(t('test.count', { n: 2, shelf: 'hylden' }), '2 bøger på hylden'));
});

test('dates are formatted in the reader language', () => {
  const en = fmtDate('2026-03-14');
  const da = (() => { setLang('da'); const out = fmtDate('2026-03-14'); setLang('en'); return out; })();
  assert.match(en, /2026/);
  assert.match(da, /2026/);
  assert.notEqual(en, da, 'en-GB and da-DK do not write the same date the same way');
  assert.equal(fmtDate(''), '', 'no date, no text');
  assert.equal(fmtDate('not a date'), 'not a date', 'an unparseable value is handed back unchanged');
});

test('the browser-only helpers are inert without a browser', () => {
  assert.equal(hydrate(), 0, 'nothing to hydrate is not a crash');
  assert.equal(langToggle(), null);
});

/* ---------------------------------------------------------------------------
 * The name, the header, and every page's own strings
 * ------------------------------------------------------------------------- */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the site is called My quote collection in English and Min citatsamling in Danish', () => {
  assert.equal(t('nav.brand'), 'My quote collection');
  inDanish(() => assert.equal(t('nav.brand'), 'Min citatsamling'));
});

test('the dictionary says nothing under the retired name', () => {
  const retired = /Lines Worth Keeping|A personal collection|En personlig samling/i;
  const hits = Object.entries(T)
    .filter(([, pair]) => retired.test(`${pair.en} ${pair.da}`))
    .map(([id]) => id);
  assert.deepEqual(hits, []);
});

test('the shared header and its More panel are worded in both languages', () => {
  const ids = [
    'nav.brand', 'nav.shelfShort', 'nav.shelf.title', 'nav.addShort', 'nav.more', 'nav.more.title',
    'nav.pages', 'nav.import', 'nav.edition', 'nav.edition.title', 'nav.language',
    'nav.quotes', 'nav.board', 'nav.next', 'nav.add',
    'edition.paper', 'edition.night', 'edition.folio', 'edition.index',
  ];
  for (const id of ids) {
    assert.ok(T[id]?.en && T[id]?.da, `${id} is missing a language`);
    assert.notEqual(T[id].en, id, `${id} has no English`);
  }
  inDanish(() => {
    assert.equal(t('nav.more'), 'Mere');
    assert.equal(t('nav.shelfShort'), 'Hylden');
    assert.equal(t('nav.language'), 'Sprog');
  });
});

/**
 * Every `register({ ... })` in a source text, as the object it passes.
 *
 * Pages cannot be imported under Node, because they reach for `document` the
 * moment they load, so their strings are read out of the source instead: find
 * each call, walk to its closing brace (stepping over strings and comments, so
 * an apostrophe in a comment is not a quote), and evaluate the literal, which
 * holds nothing but strings.
 */
function registeredStrings(text) {
  const found = {};
  let at = 0;
  for (;;) {
    const call = text.indexOf('register({', at);
    if (call < 0) break;
    const start = call + 'register('.length;
    let i = start;
    let depth = 0;
    let state = 'code';
    for (; i < text.length; i += 1) {
      const c = text[i];
      const next = text[i + 1];
      if (state === 'code') {
        if (c === '/' && next === '/') { state = 'line'; i += 1; }
        else if (c === '/' && next === '*') { state = 'block'; i += 1; }
        else if (c === "'" || c === '"' || c === '`') state = c;
        else if (c === '{') depth += 1;
        else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
      } else if (state === 'line') {
        if (c === '\n') state = 'code';
      } else if (state === 'block') {
        if (c === '*' && next === '/') { state = 'code'; i += 1; }
      } else if (c === '\\') {
        i += 1;
      } else if (c === state) {
        state = 'code';
      }
    }
    Object.assign(found, new Function(`return (${text.slice(start, i)});`)());
    at = i;
  }
  return found;
}

/** The files that register strings: every script under assets/ and every page. */
async function filesThatRegister() {
  const scripts = (await readdir(path.join(REPO_ROOT, 'assets')))
    .filter((name) => name.endsWith('.js') && name !== 'i18n.js')
    .map((name) => path.join('assets', name));
  const pages = (await readdir(REPO_ROOT)).filter((name) => name.endsWith('.html'));
  return [...scripts, ...pages];
}

test('every string a page or script registers carries both languages', async () => {
  const missing = [];
  let count = 0;
  for (const file of await filesThatRegister()) {
    const strings = registeredStrings(await readFile(path.join(REPO_ROOT, file), 'utf8'));
    for (const [id, pair] of Object.entries(strings)) {
      count += 1;
      if (!pair?.en || !pair?.da) missing.push(`${file}: ${id}`);
    }
  }
  assert.ok(count > 150, `only ${count} strings found; the reader of the source has probably stopped working`);
  assert.deepEqual(missing, []);
});

test('the words on the front page and in the shared header have no em dash', async () => {
  // The words a visitor reads go out under his name, and an em dash reads as
  // written by a machine to him. The en dash and the Danish tankestreg are fine.
  const EM = '—';
  const hits = [];
  for (const [id, pair] of Object.entries(T)) {
    if (`${pair.en} ${pair.da}`.includes(EM)) hits.push(`i18n.js: ${id}`);
  }
  for (const file of ['assets/app.js', 'assets/nav.js', 'scout.html', 'suggest.html', 'import.html']) {
    const strings = registeredStrings(await readFile(path.join(REPO_ROOT, file), 'utf8'));
    for (const [id, pair] of Object.entries(strings)) {
      if (`${pair.en} ${pair.da}`.includes(EM)) hits.push(`${file}: ${id}`);
    }
  }
  const page = (await readFile(path.join(REPO_ROOT, 'index.html'), 'utf8'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
  if (page.includes(EM)) hits.push('index.html: the markup');
  assert.deepEqual(hits, []);
});
