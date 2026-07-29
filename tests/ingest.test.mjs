/**
 * Tests for the issue-to-quote path.
 *
 * The thing being protected here is narrow but important: the owner adds quotes
 * through a GitHub form and never sees a terminal, so a field that stops being
 * read, or an error that stops being explained, would be invisible until the
 * collection had quietly lost a year's worth of themes.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  BULK_FIELDS,
  SINGLE_FIELDS,
  normalizeLabel,
  parseYear,
  readBulkQuotes,
  readSingleQuote,
  serializeCollection,
} from '../scripts/ingest.mjs';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INGEST = path.join(REPO_ROOT, 'scripts', 'ingest.mjs');
const ADDED_AT = '2026-03-14';

/** A body shaped exactly the way GitHub renders an issue form. */
const SINGLE_BODY = `### Quote

Under conditions of tyranny it is far easier to act than to think.

### Author

Hannah Arendt

### Work

The Life of the Mind

### Kind of work

book

### Year

1971

### Themes

politics, mind, freedom

### Tags

arendt, exam notes

### Language

English (en)

### Source URL

_No response_

### Note

Worth setting against her remark about the banality of evil.

### Favourite

- [X] One of the ones worth coming back to`;

/* --------------------------------------------------------------------------
 * The contract between the forms and the parser
 * ------------------------------------------------------------------------ */

/** Field labels sit at one indent inside `attributes:`; checkbox options do not. */
async function labelsIn(file) {
  const yaml = await readFile(path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', file), 'utf8');
  return [...yaml.matchAll(/^ {6}label: (.+)$/gm)].map((match) => normalizeLabel(match[1]));
}

test('every label in add-quote.yml is a field ingest.mjs reads', async () => {
  assert.deepEqual(new Set(await labelsIn('add-quote.yml')), new Set(Object.keys(SINGLE_FIELDS)));
});

test('every label in bulk-import.yml is a field ingest.mjs reads', async () => {
  assert.deepEqual(new Set(await labelsIn('bulk-import.yml')), new Set(Object.keys(BULK_FIELDS)));
});

test('the themes dropdown offers exactly the shared vocabulary', async () => {
  const { THEMES } = await import('../assets/quote-core.js');
  const yaml = await readFile(path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', 'add-quote.yml'), 'utf8');
  const block = yaml.slice(yaml.indexOf('      label: Themes'), yaml.indexOf('      label: Tags'));
  const options = [...block.matchAll(/^ {8}- (\S+)$/gm)].map((match) => match[1]);
  assert.deepEqual(options, [...THEMES]);
});

/* --------------------------------------------------------------------------
 * Reading one quote
 * ------------------------------------------------------------------------ */

test('a filled-in form becomes a complete record', () => {
  const quote = readSingleQuote(SINGLE_BODY, ADDED_AT);

  assert.equal(quote.text, 'Under conditions of tyranny it is far easier to act than to think.');
  assert.equal(quote.author, 'Hannah Arendt');
  assert.equal(quote.work, 'The Life of the Mind');
  assert.equal(quote.workKind, 'book');
  assert.equal(quote.year, 1971);
  assert.deepEqual(quote.themes, ['politics', 'mind', 'freedom']);
  assert.deepEqual(quote.tags, ['arendt', 'exam notes']);
  assert.equal(quote.lang, 'en');
  assert.equal(quote.source.kind, 'manual');
  assert.equal(quote.source.url, null, 'an untouched optional field is empty, not the words "No response"');
  assert.equal(quote.favorite, true);
  assert.match(quote.note, /banality of evil/);
  assert.equal(quote.addedAt, ADDED_AT);
  assert.match(quote.id, /^q_[0-9a-f]{12}$/);
});

test('an unchecked favourite box is not a favourite', () => {
  const body = SINGLE_BODY.replace('- [X] One', '- [ ] One');
  assert.equal(readSingleQuote(body, ADDED_AT).favorite, false);
});

test('a quotation pasted as a blockquote keeps its words', () => {
  const body = '### Quote\n\n> Man is condemned to be free.\n\n### Author\n\nJean-Paul Sartre';
  assert.equal(readSingleQuote(body, ADDED_AT).text, 'Man is condemned to be free.');
});

test('a heading inside the quotation is not mistaken for a field', () => {
  const body = '### Quote\n\n### Chapter one\n\nAll happy families are alike.\n\n### Author\n\nLeo Tolstoy';
  assert.match(readSingleQuote(body, ADDED_AT).text, /^### Chapter one All happy families/);
});

test('years are read the way a person writes them', () => {
  assert.equal(parseYear('1971'), 1971);
  assert.equal(parseYear('-350'), -350);
  assert.equal(parseYear('350 BC'), -350);
  assert.equal(parseYear('350 f.Kr.'), -350);
  assert.equal(parseYear(''), null);
});

test('an unreadable year is refused with something to do about it', () => {
  assert.throws(() => parseYear('sometime in the fifties'), (error) => {
    assert.match(error.message, /could not read/);
    assert.match(error.hint, /plain number/);
    return true;
  });
});

test('a year outside the collection is refused', () => {
  assert.throws(() => parseYear('3000'), /outside the range/);
});

test('a theme outside the vocabulary is refused, and the vocabulary is offered', () => {
  const body = SINGLE_BODY.replace('politics, mind, freedom', 'politics, vibes');
  assert.throws(() => readSingleQuote(body, ADDED_AT), (error) => {
    assert.match(error.message, /Not a theme in this collection: vibes/);
    assert.match(error.hint, /agency, art, attention/);
    return true;
  });
});

test('a quote with no words is refused', () => {
  const body = SINGLE_BODY.replace('Under conditions of tyranny it is far easier to act than to think.', '');
  assert.throws(() => readSingleQuote(body, ADDED_AT), /quote itself is empty/);
});

test('a quote with no author is refused', () => {
  const body = SINGLE_BODY.replace('Hannah Arendt', '');
  assert.throws(() => readSingleQuote(body, ADDED_AT), /no author/);
});

test('a hand-written issue is refused with an explanation', () => {
  assert.throws(() => readSingleQuote('I heard a good one today', ADDED_AT), (error) => {
    assert.match(error.message, /did not look|does not look/);
    return true;
  });
});

test('a URL that is not a URL is refused', () => {
  const body = SINGLE_BODY.replace('_No response_', 'page 42 of the paperback');
  assert.throws(() => readSingleQuote(body, ADDED_AT), /does not look like a web address/);
});

/* --------------------------------------------------------------------------
 * Reading many quotes
 * ------------------------------------------------------------------------ */

const BULK_BODY = `### Quotes

\`\`\`json
[
  { "text": "The unexamined life is not worth living.", "author": "Socrates", "year": -399, "themes": ["meaning"] },
  { "text": "We are what we repeatedly do.", "author": "Will Durant", "themes": ["character", "work"] }
]
\`\`\``;

test('a pasted array becomes records marked as an import', () => {
  const { quotes, warnings } = readBulkQuotes(BULK_BODY, ADDED_AT);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].year, -399);
  assert.equal(quotes[0].source.kind, 'import');
  assert.deepEqual(quotes[1].themes, ['character', 'work']);
  assert.deepEqual(warnings, []);
});

test('a whole collection object may be pasted instead of an array', () => {
  const body = '### Quotes\n\n{ "schemaVersion": 1, "quotes": [{ "text": "Ars longa, vita brevis.", "author": "Hippocrates" }] }';
  assert.equal(readBulkQuotes(body, ADDED_AT).quotes.length, 1);
});

test('broken JSON is refused with the parser’s own complaint', () => {
  const body = '### Quotes\n\n[{ "text": "half a thought", ]';
  assert.throws(() => readBulkQuotes(body, ADDED_AT), (error) => {
    assert.match(error.message, /not valid JSON/);
    assert.match(error.hint, /import\.html/);
    return true;
  });
});

test('an empty import is refused', () => {
  assert.throws(() => readBulkQuotes('### Quotes\n\n```json\n\n```', ADDED_AT), /import is empty/);
});

test('JSON that is not a list of quotes is refused', () => {
  assert.throws(() => readBulkQuotes('### Quotes\n\n"just a string"', ADDED_AT), /not a list of quotes/);
});

test('an id that disagrees with its own text is refused', () => {
  const body = '### Quotes\n\n[{ "id": "q_000000000000", "text": "Nothing is more real than nothing.", "author": "Samuel Beckett" }]';
  assert.throws(() => readBulkQuotes(body, ADDED_AT), /does not match its text/);
});

test('a missing author is a warning, not a refusal', () => {
  const body = '### Quotes\n\n[{ "text": "Everything flows." }]';
  const { quotes, warnings } = readBulkQuotes(body, ADDED_AT);
  assert.equal(quotes[0].author, 'Unknown');
  assert.match(warnings[0], /filed under Unknown/);
});

/* --------------------------------------------------------------------------
 * Writing the collection
 * ------------------------------------------------------------------------ */

test('the data file is written in a stable, readable shape', () => {
  const quote = readSingleQuote(SINGLE_BODY, ADDED_AT);
  const scrambled = Object.fromEntries(Object.entries(quote).reverse());
  const contents = serializeCollection({ quotes: [scrambled], schemaVersion: 1 });

  assert.ok(contents.endsWith('}\n'), 'ends with exactly one newline');
  assert.match(contents, /^\{\n {2}"schemaVersion": 1,/, 'two-space indent, schemaVersion first');
  assert.deepEqual(Object.keys(JSON.parse(contents)), ['schemaVersion', 'quotes']);
  assert.deepEqual(Object.keys(JSON.parse(contents).quotes[0]).slice(0, 4), ['id', 'text', 'author', 'work']);
  assert.equal(contents, serializeCollection(JSON.parse(contents)), 'writing twice gives the same bytes');
});

/* --------------------------------------------------------------------------
 * End to end, the way the Action runs it
 * ------------------------------------------------------------------------ */

async function scratchCollection(quotes = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'quotes-'));
  const file = path.join(directory, 'quotes.json');
  await writeFile(file, `${JSON.stringify({ schemaVersion: 1, quotes }, null, 2)}\n`);
  return file;
}

async function ingestBody(body, file, extra = []) {
  return run(process.execPath, [INGEST, '--body-env', 'ISSUE_BODY', '--data', file, ...extra], {
    env: { ...process.env, ISSUE_BODY: body, GITHUB_OUTPUT: '', SITE_BASE_URL: 'https://example.test/' },
  });
}

test('running it twice adds the quote once', async () => {
  const file = await scratchCollection();

  const first = await ingestBody(SINGLE_BODY, file);
  assert.match(first.stdout, /1 added/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).quotes.length, 1);

  const second = await ingestBody(SINGLE_BODY, file);
  assert.match(second.stdout, /0 added/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).quotes.length, 1);
});

test('a malformed issue leaves the data file untouched and exits non-zero', async () => {
  const file = await scratchCollection();
  const before = await readFile(file, 'utf8');

  const failure = await ingestBody('### Quote\n\n### Author\n\nNobody', file).then(
    () => assert.fail('a quote with no text should not be accepted'),
    (error) => error,
  );

  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /could not add this one/i);
  assert.equal(await readFile(file, 'utf8'), before, 'nothing was written');
});

test('the mode is detected from the form when it is not given', async () => {
  const file = await scratchCollection();
  const result = await ingestBody(BULK_BODY, file, ['--mode', 'auto']);
  assert.match(result.stdout, /^Bulk import: 2 added/m);
});

test('a dry run reports what it would do and writes nothing', async () => {
  const file = await scratchCollection();
  const before = await readFile(file, 'utf8');
  const result = await ingestBody(SINGLE_BODY, file, ['--dry-run']);

  assert.match(result.stdout, /1 added/);
  assert.equal(await readFile(file, 'utf8'), before);
});
