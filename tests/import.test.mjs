/**
 * The importer is the only door the collection's first 174 quotes come through,
 * so it is held to a number rather than an impression: every quote in every
 * fixture, with its author, its work and its tags, recovered exactly.
 *
 * The fixtures are real PDFs printed by real Chromium from an HTML replica of
 * the Goodreads quote list — see tests/fixtures/make-fixtures.mjs. `expected.json`
 * is written by the same script from the same data, so it is a statement of what
 * went in, not a transcript of what the parser happened to produce.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  dedupeRows,
  guessLanguage,
  importPdf,
  linesFromItems,
  parseQuoteLines,
  readPdfLines,
  toRecord,
} from '../assets/import.js';
import { mergeQuotes, quoteId, validateCollection } from '../assets/quote-core.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const normalise = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Load every fixture once; parsing four PDFs per assertion would be silly. */
const parsed = new Map();
const expectedPages = JSON.parse(await readFile(join(FIXTURES, 'expected.json'), 'utf8')).pages;

before(async () => {
  for (const page of expectedPages) {
    const bytes = new Uint8Array(await readFile(join(FIXTURES, page.file)));
    parsed.set(page.file, await importPdf(bytes));
  }
});

/* ---------------------------------------------------------------------------
 * Recall and field accuracy
 * ------------------------------------------------------------------------- */

describe('reading a printed Goodreads quote list', () => {
  it('recovers every quote from every fixture, verbatim', (t) => {
    let quotesExpected = 0;
    let found = 0;
    let authors = 0;
    let works = 0;
    let tags = 0;

    for (const page of expectedPages) {
      const { quotes } = parsed.get(page.file);
      const byText = new Map(quotes.map((quote) => [normalise(quote.text), quote]));

      for (const want of page.quotes) {
        quotesExpected += 1;
        const got = byText.get(normalise(want.text));
        if (!got) continue;
        found += 1;
        if (got.author === want.author) authors += 1;
        if ((got.work ?? null) === (want.work ?? null)) works += 1;
        if (got.tags.join('|') === want.tags.join('|')) tags += 1;
      }
    }

    t.diagnostic(`text ${found}/${quotesExpected}, author ${authors}, work ${works}, tags ${tags}`);
    assert.equal(found, quotesExpected, 'every quote is recovered');
    assert.equal(authors, quotesExpected, 'every author is recovered');
    assert.equal(works, quotesExpected, 'every work title is recovered');
    assert.equal(tags, quotesExpected, 'every tag list is recovered');
  });

  it('invents nothing: no extra rows beyond what was printed', () => {
    for (const page of expectedPages) {
      const { quotes } = parsed.get(page.file);
      const wanted = new Set(page.quotes.map((quote) => normalise(quote.text)));
      const extra = quotes.filter((quote) => !wanted.has(normalise(quote.text)));
      assert.deepEqual(extra.map((quote) => quote.text), [], `${page.file} produced unexpected rows`);
    }
  });

  it('agrees with the "Showing 1-30 of 174" line on each page', () => {
    for (const page of expectedPages) {
      const { meta } = parsed.get(page.file);
      assert.deepEqual(meta.showing, page.showing, `${page.file} header count`);
      assert.equal(meta.parsed, meta.expected, `${page.file} parsed as many quotes as the page claims`);
    }
  });

  it('keeps the address the page was printed from', () => {
    for (const page of expectedPages) {
      assert.equal(parsed.get(page.file).meta.sourceUrl, page.sourceUrl);
    }
  });
});

/* ---------------------------------------------------------------------------
 * The furniture a browser prints around the page
 * ------------------------------------------------------------------------- */

describe('print furniture', () => {
  it('never leaks into a quote', () => {
    const leaks = [/https?:\/\//i, /\d{1,2}[./]\d{1,2}[./]\d{2,4}/, /\bAlexander Bustrup/, /\d+\s*\/\s*\d+\s*$/];
    for (const page of expectedPages) {
      for (const quote of parsed.get(page.file).quotes) {
        for (const pattern of leaks) {
          assert.ok(!pattern.test(quote.text), `${pattern} leaked into: ${quote.text.slice(0, 80)}`);
          assert.ok(!pattern.test(quote.author), `${pattern} leaked into author: ${quote.author}`);
        }
      }
    }
  });

  it('does not swallow the first or last quote on a printed page', () => {
    // The geometric half of the furniture test works on lines sitting alone in
    // the page margin, and the quotes nearest those margins are the ones it
    // would eat first. Both ends of every file, checked against what went in.
    for (const page of expectedPages) {
      const { quotes } = parsed.get(page.file);
      assert.equal(normalise(quotes[0].text), normalise(page.quotes[0].text), `${page.file} first quote`);
      assert.equal(
        normalise(quotes[quotes.length - 1].text),
        normalise(page.quotes[page.quotes.length - 1].text),
        `${page.file} last quote`,
      );
    }
  });
});

/* ---------------------------------------------------------------------------
 * The cases that break parsers
 * ------------------------------------------------------------------------- */

describe('hard cases', () => {
  const find = (file, fragment) => {
    const { quotes } = parsed.get(file);
    const hit = quotes.find((quote) => quote.text.includes(fragment));
    assert.ok(hit, `no quote containing ${JSON.stringify(fragment)} in ${file}`);
    return hit;
  };

  it('stitches a quote back together across a page break', () => {
    let straddlers = 0;
    for (const page of expectedPages) {
      straddlers += parsed.get(page.file).quotes.filter((quote) => quote.splitAcrossPages).length;
    }
    // The fixtures are built to guarantee one per file; if this drops to zero
    // the fixtures have stopped testing the case they exist for.
    assert.ok(straddlers >= 3, `expected a straddling quote in each fixture, found ${straddlers}`);

    const quote = find('goodreads-quotes-page-1.pdf', 'A student who has read only summaries');
    assert.ok(quote.splitAcrossPages);
    assert.match(quote.text, /which is the only condition under which reading changes anybody\.$/);
    assert.equal(quote.author, 'Fixture Author 101');
    assert.equal(quote.work, 'On Reading Slowly');
  });

  it('keeps inner quotation marks and an em dash, and drops the outer pair', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'Never say about anything');
    assert.equal(
      quote.text,
      'Never say about anything, “I have lost it,” but say, “I have given it back” '
        + '— and then go on living as though nothing had been taken from you.',
    );
    assert.equal(quote.author, 'Epictetus');
    assert.equal(quote.work, 'The Enchiridion');
  });

  it('reads a quote with no work title', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'The unexamined life');
    assert.equal(quote.author, 'Socrates');
    assert.equal(quote.work, null);
    assert.ok(quote.flags.includes('no work title'));
  });

  it('reads a quote with no tags', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'Man is condemned to be free');
    assert.deepEqual(quote.tags, []);
    assert.equal(quote.author, 'Jean-Paul Sartre');
  });

  it('keeps a comma inside a work title', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'The story so far');
    assert.equal(quote.author, 'Douglas Adams');
    assert.equal(quote.work, 'The Restaurant at the End of the Universe, Volume 2');
  });

  it('survives a long attribution and a long tag list that both wrap', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'We are not troubled by things');
    assert.equal(quote.author, 'Marcus Aurelius Antoninus Augustus');
    assert.equal(quote.work, 'Meditations: A New Translation with an Introduction');
    assert.equal(quote.tags.length, 8);
    assert.equal(quote.tags[7], 'classics');
  });

  it('does not mistake a very short quote for noise', () => {
    const quote = find('goodreads-quotes-page-1.pdf', 'Amor fati');
    assert.equal(quote.text, 'Amor fati.');
    assert.equal(quote.work, 'Ecce Homo');
    assert.ok(quote.flags.includes('very short'));
  });

  it('does not file a Danish, German or French quote as English', () => {
    assert.equal(find('goodreads-quotes-page-1.pdf', 'Livet skal forstås').lang, 'da');
    assert.equal(find('goodreads-quotes-page-1.pdf', 'Hat man sein Warum').lang, 'de');
    assert.equal(find('goodreads-quotes-page-1.pdf', 'Au milieu de l’hiver').lang, 'fr');
    assert.equal(find('goodreads-quotes-page-1.pdf', 'The unexamined life').lang, 'en');
  });

  it('says nothing rather than something when handed the wrong PDF', async () => {
    const bytes = new Uint8Array(await readFile(join(FIXTURES, 'not-a-quote-list.pdf')));
    const { quotes, meta } = await importPdf(bytes);
    assert.deepEqual(quotes, []);
    assert.equal(meta.showing, null);
  });
});

/* ---------------------------------------------------------------------------
 * The pieces, without a PDF in sight
 * ------------------------------------------------------------------------- */

describe('line reconstruction', () => {
  // pdf.js item shape: transform is [a, b, c, d, x, y].
  const item = (str, x, y, width, height = 10) => ({ str, transform: [1, 0, 0, 1, x, y], width, height });

  it('joins a word split by a ligature and separates words that are apart', () => {
    const [line] = linesFromItems([
      item('tags:', 90, 500, 20),
      item('fi', 113, 500, 6),
      item('xture, set-1', 119, 500, 48),
    ]);
    assert.equal(line.text, 'tags: fixture, set-1');
  });

  it('reads floated content in visual order, not paint order', () => {
    // Chrome paints the tag list and like count of every quote before the text
    // they sit under; taking items in order would interleave the whole page.
    const lines = linesFromItems([
      item('tags: time', 90, 400, 40),
      item('1204 likes', 470, 398.5, 43),
      item('“A quotation.”', 90, 430, 80),
    ]);
    assert.deepEqual(lines.map((line) => line.text), ['“A quotation.”', 'tags: time', '1204 likes']);
  });

  it('does not join columns that merely share a baseline', () => {
    // Two runs of text a third of a page apart are two columns, not one line.
    // Joining them is what let a book cover — whose alt text is the book's
    // title — splice itself into the middle of a quotation.
    const lines = linesFromItems([
      item('THE BOOK COVER', 60, 400, 62),
      item('and the quote continues here.', 150, 400, 140),
    ]);
    assert.deepEqual(lines.map((line) => line.text),
      ['THE BOOK COVER', 'and the quote continues here.']);
    assert.deepEqual(lines.map((line) => line.beside), [0, 1],
      'both segments must record that they sat beside another column');
  });

  it('still joins ordinary word spacing on one line', () => {
    const [line] = linesFromItems([
      item('The unexamined', 90, 400, 68),
      item('life', 162, 400, 18),
    ]);
    assert.equal(line.text, 'The unexamined life');
    assert.equal(line.beside, null);
  });
});

describe('language guessing', () => {
  it('stays with English unless the evidence is clear', () => {
    assert.equal(guessLanguage('Man is condemned to be free.'), 'en');
    assert.equal(guessLanguage('A short one.'), 'en');
    assert.equal(guessLanguage('Det er ikke let at leve, men det skal jeg nok lære.'), 'da');
  });
});

describe('records', () => {
  it('produces a collection that validates', () => {
    const rows = expectedPages.flatMap((page) => parsed.get(page.file).quotes);
    const { rows: unique } = dedupeRows(rows);
    const collection = {
      schemaVersion: 1,
      quotes: unique.map((row) => toRecord(row, '2026-07-29')),
    };
    const { errors } = validateCollection(collection);
    assert.deepEqual(errors, []);
    assert.equal(collection.quotes.length, 84);
  });

  it('gives every quote an id derived from its own text', () => {
    const rows = parsed.get('goodreads-quotes-page-6.pdf').quotes;
    for (const record of rows.map((row) => toRecord(row))) {
      assert.equal(record.id, quoteId(record.text));
    }
  });

  it('marks the source as Goodreads and leaves verification alone', () => {
    const [row] = parsed.get('goodreads-quotes-page-1.pdf').quotes;
    const record = toRecord(row);
    assert.equal(record.source.kind, 'goodreads');
    assert.equal(record.source.url, 'https://www.goodreads.com/quotes/list?page=1');
    assert.equal(record.verification.status, 'unverified');
    assert.equal(record.workKind, 'book');
  });

  it('adopts a Goodreads tag as a theme only when it is already in the vocabulary', () => {
    const { quotes } = parsed.get('goodreads-quotes-page-1.pdf');
    const seneca = quotes.find((quote) => quote.author === 'Seneca');
    assert.deepEqual(seneca.tags, ['time', 'philosophy', 'stoicism']);
    assert.deepEqual(seneca.themes, ['time']);
  });

  it('imports the same file twice without duplicating anything', () => {
    const rows = parsed.get('goodreads-quotes-page-2.pdf').quotes;
    const records = rows.map((row) => toRecord(row, '2026-07-29'));
    const first = mergeQuotes([], records);
    assert.equal(first.added.length, 30);
    const second = mergeQuotes(first.quotes, records);
    assert.equal(second.added.length, 0);
    assert.equal(second.quotes.length, 30);
  });

  it('drops a quote repeated across two printed files', () => {
    const rows = parsed.get('goodreads-quotes-page-1.pdf').quotes;
    const { rows: unique, duplicates } = dedupeRows([...rows, ...rows]);
    assert.equal(duplicates, rows.length);
    assert.equal(unique.length, rows.length);
  });
});

/* ---------------------------------------------------------------------------
 * Flags
 * ------------------------------------------------------------------------- */

describe('flagging', () => {
  it('flags only what deserves a second look', (t) => {
    const rows = expectedPages.flatMap((page) => parsed.get(page.file).quotes);
    const flagged = rows.filter((row) => row.flags.length);
    const counts = {};
    for (const row of rows) for (const flag of row.flags) counts[flag] = (counts[flag] ?? 0) + 1;

    t.diagnostic(`${flagged.length} of ${rows.length} rows flagged: ${JSON.stringify(counts)}`);
    assert.ok(flagged.length < rows.length / 2, 'flagging should be the exception');
    assert.equal(counts['quotation marks did not close'], undefined);
    assert.equal(counts['no opening quotation mark'], undefined);
    assert.equal(counts['no author'], undefined);
  });
});

after(() => parsed.clear());

/* A parse of the raw line stream, so the state machine can be poked directly. */
describe('the state machine, on lines alone', () => {
  const page = (texts, number = 1, height = 800) => ({
    number,
    height,
    lines: texts.map((text, index) => ({ text, y: height - 100 - index * 15, height: 10 })),
  });

  it('ignores navigation and page chrome that precede the first quote', () => {
    const { quotes } = parseQuoteLines([page([
      'goodreads Search books Home My Books Browse',
      'Alexander Bustrups citater',
      'Showing 1-30 of 174',
      '“A quotation that matters.”',
      '― An Author, A Work',
      'tags: one, two 12 likes Like',
    ])]);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].text, 'A quotation that matters.');
    assert.deepEqual(quotes[0].tags, ['one', 'two']);
  });

  it('does not read a wrapped line beginning with a dash as an attribution', () => {
    const { quotes } = parseQuoteLines([page([
      '“A sentence that runs on past the end of its line',
      '— and then keeps going to the end.”',
      '― An Author, A Work',
    ])]);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].text, 'A sentence that runs on past the end of its line — and then keeps going to the end.');
  });

  it('reads a PDF where a page begins mid-quote', () => {
    const { quotes } = parseQuoteLines([
      page(['“The first half of a sentence that was'], 1),
      page(['cut in two by the end of a page.”', '― An Author, A Work', '3 likes Like'], 2),
    ]);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].text, 'The first half of a sentence that was cut in two by the end of a page.');
    assert.ok(quotes[0].splitAcrossPages);
  });
});
