/**
 * The shelf.
 *
 * A quote collection is really a collection of books that were worth reading,
 * and since 2026-09-16 the registry says so out loud: 87 books arrived from
 * Goodreads with their shelves, their dates and their covers. This page is the
 * library those records describe — books standing on painted ledges, arranged
 * by whichever property is asked for, opening to their own page.
 *
 * Four decisions shape the whole file, and each one was measured rather than
 * preferred.
 *
 * One node per work, built once and moved. A re-sort is a DOM reorder that FLIP
 * can animate; rebuilding the same books cost 2.2× per work and about 60 ms at
 * 300 of them, and it also throws away the element identity the animation needs.
 * `nodes` is that Map and nothing else may create a book.
 *
 * Reads and writes never interleave. Every FLIP is: read every rect into a Map,
 * mutate once, read every new rect, then write transforms. A single
 * layout-affecting write inside a measuring loop turns one reflow into 115.
 *
 * Two score fields, never one. A book he has read carries `rating` — how good
 * it was. A book he has not carries `want` — how much he wants to. One number
 * would silently change meaning the day a book moves from one shelf to the
 * other, so the field, the label and the value all follow the edited shelf.
 *
 * Nothing is invented. A book without a page count keeps the shelf's constant
 * height rather than being guessed into a thickness; a work without a date has
 * no era; a cover that is not there is a tinted rectangle with the title set in
 * it, never a hole and never a collapse.
 */

import { ERAS, SUBJECTS, eraFor, slug, typographic } from './quote-core.js';
import { fmtDate, hydrate, lang, onLang, register, t } from './i18n.js';
import { mountNav } from './nav.js';
import {
  applyWork, isUnlocked, loadState, lock, onChange, setWork, status, unlock,
} from './store.js';

/* ==========================================================================
   Strings
   ========================================================================== */

register({
  'shelf.title': { en: 'The shelf', da: 'Hylden' },
  'shelf.dek': {
    en: 'Everything I have read, am reading, or mean to read one day, the talks worth keeping, and the lines they gave me.',
    da: 'Alt hvad jeg har læst, læser, eller vil læse en dag, de foredrag der er værd at gemme, og de linjer de gav mig.',
  },
  'shelf.stats': { en: '{books} books · {talks} talks & essays · {quotes} quotes', da: '{books} bøger · {talks} foredrag & essays · {quotes} citater' },
  'shelf.registry': { en: 'The registry', da: 'Registret' },

  'shelf.searchLabel': { en: 'Search by title or author', da: 'Søg på titel eller forfatter' },
  'shelf.searchPlaceholder': { en: 'Title or author', da: 'Titel eller forfatter' },
  'shelf.shelvesLabel': { en: 'Shelves', da: 'Hylder' },
  'shelf.arrangeLabel': { en: 'Arranged by', da: 'Ordnet efter' },
  'shelf.all': { en: 'All', da: 'Alle' },

  'shelf.arrange.shelf': { en: 'Shelf status', da: 'Hyldestatus' },
  'shelf.arrange.subject': { en: 'Subject', da: 'Emne' },
  'shelf.arrange.author': { en: 'Author', da: 'Forfatter' },
  'shelf.arrange.year': { en: 'Year written', da: 'Skriveår' },
  'shelf.arrange.added': { en: 'Date added', da: 'Tilføjet' },
  'shelf.arrange.read': { en: 'Date read', da: 'Læst' },
  'shelf.arrange.rating': { en: 'Rating', da: 'Bedømmelse' },
  'shelf.arrange.quotes': { en: 'How often quoted', da: 'Hvor ofte citeret' },

  'shelf.group.unshelved': { en: 'Not on a shelf yet', da: 'Ikke på hylden endnu' },
  'shelf.group.talks': { en: 'Talks & essays', da: 'Foredrag & essays' },
  'shelf.group.undated': { en: 'Undated', da: 'Uden år' },
  'shelf.group.noDate': { en: 'No date recorded', da: 'Ingen dato' },
  'shelf.group.unfinished': { en: 'Not finished', da: 'Ikke læst færdig' },

  'shelf.band.rating.high': { en: '9 and 10', da: '9 og 10' },
  'shelf.band.rating.good': { en: '7 and 8', da: '7 og 8' },
  'shelf.band.rating.fair': { en: '5 and 6', da: '5 og 6' },
  'shelf.band.rating.low': { en: 'Below 5', da: 'Under 5' },
  'shelf.band.rating.none': { en: 'Not rated', da: 'Ikke bedømt' },
  'shelf.band.quotes.many': { en: '10 quotes or more', da: '10 citater eller flere' },
  'shelf.band.quotes.some': { en: '5 to 9 quotes', da: '5 til 9 citater' },
  'shelf.band.quotes.few': { en: '2 to 4 quotes', da: '2 til 4 citater' },
  'shelf.band.quotes.one': { en: 'One quote', da: 'Ét citat' },
  'shelf.band.quotes.none': { en: 'Not quoted yet', da: 'Ikke citeret endnu' },

  /* Subjects and eras now live in the shared block in assets/i18n.js: the
     collection's filters label themselves from the same dictionary. What a
     work *is* stays here, because only this page says it. */

  'shelf.kind.book': { en: 'Book', da: 'Bog' },
  'shelf.kind.essay': { en: 'Essay', da: 'Essay' },
  'shelf.kind.interview': { en: 'Interview', da: 'Interview' },
  'shelf.kind.speech': { en: 'Speech', da: 'Tale' },
  'shelf.kind.letter': { en: 'Letter', da: 'Brev' },
  'shelf.kind.document': { en: 'Document', da: 'Dokument' },
  'shelf.kind.other': { en: 'Work', da: 'Værk' },


  'shelf.hero.reading': { en: 'Currently reading', da: 'Læser lige nu' },
  'shelf.hero.feature': { en: 'Stand this one at the front', da: 'Stil denne forrest' },
  'shelf.hero.lastAdded': { en: 'Last added', da: 'Sidst tilføjet' },
  'shelf.hero.bestRated': { en: 'Best rated', da: 'Bedst bedømt' },

  'shelf.readQuotes': { en: 'Read the quotes', da: 'Læs citaterne' },
  'shelf.openBook': { en: 'Open the book', da: 'Åbn bogen' },
  'shelf.details': { en: 'Details', da: 'Detaljer' },
  'shelf.goodreads': { en: 'On Goodreads', da: 'På Goodreads' },
  'shelf.find': { en: 'Find it', da: 'Find den' },
  'shelf.source': { en: 'The source', da: 'Kilden' },
  'shelf.near': { en: 'Next to it on the shelf', da: 'Ved siden af på hylden' },
  'shelf.shelfLabel': { en: 'Shelf', da: 'Hylde' },
  'shelf.remove': { en: 'Remove from shelf', da: 'Fjern fra hylden' },

  'shelf.pages': { en: '{n} pages', da: '{n} sider' },
  'shelf.quotes': { en: '{n} quotes', da: '{n} citater' },
  'shelf.quote1': { en: '1 quote', da: '1 citat' },
  'shelf.noQuotes': { en: 'No quotes yet', da: 'Ingen citater endnu' },
  'shelf.added': { en: 'Added {d}', da: 'Tilføjet {d}' },
  'shelf.finished': { en: 'Finished {d}', da: 'Læst færdig {d}' },
  'shelf.notRated': { en: 'Not rated', da: 'Ikke bedømt' },
  'shelf.notRatedYet': { en: 'Not rated yet', da: 'Ikke bedømt endnu' },
  'shelf.of10': { en: '{n} of 10', da: '{n} af 10' },
  'shelf.star': { en: '{n} of 10', da: '{n} af 10' },

  'shelf.summary.all': { en: '{n} works on the shelf', da: '{n} værker på hylden' },
  'shelf.summary.some': { en: '{n} of {total} works', da: '{n} af {total} værker' },
  'shelf.empty': { en: 'Nothing on the shelf matches that.', da: 'Intet på hylden passer på det.' },
  'shelf.footCount': { en: '{books} books · {quotes} quotes', da: '{books} bøger · {quotes} citater' },

  'shelf.unlock.title': { en: 'Enter your edit code to change the shelf', da: 'Indtast din redigeringskode for at ændre hylden' },
  'shelf.unlock.help': {
    en: 'The code lives in the owner’s .env file. It is remembered on this device only.',
    da: 'Koden står i ejerens .env-fil. Den huskes kun på denne enhed.',
  },
  'shelf.unlock.wrong': { en: 'That code was not accepted.', da: 'Koden blev ikke godkendt.' },
  'shelf.lockNow': { en: 'Lock editing again', da: 'Lås redigering igen' },
  'shelf.unlockNow': { en: 'Unlock editing', da: 'Lås redigering op' },
  'shelf.savedHere': {
    en: 'Saved on this device; it syncs when the connection is back.',
    da: 'Gemt på denne enhed; den synkroniseres, når forbindelsen er tilbage.',
  },
  'shelf.notSetUp': { en: 'Editing is not set up.', da: 'Redigering er ikke slået til.' },
  'shelf.saveFailed': { en: 'That change could not be saved.', da: 'Ændringen kunne ikke gemmes.' },
  'shelf.ratingCleared': { en: 'Rating cleared', da: 'Bedømmelse ryddet' },
  /* The phone's version of the two questions. The long form is still the
     radiogroup's accessible name, so nothing is lost to a screen reader. */
  'shelf.rateShort.good': { en: 'Rated', da: 'Bedømt' },
  'shelf.rateShort.want': { en: 'Want', da: 'Vil læse' },
  'shelf.skip': { en: 'Skip to the shelf', da: 'Spring til hylden' },
  'shelf.repo': { en: 'Source', da: 'Kildekode' },
  'shelf.removed': { en: 'Removed from the shelf', da: 'Fjernet fra hylden' },
});

/* ==========================================================================
   Small helpers
   ========================================================================== */

const params = new URLSearchParams(location.search);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const STAR_PATH = 'M12 2.6l2.7 5.9 6.3.7-4.7 4.3 1.3 6.3L12 16.6 6.4 19.8l1.3-6.3L3 9.2l6.3-.7z';

function starSvg(extra) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', extra ? `star ${extra}` : 'star');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', STAR_PATH);
  svg.append(path);
  return svg;
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

const fmtYear = (year) => {
  if (!Number.isInteger(year)) return '';
  return year < 0 ? `${Math.abs(year)} ${lang() === 'da' ? 'f.Kr.' : 'BC'}` : String(year);
};

const nQuotes = (n) => (n === 1 ? t('shelf.quote1') : t('shelf.quotes', { n }));

/**
 * One spelling for the search box and the shelf both.
 *
 * `slug()` in quote-core folds a name down to something a URL can carry;
 * searching wants the same folding without the hyphens, so a reader who types
 * "zizek" finds Žižek, "acemoglu" finds Acemoğlu, and "claude's" finds a title
 * set with a curly apostrophe. The Nordic letters are transliterated the way
 * `slug()` transliterates them, because NFD leaves ø and æ standing.
 */
const NORDIC = { 'ø': 'o', 'æ': 'ae', 'å': 'aa', 'ð': 'd', 'þ': 'th', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ł': 'l', 'ı': 'i' };

function fold(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[øæåðþœßđłı]/g, (letter) => NORDIC[letter] ?? letter)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-');
}

/**
 * The name a shelf sorts by.
 *
 * The last token, except when the last token is preceded by a nobiliary
 * particle — "van Gogh", "de Beauvoir", "von Neumann" sort under V, D and V the
 * way a library catalogue files them, not under G, B and N.
 */
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'du', 'la', 'le', 'ten', 'ter', 'da', 'dos', 'af', 'al', 'bin', 'ibn', 'st', 'st.']);

function surname(author) {
  const parts = String(author || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  let start = parts.length - 1;
  while (start > 0 && PARTICLES.has(parts[start - 1].toLowerCase())) start -= 1;
  return parts.slice(start).join(' ');
}

/**
 * One collator, not one per re-sort.
 *
 * `new Intl.Collator` builds an ICU collation table, and building one inside
 * the handler that has twelve milliseconds to spend is most of them. It is
 * rebuilt only when the language actually changes.
 */
let collatorCache = null;
function collator() {
  const want = lang() === 'da' ? 'da' : 'en';
  if (!collatorCache || collatorCache.lang !== want) {
    collatorCache = { lang: want, value: new Intl.Collator(want, { sensitivity: 'base' }) };
  }
  return collatorCache.value;
}

/* ==========================================================================
   The model
   ========================================================================== */

/** The registry's shelf vocabulary. Absence is the fifth state and has no name. */
const SHELF_KEYS = ['reading', 'read', 'to-read', 'abandoned'];

/** One constant per shelf scale. A page count may move a book ±8% from it. */
/* A 2:3 jacket stands 145px wide at this height, which puts six books in a
   1152px row rather than seven. Six is the number: the covers are the page, and
   at seven-up they had become a contact sheet of the covers. The phone scales
   the same constant down rather than carrying a second one. */
const BASE_HEIGHT = 218;
const DEFAULT_ASPECT = 2 / 3;
const WARM_HUES = [18, 28, 38, 46, 56, 84, 10];

function heightFor(pages) {
  if (!Number.isInteger(pages) || pages <= 0) return BASE_HEIGHT;
  const n = Math.min(1, Math.max(0, (pages - 140) / 480));
  return Math.round(BASE_HEIGHT * (0.92 + 0.16 * n));
}

function hueFor(key) {
  let h = 7;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 99991;
  return WARM_HUES[h % WARM_HUES.length];
}

let works = [];
const bySlug = new Map();
/* Every quote in data/quotes.json, including the ones attributed to no work.
   Summing the per-work counts instead said "239 quotes" beside the collection's
   own "240", and a number that disagrees with the page next door is worse than
   no number at all. */
let quoteTotal = 0;

function makeItem(raw, counts) {
  const key = slug(raw.title);
  const stats = counts.get(raw.title) || { count: 0, shortest: null, earliest: null };
  const aspect = Array.isArray(raw.coverSize) && raw.coverSize.length === 2 && raw.coverSize[1]
    ? raw.coverSize[0] / raw.coverSize[1]
    : DEFAULT_ASPECT;
  const height = heightFor(raw.pages);
  const item = {
    raw,
    slug: key,
    title: raw.title,
    author: raw.author || '',
    year: Number.isInteger(raw.year) ? raw.year : null,
    kind: raw.kind || 'other',
    subject: raw.subject || null,
    cover: raw.cover || null,
    pages: Number.isInteger(raw.pages) ? raw.pages : null,
    goodreads: raw.goodreads?.url || null,
    url: raw.url || null,
    // A work the registry has no `added` for takes the date its first quote was
    // filed, which is what data/works.json records for quoted-only works. It is
    // read from the quotes rather than guessed.
    added: raw.added || stats.earliest || null,
    read: raw.read || null,
    quotes: stats.count,
    sample: stats.shortest,
    aspect,
    height,
    width: Math.round(height * aspect),
    hue: hueFor(key),
    surname: surname(raw.author),
    search: fold(`${raw.title} ${raw.author || ''}`),
    shelf: null,
    rating: null,
    want: null,
  };
  refresh(item);
  return item;
}

/** Lay the Worker's overrides over the registry record. */
function refresh(item) {
  const merged = applyWork(item.raw, item.slug);
  item.shelf = SHELF_KEYS.includes(merged.shelf) ? merged.shelf : null;
  item.rating = Number.isFinite(merged.rating) ? merged.rating : null;
  item.want = Number.isFinite(merged.want) ? merged.want : null;
}

/** Which of the two score fields this work is currently being asked about. */
function scoreOf(item) {
  if (item.shelf === 'read' || item.shelf === 'abandoned') {
    return { field: 'rating', value: item.rating };
  }
  return { field: 'want', value: item.want };
}

const rateLabelFor = (item) => (item.shelf === 'read' || item.shelf === 'abandoned' ? t('rating.good') : t('rating.want'));

const isBook = (item) => item.kind === 'book';
const subjectLabel = (id) => (id && SUBJECTS.includes(id) ? t(`shelf.subject.${id}`) : t('shelf.subject.none'));
const kindLabel = (item) => t(`shelf.kind.${item.kind}`) || item.kind;

/** Where to go and read the thing, when the registry has no url of its own. */
function findLink(item) {
  if (item.url) return { href: item.url, label: t('shelf.source') };
  const query = encodeURIComponent(`${item.title} ${item.author}`);
  return { href: `https://openlibrary.org/search?q=${query}`, label: t('shelf.find') };
}

/* ==========================================================================
   Page state
   ========================================================================== */

const ARRANGE = ['shelf', 'subject', 'author', 'year', 'added', 'read', 'rating', 'quotes'];

const view = {
  sort: ARRANGE.includes(params.get('sort')) ? params.get('sort') : 'shelf',
  filter: SHELF_KEYS.includes(params.get('filter')) ? params.get('filter') : 'all',
  query: '',
};

/** The flattened order the shelf is currently in — what "next to it" means. */
let flatOrder = [];

/* ==========================================================================
   Grouping
   ========================================================================== */

const LETTER_BANDS = [
  { id: 'A–C', to: 'C' },
  { id: 'D–F', to: 'F' },
  { id: 'G–I', to: 'I' },
  { id: 'J–L', to: 'L' },
  { id: 'M–O', to: 'O' },
  { id: 'P–S', to: 'S' },
  { id: 'T–Z', to: 'Z' },
];

/**
 * The letter a surname files under.
 *
 * Accents are stripped first, so Žižek files at Z and Acemoğlu at A rather
 * than falling off the end of the alphabet — a catalogue that shelves Ž after
 * Z because 017D is a larger number than 005A is sorting bytes, not names.
 */
function initialOf(name) {
  const bare = String(name || '').normalize('NFD').replace(/\p{M}+/gu, '');
  const first = (bare[0] || 'Z').toUpperCase();
  return /^[A-Z]$/.test(first) ? first : 'Z';
}

function bandFor(name) {
  const initial = initialOf(name);
  return LETTER_BANDS.find((band) => initial <= band.to) || LETTER_BANDS[LETTER_BANDS.length - 1];
}

const ERA_ORDER = ERAS.map((era) => era.id);

function ratingBand(value) {
  if (value == null) return { key: 'none', label: 'shelf.band.rating.none', order: 4 };
  if (value >= 9) return { key: 'high', label: 'shelf.band.rating.high', order: 0 };
  if (value >= 7) return { key: 'good', label: 'shelf.band.rating.good', order: 1 };
  if (value >= 5) return { key: 'fair', label: 'shelf.band.rating.fair', order: 2 };
  return { key: 'low', label: 'shelf.band.rating.low', order: 3 };
}

function quoteBand(n) {
  if (n >= 10) return { key: 'many', label: 'shelf.band.quotes.many', order: 0 };
  if (n >= 5) return { key: 'some', label: 'shelf.band.quotes.some', order: 1 };
  if (n >= 2) return { key: 'few', label: 'shelf.band.quotes.few', order: 2 };
  if (n === 1) return { key: 'one', label: 'shelf.band.quotes.one', order: 3 };
  return { key: 'none', label: 'shelf.band.quotes.none', order: 4 };
}

/**
 * Every arrangement keeps its headings.
 *
 * A re-sort that lands in one unbroken list of 115 books is not an arrangement,
 * it is a dump: the heading is what makes the order legible, and it is also
 * what the eye follows while the FLIP plays.
 */
function groupsFor(items) {
  const bucket = new Map();
  const push = (key, label, order, item) => {
    if (!bucket.has(key)) bucket.set(key, { key, label, order, items: [] });
    bucket.get(key).items.push(item);
  };

  for (const item of items) {
    if (view.sort === 'shelf') {
      if (!isBook(item)) push('talks', t('shelf.group.talks'), 5, item);
      else if (item.shelf) push(item.shelf, t(`shelf.${item.shelf}`), SHELF_KEYS.indexOf(item.shelf), item);
      else push('unshelved', t('shelf.group.unshelved'), 4, item);
    } else if (view.sort === 'subject') {
      push(item.subject || 'none', subjectLabel(item.subject), 0, item);
    } else if (view.sort === 'author') {
      const band = bandFor(item.surname || item.author || 'Z');
      push(band.id, band.id, LETTER_BANDS.indexOf(band), item);
    } else if (view.sort === 'year') {
      const era = eraFor(item.year);
      if (era) push(era, t(`shelf.era.${era}`), ERA_ORDER.indexOf(era), item);
      else push('undated', t('shelf.group.undated'), 99, item);
    } else if (view.sort === 'added') {
      const year = item.added ? item.added.slice(0, 4) : null;
      if (year) push(year, year, -Number(year), item);
      else push('none', t('shelf.group.noDate'), 1e6, item);
    } else if (view.sort === 'read') {
      const year = item.read ? item.read.slice(0, 4) : null;
      if (year) push(`r${year}`, year, -Number(year), item);
      else push('unfinished', t('shelf.group.unfinished'), 1e6, item);
    } else if (view.sort === 'rating') {
      const band = ratingBand(scoreOf(item).value);
      push(band.key, t(band.label), band.order, item);
    } else if (view.sort === 'quotes') {
      const band = quoteBand(item.quotes);
      push(band.key, t(band.label), band.order, item);
    }
  }

  const groups = [...bucket.values()];
  const compare = collator().compare;

  if (view.sort === 'subject') groups.sort((a, b) => b.items.length - a.items.length || compare(a.label, b.label));
  else groups.sort((a, b) => a.order - b.order);

  const byTitle = (a, b) => compare(a.title, b.title);
  const byAddedDesc = (a, b) => String(b.added || '').localeCompare(String(a.added || '')) || byTitle(a, b);
  const byScoreDesc = (a, b) => {
    const x = scoreOf(a).value;
    const y = scoreOf(b).value;
    if (x === y) return byAddedDesc(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x;
  };

  for (const group of groups) {
    if (view.sort === 'shelf') {
      if (group.key === 'read') {
        group.items.sort((a, b) => String(b.read || '').localeCompare(String(a.read || '')) || byAddedDesc(a, b));
      } else if (group.key === 'to-read') {
        group.items.sort(byScoreDesc);
      } else if (group.key === 'unshelved') {
        group.items.sort(byTitle);
      } else {
        group.items.sort(byAddedDesc);
      }
    } else if (view.sort === 'author') {
      group.items.sort((a, b) => compare(a.surname, b.surname) || (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b));
    } else if (view.sort === 'year') {
      group.items.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b));
    } else if (view.sort === 'added') {
      group.items.sort(byAddedDesc);
    } else if (view.sort === 'read') {
      group.items.sort((a, b) => String(b.read || '').localeCompare(String(a.read || '')) || byAddedDesc(a, b));
    } else if (view.sort === 'rating') {
      group.items.sort(byScoreDesc);
    } else if (view.sort === 'quotes') {
      group.items.sort((a, b) => b.quotes - a.quotes || byTitle(a, b));
    } else {
      group.items.sort(byTitle);
    }
  }

  return groups;
}

function visible() {
  const query = fold(view.query.trim());
  return works.filter((item) => {
    if (view.filter !== 'all' && item.shelf !== view.filter) return false;
    if (!query) return true;
    return item.search.includes(query);
  });
}

/* ==========================================================================
   One node per work
   ========================================================================== */

const nodes = new Map();
let built = 0;

/** The three spans a work with no jacket gets instead of a photograph. */
function typographicCover(box, item) {
  box.classList.add('is-type');
  box.style.setProperty('--tc-h', String(item.hue));
  const kind = el('span', 'tc-kind');
  const title = el('span', 'tc-title', item.title);
  const author = el('span', 'tc-author', item.author);
  box.append(kind, title, author);
  return { kind, title, author };
}

/**
 * A cover, at a size somebody else decides.
 *
 * `height` pins it in pixels — the hero and the neighbour row both want an
 * exact size. `fluid` instead fills whatever column it is put in and keeps the
 * jacket's own proportions through an aspect-ratio, which is what the detail
 * needs: a cover pinned at 280px wide is 280px wide on a 390px phone too, and
 * pushes the top of the dialog off the screen.
 */
function coverBox(item, { height, fluid = false, eager = false } = {}) {
  const box = el('span', 'cover-box');
  if (fluid) {
    box.classList.add('is-fluid');
    box.style.setProperty('--ar', String(item.aspect.toFixed(4)));
  } else if (height) {
    box.style.height = `${Math.round(height)}px`;
    box.style.width = `${Math.round(height * item.aspect)}px`;
  }
  if (!item.cover) {
    typographicCover(box, item);
    return box;
  }
  const img = new Image();
  img.src = item.cover;
  img.alt = '';
  img.decoding = 'async';
  img.loading = eager ? 'eager' : 'lazy';
  if (eager) img.fetchPriority = 'high';
  // Explicit dimensions so the frame reserves its space before a byte arrives.
  img.width = item.width;
  img.height = item.height;
  img.addEventListener('load', () => {
    // A frame that sizes itself from the aspect has to be told the truth as
    // soon as the picture arrives, or object-fit crops the jacket it was drawn
    // to protect.
    if (fluid && img.naturalWidth && img.naturalHeight) {
      box.style.setProperty('--ar', String((img.naturalWidth / img.naturalHeight).toFixed(4)));
    }
    trueAspect(item, img);
  }, { once: true });
  // A cover file that is not there yet becomes the typographic cover rather
  // than a broken picture: the librarian is still fetching some of them.
  img.addEventListener('error', () => {
    img.remove();
    item.cover = null;
    typographicCover(box, item);
    paintBook(item);
  }, { once: true });
  box.append(img);
  return box;
}

/**
 * Correct a book's width to the cover's real proportions.
 *
 * The registry does not carry `coverSize` for every work yet, so the frame is
 * drawn at 2:3 and then told the truth once the picture has arrived. Without
 * this the shelf either crops jackets that are not 2:3 — and they run from
 * 0.56 to 0.74 — or letterboxes them against the ground. Books stand at their
 * own proportions or the shelf is a diagram of a shelf.
 */
let aspectSettle = null;
function trueAspect(item, img) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  const real = img.naturalWidth / img.naturalHeight;
  if (Math.abs(real - item.aspect) < 0.01) return;
  item.aspect = real;
  item.width = Math.round(item.height * real);
  const node = nodes.get(item.slug);
  if (node) node.style.setProperty('--bw', `${item.width}px`);
  unplace();
  clearTimeout(aspectSettle);
  aspectSettle = setTimeout(() => applyLean(), 120);
}

function bookNode(item) {
  const existing = nodes.get(item.slug);
  if (existing) return existing;

  const node = el('button', 'book');
  node.type = 'button';
  node.dataset.slug = item.slug;
  node.style.setProperty('--bw', `${item.width}px`);
  node.style.setProperty('--bh', `${item.height}px`);

  const stage = el('span', 'book-stage');
  const tilt = el('span', 'tilt');
  // The first two rows are wanted immediately; everything below the fold waits
  // until it is scrolled towards.
  tilt.append(coverBox(item, { eager: built < 18 }));
  stage.append(tilt);
  node.append(stage);

  const caption = el('span', 'caption');
  caption.append(el('span', 'c-title', item.title), el('span', 'c-author', item.author));
  if (item.quotes) caption.append(el('span', 'c-quotes'));
  node.append(caption);

  node.addEventListener('click', () => openBook(item.slug, node));
  nodes.set(item.slug, node);
  built += 1;
  paintBook(item);
  return node;
}

/**
 * Repaint one book without rebuilding it.
 *
 * Only the words change when a language, a rating or a shelf changes, so only
 * the words are written. The element identity is what FLIP animates and what
 * keeps focus where the reader left it.
 */
function paintBook(item) {
  const node = nodes.get(item.slug);
  if (!node) return;
  const quotes = item.quotes ? nQuotes(item.quotes) : '';
  node.setAttribute('aria-label', [item.title, item.author, quotes].filter(Boolean).join(' — '));
  const title = node.querySelector('.c-title');
  if (title) title.textContent = item.title;
  const author = node.querySelector('.c-author');
  if (author) author.textContent = item.author;
  const count = node.querySelector('.c-quotes');
  if (count) count.textContent = quotes;
  const kind = node.querySelector('.tc-kind');
  // The year leads, and the kind follows it. On a 78px typographic cover the
  // kicker does not fit, and whichever half is written last is the half that
  // gets the ellipsis — "Interview · 202…" on 14 of the 24 talks. The year is
  // the informative half, so the kind is the one that yields.
  if (kind) kind.textContent = [fmtYear(item.year), item.kind === 'book' ? '' : kindLabel(item)].filter(Boolean).join(' · ');
}

/* ==========================================================================
   The hover plate
   --------------------------------------------------------------------------
   What the caption cannot hold. Created on demand: 115 hidden cards widen the
   document at 390 px, and a hidden card still counts as overflow.
   ========================================================================== */

let plate = null;
let plateOwner = null;
let plateHide = null;

function showPlate(node, item) {
  // The same book, entered again: keep the plate that is already standing.
  // A pointer crossing from the cover to the caption, or a layout that shifts
  // under a stationary pointer, fires leave-then-enter on the same book — and
  // rebuilding it there restarts the fade, so the plate flickers for something
  // the reader did not do. It is also why a full-page screenshot of the shelf
  // used to catch it half-transparent.
  if (plateHide) { clearTimeout(plateHide); plateHide = null; }
  if (plate && plateOwner === node) { plate.classList.add('show'); return; }

  dropPlate();
  const card = el('span', 'plate');

  // The plate covers this book's own caption, so it carries the title itself —
  // otherwise hovering a book is the one moment its name is not on screen.
  card.append(el('span', 'p-title', item.title));

  const facts = [fmtYear(item.year), item.pages ? t('shelf.pages', { n: item.pages }) : null]
    .filter(Boolean).join(' · ');
  card.append(el('span', 'p-facts', facts || item.author || kindLabel(item)));

  const foot = el('span', 'p-foot');
  foot.append(el('span', 'p-shelf', item.shelf ? t(`shelf.${item.shelf}`) : kindLabel(item)));

  const score = scoreOf(item);
  if (score.value != null) {
    const box = el('span', 'p-score');
    const stars = el('span', 'stars-inline');
    const filled = Math.round(score.value / 2);
    for (let i = 0; i < 5; i += 1) stars.append(starSvg(i < filled ? null : 'off'));
    box.append(stars, el('span', null, String(score.value)));
    foot.append(box);
  }
  card.append(foot);

  if (item.quotes) card.append(el('span', 'p-quotes', nQuotes(item.quotes)));

  node.append(card);
  plate = card;
  plateOwner = node;

  // The one thing the stylesheet cannot know: whether this book is the last in
  // its row. A 200px plate hanging off a 145px column in the last position
  // would widen the document, so there it hangs the other way. One rect each,
  // read once on enter — never in a pointermove handler.
  const room = shelfEl.getBoundingClientRect();
  const here = node.getBoundingClientRect();
  if (here.left + card.offsetWidth > room.right - 1) card.classList.add('is-right');

  // Flush the style so the browser has a "from" value, then reveal. A
  // requestAnimationFrame would do the same on a page that is being painted
  // and nothing at all on one that is not.
  void card.offsetWidth;
  card.classList.add('show');
}

/* Leaving is deferred so that a leave immediately followed by an enter on the
   same book is not a removal and a rebuild.

   140 ms rather than a frame, because the gap is not always a frame: a scroll
   that moves the shelf under a stationary pointer fires the leave and the enter
   about 30 ms apart, and one frame of grace missed it — which is how a
   full-page screenshot of the shelf kept catching the plate a third of the way
   through its fade. Moving to a different book does not wait: that calls
   showPlate, which drops the old plate at once. */
function hidePlate() {
  if (plateHide || !plate) return;
  plateHide = setTimeout(() => { plateHide = null; dropPlate(); }, 140);
}

function dropPlate() {
  plate?.remove();
  plate = null;
  plateOwner = null;
}

/* ==========================================================================
   Rendering
   ========================================================================== */

const shelfEl = $('shelf');
const emptyEl = $('shelf-empty');

/**
 * Lay the groups out, without ever detaching a book.
 *
 * The obvious version builds a fragment and calls `replaceChildren`, which is
 * two lines shorter and takes every one of the 115 books out of the document
 * and puts it back: each one loses its computed style on the way out and pays
 * for a fresh one on the way in. Moving a node with `append` while it stays in
 * the document is a reparent, not a rebuild — measured at 26 ms against 6 ms
 * for the same re-sort. Section wrappers are reused and only their words are
 * rewritten, which is the same argument one level up.
 */
function build(groups) {
  flatOrder = [];
  const sections = [...shelfEl.children];

  groups.forEach((group, index) => {
    let section = sections[index];
    if (!section) {
      section = el('section', 'shelf-group');
      const head = el('div', 'shelf-group-head');
      head.append(el('h2'), el('span', 'n'), el('span', 'fill'));
      section.append(head, el('div', 'ledge'));
      shelfEl.append(section);
    }
    section.dataset.group = group.key;
    const head = section.firstElementChild;
    head.firstElementChild.textContent = group.label;
    head.children[1].textContent = String(group.items.length);

    const ledge = section.lastElementChild;
    let tallest = 0;
    for (const item of group.items) {
      if (item.height > tallest) tallest = item.height;
      ledge.append(bookNode(item));      // a move, not an insert, when it is already here
      flatOrder.push(item.slug);
    }
    ledge.style.setProperty('--bmax', `${tallest || BASE_HEIGHT}px`);
  });

  for (let i = groups.length; i < sections.length; i += 1) sections[i].remove();

  // Books filtered out of this render are still sitting where they were: the
  // appends above only moved the ones that belong. Taking them out last leaves
  // every retained book in exactly the order it was appended in.
  const wanted = new Set(flatOrder);
  for (const [key, node] of nodes) {
    if (node.isConnected && !wanted.has(key)) node.remove();
  }

  unplace();
}

function render({ animate = true } = {}) {
  const items = visible();
  const groups = groupsFor(items);
  const paint = () => {
    build(groups);
    emptyEl.hidden = items.length > 0;
  };

  if (animate && !reduced) flip(paint);
  else { paint(); applyLean(); }


  $('shelf-summary').textContent = items.length === works.length
    ? t('shelf.summary.all', { n: works.length })
    : t('shelf.summary.some', { n: items.length, total: works.length });
}

/* ==========================================================================
   FLIP
   --------------------------------------------------------------------------
   Read every rect, mutate once, read every new rect, then write. Nothing
   between the two reads may touch layout, or the second read costs 115
   reflows instead of one.

   The transitions are CSS with an inline-style cleanup rather than Web
   Animations with fill: 'both' — a filled animation stays resident on the
   element for as long as the page lives, and eight re-sorts of 115 books is
   920 of them.
   ========================================================================== */

const FLIP_MS = 500;
let flipTimer = null;
let flipGuard = null;

/**
 * Where every book is, in the document's own coordinates — and the one place
 * that number is paid for.
 *
 * A FLIP needs the positions before the move and the positions after it. The
 * "after" read has to be fresh; the "before" read does not, because the books
 * have not moved since the last time anything measured them. The lean measures
 * them at the end of every re-sort, so that measurement is kept and the next
 * re-sort reads it instead of forcing a second whole-page layout — six
 * milliseconds of a twelve-millisecond budget on this laptop, and far more than
 * that on a phone.
 *
 * Document coordinates rather than viewport ones, so a page that was scrolled
 * in between is still comparable; the scroll offset is stored alongside and the
 * difference is taken out when the transforms are written.
 */
let placed = null;

function measureBooks() {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const rects = new Map();
  for (const [key, node] of nodes) {
    if (!node.isConnected) continue;
    const rect = node.getBoundingClientRect();
    rects.set(key, {
      left: rect.left + scrollX,
      top: rect.top + scrollY,
      right: rect.right + scrollX,
    });
  }
  placed = { rects, scrollX, scrollY };
  return placed;
}

/** Say that the page has moved under the last measurement. */
function unplace() { placed = null; }

/**
 * Put the page's one fixed box back where the viewport actually is.
 *
 * A window that changes size while a transition is playing can leave Chrome's
 * own idea of the viewport behind: `window.innerWidth` went on reading 1089 on
 * a 390px screen for as long as a re-sort ran, and `#shelf-toast` — the only
 * `position: fixed` box on this page — was laid out against that stale number
 * and widened the document by 699px, permanently. Nothing short of taking the
 * box out of the layout and putting it back re-resolves it: a forced layout
 * read does not, and neither does invalidating style [measured 2026-09-16].
 *
 * Guarded on the document having actually gone wide, so an ordinary resize
 * costs nothing and a toast mid-fade is never interrupted for no reason.
 */
/* What the page last understood the viewport to be. Module scope, because the
   delayed settle below asks the same question again a second later: a viewport
   that changes during an animation does not always tell the page so in one go,
   and a card built for the wrong width is worse than a late repaint. */
let lastViewportWidth = null;
let lastNarrow = null;
const viewportWork = { calls: 0, heroRepaints: 0, flipsCut: 0 };

/**
 * The window changed size. Three things have to answer it.
 *
 * The hero is rebuilt if the phone boundary was crossed. Its two layouts are a
 * JavaScript decision — the thumbnails are built at 46px or at 120px — so a
 * card built at 1440 and left standing in a 390px window puts 440px of books
 * in a 353px card, which is what a window narrowed during a re-sort was left
 * holding, and what widened the document by 99px for good.
 *
 * A FLIP in flight is cut short. It holds every book at the position it had in
 * the *old* viewport as an inline transform, up to a thousand pixels right of
 * the new one, and a phone answers a document wider than its screen by zooming
 * out — which it does not undo when the animation ends. The books are already
 * where they belong, so the worst of ending it here is a re-sort that did not
 * glide across a resize nobody performs mid-animation on purpose.
 *
 * And the lean is re-measured, because every rect it rests on has moved.
 */
function viewportChanged() {
  viewportWork.calls += 1;
  const width = document.documentElement.clientWidth;
  const widthChanged = lastViewportWidth !== null && width !== lastViewportWidth;
  lastViewportWidth = width;

  if (widthChanged && document.documentElement.classList.contains('is-flipping')) {
    viewportWork.flipsCut += 1;
    endFlip();
  }
  let repainted = false;
  if (narrowQuery.matches !== lastNarrow) {
    lastNarrow = narrowQuery.matches;
    viewportWork.heroRepaints += 1;
    paintHero();
    repainted = true;
  }
  if (widthChanged || repainted) {
    unplace();
    applyLean();
  }
  if (widthChanged) scheduleSettle();
  return widthChanged || repainted;
}

function pokeFixed() {
  const node = $('shelf-toast');
  if (!node) return;
  node.style.display = 'none';
  void node.offsetWidth;
  node.style.display = '';
  void node.offsetWidth;
}

/** The same poke, but only when the page has actually gone wide. */
function settleFixed() {
  const doc = document.documentElement;
  if (doc.scrollWidth <= doc.clientWidth + 1) return false;
  pokeFixed();
  return true;
}

/* Four attempts rather than one: the stale viewport does not always arrive
   with the resize event — it can turn up a few hundred milliseconds later,
   while the re-sort is still playing — and a poke that lands before it is a
   poke wasted. The timers restart on every resize event, so dragging a window
   edge pokes once at the end rather than on every pixel. */
let settleTimers = [];
function scheduleSettle() {
  for (const id of settleTimers) clearTimeout(id);
  settleTimers = [90, 320, 900, 1800].map((ms) => setTimeout(() => {
    pokeFixed();
    // And ask again. A media query can still be answering for the old viewport
    // at the instant the resize is announced, so the layout decision the card
    // makes in JavaScript has to be re-taken once the dust has settled.
    viewportChanged();
  }, ms));
}

function endFlip() {
  document.documentElement.classList.remove('is-flipping');
  for (const node of nodes.values()) {
    node.style.transition = '';
    node.style.transform = '';
    node.style.opacity = '';
  }
  applyLean();
  settleFixed();
}

function flip(mutate) {
  // Whatever the last one left behind, this one clears. A frame that never
  // arrived — a background tab, a view transition that hung — would otherwise
  // leave books inverted and invisible until something else happened to fire.
  if (document.documentElement.classList.contains('is-flipping')) endFlip();

  const before = placed || measureBooks();

  mutate();

  document.documentElement.classList.add('is-flipping');

  // Everything from here on happens in a frame rather than in the handler that
  // the reader is waiting on. Reading where the books landed forces a whole
  // layout — measured at about 6 ms of the 12 ms budget, three quarters of the
  // total — and that layout is one the browser owes the next frame anyway. Done
  // here it is free; done in the handler it is the single most expensive thing
  // a re-sort does.
  //
  // Two frames, not one: the first reads and writes the inverted position, and
  // is the frame that gets painted, so the books are still where they were. The
  // second plays them back. Collapsing the two paints the destination for one
  // frame first, which is a flash on every re-sort.
  requestAnimationFrame(() => {
    clearTimeout(flipGuard);

    const after = measureBooks();
    // Usually zero. It is not zero when the new arrangement is shorter than the
    // old one and the browser has pulled the page back up under the reader.
    const shiftX = before.scrollX - after.scrollX;
    const shiftY = before.scrollY - after.scrollY;

    // A book that would travel further than a screen and a half streaks rather
    // than glides — across an eleven-thousand-pixel move the eye sees a smear,
    // not an object. Those fade out where they were and fade in where they are.
    const cap = window.innerHeight * 1.5;
    const moved = [];
    const faded = [];

    for (const [key, rect] of after.rects) {
      const node = nodes.get(key);
      const was = before.rects.get(key);
      if (!was) { faded.push(node); continue; }
      const dx = (was.left - rect.left) - shiftX;
      const dy = (was.top - rect.top) - shiftY;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      if (Math.hypot(dx, dy) > cap) { faded.push(node); continue; }
      moved.push({ node, dx, dy, top: rect.top, left: rect.left });
    }

    if (!moved.length && !faded.length) { endFlip(); return; }

    // Write phase. Nothing above this line is read again.
    for (const entry of moved) {
      entry.node.style.transition = 'none';
      entry.node.style.transform = `translate(${entry.dx}px, ${entry.dy}px)`;
    }
    for (const node of faded) {
      node.style.transition = 'none';
      node.style.opacity = '0';
      node.style.transform = 'scale(0.965)';
    }

    moved.sort((a, b) => a.top - b.top || a.left - b.left);

    requestAnimationFrame(() => {
      moved.forEach((entry, index) => {
        const delay = Math.min(index * 6, 160);
        entry.node.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.2, 0, 0, 1) ${delay}ms`;
        entry.node.style.transform = '';
      });
      faded.forEach((node, index) => {
        const delay = 120 + Math.min(index * 6, 160);
        node.style.transition = `opacity 260ms cubic-bezier(0.2, 0, 0, 1) ${delay}ms, transform 320ms cubic-bezier(0.2, 0, 0, 1) ${delay}ms`;
        node.style.opacity = '';
        node.style.transform = '';
      });

      clearTimeout(flipTimer);
      flipTimer = setTimeout(endFlip, FLIP_MS + 260);
    });
  });

  // Frames are not promised. A background tab, a throttled renderer or a
  // headless browser can leave the callback above unrun, and the shelf must
  // never be stuck mid-animation with hover suspended: the books are already in
  // their right places, so the worst case is a re-sort that did not glide.
  clearTimeout(flipGuard);
  flipGuard = setTimeout(endFlip, 900);
}

/* ==========================================================================
   The lean
   --------------------------------------------------------------------------
   One book at the end of a row that does not fill may lean, the way the last
   book on a real shelf does when nothing holds it up. Every measurement is
   taken before any class is written, so this costs one layout pass rather
   than one per ledge.
   ========================================================================== */

function applyLean() {
  const measured = placed || measureBooks();
  const ledges = [...shelfEl.querySelectorAll('.ledge')];
  const plan = [];

  for (const ledge of ledges) {
    const kids = [...ledge.children];
    if (kids.length < 3) { plan.push({ kids, tail: null }); continue; }
    const width = ledge.clientWidth;
    const rows = new Map();
    for (const kid of kids) {
      const rect = measured.rects.get(kid.dataset.slug);
      if (!rect) continue;
      const top = Math.round(rect.top);
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push({ kid, rect });
    }
    const all = [...rows.values()];
    if (all.length < 2) { plan.push({ kids, tail: null }); continue; }
    const lastRow = all[all.length - 1];
    if (lastRow.length < 2) { plan.push({ kids, tail: null }); continue; }
    const first = lastRow[0];
    const tail = lastRow[lastRow.length - 1];
    const filled = (tail.rect.right - first.rect.left) / (width || 1);
    plan.push({ kids, tail: filled < 0.88 ? tail.kid : null });
  }

  for (const entry of plan) {
    for (const kid of entry.kids) kid.classList.toggle('lean', kid === entry.tail);
  }
}

/* ==========================================================================
   Hover, with depth
   --------------------------------------------------------------------------
   One rect, read when the pointer enters. Reading it on every pointermove over
   115 elements is how a shelf becomes a slideshow.
   ========================================================================== */

let hovered = null;
let hoverRect = null;
/* Set only by ?hover=<n>. A frozen hover is a still being posed, and nothing —
   a scroll, a pointer that was never there — is allowed to undo it. */
let hoverFrozen = false;

function tiltTo(node, clientX) {
  if (!hoverRect || document.documentElement.classList.contains('is-flipping')) return;
  const dx = Math.max(-1, Math.min(1, ((clientX - hoverRect.left) / (hoverRect.width || 1) - 0.5) * 2));
  // No lean term here: a leaning book carries its angle in the `rotate`
  // property, which composes with this and is not transitioned.
  const tilt = node.querySelector('.tilt');
  if (tilt) tilt.style.transform = `translateY(-9px) rotateY(${(dx * 4).toFixed(2)}deg) rotateX(2.2deg)`;
}

function leaveBook() {
  if (hoverFrozen || !hovered) return;
  hovered.classList.remove('is-hover');
  const tilt = hovered.querySelector('.tilt');
  if (tilt) tilt.style.transform = '';
  hovered = null;
  hoverRect = null;
  hidePlate();
}

function enterBook(node) {
  if (node === hovered) return;
  leaveBook();
  hovered = node;
  node.classList.add('is-hover');
  const box = node.querySelector('.cover-box');
  hoverRect = box ? box.getBoundingClientRect() : null;
  const item = bySlug.get(node.dataset.slug);
  if (item && window.matchMedia('(hover: hover) and (pointer: fine)').matches) showPlate(node, item);
}

function wireHover() {
  shelfEl.addEventListener('pointerover', (event) => {
    const node = event.target.closest?.('.book');
    if (node) enterBook(node);
  });
  shelfEl.addEventListener('pointermove', (event) => {
    if (!hovered) return;
    tiltTo(hovered, event.clientX);
  });
  shelfEl.addEventListener('pointerout', (event) => {
    const node = event.target.closest?.('.book');
    if (node && node === hovered && !node.contains(event.relatedTarget)) leaveBook();
  });
  // A scroll takes the book out from under a stationary pointer, so the lift
  // and its plate go with it. Guarded on the document actually having moved:
  // a `scroll` event that leaves scrollY where it was is the browser resizing
  // its own viewport — which is what a full-page screenshot does — and
  // dismissing the plate for that dismissed it in the picture of it.
  let lastY = window.scrollY;
  let lastX = window.scrollX;
  window.addEventListener('scroll', () => {
    if (window.scrollY === lastY && window.scrollX === lastX) return;
    lastY = window.scrollY;
    lastX = window.scrollX;
    if (hovered) leaveBook();
  }, { passive: true });
}

/* ==========================================================================
   The rating control
   --------------------------------------------------------------------------
   Ten persistent buttons. Pressing one swaps classes and contents; it never
   replaces the element, because a button that is rebuilt under a keypress
   takes the focus with it and the next press goes nowhere.
   ========================================================================== */

function rateControl(item, { onChanged, empty = 'shelf.notRated' } = {}) {
  const wrap = el('div', 'rate');
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', rateLabelFor(item));

  const buttons = [];
  for (let i = 1; i <= 10; i += 1) {
    const button = el('button', 'rate-btn');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.value = String(i);
    button.append(starSvg());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      press(i);
    });
    buttons.push(button);
    wrap.append(button);
  }

  const value = el('span', 'rate-value');
  wrap.append(value);

  function paint({ pressed = null, previous = 0 } = {}) {
    const score = scoreOf(item);
    const current = score.value ?? 0;
    wrap.setAttribute('aria-label', rateLabelFor(item));
    buttons.forEach((button, index) => {
      const on = index < current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(index + 1 === current));
      button.setAttribute('aria-label', t('shelf.of10', { n: index + 1 }));
      button.classList.remove('pop', 'fill-in');
      button.querySelector('.ring')?.remove();
      if (!on || reduced || pressed == null) return;
      if (index + 1 === pressed) {
        button.classList.add('pop');
        const ring = el('span', 'ring');
        button.append(ring);
        setTimeout(() => ring.remove(), 500);
      } else if (index >= previous) {
        button.style.setProperty('--k', String(index - previous));
        button.classList.add('fill-in');
      }
    });
    value.replaceChildren();
    if (score.value != null) {
      value.append(document.createTextNode(String(score.value)));
      value.append(el('em', null, ` ${lang() === 'da' ? 'af 10' : 'of 10'}`));
    } else {
      value.append(el('em', null, t(empty)));
    }
    // Ten grey stars beside a label is the one state of this control that
    // reads as broken rather than as empty. The class lets the detail hold it
    // back until the reader goes for it.
    wrap.classList.toggle('is-empty', score.value == null);
  }

  async function press(n) {
    const score = scoreOf(item);
    const previous = score.value ?? 0;
    const next = score.value === n ? null : n;
    const result = await commit(item, { [score.field]: next });
    paint({ pressed: result && next ? n : null, previous });
    // Clearing has no animation to speak for it — the stars simply go out —
    // so it says what happened instead.
    if (result === 'saved' && next === null) toast(t('shelf.ratingCleared'));
    onChanged?.();
  }

  paint();
  return { root: wrap, paint };
}

/* ==========================================================================
   Writing
   ========================================================================== */

let pendingAfterUnlock = null;

/**
 * Send one change, and say in a word how it went.
 *
 * 'saved' and 'offline' are both successes as far as the screen is concerned —
 * the local copy holds the change either way — but only one of them is allowed
 * to put a message of its own on top of "saved on this device".
 */
async function commit(item, patch) {
  if (!isUnlocked()) {
    openUnlock(() => commit(item, patch).then(() => { paintAll(); }));
    return false;
  }
  try {
    await setWork(item.slug, patch);
    return 'saved';
  } catch (error) {
    if (error?.code === 'locked') {
      openUnlock(() => commit(item, patch).then(() => { paintAll(); }));
    } else if (error?.code === 'offline') {
      toast(t('shelf.savedHere'));
      return 'offline';      // the local copy holds it, and the queue replays it
    } else if (error?.code === 'unconfigured') {
      toast(t('shelf.notSetUp'));
    } else {
      toast(t('shelf.saveFailed'));
    }
    return false;
  }
}

function toast(message) {
  const node = $('shelf-toast');
  // The wrapper is a full-width row; the bubble inside it is what is seen and
  // what moves. Writing to the wrapper would throw the bubble away.
  const body = node.querySelector('.shelf-toast-body') || node;
  body.textContent = message;
  node.dataset.visible = 'true';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.dataset.visible = 'false'; }, 4200);
}

/* ---------------------------------------------------------------- unlock */

const unlockEl = $('unlock');
let unlockReturn = null;

function openUnlock(after) {
  pendingAfterUnlock = after || null;
  unlockReturn = document.activeElement;
  $('unlock-error').hidden = true;
  unlockEl.hidden = false;
  $('unlock-code').value = '';
  $('unlock-code').focus();
}

function closeUnlock() {
  unlockEl.hidden = true;
  pendingAfterUnlock = null;
  if (unlockReturn?.isConnected) unlockReturn.focus();
  unlockReturn = null;
}

function wireUnlock() {
  $('unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $('unlock-code').value;
    const error = $('unlock-error');
    error.hidden = true;
    try {
      const ok = await unlock(code);
      if (!ok) { error.textContent = t('shelf.unlock.wrong'); error.hidden = false; return; }
      const after = pendingAfterUnlock;
      closeUnlock();
      paintLock();
      after?.();
    } catch (problem) {
      error.textContent = problem?.code === 'unconfigured' ? t('shelf.notSetUp') : t('edit.offline');
      error.hidden = false;
    }
  });
  $('unlock-cancel').addEventListener('click', closeUnlock);
  unlockEl.addEventListener('click', (event) => { if (event.target === unlockEl) closeUnlock(); });
  // No Escape handler here on purpose. There used to be one, and because it ran
  // first and hid this dialog, the document's handler underneath it then saw no
  // dialog open and closed the book detail as well — one key, two layers. The
  // document's handler is the only one, and it closes the top-most layer.

  $('shelf-lock').addEventListener('click', () => {
    if (isUnlocked()) { lock(); paintLock(); toast(t('edit.locked')); }
    else openUnlock(null);
  });
}

const LOCK_SHUT = 'M12 2.8a4.2 4.2 0 0 0-4.2 4.2v2.4H7A1.8 1.8 0 0 0 5.2 11.2v7A1.8 1.8 0 0 0 7 20h10a1.8 1.8 0 0 0 1.8-1.8v-7A1.8 1.8 0 0 0 17 9.4h-.8V7A4.2 4.2 0 0 0 12 2.8zm0 1.8A2.4 2.4 0 0 1 14.4 7v2.4H9.6V7A2.4 2.4 0 0 1 12 4.6z';
const LOCK_OPEN = 'M12 2.8a4.2 4.2 0 0 1 4.2 4.2h-1.8A2.4 2.4 0 0 0 9.6 7v2.4H17a1.8 1.8 0 0 1 1.8 1.8v7A1.8 1.8 0 0 1 17 20H7a1.8 1.8 0 0 1-1.8-1.8v-7A1.8 1.8 0 0 1 7 9.4h.8V7A4.2 4.2 0 0 1 12 2.8z';

/* An emoji padlock is the one thing on this page nobody chose the colour of.
   A path in currentColor belongs to whichever edition is showing. */
function paintLock() {
  const button = $('shelf-lock');
  const open = isUnlocked();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.style.display = 'block';
  svg.style.fill = 'currentColor';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', open ? LOCK_OPEN : LOCK_SHUT);
  svg.append(path);
  button.replaceChildren(svg);
  button.setAttribute('aria-pressed', String(open));
  const label = open ? t('shelf.lockNow') : t('shelf.unlockNow');
  button.title = label;
  button.setAttribute('aria-label', label);
}

/* ==========================================================================
   The detail
   ========================================================================== */

const detailEl = $('detail');
const scrimEl = $('detail-scrim');
let openSlug = null;
let openedFrom = null;
/* True when opening the detail is what put the current entry in the history,
   and therefore when closing it is allowed to take that entry back out. A
   detail opened by a deep link owns no entry of its own, so Escape there must
   not send the reader off the page. */
let pushedDetail = false;

function metaLine(item) {
  return [
    fmtYear(item.year),
    item.pages ? t('shelf.pages', { n: item.pages }) : null,
    item.added ? t('shelf.added', { d: fmtDate(item.added) }) : null,
    item.read ? t('shelf.finished', { d: fmtDate(item.read) }) : null,
    item.quotes ? nQuotes(item.quotes) : t('shelf.noQuotes'),
  ].filter(Boolean).join(' · ');
}

/** The seven works standing beside this one in the arrangement on screen. */
function neighbours(item) {
  const index = flatOrder.indexOf(item.slug);
  if (index < 0) return [];
  const others = flatOrder.filter((key) => key !== item.slug);
  const centre = Math.max(0, Math.min(others.length - 7, index - 3));
  return others.slice(centre, centre + 7).map((key) => bySlug.get(key)).filter(Boolean);
}

function buildDetail(item) {
  const card = el('div', 'detail-card');
  let step = 0;
  const item_ = (node) => { node.classList.add('d-item'); node.style.setProperty('--i', String(step += 1)); return node; };

  const close = el('button', 'pill detail-close');
  close.type = 'button';
  close.id = 'detail-close';
  close.append(document.createTextNode(t('ui.close')));
  const kbd = document.createElement('kbd');
  kbd.textContent = 'esc';
  close.append(kbd);
  close.addEventListener('click', () => closeBook());
  card.append(close);

  const grid = el('div', 'detail-grid');

  const stage = item_(el('div', 'detail-stage'));
  const wrap = el('span', 'detail-cover-wrap');
  const cover = coverBox(item, { fluid: true, eager: true });
  cover.classList.add('detail-cover');
  wrap.append(cover);
  stage.append(wrap);
  grid.append(stage);

  const body = el('div', 'detail-body');

  body.append(item_(el('p', 'detail-kicker', [subjectLabel(item.subject), kindLabel(item)].join(' · '))));
  const title = item_(el('h1', 'detail-title', item.title));
  title.id = 'detail-title';
  body.append(title);
  body.append(item_(el('p', 'detail-author', item.author)));
  body.append(item_(el('p', 'detail-meta', metaLine(item))));

  if (item.sample) {
    body.append(item_(el('p', 'detail-quote', `“${typographic(item.sample)}”`)));
  }

  // Rating and shelf, together, and only for a book. A talk is not on a shelf
  // and is not waiting to be read, so "How much do I want to read it" under a
  // conference video was a question about nothing — the brief gives non-books
  // no rating and no shelf control, just the quotes and the links.
  if (isBook(item)) {
    const rateBlock = item_(el('div', 'detail-block'));
    const rateLabel = el('span', 'detail-label', rateLabelFor(item));
    rateBlock.append(rateLabel);
    const rate = rateControl(item, {
      empty: 'shelf.notRatedYet',
      onChanged: () => {
        paintBook(item);
        paintHero();
        if (view.sort === 'rating') render({ animate: true });
      },
    });
    rateBlock.append(rate.root);
    body.append(rateBlock);

    const shelfBlock = item_(el('div', 'detail-block'));
    shelfBlock.append(el('span', 'detail-label', t('shelf.shelfLabel')));
    const choice = el('div', 'detail-shelves');
    const buttons = [];
    for (const key of SHELF_KEYS) {
      const pill = el('button', 'pill', t(`shelf.${key}`));
      pill.type = 'button';
      pill.dataset.shelf = key;
      pill.setAttribute('aria-pressed', String(item.shelf === key));
      pill.addEventListener('click', () => setShelf(item, item.shelf === key ? null : key));
      buttons.push(pill);
      choice.append(pill);
    }
    const clear = el('button', 'pill is-clear', t('shelf.remove'));
    clear.type = 'button';
    clear.addEventListener('click', () => setShelf(item, null));
    choice.append(clear);
    shelfBlock.append(choice);
    body.append(shelfBlock);

    detailEl.__repaintShelf = () => {
      for (const pill of buttons) pill.setAttribute('aria-pressed', String(item.shelf === pill.dataset.shelf));
      rateLabel.textContent = rateLabelFor(item);
      rate.paint();
    };
  } else {
    detailEl.__repaintShelf = null;
  }

  const actions = item_(el('div', 'detail-actions'));
  if (item.quotes) {
    const primary = el('a', 'pill pill-primary', `${t('shelf.readQuotes')} · ${item.quotes}`);
    primary.href = `./?work=${encodeURIComponent(item.slug)}`;
    actions.append(primary);
  } else {
    const none = el('span', 'detail-link', t('shelf.noQuotes'));
    actions.append(none);
  }
  if (item.goodreads) {
    const gr = el('a', 'detail-link', t('shelf.goodreads'));
    gr.href = item.goodreads;
    gr.target = '_blank';
    gr.rel = 'noopener noreferrer';
    actions.append(gr);
  }
  const find = findLink(item);
  const findEl = el('a', 'detail-link', find.label);
  findEl.href = find.href;
  findEl.target = '_blank';
  findEl.rel = 'noopener noreferrer';
  actions.append(findEl);
  body.append(actions);

  grid.append(body);
  card.append(grid);

  const near = neighbours(item);
  if (near.length) {
    const block = item_(el('div', 'detail-near'));
    block.append(el('span', 'detail-label', t('shelf.near')));
    const row = el('ul', 'near-row');
    for (const other of near) {
      const li = document.createElement('li');
      const button = el('button', 'near-book');
      button.type = 'button';
      button.setAttribute('aria-label', `${other.title} — ${other.author}`);
      const box = coverBox(other, { height: 92, eager: true });
      box.style.width = `${Math.round(92 * other.aspect)}px`;
      button.append(box, el('span', 'c-title', other.title));
      button.addEventListener('click', () => openBook(other.slug, null));
      li.append(button);
      row.append(li);
    }
    block.append(row);
    card.append(block);
  }

  return card;
}

function paintDetail(item) {
  detailEl.replaceChildren(buildDetail(item));
  detailEl.hidden = false;
  scrimEl.hidden = false;
  // Both, not one. The document scrolls on <html>, so hiding the body's
  // overflow alone left the shelf sliding about behind the open sheet at a
  // desk. The gutter is reserved in CSS (`scrollbar-gutter: stable`) so taking
  // the scrollbar away does not shift the page sideways underneath it.
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  detailEl.scrollTop = 0;
  $('detail-close').focus({ preventScroll: true });
  wireDetailTilt();
}

function setShelf(item, next) {
  commit(item, { shelf: next }).then((result) => {
    if (result === 'saved' && next === null) toast(t('shelf.removed'));
    refresh(item);
    detailEl.__repaintShelf?.();
    paintBook(item);
    paintChips();
    paintHero();
    if (view.sort === 'shelf' || view.filter !== 'all') render({ animate: true });
  });
}

/** The detail's cover leans toward the pointer, the way the hero's does. */
function wireDetailTilt() {
  if (reduced) return;
  const stage = detailEl.querySelector('.detail-stage');
  const wrap = detailEl.querySelector('.detail-cover-wrap');
  if (!stage || !wrap) return;
  const spring = spring2d((rx, ry) => {
    wrap.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    wrap.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  });
  let rect = null;
  stage.addEventListener('pointerenter', () => { rect = stage.getBoundingClientRect(); });
  stage.addEventListener('pointermove', (event) => {
    if (!rect) rect = stage.getBoundingClientRect();
    const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 1.4);
    const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 1.4);
    spring.to(Math.max(-6, Math.min(6, -ny * 12)), Math.max(-6, Math.min(6, nx * 12)));
  });
  stage.addEventListener('pointerleave', () => spring.to(0, 0));
}

/**
 * Open a book.
 *
 * The cover does not disappear and reappear larger: it is the same object
 * moving. View Transitions where the browser has them, a measured
 * translate-and-scale where it does not. Exactly one element may carry the
 * transition name at any instant, so the card wears it while the old frame is
 * captured and hands it over inside the callback — the handover is the
 * transition.
 */
function openBook(key, source, { animate = true, push = true } = {}) {
  const item = bySlug.get(key);
  if (!item) return;
  const wasOpen = !detailEl.hidden;
  if (source) openedFrom = source;
  openSlug = key;
  leaveBook();

  // Opening pushes, so Back closes the sheet rather than leaving the site.
  // Moving from one book to a neighbour replaces instead: seven neighbours
  // deep, a reader still expects one Back to put them on the shelf.
  const url = `#${encodeURIComponent(key)}`;
  if (!push || wasOpen) {
    history.replaceState({ book: key }, '', url);
    if (!wasOpen) pushedDetail = false;
  } else {
    history.pushState({ book: key }, '', url);
    pushedDetail = true;
  }

  const sourceCover = source?.querySelector('.cover-box') || null;

  if (!animate || reduced) { paintDetail(item); return; }

  if (document.startViewTransition && sourceCover) {
    sourceCover.style.viewTransitionName = 'book-cover';
    const vt = document.startViewTransition(() => {
      sourceCover.style.viewTransitionName = '';
      paintDetail(item);
      const target = detailEl.querySelector('.detail-cover');
      if (target) target.style.viewTransitionName = 'book-cover';
    });
    guardTransition(vt);
    vt.ready?.catch(() => {});
    vt.updateCallbackDone?.catch(() => {});
    vt.finished?.then(() => {}, () => {}).finally(() => {
      sourceCover.style.viewTransitionName = '';
      const target = detailEl.querySelector('.detail-cover');
      if (target) target.style.viewTransitionName = '';
    });
    return;
  }

  const from = sourceCover ? sourceCover.getBoundingClientRect() : null;
  paintDetail(item);
  const target = detailEl.querySelector('.detail-cover');
  if (from && target) {
    const to = target.getBoundingClientRect();
    target.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'none' });
  }
  detailEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'none' });
}

function closeBook({ viaHistory = false } = {}) {
  if (detailEl.hidden) return;
  const key = openSlug;
  openSlug = null;
  const back = () => {
    detailEl.hidden = true;
    scrimEl.hidden = true;
    detailEl.replaceChildren();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (viaHistory) {
      // The browser has already moved; undoing that would fight the reader.
      pushedDetail = false;
    } else if (pushedDetail) {
      pushedDetail = false;
      history.back();          // pops the entry opening it pushed
    } else if (location.hash) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    // Focus goes back to the book that opened the detail, not to the top of
    // the document: a reader who opened the fortieth book keeps their place.
    const home = openedFrom?.isConnected ? openedFrom : nodes.get(key);
    home?.focus({ preventScroll: false });
    openedFrom = null;
  };

  const card = key ? nodes.get(key)?.querySelector('.cover-box') : null;
  if (reduced || !document.startViewTransition || !card || !card.isConnected) {
    detailEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)', fill: 'none' })
      .finished.then(back, back);
    return;
  }

  const target = detailEl.querySelector('.detail-cover');
  if (target) target.style.viewTransitionName = 'book-cover';
  const vt = document.startViewTransition(() => {
    back();
    card.style.viewTransitionName = 'book-cover';
  });
  guardTransition(vt);
  vt.ready?.catch(() => {});
  vt.updateCallbackDone?.catch(() => {});
  vt.finished?.then(() => {}, () => {}).finally(() => { card.style.viewTransitionName = ''; });
}

/**
 * A view transition that outstays its welcome is cut short.
 *
 * The browser suspends rendering while one plays. A 420 ms animation that has
 * not finished in a second and a half is not going to, and the cost of waiting
 * is a page that has stopped painting — so it is skipped and the frame after it
 * shows the finished state, which is where the reader was going anyway.
 */
function guardTransition(vt) {
  if (!vt) return;
  const bail = setTimeout(() => { try { vt.skipTransition?.(); } catch { /* already over */ } }, 1500);
  vt.finished?.then(() => {}, () => {}).finally(() => clearTimeout(bail));
}

/** Tab stays inside the dialog while it is open. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function trapTab(event) {
  if (event.key !== 'Tab') return;
  const host = !unlockEl.hidden ? unlockEl : (!detailEl.hidden ? detailEl : null);
  if (!host) return;
  const stops = [...host.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/* ==========================================================================
   The hero
   ========================================================================== */

/**
 * A spring, not a curve.
 *
 * It arrives fast from far, barely moves from near, and overshoots a little.
 * A CSS transition cannot do that, and a book that eases on a fixed curve
 * feels like a picture of a book.
 */
function spring2d(onFrame) {
  const K = 170;
  const D = 19;
  let px = 0; let py = 0; let vx = 0; let vy = 0; let tx = 0; let ty = 0;
  let raf = null; let last = 0;
  const step = (now) => {
    if (!last) last = now;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    vx += (K * (tx - px) - D * vx) * dt;
    vy += (K * (ty - py) - D * vy) * dt;
    px += vx * dt;
    py += vy * dt;
    onFrame(px, py);
    if (Math.abs(tx - px) < 0.01 && Math.abs(ty - py) < 0.01 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
      px = tx; py = ty; vx = 0; vy = 0; onFrame(px, py); raf = null; last = 0; return;
    }
    raf = requestAnimationFrame(step);
  };
  return { to(x, y) { tx = x; ty = y; if (!raf) { last = 0; raf = requestAnimationFrame(step); } } };
}

const heroEl = $('hero');

/**
 * Is this the phone layout?
 *
 * Held in a variable rather than asked for each time, and deliberately not
 * `window.matchMedia(...).addEventListener(...)` on a throwaway object: a
 * MediaQueryList nothing keeps a reference to can be collected with its
 * listener still attached, and then the card simply never hears that the
 * window crossed the boundary. The resize path below asks this object instead.
 */
const narrowQuery = window.matchMedia('(max-width: 760px)');

/* The book standing large on the hero's ledge. It starts as the most recently
   added `reading` book and changes when the reader clicks one of the others,
   which is why it is state rather than a derived value: a language switch or a
   rating repaints the hero, and the book he chose has to survive that. */
let heroFeatured = null;

/** The three `reading` books, featured first. */
function heroBooks() {
  const reading = works.filter((item) => item.shelf === 'reading')
    .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
  if (!reading.length) return { featured: null, others: [] };
  const chosen = reading.find((item) => item.slug === heroFeatured) || reading[0];
  heroFeatured = chosen.slug;
  return { featured: chosen, others: reading.filter((item) => item !== chosen) };
}

/* One cover 200px wide would be 324px tall for a jacket as narrow as Genesis,
   and the card has a height budget: the shelf itself has to start above the
   fold. So the width is the target and the height is the cap, and a tall jacket
   gives up a little width rather than the card giving up its proportions. */
const HERO_W = 200;
const HERO_H = 288;
const HERO_MINI_W = 120;

function heroCoverHeight(item, { narrow, mini }) {
  if (narrow) return (mini ? 46 : 96) / item.aspect;
  if (mini) return Math.min(HERO_H * 0.66, HERO_MINI_W / item.aspect);
  return Math.min(HERO_H, HERO_W / item.aspect);
}

/** One of the books standing on the hero's ledge. */
function heroBookNode(item, { narrow, mini }) {
  const node = el('button', `hero-book${mini ? ' is-mini' : ' is-featured'}`);
  node.type = 'button';
  node.dataset.slug = item.slug;
  const tilt = el('span', mini ? 'hero-mini-tilt' : 'hero-tilt');
  tilt.append(coverBox(item, { height: heroCoverHeight(item, { narrow, mini }), eager: true }));
  node.append(tilt);
  if (mini) {
    node.setAttribute('aria-label', `${t('shelf.hero.feature')}: ${item.title}`);
    node.title = item.title;
    node.addEventListener('click', () => featureHero(item.slug));
  } else {
    node.setAttribute('aria-label', `${t('shelf.openBook')}: ${item.title}`);
    node.addEventListener('click', () => openBook(item.slug, null));
  }
  return node;
}

function paintHero() {
  unplace();
  const { featured, others } = heroBooks();
  if (!featured) { heroEl.hidden = true; return; }
  heroEl.hidden = false;
  heroEl.replaceChildren();

  const narrow = narrowQuery.matches;

  const lead = heroBookNode(featured, { narrow, mini: false });
  heroEl.append(lead);
  // The phone layout indents the thumbnails past the featured cover so they sit
  // under the text rather than under the book; only the layout knows how wide
  // that cover ended up, so it is handed to the stylesheet rather than guessed.
  heroEl.style.setProperty('--hero-lead-w', `${Math.round(heroCoverHeight(featured, { narrow, mini: false }) * featured.aspect)}px`);

  if (others.length) {
    const rest = el('div', 'hero-others');
    for (const item of others) rest.append(heroBookNode(item, { narrow, mini: true }));
    heroEl.append(rest);
  }

  const body = el('div', 'hero-body');
  body.append(el('p', 'hero-kicker', t('shelf.hero.reading')));

  const title = el('h2', 'hero-title');
  title.id = 'hero-title';
  const titleLink = el('a', 'hero-title-link', featured.title);
  titleLink.href = `#${encodeURIComponent(featured.slug)}`;
  titleLink.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openBook(featured.slug, null);
  });
  title.append(titleLink);
  body.append(title);

  body.append(el('p', 'hero-meta', [
    featured.author,
    fmtYear(featured.year),
    featured.pages ? t('shelf.pages', { n: featured.pages }) : null,
  ].filter(Boolean).join(' · ')));

  const rateWrap = el('div', 'hero-rate');
  const shortLabel = featured.shelf === 'read' || featured.shelf === 'abandoned'
    ? t('shelf.rateShort.good')
    : t('shelf.rateShort.want');
  rateWrap.append(el('span', 'hero-rate-label', narrow ? shortLabel : rateLabelFor(featured)));
  const rate = rateControl(featured, {
    onChanged: () => { paintBook(featured); if (view.sort === 'rating') render({ animate: true }); },
  });
  rateWrap.append(rate.root);
  // On a phone the rating is its own band across the card, not a block inside
  // the text column: the text column is the taller of the two, so anything put
  // there is added straight to the card's height and the shelf goes down the
  // screen with it. `order` in the stylesheet decides where the band lands.
  if (!narrow) body.append(rateWrap);

  const actions = el('div', 'hero-actions');
  if (featured.quotes) {
    const primary = el('a', 'pill pill-primary', `${t('shelf.readQuotes')} · ${featured.quotes}`);
    primary.href = `./?work=${encodeURIComponent(featured.slug)}`;
    actions.append(primary);
  }
  const details = el('button', `pill${featured.quotes ? '' : ' pill-primary'}`, featured.quotes ? t('shelf.details') : t('shelf.openBook'));
  details.type = 'button';
  details.addEventListener('click', () => openBook(featured.slug, null));
  actions.append(details);
  body.append(actions);

  heroEl.append(body);
  if (narrow) heroEl.append(rateWrap);
  heroEl.append(heroFoot(featured));
  wireHeroTilt();
}

/**
 * The quiet line at the card's foot.
 *
 * "Also reading" used to live here as a list of titles. It does not any more:
 * the other books he is reading are standing on the ledge above it, which is
 * the same fact told as a shelf rather than as a sentence. What is left is the
 * two facts no cover can carry.
 */
function heroFoot(featured) {
  const line = el('p', 'hero-foot');

  const link = (item) => {
    const anchor = el('a', 'hero-foot-link', item.title);
    anchor.href = `#${encodeURIComponent(item.slug)}`;
    anchor.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      openBook(item.slug, null);
    });
    return anchor;
  };

  const bit = (label) => {
    const span = el('span', 'hero-foot-bit');
    span.append(el('b', null, `${label}: `));
    line.append(span);
    return span;
  };

  const pool = works.filter((item) => item !== featured);
  const lastAdded = pool.filter((item) => item.added).sort((a, b) => b.added.localeCompare(a.added))[0];
  if (lastAdded) bit(t('shelf.hero.lastAdded')).append(link(lastAdded));

  const best = pool.filter((item) => item.shelf === 'read' && item.rating != null)
    .sort((a, b) => b.rating - a.rating || b.quotes - a.quotes)[0];
  if (best) {
    const span = bit(t('shelf.hero.bestRated'));
    span.append(link(best), document.createTextNode(` ${best.rating}/10`));
  }
  return line;
}

/**
 * Put one of the small books in the large place.
 *
 * A FLIP, for the same reason the shelf uses one: the two covers swap sizes and
 * positions, and a crossfade alone would read as two pictures being exchanged
 * rather than as two objects trading places. Read both rects, mutate once, read
 * again, then write — and the transforms are inline styles cleared on the way
 * out, so nothing stays resident on the element afterwards.
 */
function featureHero(slug) {
  if (slug === heroFeatured) return;

  const before = new Map();
  for (const node of heroEl.querySelectorAll('.hero-book')) {
    before.set(node.dataset.slug, node.getBoundingClientRect());
  }

  heroFeatured = slug;
  paintHero();
  heroEl.querySelector('.hero-body')?.classList.add('is-swapped');

  if (reduced) return;

  const moved = [];
  for (const node of heroEl.querySelectorAll('.hero-book')) {
    const was = before.get(node.dataset.slug);
    if (!was) continue;
    const now = node.getBoundingClientRect();
    if (!now.width || !was.width) continue;
    const dx = (was.left + was.width / 2) - (now.left + now.width / 2);
    const dy = was.bottom - now.bottom;
    const scale = was.width / now.width;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.01) continue;
    moved.push({ node, dx, dy, scale });
  }

  for (const entry of moved) {
    entry.node.style.transformOrigin = 'bottom center';
    entry.node.style.transition = 'none';
    entry.node.style.transform = `translate(${entry.dx}px, ${entry.dy}px) scale(${entry.scale.toFixed(4)})`;
  }

  // Flush the inverted position into computed style before the frame that
  // plays it back. Without this there is no "from" value to transition out of:
  // requestAnimationFrame callbacks run before style is recalculated, so the
  // browser would only ever see the final transform and the books would jump.
  if (moved.length) void moved[0].node.offsetWidth;

  requestAnimationFrame(() => {
    for (const entry of moved) {
      entry.node.style.transition = `transform 460ms var(--shelf-ease)`;
      entry.node.style.transform = '';
    }
    setTimeout(() => {
      for (const entry of moved) {
        entry.node.style.transition = '';
        entry.node.style.transform = '';
        entry.node.style.transformOrigin = '';
      }
    }, 520);
  });
}

/**
 * The featured book leans toward the pointer.
 *
 * Wired to the section once and never again: `paintHero` replaces its children
 * on every language change, every rating and every swap, and listeners added
 * per paint would accumulate one set per repaint for the life of the page. The
 * spring writes to whichever `.hero-tilt` is currently in the card.
 */
let heroSpring = null;
let heroWired = false;

function wireHeroTilt() {
  if (reduced || heroWired) return;
  heroWired = true;
  heroSpring = spring2d((rx, ry) => {
    const tilt = heroEl.querySelector('.hero-tilt');
    if (!tilt) return;
    tilt.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    tilt.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  });
  let rect = null;
  heroEl.addEventListener('pointerenter', () => { rect = heroEl.getBoundingClientRect(); });
  heroEl.addEventListener('pointermove', (event) => {
    if (!rect) rect = heroEl.getBoundingClientRect();
    const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 1.2);
    const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 1.2);
    heroSpring.to(Math.max(-6, Math.min(6, -ny * 14)), Math.max(-6, Math.min(6, nx * 14)));
  });
  heroEl.addEventListener('pointerleave', () => heroSpring.to(0, 0));
}

/* The hero is laid out one way beside a mouse and another on a phone — the
   thumbnails move from the ledge to under the text — and which one it is, is a
   decision JavaScript makes when it builds the covers. A rotation crosses that
   line without a reload, so the card is rebuilt when it does. The resize path
   in wireControls() asks the same question and is the one that has to be
   right; this listener is the cheap half of the same answer. */
narrowQuery.addEventListener?.('change', () => paintHero());

/* ==========================================================================
   Chrome
   ========================================================================== */

function paintChips() {
  unplace();
  const box = $('shelf-chips');
  const counts = { all: works.length };
  for (const key of SHELF_KEYS) counts[key] = works.filter((item) => item.shelf === key).length;

  const make = (id, label) => {
    const pill = el('button', 'pill');
    pill.type = 'button';
    pill.dataset.filter = id;
    pill.setAttribute('aria-pressed', String(view.filter === id));
    pill.append(el('span', null, label), el('span', 'pill-count', String(counts[id])));
    pill.addEventListener('click', () => {
      view.filter = view.filter === id ? 'all' : id;
      paintChips();
      render({ animate: true });
    });
    return pill;
  };

  const frame = document.createDocumentFragment();
  frame.append(make('all', t('shelf.all')));
  for (const key of SHELF_KEYS) frame.append(make(key, t(`shelf.${key}`)));
  box.replaceChildren(frame);
}

function paintArrange() {
  const select = $('shelf-arrange');
  select.replaceChildren();
  for (const key of ARRANGE) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${t('shelf.arrangeLabel')}: ${t(`shelf.arrange.${key}`)}`;
    if (key === view.sort) option.selected = true;
    select.append(option);
  }
}

function paintStats() {
  const books = works.filter(isBook).length;
  const talks = works.length - books;
  const quotes = quoteTotal;
  $('shelf-stats').textContent = t('shelf.stats', { books, talks, quotes });
  $('shelf-foot-count').textContent = t('shelf.footCount', { books, quotes });
}

/** Everything that is words rather than structure. */
function paintAll() {
  hydrate(document);
  paintStats();
  paintArrange();
  paintChips();
  paintLock();
  paintHero();
  for (const item of works) paintBook(item);
}

/* ==========================================================================
   Boot
   ========================================================================== */

/**
 * Where the top of the page is, as far as a jump is concerned.
 *
 * Two things stick here — the header and the control row — so "Skip to the
 * shelf" landed the first ledge underneath both of them. Measured rather than
 * assumed: the header is two rows on a phone, and the control row wraps.
 */
function measureStuck() {
  const height = (node) => (node && getComputedStyle(node).position === 'sticky' ? node.offsetHeight : 0);
  const total = height(document.getElementById('site-nav')) + height($('shelf-controls'));
  document.documentElement.style.scrollPaddingTop = `${Math.round(total + 12)}px`;
}

function wireControls() {
  measureStuck();
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(measureStuck);
    for (const node of [document.getElementById('site-nav'), $('shelf-controls')]) if (node) watch.observe(node);
  } else {
    window.addEventListener('resize', measureStuck);
  }

  $('shelf-arrange').addEventListener('change', (event) => {
    view.sort = ARRANGE.includes(event.target.value) ? event.target.value : 'shelf';
    render({ animate: true });
  });

  let searchTimer = null;
  $('shelf-search').addEventListener('input', (event) => {
    const value = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { view.query = value; render({ animate: true }); }, 110);
  });

  scrimEl.addEventListener('click', () => closeBook());
  detailEl.addEventListener('click', (event) => { if (event.target === detailEl) closeBook(); });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!unlockEl.hidden) { closeUnlock(); return; }
      if (!detailEl.hidden) closeBook();
      return;
    }
    trapTab(event);
  });

  /**
   * The window changed size. Three things have to answer it.
   *
   * The hero is rebuilt if the phone boundary was crossed. Its two layouts are
   * a JavaScript decision — the thumbnails are built at 46px or at 120px — so a
   * card built at 1440 and left standing in a 390px window puts 440px of books
   * in a 353px card, which is exactly what a window narrowed during a re-sort
   * was left holding.
   *
   * A FLIP in flight is cut short. It holds every book at the position it had
   * in the *old* viewport as an inline transform, up to a thousand pixels to
   * the right of the new one, and a phone answers a document wider than its
   * screen by zooming out — which it does not undo when the animation ends. The
   * books are already in their right places, so the worst of ending it here is
   * a re-sort that did not glide across a resize nobody performs mid-animation
   * on purpose.
   *
   * And the lean is re-measured, because every rect it was based on has moved.
   */
  lastViewportWidth = document.documentElement.clientWidth;
  lastNarrow = narrowQuery.matches;

  window.addEventListener('resize', viewportChanged);

  /* The window's own resize event is not a reliable witness to the window
     changing size: when it changes while a transition is playing, Chrome can go
     on reporting the old `window.innerWidth` and fire it late or not at all.
     The document element's box did change, and a ResizeObserver sees that —
     but it also sees the page getting taller, which is what a re-sort does
     every time, so anything but a change of width is none of its business. */
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (document.documentElement.clientWidth === lastViewportWidth) return;
      viewportChanged();
    }).observe(document.documentElement);
  }

  /* Back and Forward move through the books, and off the end of them.
     `push: false` throughout: the entry the reader has just travelled to is
     already in the history, and opening it again must not add a second. */
  const followHistory = () => {
    const key = decodeURIComponent(location.hash.slice(1));
    if (key && bySlug.has(key)) {
      pushedDetail = false;
      if (key !== openSlug) openBook(key, nodes.get(key) || null, { push: false });
      return;
    }
    if (!detailEl.hidden) closeBook({ viaHistory: true });
  };
  window.addEventListener('popstate', followHistory);
  // A hash typed into the address bar is a navigation, not a traversal, and in
  // some browsers only this fires. The guard inside makes the overlap harmless.
  window.addEventListener('hashchange', followHistory);

  onLang(() => {
    paintAll();
    render({ animate: false });
    if (openSlug) paintDetail(bySlug.get(openSlug));
  });

  // A change from another tab, or a queued write landing, repaints the words
  // but never re-sorts the shelf under the reader's hands.
  onChange(() => {
    for (const item of works) refresh(item);
    for (const item of works) paintBook(item);
    paintChips();
    paintLock();
  });
}

async function boot() {
  mountNav({ active: 'shelf', variant: 'bar' });
  wireUnlock();
  hydrate(document);

  const [registry, collection] = await Promise.all([
    loadJson('data/works.json', { works: [] }),
    loadJson('data/quotes.json', { quotes: [] }),
  ]);

  const quotes = Array.isArray(collection) ? collection : (collection.quotes || []);
  quoteTotal = quotes.length;
  const counts = new Map();
  for (const quote of quotes) {
    const key = quote.work;
    if (!key) continue;
    const entry = counts.get(key) || { count: 0, shortest: null, earliest: null };
    entry.count += 1;
    if (!entry.shortest || String(quote.text).length < entry.shortest.length) entry.shortest = String(quote.text);
    const at = typeof quote.addedAt === 'string' ? quote.addedAt.slice(0, 10) : null;
    if (at && (!entry.earliest || at < entry.earliest)) entry.earliest = at;
    counts.set(key, entry);
  }

  // The Worker's state is laid over the repository JSON. It is allowed to be
  // slow or absent: a 2.5 second budget, then the page renders from the repo.
  await loadState().catch(() => {});

  const list = Array.isArray(registry) ? registry : (registry.works || []);
  works = list.map((raw) => makeItem(raw, counts));
  for (const item of works) bySlug.set(item.slug, item);

  paintAll();
  render({ animate: false });
  wireHover();
  wireControls();

  // Deliberately not inside requestAnimationFrame. A deep link is correctness,
  // not decoration: `render()` has already laid the shelf out synchronously, so
  // there is nothing to wait a frame for, and a page whose deep link depends on
  // a frame being painted fails wherever frames are throttled — a background
  // tab, a headless browser, a phone that has just been woken.
  applyLean();

  const deep = decodeURIComponent(location.hash.slice(1));
  const asked = params.get('open');
  const target = asked && asked !== '1' ? asked : (asked === '1' ? mostQuoted() : deep);
  if (target && bySlug.has(target)) openBook(target, nodes.get(target) || null, { animate: false, push: false });

  const hover = params.get('hover');
  if (hover) freezeHover(Number(hover) || 1);

  if (params.get('probe') === '1') probe();
}

const mostQuoted = () => [...works].sort((a, b) => b.quotes - a.quotes)[0]?.slug;

/** ?hover=<n> freezes the nth book's hover state, so a still can show it. */
function freezeHover(n) {
  const list = [...shelfEl.querySelectorAll('.book')];
  const node = list[Math.max(0, Math.min(list.length - 1, n - 1))];
  if (!node) return;

  // Frozen before the scroll, not after. `scrollIntoView` fires a scroll event
  // of its own a frame later, and the scroll handler's job is to take the lift
  // and its plate away — which is why the plate used to stand for about 200 ms
  // and then vanish, and why a headless still of ?hover= photographed a shelf
  // at rest.
  hoverFrozen = true;
  node.scrollIntoView({ block: 'center' });

  const pose = () => {
    enterBook(node);
    const box = node.querySelector('.cover-box');
    if (!box) return;
    hoverRect = box.getBoundingClientRect();
    const item = bySlug.get(node.dataset.slug);
    if (item) showPlate(node, item);
    tiltTo(node, hoverRect.left + hoverRect.width * 0.78);
  };
  pose();
  // Again once the scroll has landed, so the rect the tilt and the plate's
  // viewport nudge are read from is the one on the screen.
  setTimeout(pose, 140);
}

/** ?probe=1 prints what a still cannot show: whether anything overflows. */
function probe() {
  setTimeout(() => {
    const doc = document.documentElement;
    const offenders = [];
    for (const node of document.querySelectorAll('body *')) {
      const rect = node.getBoundingClientRect();
      if (!rect.width) continue;
      if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
        const style = getComputedStyle(node.parentElement || node);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        offenders.push(`${node.tagName.toLowerCase()}.${String(node.className || '').split(' ')[0]} L${Math.round(rect.left)} R${Math.round(rect.right)}`);
      }
    }
    const pre = document.createElement('pre');
    pre.id = 'probe';
    pre.textContent = JSON.stringify({
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflow: doc.scrollWidth - doc.clientWidth,
      offenders: offenders.slice(0, 12),
      books: nodes.size,
      online: status.online,
    }, null, 1);
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;font:11px monospace;background:#fff;color:#000;max-width:100%;white-space:pre-wrap';
    document.body.append(pre);
  }, 900);
}

/* --------------------------------------------------------------- exposed */

/* The acceptance harness drives the page rather than reaching into it, but two
   measurements are impossible from the outside: how long the synchronous part
   of a re-sort takes, and what order the shelf is actually in. */
window.__shelf = {
  resort(sort) {
    view.sort = ARRANGE.includes(sort) ? sort : view.sort;
    $('shelf-arrange').value = view.sort;
    const started = performance.now();
    render({ animate: true });
    return performance.now() - started;
  },
  order: () => [...shelfEl.querySelectorAll('.book')].map((node) => node.dataset.slug),
  /**
   * The shelf as it actually stands, read out of the DOM rather than out of the
   * model, so an assertion about the order is an assertion about what is on the
   * screen and not about what the sort function believes.
   */
  groups: () => [...shelfEl.querySelectorAll('.shelf-group')].map((node) => ({
    key: node.dataset.group,
    label: node.querySelector('h2')?.textContent || '',
    n: node.querySelectorAll('.book').length,
    items: [...node.querySelectorAll('.book')].map((book) => {
      const found = bySlug.get(book.dataset.slug);
      if (!found) return { slug: book.dataset.slug };
      return {
        slug: found.slug,
        title: found.title,
        surname: found.surname,
        year: found.year,
        added: found.added,
        read: found.read,
        quotes: found.quotes,
        shelf: found.shelf,
        kind: found.kind,
        subject: found.subject,
        score: scoreOf(found).value,
      };
    }),
  })),
  item: (key) => {
    const found = bySlug.get(key);
    if (!found) return null;
    const score = scoreOf(found);
    return { slug: found.slug, shelf: found.shelf, field: score.field, value: score.value, quotes: found.quotes };
  },
  viewport: () => ({ ...viewportWork, lastViewportWidth, lastNarrow, narrow: narrowQuery.matches }),
  count: () => works.length,
  shelved: () => works.filter((item) => isBook(item)).length,
  sort: () => view.sort,
};

boot();
