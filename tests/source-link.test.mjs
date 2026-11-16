/**
 * Tests for the link from a quote's work title to its source.
 *
 * The rule is small and has two ways to go wrong: offering a Goodreads page as
 * the place a line came from (it is only where another reader copied it), and
 * following an address that is not a web address. `assets/source-link.js` is a
 * file of its own so both can be checked here with no browser.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sourceHost, sourceUrl } from '../assets/source-link.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quote = (source) => ({ text: 'A line.', author: 'Someone', work: 'A work', source });

test('a curated quote with a web address links to it', () => {
  const url = sourceUrl(quote({ kind: 'curated', url: 'https://example.com/essay#part-2', locator: null }));
  assert.ok(url instanceof URL);
  assert.equal(url.href, 'https://example.com/essay#part-2');
});

test('plain http is followed too, because some of the sources only have it', () => {
  assert.equal(sourceUrl(quote({ kind: 'curated', url: 'http://example.com/talk' })).protocol, 'http:');
});

test('a Goodreads source is never offered, whatever its address', () => {
  const goodreads = { kind: 'goodreads', url: 'https://www.goodreads.com/quotes/list/149695942?page=1' };
  assert.equal(sourceUrl(quote(goodreads)), null);
  // The kind decides, not the host: a Goodreads record is not a source even if
  // its address were somewhere else, and a curated record is one even if its
  // address were Goodreads (somebody chose it on purpose).
  assert.equal(sourceUrl(quote({ kind: 'goodreads', url: 'https://example.com/x' })), null);
  assert.ok(sourceUrl(quote({ kind: 'curated', url: 'https://www.goodreads.com/book/show/1' })));
});

test('no source, no address, or an address that is not text, means no link', () => {
  assert.equal(sourceUrl(quote(undefined)), null);
  assert.equal(sourceUrl(quote(null)), null);
  assert.equal(sourceUrl(quote({ kind: 'curated' })), null);
  assert.equal(sourceUrl(quote({ kind: 'curated', url: null })), null);
  assert.equal(sourceUrl(quote({ kind: 'curated', url: '' })), null);
  assert.equal(sourceUrl(quote({ kind: 'curated', url: 42 })), null);
  assert.equal(sourceUrl(undefined), null);
  assert.equal(sourceUrl({}), null);
});

test('only http and https are followed', () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'mailto:someone@example.com',
    'blob:https://example.com/1',
  ]) {
    assert.equal(sourceUrl(quote({ kind: 'curated', url })), null, `${url} must not become a link`);
  }
});

test('an address that does not parse is no link', () => {
  for (const url of ['not a url', '//example.com/no-scheme', '/relative/path', 'example.com']) {
    assert.equal(sourceUrl(quote({ kind: 'curated', url })), null, `"${url}" must not become a link`);
  }
});

test('space around an address in the record is not held against it', () => {
  assert.equal(sourceUrl(quote({ kind: 'curated', url: '  https://example.com/a  ' })).href, 'https://example.com/a');
});

test('the host is what a reader would say: no www, no path', () => {
  assert.equal(sourceHost(new URL('https://www.youtube.com/watch?v=abc')), 'youtube.com');
  assert.equal(sourceHost(new URL('https://anthropic.com/essay')), 'anthropic.com');
  assert.equal(sourceHost(new URL('https://blog.example.co.uk/x')), 'blog.example.co.uk');
  assert.equal(sourceHost(null), '');
});

test('the shipped collection: sourced quotes link, and none of them points at Goodreads', async () => {
  const file = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'quotes.json'), 'utf8'));
  const quotes = file.quotes ?? file;

  const linked = quotes.filter((entry) => sourceUrl(entry));
  const goodreads = quotes.filter((entry) => entry.source?.kind === 'goodreads');

  // Not vacuous: the collection holds both kinds, so both halves of the rule run.
  assert.ok(linked.length > 0, 'no quote in the collection has a source to link to');
  assert.ok(goodreads.length > 0, 'no Goodreads quote in the collection to leave unlinked');

  for (const entry of goodreads) assert.equal(sourceUrl(entry), null, `${entry.id} is from Goodreads and must not link`);
  for (const entry of linked) {
    assert.notEqual(entry.source.kind, 'goodreads', entry.id);
    assert.ok(['https:', 'http:'].includes(sourceUrl(entry).protocol), entry.id);
  }
});
