/**
 * Tests for the shared contract in assets/quote-core.js.
 *
 * The emphasis here is on text handling, because that is where a mistake is
 * both silent and expensive: `cleanQuoteText` feeds `quoteId`, so a wrong strip
 * does not merely display badly — it changes a quote's identity, breaks its
 * permalink, and lets the same quote enter the collection twice.
 *
 * Several cases below are regressions from a real bug: an earlier version
 * stripped anything after an em dash followed by a capital letter, which ate
 * half of "Life is short — Art is long", and unwrapped any string that began
 * and ended with a quotation mark, which mangled dialogue.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES,
  VERIFICATION_STATUSES,
  cleanQuoteText,
  makeQuote,
  mergeQuotes,
  normalizeForIdentity,
  parseAttribution,
  quoteId,
  slug,
  tidyWhitespace,
  typographic,
  validateCollection,
} from '../assets/quote-core.js';

test('tidyWhitespace rejoins words broken across a line', () => {
  assert.equal(tidyWhitespace('under-\nstanding the world'), 'understanding the world');
  assert.equal(tidyWhitespace('two   spaces\nand a newline'), 'two spaces and a newline');
  assert.equal(tidyWhitespace('non breaking'), 'non breaking');
});

test('tidyWhitespace does not join across a hyphenated compound', () => {
  // A real hyphen followed by a space is not a line break artefact.
  assert.equal(tidyWhitespace('well- known'), 'well- known');
});

test('cleanQuoteText unwraps a quotation that is wrapped as a whole', () => {
  assert.equal(cleanQuoteText('“The mysterious is the source of all true art.”'),
    'The mysterious is the source of all true art.');
  assert.equal(cleanQuoteText('«Le style est l’homme même»'), 'Le style est l’homme même');
  assert.equal(cleanQuoteText('"A plain one."'), 'A plain one.');
});

test('cleanQuoteText leaves inner dialogue intact', () => {
  // Regression: stripping the outer characters here would silently corrupt the
  // quote into `Hello," she said, "goodbye`.
  const dialogue = '"Hello," she said, "goodbye"';
  assert.equal(cleanQuoteText(dialogue), dialogue);

  const nested = '“He said “no” firmly.”';
  assert.equal(cleanQuoteText(nested), nested);
});

test('cleanQuoteText strips a Goodreads attribution but not prose', () => {
  assert.equal(
    cleanQuoteText('“Whereof one cannot speak, thereof one must be silent.” ― Ludwig Wittgenstein, Tractatus'),
    'Whereof one cannot speak, thereof one must be silent.',
  );
  assert.equal(cleanQuoteText('We must cultivate our garden ― Voltaire'), 'We must cultivate our garden');
});

test('cleanQuoteText keeps em dashes that belong to the sentence', () => {
  // Regression: the capital A after the dash used to trigger attribution
  // stripping, deleting the second half of the aphorism.
  assert.equal(cleanQuoteText('Life is short — Art is long.'), 'Life is short — Art is long.');
  assert.equal(cleanQuoteText('To be, or not to be—that is the question.'),
    'To be, or not to be—that is the question.');
  assert.equal(cleanQuoteText('The unexamined life — Socrates said — is not worth living.'),
    'The unexamined life — Socrates said — is not worth living.');
});

test('quoteId is stable across transcription styles', () => {
  const plain = 'The unexamined life is not worth living';
  assert.equal(quoteId('“The unexamined life is not worth living.”'), quoteId(plain));
  assert.equal(quoteId('It’s a test — really.'), quoteId("It's a test - really"));
  assert.equal(quoteId('Ellipsis…'), quoteId('Ellipsis...'));
  assert.equal(quoteId('CASE INSENSITIVE'), quoteId('case insensitive'));
});

test('quoteId separates quotes that differ in words', () => {
  assert.notEqual(quoteId('The unexamined life is not worth living'),
    quoteId('The examined life is not worth living'));
  assert.match(quoteId('anything'), /^q_[0-9a-f]{12}$/);
});

test('normalizeForIdentity discards punctuation but not words', () => {
  assert.equal(normalizeForIdentity('Man, is; condemned: to—be free!'), 'man is condemned to be free');
});

test('parseAttribution splits author from work at the first comma', () => {
  assert.deepEqual(parseAttribution('― Hannah Arendt, The Human Condition'),
    { author: 'Hannah Arendt', work: 'The Human Condition' });
  assert.deepEqual(parseAttribution('― Marcus Aurelius'),
    { author: 'Marcus Aurelius', work: null });
  assert.deepEqual(parseAttribution(''), { author: '', work: null });

  // Single-word titles must survive. An earlier rule treated a lone capitalised
  // word after the comma as a forename, which folded the title into the author
  // and split one author across two filters.
  assert.deepEqual(parseAttribution('― Plato, Apology'),
    { author: 'Plato', work: 'Apology' });
  assert.deepEqual(parseAttribution('― William Shakespeare, Hamlet'),
    { author: 'William Shakespeare', work: 'Hamlet' });

  // Later commas belong to the title, not to a second field.
  assert.deepEqual(parseAttribution('― Michel Foucault, The History of Sexuality, Volume 1'),
    { author: 'Michel Foucault', work: 'The History of Sexuality, Volume 1' });
});

test('makeQuote fills defaults and discards unknown vocabulary', () => {
  const quote = makeQuote({
    text: '“A line worth keeping.”',
    author: 'Someone',
    themes: ['beauty', 'not-a-real-theme'],
    workKind: 'grimoire',
    year: 1931,
  });

  assert.equal(quote.text, 'A line worth keeping.');
  assert.deepEqual(quote.themes, ['beauty']);
  assert.equal(quote.workKind, null, 'an unknown workKind is dropped, not passed through');
  assert.equal(quote.verification.status, 'unverified',
    'anything not explicitly checked must not claim to be verified');
  assert.equal(quote.id, quoteId(quote.text));
});

test('makeQuote keeps a supplied id that matches the format', () => {
  const id = quoteId('some text');
  assert.equal(makeQuote({ text: 'some text', author: 'A', id }).id, id);
  assert.equal(makeQuote({ text: 'some text', author: 'A', id: 'nonsense' }).id, id);
});

test('mergeQuotes is idempotent', () => {
  const first = [makeQuote({ text: 'One.', author: 'A' })];
  const again = [makeQuote({ text: '“One.”', author: 'A' })];

  const result = mergeQuotes(first, again);
  assert.equal(result.quotes.length, 1, 'the same words must not enter twice');
  assert.equal(result.added.length, 0);
});

test('mergeQuotes fills gaps without overwriting what is already there', () => {
  const existing = [makeQuote({
    text: 'One.',
    author: 'A',
    work: 'The Corrected Title',
    note: 'my own note',
    tags: ['mine'],
    verification: { status: 'verified' },
  })];

  const incoming = [makeQuote({
    text: 'One.',
    author: 'A',
    work: 'A Worse Title',
    year: 1900,
    tags: ['theirs'],
    verification: { status: 'unverified' },
  })];

  const { quotes } = mergeQuotes(existing, incoming);
  const merged = quotes[0];

  assert.equal(merged.work, 'The Corrected Title', 'a correction must survive re-import');
  assert.equal(merged.note, 'my own note');
  assert.equal(merged.verification.status, 'verified', 'earned verification must not be downgraded');
  assert.equal(merged.year, 1900, 'a genuinely empty field is filled');
  assert.deepEqual(merged.tags.sort(), ['mine', 'theirs']);
});

test('validateCollection accepts a well-formed collection', () => {
  const collection = {
    schemaVersion: 1,
    quotes: [makeQuote({ text: 'Something true.', author: 'A' })],
  };
  assert.deepEqual(validateCollection(collection).errors, []);
});

test('validateCollection catches an id that has drifted from its text', () => {
  const quote = makeQuote({ text: 'Original text.', author: 'A' });
  quote.text = 'Edited text without regenerating the id.';

  const { errors } = validateCollection({ schemaVersion: 1, quotes: [quote] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not match its text/);
});

test('validateCollection catches duplicates, bad vocabulary and bad years', () => {
  const one = makeQuote({ text: 'Twice.', author: 'A' });
  const { errors } = validateCollection({
    schemaVersion: 1,
    quotes: [one, { ...one }, { ...makeQuote({ text: 'Other.', author: 'B' }), themes: ['nope'], year: 9999 }],
  });

  assert.ok(errors.some((e) => /duplicate id/.test(e)));
  assert.ok(errors.some((e) => /unknown theme/.test(e)));
  assert.ok(errors.some((e) => /implausible year/.test(e)));
});

test('validateCollection rejects a wrong schemaVersion and a missing author', () => {
  const bad = validateCollection({ schemaVersion: 99, quotes: [{ id: quoteId('x'), text: 'xy' }] });
  assert.ok(bad.errors.some((e) => /schemaVersion/.test(e)));
  assert.ok(bad.errors.some((e) => /author is missing/.test(e)));
});

test('slug is url-safe and folds accents', () => {
  assert.equal(slug('Søren Kierkegaard'), 'soren-kierkegaard');
  assert.equal(slug('Ludwig  Wittgenstein!'), 'ludwig-wittgenstein');
});

test('the controlled vocabularies are sorted and free of duplicates', () => {
  // Sorted lists keep the schema, the issue form and the filter menu reviewable
  // side by side; duplicates would silently double-count a theme.
  assert.deepEqual(THEMES, [...THEMES].sort(), 'THEMES should stay alphabetical');
  assert.equal(new Set(THEMES).size, THEMES.length);
  assert.equal(new Set(VERIFICATION_STATUSES).size, VERIFICATION_STATUSES.length);
});

test('slug keeps Nordic authors distinct', () => {
  // Regression: ø and æ have no Unicode decomposition, so an NFD-only slug
  // turned both into a hyphen and collapsed distinct names onto one filter.
  assert.equal(slug('Søren Kierkegaard'), 'soren-kierkegaard');
  assert.equal(slug('Karen Blixen'), 'karen-blixen');
  assert.equal(slug('H.C. Ørsted'), 'h-c-orsted');
  assert.notEqual(slug('Søren'), slug('Særen'));
  assert.equal(slug('Friedrich Nietzsche'), 'friedrich-nietzsche');
  assert.equal(slug('Simone de Beauvoir'), 'simone-de-beauvoir');
});

test('typographic curls marks the way a typesetter would', () => {
  assert.equal(
    typographic(`I can only answer the question 'What am I to do?' if I can answer the prior question`),
    'I can only answer the question ‘What am I to do?’ if I can answer the prior question');
  assert.equal(typographic(`"Hello," she said, "goodbye"`), '“Hello,” she said, “goodbye”');
  assert.equal(typographic(`man's heart`), 'man’s heart');
  assert.equal(typographic(`the '89 crash`), 'the ’89 crash');
  assert.equal(typographic(`'tis the season`), '‘tis the season');
  assert.equal(typographic(`He said "no" — 'firmly'`), 'He said “no” — ‘firmly’');
  assert.equal(typographic(`dogs' bowls`), 'dogs’ bowls');
});

test('typographic leaves already-typeset text and the identity alone', () => {
  const already = '“The unexamined life,” he said — ‘truly’.';
  assert.equal(typographic(already), already);
  // The transform must never be part of identity, or permalinks would move.
  const straight = `It's a test`;
  assert.equal(quoteId(straight), quoteId(typographic(straight)));
});
