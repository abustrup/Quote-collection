/**
 * Shared vocabulary and text handling for the collection.
 *
 * Everything that has to agree on what a quote *is* imports from here: the
 * reading page, the PDF importer, the GitHub Action that appends new quotes,
 * and the validator that runs in CI. Keeping identity and normalisation in one
 * place is what lets a quote added from a phone in 2027 collapse onto the same
 * record as the one imported from Goodreads today.
 *
 * Plain ES module, no dependencies, runs unchanged in the browser and in Node.
 */

export const SCHEMA_VERSION = 1;

export const THEMES = [
  'agency', 'art', 'attention', 'beauty', 'certainty', 'character', 'death',
  'ethics', 'freedom', 'friendship', 'history', 'knowledge', 'language', 'love',
  'meaning', 'mind', 'money', 'nature', 'politics', 'power', 'progress', 'risk',
  'science', 'solitude', 'suffering', 'technology', 'time', 'truth', 'work',
  'writing',
];

export const WORK_KINDS = [
  'book', 'essay', 'paper', 'speech', 'interview', 'film', 'poem', 'letter',
  'document', 'song', 'other',
];

export const VERIFICATION_STATUSES = ['verified', 'reported', 'unverified', 'disputed'];

/** How each verification status should be described to a reader, in plain words. */
export const VERIFICATION_LABELS = {
  verified: {
    short: 'Verified',
    long: 'Wording checked against the primary text.',
  },
  reported: {
    short: 'Reported',
    long: 'Attribution is well established, but the primary text was not consulted.',
  },
  unverified: {
    short: 'Unverified',
    long: 'Carried over from an import and not independently checked.',
  },
  disputed: {
    short: 'Disputed',
    long: 'Commonly misattributed or circulated in paraphrase. Treat with care.',
  },
};

/* ---------------------------------------------------------------------------
 * Text handling
 * ------------------------------------------------------------------------- */

const CURLY_DOUBLE = /[“”„‟″«»]/g;
const CURLY_SINGLE = /[‘’‚‛′]/g;
const DASHES = /[‐‑‒–—―−]/g;
const INVISIBLES = /[­​‌‍⁠﻿]/g;

/**
 * Collapse the whitespace damage that PDF text extraction and copy-paste do to
 * a quotation, without touching the words themselves.
 *
 * Soft-hyphen removal happens before whitespace collapsing so that a word
 * broken across a line in the source PDF ("under-\nstanding") rejoins cleanly.
 */
export function tidyWhitespace(input) {
  return String(input ?? '')
    .replace(INVISIBLES, '')
    .replace(/ /g, ' ')
    .replace(/-\s*\n\s*(?=[a-zæøåäöü])/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Opening quote marks and the closers that legitimately match them. */
const QUOTE_PAIRS = new Map([
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
  ['„', '”“'],
]);

/**
 * Strip the packaging Goodreads and copy-paste wrap around a quotation:
 * enclosing quote marks, and a trailing attribution that rode along with the
 * quote body.
 *
 * Both steps are deliberately timid, because this function feeds `quoteId` —
 * a wrong strip here does not merely display badly, it changes a quote's
 * identity and breaks its permalink.
 *
 * Attribution stripping only fires on U+2015 HORIZONTAL BAR, the character
 * Goodreads actually emits. An em dash is not enough: prose is full of them,
 * and "Life is short — Art is long" would lose half its meaning to a stripper
 * that treated a capitalised word after a dash as an author's name.
 *
 * Unwrapping only fires when the closing mark appears nowhere inside the text,
 * so `"Hello," she said, "goodbye"` is left intact rather than being silently
 * reduced to `Hello," she said, "goodbye`.
 */
export function cleanQuoteText(input) {
  let text = tidyWhitespace(input);

  text = text.replace(/\s*―\s*\p{Lu}[^―]{0,140}$/u, '');

  for (let i = 0; i < 3; i += 1) {
    const opener = text[0];
    const closers = QUOTE_PAIRS.get(opener);
    if (!closers || text.length < 2) break;

    const closer = text[text.length - 1];
    if (!closers.includes(closer)) break;

    const interior = text.slice(1, -1);
    if (interior.includes(closer)) break;

    text = interior.trim();
  }

  return text.trim();
}

/**
 * The comparison key used for identity and de-duplication.
 *
 * Two records collapse onto one when they say the same words: casing, quote
 * style, dash style, ellipsis spelling and punctuation are all discarded, since
 * those are exactly the things that differ between a Goodreads transcription
 * and the same line typed in by hand.
 */
export function normalizeForIdentity(input) {
  return cleanQuoteText(input)
    .toLowerCase()
    .replace(CURLY_DOUBLE, '"')
    .replace(CURLY_SINGLE, "'")
    .replace(DASHES, '-')
    .replace(/…/g, '...')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * 64-bit FNV-1a, truncated to 48 bits of hex.
 *
 * Chosen over a crypto hash because it is synchronous in the browser — the
 * importer assigns ids to hundreds of quotes inside one drag-and-drop, and
 * `crypto.subtle.digest` would force that whole path to be async for no gain.
 * At collection scale the collision probability is around one in a billion.
 */
export function quoteId(text) {
  const key = normalizeForIdentity(text);
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(key);
  for (let i = 0; i < bytes.length; i += 1) {
    hash = ((hash ^ BigInt(bytes[i])) * PRIME) & MASK;
  }
  return `q_${(hash & 0xffffffffffffn).toString(16).padStart(12, '0')}`;
}

/**
 * Letters that Unicode normalisation cannot take apart.
 *
 * NFD splits an accent off its base letter, which handles é and å, but ø and æ
 * are letters in their own right with no decomposition — they would survive to
 * the strip step and be replaced by a hyphen. That is not merely ugly in a URL:
 * it would slug Søren and Særen to the same string, silently merging two
 * authors into one filter. A Danish collection cannot afford that.
 */
const TRANSLITERATIONS = new Map(Object.entries({
  ø: 'o', æ: 'ae', å: 'a', ð: 'd', þ: 'th', œ: 'oe', ß: 'ss', đ: 'd', ł: 'l', ı: 'i',
}));

/**
 * Curl the straight quotation marks a keyboard produces.
 *
 * This is a *display* transform and nothing else. It is deliberately not part
 * of `cleanQuoteText`, because that function feeds `quoteId`: curling a mark
 * there would change a quote's identity and break its permalink. Stored text
 * keeps whatever the source had; only what a reader sees is set properly.
 *
 * The rules are the ordinary ones a typesetter uses. A mark opens when it
 * follows a space, a bracket or a dash, or begins the text; otherwise it
 * closes. A lone apostrophe between two letters or digits is always an
 * apostrophe, which is what keeps "man's" and "'89" from turning into an
 * opening quotation mark.
 */
export function typographic(input) {
  const text = String(input ?? '');
  let result = '';

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character !== '"' && character !== "'") {
      result += character;
      continue;
    }

    const before = text[i - 1] ?? '';
    const after = text[i + 1] ?? '';
    const opens = before === '' || /[\s([{<—–―“‘]/u.test(before);

    if (character === '"') {
      result += opens ? '“' : '”';
      continue;
    }

    // An apostrophe inside a word is never a quotation mark.
    if (/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) {
      result += '’';
      continue;
    }
    // A leading elision, as in '89 or 'tis.
    if (opens && /[\p{L}\p{N}]/u.test(after)) {
      result += /^\d/u.test(after) ? '’' : '‘';
      continue;
    }
    result += opens ? '‘' : '’';
  }

  return result;
}

/** A short, human-readable slug — used for author and theme filter links. */
export function slug(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[øæåðþœßđłı]/g, (letter) => TRANSLITERATIONS.get(letter) ?? letter)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* ---------------------------------------------------------------------------
 * Attribution parsing
 * ------------------------------------------------------------------------- */

/**
 * Split a Goodreads-style attribution line into author and work.
 *
 * Goodreads renders these as `― Hannah Arendt, The Human Condition`, so the
 * first comma separates the author from the work and everything after it —
 * including further commas in a subtitle or series position — belongs to the
 * title.
 *
 * An earlier version tried to protect the inverted "Kant, Immanuel" form by
 * refusing to split when the text after the comma was a single capitalised
 * word. That rule cost more than it saved: single-word titles are common
 * (Hamlet, Apology, Walden, Ulysses) and the failure put the title inside the
 * author's name, where it silently splits one author into two in every filter
 * and grouping. Getting a rare forename wrong is visible in the importer's
 * preview and costs one edit; getting the author wrong is not visible at all.
 */
export function parseAttribution(line) {
  const raw = tidyWhitespace(line).replace(/^[―—–-]{1,2}\s*/u, '');
  if (!raw) return { author: '', work: null };

  const commaIndex = raw.indexOf(',');
  if (commaIndex === -1) return { author: raw.trim(), work: null };

  return {
    author: raw.slice(0, commaIndex).trim(),
    work: raw.slice(commaIndex + 1).trim() || null,
  };
}

/* ---------------------------------------------------------------------------
 * Author names
 * ------------------------------------------------------------------------- */

/**
 * One spelling per person.
 *
 * Goodreads records whatever the edition on the shelf credited, so the same
 * author arrives under more than one name: a transliteration that went out of
 * fashion, or a name someone typed in lower case. The cost is not cosmetic —
 * the author filter, the "you already quote X" signal in the recommender, and
 * the count on the masthead all key on this string, so one person split in two
 * is one person the collection cannot see clearly.
 *
 * Deliberately a list rather than a similarity heuristic. Two names that look
 * alike are often two people, and quietly merging them would be a worse error
 * than leaving them apart. Keyed on the lower-cased form, so a casing slip is
 * covered by the same entry.
 */
export const AUTHOR_ALIASES = new Map(Object.entries({
  'fyodor dostoyevsky': 'Fyodor Dostoevsky',
  'fyodor dostoievsky': 'Fyodor Dostoevsky',
  'leo tolstoy': 'Leo Tolstoy',
  'lev tolstoy': 'Leo Tolstoy',
  'friedrich nietzche': 'Friedrich Nietzsche',
  'albert camu': 'Albert Camus',
}));

/** Resolve an author to the collection's one spelling for that person. */
export function canonicalAuthor(name) {
  const tidied = tidyWhitespace(name);
  return AUTHOR_ALIASES.get(tidied.toLowerCase()) ?? tidied;
}

/* ---------------------------------------------------------------------------
 * Records
 * ------------------------------------------------------------------------- */

/**
 * Fill a partial quote out into a complete record.
 *
 * Callers supply whatever they know; everything else takes a defensible
 * default. Verification defaults to `unverified` on purpose: anything arriving
 * through an importer has not been checked by anyone, and silently calling it
 * verified would hollow out the one field that makes the collection trustworthy.
 */
export function makeQuote(partial = {}) {
  const text = cleanQuoteText(partial.text);
  const themes = (partial.themes ?? []).filter((theme) => THEMES.includes(theme));
  const workKind = WORK_KINDS.includes(partial.workKind) ? partial.workKind : null;

  return {
    id: partial.id && /^q_[0-9a-f]{12}$/.test(partial.id) ? partial.id : quoteId(text),
    text,
    author: canonicalAuthor(partial.author) || 'Unknown',
    work: partial.work ? tidyWhitespace(partial.work) : null,
    workKind,
    year: Number.isInteger(partial.year) ? partial.year : null,
    source: {
      kind: ['goodreads', 'curated', 'manual', 'import'].includes(partial.source?.kind)
        ? partial.source.kind
        : 'manual',
      url: partial.source?.url || null,
      locator: partial.source?.locator || null,
    },
    tags: [...new Set((partial.tags ?? []).map((tag) => tidyWhitespace(tag)).filter(Boolean))],
    themes: [...new Set(themes)],
    lang: /^[a-z]{2}$/.test(partial.lang ?? '') ? partial.lang : 'en',
    verification: {
      status: VERIFICATION_STATUSES.includes(partial.verification?.status)
        ? partial.verification.status
        : 'unverified',
      ...(partial.verification?.note ? { note: partial.verification.note } : {}),
      ...(partial.verification?.checkedAt ? { checkedAt: partial.verification.checkedAt } : {}),
    },
    favorite: Boolean(partial.favorite),
    note: partial.note ? String(partial.note) : '',
    addedAt: partial.addedAt || new Date().toISOString().slice(0, 10),
  };
}

/**
 * Merge incoming quotes into an existing collection.
 *
 * Existing records win on every field they already fill, so re-running an
 * import is safe and never overwrites a hand-written note, a corrected title or
 * a verification that someone did the work to earn. Incoming records only
 * contribute to gaps.
 */
export function mergeQuotes(existing, incoming) {
  const byId = new Map(existing.map((quote) => [quote.id, quote]));
  const added = [];
  const enriched = [];

  for (const candidate of incoming) {
    const quote = candidate.id ? candidate : makeQuote(candidate);
    const current = byId.get(quote.id);

    if (!current) {
      byId.set(quote.id, quote);
      added.push(quote);
      continue;
    }

    const merged = { ...current };
    let changed = false;

    for (const field of ['work', 'workKind', 'year']) {
      if ((merged[field] === null || merged[field] === undefined) && quote[field] != null) {
        merged[field] = quote[field];
        changed = true;
      }
    }

    const tags = [...new Set([...(current.tags ?? []), ...(quote.tags ?? [])])];
    if (tags.length !== (current.tags ?? []).length) {
      merged.tags = tags;
      changed = true;
    }

    const themes = [...new Set([...(current.themes ?? []), ...(quote.themes ?? [])])];
    if (themes.length !== (current.themes ?? []).length) {
      merged.themes = themes;
      changed = true;
    }

    if (changed) {
      byId.set(quote.id, merged);
      enriched.push(merged);
    }
  }

  return { quotes: [...byId.values()], added, enriched };
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------- */

/**
 * Structural check over a whole collection.
 *
 * Deliberately hand-rolled rather than schema-driven: it runs in CI with no
 * install step, and it can say things a JSON Schema cannot, such as "this id
 * does not match its own text" — the failure mode that would quietly break
 * every permalink.
 */
export function validateCollection(collection) {
  const errors = [];
  const warnings = [];

  if (!collection || typeof collection !== 'object') {
    return { errors: ['collection is not an object'], warnings };
  }
  if (collection.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}, found ${collection.schemaVersion}`);
  }
  if (!Array.isArray(collection.quotes)) {
    return { errors: [...errors, 'quotes must be an array'], warnings };
  }

  const seenIds = new Map();
  const seenText = new Map();
  // One person under two spellings splits every filter that keys on the name.
  const authorsByKey = new Map();

  collection.quotes.forEach((quote, index) => {
    const where = `quotes[${index}]`;

    if (typeof quote.text !== 'string' || cleanQuoteText(quote.text).length < 2) {
      errors.push(`${where}: text is missing or too short`);
      return;
    }
    if (typeof quote.author !== 'string' || !quote.author.trim()) {
      errors.push(`${where}: author is missing`);
    }
    if (!/^q_[0-9a-f]{12}$/.test(quote.id ?? '')) {
      errors.push(`${where}: id "${quote.id}" is malformed`);
    } else {
      const expected = quoteId(quote.text);
      if (quote.id !== expected) {
        errors.push(`${where}: id ${quote.id} does not match its text (expected ${expected})`);
      }
      if (seenIds.has(quote.id)) {
        errors.push(`${where}: duplicate id ${quote.id}, first seen at quotes[${seenIds.get(quote.id)}]`);
      }
      seenIds.set(quote.id, index);
    }

    const key = normalizeForIdentity(quote.text);
    if (seenText.has(key)) {
      warnings.push(`${where}: near-duplicate text of quotes[${seenText.get(key)}]`);
    }
    seenText.set(key, index);

    if (quote.verification && !VERIFICATION_STATUSES.includes(quote.verification.status)) {
      errors.push(`${where}: unknown verification status "${quote.verification.status}"`);
    }
    if (quote.workKind != null && !WORK_KINDS.includes(quote.workKind)) {
      errors.push(`${where}: unknown workKind "${quote.workKind}"`);
    }
    for (const theme of quote.themes ?? []) {
      if (!THEMES.includes(theme)) {
        errors.push(`${where}: unknown theme "${theme}"`);
      }
    }
    if (quote.year != null && (!Number.isInteger(quote.year) || quote.year < -800 || quote.year > 2100)) {
      errors.push(`${where}: implausible year ${quote.year}`);
    }
    if (/^\s*["“]/.test(quote.text) && /["”]\s*$/.test(quote.text)) {
      warnings.push(`${where}: text still carries enclosing quotation marks`);
    }

    if (typeof quote.author === 'string' && quote.author) {
      const key = quote.author.toLowerCase();
      const seen = authorsByKey.get(key);
      if (seen && seen !== quote.author) {
        warnings.push(`author "${quote.author}" is also spelled "${seen}" — add one to AUTHOR_ALIASES`);
      }
      authorsByKey.set(key, quote.author);
    }
  });

  return { errors, warnings };
}
