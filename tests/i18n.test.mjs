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
import test from 'node:test';

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
