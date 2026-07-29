/**
 * Reading a Goodreads quote list back out of a printed PDF.
 *
 * The 174 quotes this collection starts from exist in exactly one place: six
 * files produced by pressing Cmd-P on https://www.goodreads.com/quotes/list.
 * There is no export, the API is gone, and the person who owns the quotes does
 * not use a terminal. So the recovery path has to be a web page you drag six
 * PDFs onto, and this module is the part of it that does the actual reading.
 *
 * Nothing here touches the DOM, and nothing here imports pdf.js at module load,
 * so the whole parser can be exercised from `node --test` against fixture PDFs.
 *
 * What a printed quote block looks like once the text layer is flattened:
 *
 *     “The quote text, sometimes running over several lines.”
 *     ― Author Name, Book Title
 *     tags: philosophy, life        12 likes  Like
 *
 * and around it, the furniture a browser adds to every printed page: a date and
 * the document title in the top margin, the URL and "3/7" in the bottom one.
 * The awkward part is that a quote does not care where the page ends, so that
 * furniture regularly lands in the middle of a sentence.
 */

import {
  cleanQuoteText,
  makeQuote,
  parseAttribution,
  THEMES,
  tidyWhitespace,
} from './quote-core.js';

/* ---------------------------------------------------------------------------
 * Loading pdf.js
 * ------------------------------------------------------------------------- */

let pdfjsPromise = null;

/**
 * Load the vendored pdf.js, once.
 *
 * The worker path is resolved against this module rather than the document,
 * because the page is served from a project subpath on GitHub Pages
 * (/Quote-collection/) and a document-relative path would break the moment the
 * importer were opened from anywhere but the site root. The vendored build is
 * pdf.js's `legacy` bundle: it is the one that runs unchanged in Node, which is
 * what lets the test suite exercise the same file the browser loads.
 */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/* ---------------------------------------------------------------------------
 * From a PDF to lines of text
 * ------------------------------------------------------------------------- */

/**
 * Rebuild visual lines from pdf.js text items.
 *
 * Two things force this to be done geometrically rather than by taking the
 * items in order. First, the items arrive in paint order, not reading order:
 * Chrome paints floated elements — the tag list and the like count of every
 * quote — in a separate pass, so they all arrive before the text they sit
 * under. Second, a word can be split across items wherever the font has a
 * ligature ("fi" + "xture"), so joins have to be decided by the horizontal gap
 * rather than assumed.
 */
export function linesFromItems(items) {
  const placed = [];
  for (const item of items) {
    if (typeof item.str !== 'string' || item.str === '') continue;
    const [, , , , x, y] = item.transform;
    placed.push({ str: item.str, x, y, width: item.width ?? 0, height: item.height ?? 0 });
  }

  // Descending y is reading order: PDF user space has its origin bottom-left.
  placed.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const rows = [];
  for (const item of placed) {
    const row = rows[rows.length - 1];
    // A tag list and the like count beside it sit on baselines a point or two
    // apart but read as one line, so the tolerance is a fraction of the type
    // size rather than an exact match.
    const tolerance = row ? Math.max(1.5, 0.4 * row.height) : 0;
    if (row && Math.abs(row.y - item.y) <= tolerance) {
      row.items.push(item);
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height || 10, items: [item] });
    }
  }

  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    let cursor = null;
    for (const item of row.items) {
      // A gap of a fifth of the type size is a space; a gap of nothing is a
      // ligature that was split into two items mid-word.
      if (cursor !== null && item.x - cursor > 0.2 * row.height) text += ' ';
      text += item.str;
      cursor = Math.max(cursor ?? -Infinity, item.x + item.width);
    }
    const clean = tidyWhitespace(text);
    if (clean) lines.push({ text: clean, y: row.y, height: row.height });
  }
  return lines;
}

/** Read every page of a PDF into lines. `bytes` is a Uint8Array or ArrayBuffer. */
export async function readPdfLines(bytes, pdfjs) {
  const lib = pdfjs ?? (await loadPdfjs());
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = lib.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];

  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ number, height, lines: linesFromItems(content.items) });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  return pages;
}

/* ---------------------------------------------------------------------------
 * Telling the page apart from the furniture printed around it
 * ------------------------------------------------------------------------- */

const URL_IN_LINE = /https?:\/\/\S+/i;
const PAGE_COUNTER = /(^|\s)\d{1,4}\s*\/\s*\d{1,4}\s*$/;
// Firefox and Safari spell the counter out, in whatever language the browser is
// set to. Danish is here because the owner of this collection is Danish.
const PAGE_COUNTER_WORDS = /(^|\s)(page|side)?\s*\d{1,4}\s+(of|af|von|sur|di|av)\s+\d{1,4}\s*$/i;
const DATE_IN_LINE = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const TIME_IN_LINE = /\b\d{1,2}[:.]\d{2}(\s*(AM|PM))?\b/i;

/**
 * Is this line something the browser printed rather than something Goodreads
 * showed?
 *
 * A date on its own is not enough — quotations mention dates — so the header is
 * only recognised when a date and a clock time appear together, which is how
 * every browser stamps a printed page and how almost no quotation reads.
 */
function furnitureReason(line) {
  const { text } = line;
  if (PAGE_COUNTER.test(text) || PAGE_COUNTER_WORDS.test(text)) return 'page counter';
  if (URL_IN_LINE.test(text)) return 'printed url';
  if (DATE_IN_LINE.test(text) && TIME_IN_LINE.test(text)) return 'print date';
  return null;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Mark the header and footer of one printed page.
 *
 * The patterns above catch what Chrome, Firefox and Safari actually print. This
 * adds a second, shape-based test for the ones that do not: a line alone in the
 * page margin, separated from the body by far more than a line of leading, is
 * furniture whatever it says. Both tests are needed — the pattern test alone
 * misses a custom header, and the shape test alone would eventually eat the
 * first line of a quote.
 */
function markFurniture(page) {
  const { lines, height } = page;
  if (!lines.length) return lines.map((line) => ({ ...line, furniture: null }));

  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) gaps.push(lines[i - 1].y - lines[i].y);
  const typical = median(gaps.filter((gap) => gap > 0)) || 12;
  const band = 0.06 * height;

  return lines.map((line, index) => {
    const pattern = furnitureReason(line);
    if (pattern) return { ...line, furniture: pattern };

    const isFirst = index === 0;
    const isLast = index === lines.length - 1;
    const gapBelow = isLast ? Infinity : lines[index + 1] ? line.y - lines[index + 1].y : Infinity;
    const gapAbove = isFirst ? Infinity : lines[index - 1].y - line.y;

    if (isFirst && height - line.y < band && gapBelow > 1.8 * typical) {
      return { ...line, furniture: 'print header' };
    }
    if (isLast && line.y < band && gapAbove > 1.8 * typical) {
      return { ...line, furniture: 'print footer' };
    }
    return { ...line, furniture: null };
  });
}

/* ---------------------------------------------------------------------------
 * Reading the quote blocks
 * ------------------------------------------------------------------------- */

const OPENING_MARKS = '“„«‟"';
const CLOSING_MARKS = '”“»‟"';

/**
 * An attribution line. Goodreads emits U+2015 HORIZONTAL BAR, which is rare
 * enough elsewhere to be trusted on sight; an em or en dash is only accepted
 * when the quote above it has visibly closed, because a wrapped line of prose
 * beginning "— and then" is otherwise indistinguishable from an attribution.
 */
const ATTRIBUTION = /^(―|—|–|--)\s+(?=\S)/u;
const TAGS_LINE = /^tags\s*:\s*/i;
const LIKES_LINE = /^\d[\d.,]*\s*likes?\b/i;
const LIKE_BUTTON = /^like$/i;
// The like count sits on the same baseline as the tag list, so it arrives on
// the same line and has to be cut off the end of it. The leading boundary is
// load-bearing: without it this eats the "1" off a tag called "set-1".
const LIKES_TAIL = /(^|\s)\d[\d.,]*\s*likes?\s*(like)?\s*$/i;
const SHOWING = /\bshowing\s+(\d+)\s*[-–—]\s*(\d+)\s+of\s+(\d+)\b/i;

function classify(line) {
  const { text } = line;
  if (TAGS_LINE.test(text)) return 'tags';
  if (LIKES_LINE.test(text) || LIKE_BUTTON.test(text)) return 'likes';
  if (ATTRIBUTION.test(text)) return 'attribution';
  return 'text';
}

/** Net count of unmatched opening quotation marks, curly and guillemet only. */
function quoteBalance(text) {
  let balance = 0;
  for (const character of text) {
    if (character === '“' || character === '„' || character === '«') balance += 1;
    if (character === '”' || character === '»') balance -= 1;
  }
  return balance;
}

/**
 * Find where the quotation actually starts inside everything collected since
 * the last block ended.
 *
 * The buffer can hold navigation, a "Showing 1-30 of 174" line, or the tail of
 * the site header, and — for a quote that straddles a page break — the whole
 * lot arrives interleaved. Scanning backwards for a line that opens a quotation
 * *and* balances against the end of the buffer means an inner quotation that
 * happens to begin a line does not truncate the quote, which taking the last
 * opening mark would.
 */
function findQuoteStart(buffer) {
  let candidate = -1;
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (!OPENING_MARKS.includes(buffer[i].text[0])) continue;
    if (candidate === -1) candidate = i;
    const joined = buffer.slice(i).map((line) => line.text).join(' ');
    if (quoteBalance(joined) === 0) return { start: i, balanced: true };
  }
  return { start: candidate, balanced: false };
}

/**
 * Strip the quotation marks Goodreads wraps every quote in.
 *
 * `cleanQuoteText` in quote-core refuses to unwrap when the closing mark also
 * appears inside the text, which is right for a general-purpose cleaner but
 * wrong here: this parser knows from the markup that the outermost pair is
 * Goodreads's own, so it can strip a pair that contains balanced inner pairs
 * — `“Never say “I have lost it” ...”` — and leave anything unbalanced alone.
 */
function unwrap(text) {
  const trimmed = text.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (trimmed.length < 3) return trimmed;
  if (!OPENING_MARKS.includes(first) || !CLOSING_MARKS.includes(last)) return trimmed;

  const interior = trimmed.slice(1, -1);
  if (first === '"') {
    // Straight marks are their own closers, so balance cannot be counted; only
    // unwrap when none survive inside.
    return interior.includes('"') ? trimmed : interior.trim();
  }
  return quoteBalance(interior) === 0 ? interior.trim() : trimmed;
}

const LANGUAGE_HINTS = {
  da: ['og', 'det', 'ikke', 'skal', 'men', 'til', 'som', 'jeg', 'har', 'kan', 'må', 'være', 'livet', 'af', 'på'],
  de: ['und', 'nicht', 'das', 'ist', 'ein', 'sich', 'mit', 'dem', 'man', 'wie', 'des', 'auch', 'aber', 'sein'],
  fr: ['les', 'des', 'que', 'qui', 'pas', 'une', 'dans', 'est', 'plus', 'avait', 'moi', 'il', 'au', 'je', 'en'],
  es: ['que', 'los', 'las', 'una', 'por', 'con', 'para', 'como', 'del', 'más', 'pero', 'sus'],
  sv: ['och', 'att', 'det', 'som', 'inte', 'för', 'med', 'har', 'jag', 'än'],
  nl: ['het', 'een', 'niet', 'van', 'dat', 'zijn', 'maar', 'met', 'ook'],
  it: ['che', 'non', 'per', 'con', 'una', 'del', 'gli', 'più', 'sono'],
};

/**
 * A guess at the language, used only to avoid filing a Danish quote as English.
 *
 * Deliberately reluctant: three stopword hits and a clear winner, or it stays
 * English and the row is flagged rather than silently mislabelled.
 */
export function guessLanguage(text) {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  if (words.length < 4) return 'en';

  const scores = Object.entries(LANGUAGE_HINTS)
    .map(([code, hints]) => [code, words.filter((word) => hints.includes(word)).length])
    .sort((a, b) => b[1] - a[1]);

  const [code, score] = scores[0];
  const runnerUp = scores[1]?.[1] ?? 0;
  return score >= 3 && score > runnerUp ? code : 'en';
}

const LONG_QUOTE = 900;
const SHORT_QUOTE = 12;

/** Everything about a row that deserves a second look before it is saved. */
function flagsFor(row) {
  const flags = [];
  if (!row.balanced) flags.push('quotation marks did not close');
  if (!row.hadOpeningMark) flags.push('no opening quotation mark');
  if (!row.work) flags.push('no work title');
  if (!row.author) flags.push('no author');
  if (row.author && row.author.length > 60) flags.push('author looks too long');
  if (row.text.length > LONG_QUOTE) flags.push('unusually long');
  if (row.text.length < SHORT_QUOTE) flags.push('very short');
  if (row.splitAcrossPages) flags.push('runs across a page break');
  if (row.lang !== 'en') flags.push(`looks like ${row.lang}, not English`);
  return flags;
}

function buildRow(block) {
  const body = block.textLines.map((line) => line.text).join(' ');
  const text = cleanQuoteText(unwrap(body));
  const { author, work } = parseAttribution(block.attribution);
  const tags = block.tags
    .join(', ')
    .replace(TAGS_LINE, '')
    .replace(LIKES_TAIL, '')
    .split(/\s*,\s*/)
    .map((tag) => tidyWhitespace(tag))
    .filter(Boolean);

  const row = {
    text,
    author,
    work,
    tags,
    // Only a tag that is already part of the controlled vocabulary becomes a
    // theme. Anything cleverer would be guessing on the owner's behalf.
    themes: tags.filter((tag) => THEMES.includes(tag.toLowerCase())).map((tag) => tag.toLowerCase()),
    lang: guessLanguage(text),
    page: block.page,
    sourceUrl: block.sourceUrl ?? null,
    balanced: block.balanced,
    hadOpeningMark: block.hadOpeningMark,
    splitAcrossPages: block.splitAcrossPages,
  };
  row.flags = flagsFor(row);
  return row;
}

/**
 * Walk the flattened lines of one printed file and pull the quotes out.
 *
 * The state machine is small on purpose. A block is opened by an attribution
 * line — every Goodreads quote has one, and nothing else on the page does — and
 * closed by whatever comes after its tags and like count. Everything the block
 * does not claim is discarded, so no list of navigation labels to keep up to
 * date is needed.
 */
export function parseQuoteLines(pages) {
  const rows = [];
  const meta = { showing: null, sourceUrl: null, pageCount: pages.length };

  const stream = [];
  for (const page of pages) {
    for (const line of markFurniture(page)) {
      if (line.furniture === 'printed url' && !meta.sourceUrl) {
        const [url] = line.text.match(URL_IN_LINE) ?? [];
        if (url) meta.sourceUrl = url.replace(/[.,;]+$/, '');
      }
      if (!line.furniture) stream.push({ ...line, page: page.number });
    }
  }

  let buffer = [];
  let block = null;

  const openBlock = (line, collected) => {
    const { start, balanced } = findQuoteStart(collected);
    const textLines = start === -1 ? collected.slice() : collected.slice(start);
    if (!textLines.length) return null;
    const pagesTouched = new Set(textLines.map((entry) => entry.page));
    return {
      textLines,
      attribution: line.text,
      tags: [],
      page: textLines[0].page,
      sourceUrl: meta.sourceUrl,
      balanced,
      hadOpeningMark: start !== -1,
      splitAcrossPages: pagesTouched.size > 1,
    };
  };

  const close = () => {
    if (block) rows.push(buildRow(block));
    block = null;
    buffer = [];
  };

  for (const line of stream) {
    const kind = classify(line);

    if (!meta.showing) {
      const match = line.text.match(SHOWING);
      if (match) {
        meta.showing = { from: Number(match[1]), to: Number(match[2]), total: Number(match[3]) };
      }
    }

    if (kind === 'attribution') {
      // The lines gathered so far are this quote's body, so they have to be
      // taken before closing the previous block resets the buffer.
      const collected = buffer;
      close();
      block = openBlock(line, collected);
      continue;
    }

    if (!block) {
      if (kind === 'text') buffer.push(line);
      continue;
    }

    if (kind === 'tags') {
      block.tags.push(line.text);
      continue;
    }
    if (kind === 'likes') {
      // The footer is the end of the block, but a stray "Like" can also follow
      // a tag list that has already been read; either way nothing more belongs
      // to this quote.
      continue;
    }

    // A plain line while a block is open is either a continuation of a wrapped
    // attribution or tag list, or the first line of the next quote.
    if (OPENING_MARKS.includes(line.text[0])) {
      close();
      buffer = [line];
      continue;
    }
    if (block.tags.length) {
      block.tags.push(line.text);
    } else if (block.attribution.length < 200) {
      block.attribution = `${block.attribution} ${line.text}`;
    }
  }
  close();

  meta.parsed = rows.length;
  meta.expected = meta.showing ? meta.showing.to - meta.showing.from + 1 : null;
  return { quotes: rows, meta };
}

/** Read one printed file end to end. */
export async function importPdf(bytes, pdfjs) {
  const pages = await readPdfLines(bytes, pdfjs);
  return parseQuoteLines(pages);
}

/* ---------------------------------------------------------------------------
 * From parsed rows to collection records
 * ------------------------------------------------------------------------- */

/**
 * Turn a parsed row into a schema record.
 *
 * `workKind` is set to book whenever a work is named, because a Goodreads quote
 * list is a list of quotes attached to books — that is a fact about the source,
 * not a guess about the text. Verification stays `unverified`, which is the
 * honest description of anything that arrived this way.
 */
export function toRecord(row, addedAt) {
  return makeQuote({
    text: row.text,
    author: row.author,
    work: row.work,
    workKind: row.work ? 'book' : null,
    tags: row.tags,
    themes: row.themes,
    lang: row.lang,
    source: { kind: 'goodreads', url: row.sourceUrl ?? null },
    verification: { status: 'unverified' },
    ...(addedAt ? { addedAt } : {}),
  });
}

/** Drop rows that repeat a quote already seen earlier in the same import. */
export function dedupeRows(rows) {
  const seen = new Set();
  const kept = [];
  let duplicates = 0;

  for (const row of rows) {
    const record = toRecord(row);
    if (seen.has(record.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(record.id);
    kept.push({ ...row, id: record.id });
  }

  return { rows: kept, duplicates };
}
