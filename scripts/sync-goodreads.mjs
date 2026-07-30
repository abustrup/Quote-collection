#!/usr/bin/env node
/**
 * Pull the Goodreads quote list straight into the collection.
 *
 * This exists because of a measured fact about how this project would
 * otherwise die. The drag-the-PDFs importer works, but it costs eight steps
 * across three apps, and the record on steps that need a person to show up is
 * 0 of 3 followed, against 5 of 5 for anything that runs itself
 * (harness-priorities.md, 2026-07-29). A quote library that only fills up if
 * someone remembers to print six PDFs is a quote library that stays empty.
 *
 * So the same job runs on a schedule instead. GitHub's runners are not behind
 * the sandbox egress policy that blocked goodreads.com while this was written,
 * so the fetch that is impossible here is ordinary there.
 *
 * The one thing it cannot guess is whose list to read. That is a single URL,
 * pasted once, and after that the collection keeps itself current.
 *
 * Usage:
 *   node scripts/sync-goodreads.mjs                 # read data/sources.json
 *   node scripts/sync-goodreads.mjs --profile URL   # and remember it
 *   node scripts/sync-goodreads.mjs --html FILE     # parse a saved page
 *   node scripts/sync-goodreads.mjs --dry-run
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, makeQuote, mergeQuotes, validateCollection } from '../assets/quote-core.js';
import { readTombstones, withoutRemoved } from './tombstones.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_FILE = path.join(REPO_ROOT, 'data', 'sources.json');
const DATA_FILE = path.join(REPO_ROOT, 'data', 'quotes.json');

/** Goodreads serves 30 quotes a page; this is a runaway guard, not a limit. */
const MAX_PAGES = 40;

/* ---------------------------------------------------------------------------
 * HTML
 * ------------------------------------------------------------------------- */

/**
 * The named HTML entities for code points 160 to 255, in order.
 *
 * Built from a list rather than hand-picked, because hand-picking is how
 * `&aelig;` gets missed and a Danish quotation is published as "l&aelig;re".
 * Goodreads escapes non-ASCII letters this way, and this collection is full of
 * æ, ø and å.
 */
const LATIN1_ENTITY_NAMES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr '
  + 'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest '
  + 'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml '
  + 'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times '
  + 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig '
  + 'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml '
  + 'igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide '
  + 'oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', bdquo: '„',
  mdash: '—', ndash: '–', horbar: '―', hellip: '…', bull: '•',
  lsaquo: '‹', rsaquo: '›', dagger: '†', permil: '‰', trade: '™', euro: '€',
  ...Object.fromEntries(LATIN1_ENTITY_NAMES.map((name, index) => [name, String.fromCodePoint(160 + index)])),
};

function decodeEntities(input) {
  return String(input)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Case-sensitive first: &Aring; is Å and &aring; is å. Only fall back to a
    // case-insensitive match for the ASCII names, where case never differs.
    .replace(/&([a-zA-Z]+);/g, (whole, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}

/** Strip tags, then decode — in that order, so a tag cannot be forged by an entity. */
function textOf(html) {
  return decodeEntities(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull every quote out of one page of a Goodreads quote list.
 *
 * Anchored on `class="quoteText"`, which is the one hook that has survived
 * every redesign of this page, rather than on the surrounding layout. Author
 * and work are read from the `authorOrTitle` elements inside it: Goodreads
 * emits the author first and the work second, and renders either as a link or
 * a span depending on whether it has a page for it.
 */
export function parseQuotesHtml(html) {
  const quotes = [];
  const blocks = String(html).split(/<div[^>]*class="[^"]*\bquoteText\b/i).slice(1);

  for (const raw of blocks) {
    const body = raw.slice(raw.indexOf('>') + 1);
    // The attribution bar (U+2015) ends the quotation and begins the credit.
    const barIndex = body.search(/―|&#8213;|&#x2015;/i);
    const quotePart = barIndex === -1 ? body : body.slice(0, barIndex);
    const creditPart = barIndex === -1 ? '' : body.slice(barIndex);

    const text = textOf(quotePart).replace(/^[“"]\s*/, '').replace(/\s*[”"]$/, '');
    if (text.length < 2) continue;

    const credits = [...creditPart.matchAll(/<(?:a|span)[^>]*class="[^"]*authorOrTitle[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/gi)]
      .map((match) => textOf(match[1]).replace(/,\s*$/, ''))
      .filter(Boolean);

    // Everything after the block's own footer belongs to the next quote.
    const footer = raw.slice(0, raw.search(/<div[^>]*class="[^"]*\bquote\b[^"]*"/i) + 1 || raw.length);
    const tagBlock = /class="[^"]*greyText[^"]*smallText[^"]*left[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(footer);
    const tags = tagBlock
      ? [...tagBlock[1].matchAll(/<a[^>]*href="\/quotes\/tag\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
        .map((match) => textOf(match[1]))
        .filter(Boolean)
      : [];

    quotes.push({
      text,
      author: credits[0] ?? 'Unknown',
      work: credits[1] ?? null,
      tags,
    });
  }

  return quotes;
}

/** The "Showing 1-30 of 174" line, which is the page's own count to check against. */
export function parseShowing(html) {
  const match = /Showing\s+(\d+)\s*[-–—]\s*(\d+)\s+of\s+([\d,]+)/i.exec(textOf(html));
  if (!match) return null;
  return { from: Number(match[1]), to: Number(match[2]), total: Number(match[3].replace(/,/g, '')) };
}

/**
 * Turn a profile or quote-list URL into the canonical list URL.
 *
 * Accepts whatever someone actually has to hand: the profile page, the quotes
 * page, or a bare numeric id.
 */
export function listUrlFor(input, page = 1) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('no Goodreads profile given');

  const id = /(?:user\/show\/|quotes\/list\/)(\d+)/.exec(raw)?.[1] ?? (/^\d+$/.test(raw) ? raw : null);
  if (!id) throw new Error(`could not find a Goodreads user id in "${raw}"`);

  return `https://www.goodreads.com/quotes/list/${id}?page=${page}`;
}

/* ---------------------------------------------------------------------------
 * Fetching
 * ------------------------------------------------------------------------- */

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      // Goodreads serves a stub to clients that do not look like a browser.
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'accept-language': 'en-GB,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  return response.text();
}

/**
 * A private profile does not 404 — it serves a sign-in page with zero quotes,
 * which would otherwise read as "your collection is empty" and be committed.
 */
function looksLikeSignIn(html) {
  return /sign in to continue|Sign up to see/i.test(textOf(html).slice(0, 4000));
}

export async function fetchAllQuotes(profile, { fetchImpl = fetchPage, log = () => {} } = {}) {
  const collected = [];
  let expected = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = listUrlFor(profile, page);
    const html = await fetchImpl(url);

    if (page === 1 && looksLikeSignIn(html)) {
      throw new Error('Goodreads served a sign-in page. The quote list is not public, so it cannot be read without an account.');
    }

    const showing = parseShowing(html);
    if (page === 1) expected = showing?.total ?? null;

    const quotes = parseQuotesHtml(html);
    log(`page ${page}: ${quotes.length} quotes${showing ? ` (showing ${showing.from}-${showing.to} of ${showing.total})` : ''}`);
    if (!quotes.length) break;

    collected.push(...quotes);
    if (showing && showing.to >= showing.total) break;
  }

  return { quotes: collected, expected };
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------- */

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sources = await readJson(SOURCES_FILE, { schemaVersion: 1, goodreads: { profileUrl: null } });
  const profile = arg('profile') ?? sources.goodreads?.profileUrl ?? null;
  const htmlFile = arg('html');

  if (!profile && !htmlFile) {
    process.stdout.write(
      'No Goodreads profile is set yet, so there is nothing to sync.\n\n'
      + 'Run this workflow again with your Goodreads profile or quotes-list URL,\n'
      + 'or put it in data/sources.json under goodreads.profileUrl.\n',
    );
    process.exitCode = 78; // Nothing to do; distinguishable from a real failure.
    return;
  }

  let incoming;
  let expected = null;

  if (htmlFile) {
    const html = await readFile(path.resolve(htmlFile), 'utf8');
    incoming = parseQuotesHtml(html);
    expected = parseShowing(html)?.total ?? null;
    process.stdout.write(`Read ${incoming.length} quotes from ${htmlFile}.\n`);
  } else {
    const result = await fetchAllQuotes(profile, { log: (line) => process.stdout.write(`${line}\n`) });
    incoming = result.quotes;
    expected = result.expected;
  }

  if (expected != null && incoming.length !== expected) {
    process.stdout.write(`Note: the page says ${expected} quotes and ${incoming.length} were read.\n`);
  }

  const existing = await readJson(DATA_FILE, { schemaVersion: SCHEMA_VERSION, quotes: [] });
  const records = incoming.map((quote) => makeQuote({
    ...quote,
    source: { kind: 'goodreads', url: profile ? listUrlFor(profile) : null },
    // Goodreads quotations are transcribed by other readers, so they arrive
    // unverified by definition. Saying otherwise would hollow out the one
    // field that makes this collection worth trusting.
    verification: { status: 'unverified', note: 'Imported from Goodreads; wording not independently checked.' },
  }));

  // Anything deliberately removed stays removed. Without this the sync would
  // re-file every deleted quote the next morning, since the id is derived from
  // the text and Goodreads still has it.
  const { kept, skipped } = withoutRemoved(records, await readTombstones());
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} previously removed ${skipped.length === 1 ? 'quote' : 'quotes'}.`);
  }

  const { quotes, added, enriched } = mergeQuotes(existing.quotes ?? [], kept);

  // Only move the timestamp when the quotes moved. Otherwise a daily run that
  // finds nothing still rewrites the file, and the workflow commits it — a junk
  // commit every morning, forever, burying the real ones.
  const changed = added.length > 0 || enriched.length > 0;

  const merged = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: changed ? new Date().toISOString() : existing.updatedAt,
    quotes: quotes.sort((a, b) =>
      a.author.localeCompare(b.author, 'en')
      || (a.work ?? '').localeCompare(b.work ?? '', 'en')
      || a.text.localeCompare(b.text, 'en')),
  };

  const { errors } = validateCollection(merged);
  if (errors.length) {
    process.stderr.write(`Refusing to write, the merged collection is not valid:\n${errors.slice(0, 10).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${added.length} new, ${enriched.length} filled in, ${merged.quotes.length} in the collection.\n`);

  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `added=${added.length}\ntotal=${merged.quotes.length}\n`, { flag: 'a' });
  }

  if (dryRun) {
    process.stdout.write('Dry run, nothing written.\n');
    return;
  }

  await writeFile(DATA_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  if (profile && sources.goodreads?.profileUrl !== profile) {
    await writeFile(SOURCES_FILE, `${JSON.stringify(
      { ...sources, schemaVersion: 1, goodreads: { ...sources.goodreads, profileUrl: profile } }, null, 2,
    )}\n`, 'utf8');
    process.stdout.write('Remembered the profile, so this runs on its own from now on.\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
