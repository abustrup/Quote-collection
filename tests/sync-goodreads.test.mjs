/**
 * Tests for the scheduled Goodreads sync.
 *
 * The live page cannot be reached from the sandbox this was written in, so the
 * fixture is a replica built from the markup Goodreads has used across its
 * redesigns. That means these tests prove the parser handles the shape it was
 * written for — they do not prove the shape is current. The live fetch is
 * checked by the first real run, not here, and that limit is stated in the
 * README rather than left for someone to discover.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllQuotes, listUrlFor, parseQuotesHtml, parseShowing } from '../scripts/sync-goodreads.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const page = await readFile(path.join(FIXTURES, 'goodreads-list-page.html'), 'utf8');

test('reads every quote on the page with its author, work and tags', () => {
  const quotes = parseQuotesHtml(page);
  assert.equal(quotes.length, 4);

  assert.deepEqual(quotes[0], {
    text: 'The sad truth is that most evil is done by people who never make up their minds to be good or evil.',
    author: 'Hannah Arendt',
    work: 'The Life of the Mind',
    tags: ['ethics', 'thinking'],
  });

  // An author with no linked work must not borrow the next quote's title.
  assert.equal(quotes[1].author, 'Ludwig Wittgenstein');
  assert.equal(quotes[1].work, null);
  assert.deepEqual(quotes[1].tags, []);
});

test('keeps punctuation inside the quotation intact', () => {
  const [, , sartre] = parseQuotesHtml(page);
  assert.match(sartre.text, /he does — and ‘everything’ means everything\.$/);
  assert.equal(sartre.text.startsWith('Man is condemned'), true, 'the outer marks are dropped');
});

test('decodes the Nordic letters in both cases', () => {
  // The reason this test exists: a hand-picked entity table missed &aelig; and
  // published "l&aelig;re" as a Danish quotation.
  const [, , , blixen] = parseQuotesHtml(page);
  assert.equal(blixen.text, 'Det er ikke let at leve, men det skal jeg nok lære.');

  const probe = '<div class="quoteText">&ldquo;&Aring;h, &AElig;blet og &Oslash;en &mdash; s&aring; s&oslash;dt.&rdquo;'
    + '<br/>&#8213;<span class="authorOrTitle">Karen Blixen</span></div>';
  assert.equal(parseQuotesHtml(probe)[0].text, 'Åh, Æblet og Øen — så sødt.');
});

test('reads the page\'s own count, which is what the sync checks itself against', () => {
  assert.deepEqual(parseShowing(page), { from: 1, to: 4, total: 174 });
  assert.equal(parseShowing('<p>no such line</p>'), null);
});

test('accepts any of the URL forms a person actually has to hand', () => {
  const expected = 'https://www.goodreads.com/quotes/list/12345678?page=1';
  assert.equal(listUrlFor('https://www.goodreads.com/user/show/12345678-alexander-bustrup'), expected);
  assert.equal(listUrlFor('https://www.goodreads.com/quotes/list/12345678?ref=nav_profile_quotes'), expected);
  assert.equal(listUrlFor('12345678'), expected);
  assert.equal(listUrlFor('12345678', 3).endsWith('page=3'), true);
  assert.throws(() => listUrlFor('https://example.com/nothing'), /user id/);
});

test('a private profile fails loudly instead of reporting an empty collection', async () => {
  // The dangerous failure is not an error, it is a sign-in page parsing to
  // zero quotes and being committed as "your collection is empty".
  const signIn = '<html><body><h1>Sign in to continue</h1><p>Sign up to see what your friends are reading.</p></body></html>';
  await assert.rejects(
    () => fetchAllQuotes('12345678', { fetchImpl: async () => signIn }),
    /not public/,
  );
});

test('follows pagination until the page says it is done', async () => {
  const asked = [];
  const pageFor = (n) => `<div class="quoteListPagination">Showing ${n * 2 - 1}-${n * 2} of 4</div>`
    + [1, 2].map((i) => `<div class="quoteText">&ldquo;Quote ${n}.${i}&rdquo;<br/>&#8213;`
      + '<span class="authorOrTitle">Someone</span></div>').join('');

  const { quotes, expected } = await fetchAllQuotes('12345678', {
    fetchImpl: async (url) => {
      asked.push(url);
      return pageFor(Number(/page=(\d+)/.exec(url)[1]));
    },
  });

  assert.equal(expected, 4);
  assert.equal(quotes.length, 4);
  assert.equal(asked.length, 2, 'stops as soon as the count is satisfied');
});

test('stops on an empty page rather than looping to the guard', async () => {
  const { quotes } = await fetchAllQuotes('12345678', {
    fetchImpl: async (url) => (/page=1\b/.test(url)
      ? '<div class="quoteText">&ldquo;Only one.&rdquo;<br/>&#8213;<span class="authorOrTitle">A</span></div>'
      : '<html><body></body></html>'),
  });
  assert.equal(quotes.length, 1);
});
