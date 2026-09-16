/**
 * The reading experience.
 *
 * Everything here serves one goal: put the words on the screen and get out of
 * the way. Chrome is hidden until asked for, state lives in the URL so any view
 * can be shared, and nothing animates that does not need to.
 */

import { ERAS, VERIFICATION_LABELS, eraFor, quoteId, slug, typographic } from './quote-core.js';
import { hydrate, langToggle, locale, onLang, register, t } from './i18n.js';
import {
  favorites as storedFavorites,
  isUnlocked,
  loadState,
  onChange,
  setFavorite,
  state as shelfState,
} from './store.js';

const DATA_URL = 'data/quotes.json';
const WORKS_URL = 'data/works.json';
const REPO = 'https://github.com/abustrup/Quote-collection';
const STORAGE = {
  edition: 'quotes-edition',
  favorites: 'quotes-favorites',
};

/**
 * Every word on this page that is not a quotation.
 *
 * Registered rather than edited into `i18n.js` so that the person building the
 * shelf and the person building this page never touch the same lines. Ids are
 * prefixed `index.` for the same reason; anything shared (`ui.`, `nav.`,
 * `edit.`) already lives in the dictionary and is used from there.
 */
register({
  'index.skip': { en: 'Skip to the quotes', da: 'Spring til citaterne' },
  'index.kicker': { en: 'A personal collection', da: 'En personlig samling' },
  'index.dek': {
    en: 'Everything I have wanted to remember – from philosophy, technology, literature and the odd sentence that would not leave me alone.',
    da: 'Alt hvad jeg har villet huske – fra filosofi, teknologi, litteratur og den enkelte sætning der ikke ville forlade mig igen.',
  },

  'index.search.label': { en: 'Search the collection', da: 'Søg i samlingen' },
  'index.search.placeholder': { en: 'Search quotes, authors, works…', da: 'Søg i citater, forfattere, værker…' },

  'index.filter.author.label': { en: 'Filter by author', da: 'Filtrér efter forfatter' },
  'index.filter.author.all': { en: 'All authors', da: 'Alle forfattere' },
  'index.filter.work.label': { en: 'Filter by work', da: 'Filtrér efter værk' },
  'index.filter.work.all': { en: 'All works', da: 'Alle værker' },
  'index.filter.subject.label': { en: 'Filter by subject', da: 'Filtrér efter emne' },
  'index.filter.subject.all': { en: 'All subjects', da: 'Alle emner' },
  'index.filter.era.label': { en: 'Filter by era', da: 'Filtrér efter periode' },
  'index.filter.era.all': { en: 'All eras', da: 'Alle perioder' },

  'index.sort.label': { en: 'Sort', da: 'Sortér' },
  'index.sort.added': { en: 'Newest first', da: 'Nyeste først' },
  'index.sort.oldest': { en: 'Oldest first', da: 'Ældste først' },
  'index.sort.author': { en: 'By author', da: 'Efter forfatter' },
  'index.sort.work': { en: 'By work', da: 'Efter værk' },
  'index.sort.year': { en: 'By year written', da: 'Efter skriveår' },
  'index.sort.length': { en: 'Shortest first', da: 'Korteste først' },
  'index.sort.random': { en: 'Shuffle', da: 'Bland' },

  'index.shelf': { en: 'Shelf', da: 'Hylden' },
  'index.shelf.title': { en: 'Every book and talk on the shelf', da: 'Alle bøger og foredrag på hylden' },
  'index.add': { en: 'Add', da: 'Tilføj' },
  'index.add.title': { en: 'Add a quote', da: 'Tilføj et citat' },
  'index.favourites': { en: 'Favourites', da: 'Favoritter' },
  'index.focus.title': { en: 'Read one at a time (F)', da: 'Læs ét ad gangen (F)' },
  'index.curate': { en: 'Curate', da: 'Kurater' },
  'index.curate.title': { en: 'Show edit and remove controls (C)', da: 'Vis rediger- og fjern-knapper (C)' },
  'index.curate.hint': {
    en: 'Tick the quotes to drop, then open one issue for all of them.',
    da: 'Sæt kryds ved de citater der skal væk, og åbn én sag for dem alle.',
  },
  'index.curate.deselect': { en: 'Deselect', da: 'Fravælg' },
  'index.curate.none': { en: 'Nothing selected', da: 'Intet valgt' },
  'index.curate.selected': { en: '{n} selected', da: '{n} valgt' },
  'index.curate.remove': { en: 'Remove selected…', da: 'Fjern de valgte…' },
  'index.curate.removeN': { en: 'Remove {n} quotes…', da: 'Fjern {n} citater…' },
  'index.curate.removeThis': { en: 'Remove this one', da: 'Fjern denne' },
  'index.curate.edit': { en: 'Edit', da: 'Rediger' },
  'index.curate.opened': { en: 'Opened a removal issue for {n}', da: 'Åbnede en fjern-sag for {n}' },

  'index.edition.label': { en: 'Edition', da: 'Udgave' },
  'index.edition.title': { en: 'Change how the collection is set', da: 'Skift hvordan samlingen er sat' },

  'index.count.one': { en: '{n} quote', da: '{n} citat' },
  'index.count.many': { en: '{n} quotes', da: '{n} citater' },
  'index.summary.some': { en: '{shown} of {total}', da: '{shown} af {total}' },
  'index.showing': { en: 'Showing', da: 'Viser' },
  'index.clearAll': { en: 'Clear all', da: 'Ryd alt' },
  'index.filterOff': { en: 'Remove the {key} filter', da: 'Fjern filteret {key}' },
  'index.chip.favourites': { en: 'favourites', da: 'favoritter' },

  'index.empty.title': { en: 'Nothing here yet.', da: 'Her er ingenting endnu.' },
  'index.empty.none': {
    en: 'The collection is empty. Import your Goodreads quotes to fill it.',
    da: 'Samlingen er tom. Importér dine Goodreads-citater for at fylde den.',
  },
  'index.empty.filtered': {
    en: 'No quote matches that. Try fewer words, or clear the filters.',
    da: 'Ingen citater passer. Prøv færre ord, eller ryd filtrene.',
  },

  'index.footer.import': { en: 'Import from Goodreads', da: 'Importér fra Goodreads' },
  'index.footer.source': { en: 'Source', da: 'Kildekode' },
  'index.footer.keys': {
    en: 'Press {slash} to search, {j} and {k} to move, {f} for focus, {s} to keep one, {r} for a random line, {c} to curate.',
    da: 'Tryk {slash} for at søge, {j} og {k} for at bevæge dig, {f} for fokus, {s} for at gemme et citat, {r} for en tilfældig linje, {c} for at kuratere.',
  },
  'index.footer.stats': { en: '{quotes} from {authors}.', da: '{quotes} fra {authors}.' },
  'index.authors.one': { en: '{n} author', da: '{n} forfatter' },
  'index.authors.many': { en: '{n} authors', da: '{n} forfattere' },

  'index.quote.favourite': { en: 'Keep this one', da: 'Gem denne' },
  'index.quote.favouriteOf': { en: 'Favourite this quote by {author}', da: 'Gem dette citat af {author}' },
  'index.quote.copy': { en: 'Copy the quote', da: 'Kopiér citatet' },
  'index.quote.copyLong': { en: 'Copy this quote', da: 'Kopiér dette citat' },
  'index.quote.permalink': { en: 'Copy a link to this quote', da: 'Kopiér et link til dette citat' },
  'index.quote.permalinkLong': { en: 'Copy a permanent link to this quote', da: 'Kopiér et permanent link til dette citat' },
  'index.quote.select': { en: 'Select this quote by {author} for removal', da: 'Vælg dette citat af {author} til fjernelse' },
  'index.quote.author': { en: 'Show everything by {author}', da: 'Vis alt af {author}' },

  // A quote filed from the site but not yet folded into the repository by the
  // sync. It is on the page immediately; the tag says why it is not in the file.
  'index.pending': { en: 'pending', da: 'afventer' },
  'index.pending.title': {
    en: 'Filed from the site. It joins data/quotes.json at the next sync.',
    da: 'Sendt fra siden. Den lander i data/quotes.json ved næste synkronisering.',
  },

  'index.fav.offline': {
    en: 'Kept on this device; it syncs when the connection is back',
    da: 'Gemt på denne enhed; den synkroniseres når forbindelsen er tilbage',
  },
  'index.fav.local': { en: 'Kept on this device', da: 'Gemt på denne enhed' },
  'index.fav.refused': {
    en: 'The collection service would not take that',
    da: 'Samlingens tjeneste ville ikke tage imod det',
  },

  'index.copied': { en: 'Quote copied', da: 'Citat kopieret' },
  'index.copyFailed': {
    en: 'Could not copy – select the text instead',
    da: 'Kunne ikke kopiere – markér teksten i stedet',
  },

  'index.focus.nothing': { en: 'Nothing to focus on', da: 'Intet at fokusere på' },
  'index.focus.position': { en: '{index} / {total}', da: '{index} / {total}' },
});
const ERA_LABELS = new Map(ERAS.map((era) => [era.id, era.label]));

/** Subjects read better capitalised in a menu than they do in the data. */
const sentenceCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const EDITIONS = ['paper', 'night', 'folio', 'index'];
const THEME_COLORS = { paper: '#f6efe4', night: '#14110d', folio: '#fbf7f0', index: '#eef0f3' };

/** Quotes below this many characters are set large, above it they are set small. */
const SHORT_QUOTE = 120;
const LONG_QUOTE = 320;

const el = (id) => document.getElementById(id);

const dom = {
  search: el('search'),
  author: el('filter-author'),
  work: el('filter-work'),
  subject: el('filter-subject'),
  era: el('filter-era'),
  sort: el('sort'),
  curate: el('toggle-curate'),
  curateBar: el('curate-bar'),
  curateCount: el('curate-count'),
  curateRemove: el('curate-remove'),
  curateClear: el('curate-clear'),
  favorites: el('toggle-favorites'),
  favoritesCount: el('favorites-count'),
  edition: el('edition'),
  activeFilters: el('active-filters'),
  summary: el('result-summary'),
  collection: el('collection'),
  empty: el('empty'),
  emptyDetail: el('empty-detail'),
  controls: el('controls'),
  footerStats: el('footer-stats'),
  toast: el('toast'),
  focus: el('focus'),
  focusQuote: el('focus-quote'),
  focusPosition: el('focus-position'),
  focusFavorite: el('focus-favorite'),
  openFocus: el('open-focus'),
  footerKeys: el('footer-keys'),
  controlsAdd: el('controls-add'),
};

const state = {
  all: [],
  /** The quotes as the repository has them, before pending ones are folded in. */
  filed: [],
  works: new Map(),
  visible: [],
  query: '',
  author: '',
  theme: '',
  tag: '',
  work: '',
  subject: '',
  era: '',
  sort: 'added',
  favoritesOnly: false,
  curating: false,
  seed: 1,
  cursor: -1,
  focusIndex: -1,
};

let favorites = new Set();
/** Quotes ticked for removal. Deliberately not persisted: a stale selection
 *  from last week is a worse thing to act on than an empty one. */
const selected = new Set();

/* ---------------------------------------------------------------------------
 * Small utilities
 * ------------------------------------------------------------------------- */

/**
 * Mulberry32. A seeded generator is what makes "Shuffle" shareable: the order
 * is carried in the URL, so a shuffled collection can be sent to someone else
 * and arrive in the same order it was in when the link was copied.
 */
function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Favourites now have two homes, and this page reads both.
 *
 * `store.favorites()` is the union of what the Worker knows and what this
 * browser has held in `quotes-favorites` since before the Worker existed, so
 * reading it is always right. Writing is the part that has to branch: when
 * editing is unlocked the star goes to the Worker and follows him to his
 * phone, and when it is not it stays in the old local key rather than failing.
 * A star that will not light is worse than a star only this device remembers.
 */
function readFavorites() {
  try {
    return storedFavorites();
  } catch {
    return new Set();
  }
}

function writeFavorites() {
  try {
    localStorage.setItem(STORAGE.favorites, JSON.stringify([...favorites]));
  } catch {
    /* Private browsing. Favourites simply will not persist; nothing else breaks. */
  }
}

/**
 * Toggle one quote's star.
 *
 * Optimistic: the state flips and the star fills before anything is sent, and
 * a refusal from the write path falls back to this device rather than undoing
 * what he just pressed. `setFavorite` rolls its own copy back when the key is
 * wrong or missing, so the local write happens *after* the await, not before.
 */
async function toggleFavorite(id) {
  const on = !favorites.has(id);
  if (on) favorites.add(id);
  else favorites.delete(id);
  paintFavorites();

  if (!isUnlocked()) {
    writeFavorites();
    return;
  }
  try {
    await setFavorite(id, on);
  } catch (error) {
    const code = error?.code;
    // `locked` here means the key stopped working, and the store has already
    // rolled its own copy back and told the page — which repainted the star
    // off. Re-apply what he actually pressed and keep it in the old local key:
    // a star that un-presses itself is a worse answer than a star this device
    // remembers on its own.
    if (code === 'locked' || code === 'offline' || code === 'unconfigured') {
      if (on) favorites.add(id);
      else favorites.delete(id);
      writeFavorites();
      paintFavorites();
      toast(t(code === 'offline' ? 'index.fav.offline' : 'index.fav.local'));
      return;
    }
    // Anything else is a refusal with a reason; the rollback stands.
    favorites = readFavorites();
    paintFavorites();
    toast(t('index.fav.refused'));
  }
}

/** Bring every star and the count in line with `favorites`, without a render. */
function paintFavorites() {
  for (const button of dom.collection.querySelectorAll('[data-action="favorite"]')) {
    const item = button.closest('.quote');
    if (item) button.setAttribute('aria-pressed', String(favorites.has(item.id)));
  }
  dom.favoritesCount.textContent = favorites.size ? String(favorites.size) : '';
  paintFocusFavorite();
}

let toastTimer;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.dataset.visible = 'false'; }, 2200);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    // Clipboard access is refused in some embedded browsers; fall back to a
    // selection the reader can copy themselves rather than failing silently.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px';
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy');
    area.remove();
    toast(ok ? label : t('index.copyFailed'));
  }
}

function svgIcon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  star: ['M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  link: ['M10.5 13.5a3.5 3.5 0 005 0l3-3a3.5 3.5 0 00-5-5l-1 1', 'M13.5 10.5a3.5 3.5 0 00-5 0l-3 3a3.5 3.5 0 005 5l1-1'],
};

const reducedMotion = () => (
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
);

/** One motion vocabulary across both pages: arriving settles, leaving accelerates. */
const ENTER_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const EXIT_EASE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';

/**
 * The star pop, shared with the shelf by keyframe name (`starPop`, `ringOut`
 * in app.css). Keeping one pair of keyframes rather than two is what stops a
 * star on the shelf and a star here from drifting into two different gestures.
 */
function popStar(button) {
  if (!button || reducedMotion()) return;
  button.classList.remove('is-popping');
  void button.offsetWidth;   // restart the animation on a second press
  button.classList.add('is-popping');
  const ring = document.createElement('span');
  ring.className = 'ring';
  ring.setAttribute('aria-hidden', 'true');
  button.append(ring);
  setTimeout(() => {
    ring.remove();
    button.classList.remove('is-popping');
  }, 460);
}

/* ---------------------------------------------------------------------------
 * URL as the single source of truth for a view
 * ------------------------------------------------------------------------- */

function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  state.query = params.get('q') ?? '';
  state.author = params.get('author') ?? '';
  state.theme = params.get('theme') ?? '';
  state.tag = params.get('tag') ?? '';
  state.work = params.get('work') ?? '';
  state.subject = params.get('subject') ?? '';
  state.era = params.get('era') ?? '';
  state.sort = params.get('sort') ?? 'added';
  state.favoritesOnly = params.get('fav') === '1';
  state.seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
}

function writeStateToUrl(replace = true) {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.author) params.set('author', state.author);
  if (state.theme) params.set('theme', state.theme);
  if (state.tag) params.set('tag', state.tag);
  if (state.work) params.set('work', state.work);
  if (state.subject) params.set('subject', state.subject);
  if (state.era) params.set('era', state.era);
  if (state.sort !== 'added') params.set('sort', state.sort);
  if (state.favoritesOnly) params.set('fav', '1');
  if (state.sort === 'random') params.set('seed', String(state.seed));

  const query = params.toString();
  const url = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

/* ---------------------------------------------------------------------------
 * Filtering and sorting
 * ------------------------------------------------------------------------- */

/**
 * Tokenised AND search across every field a reader might remember a quote by.
 * Each whitespace-separated term must appear somewhere, which makes "arendt
 * freedom" behave the way people expect without any query syntax to learn.
 */
function matchesQuery(quote, terms) {
  if (!terms.length) return true;
  return terms.every((term) => quote._haystack.includes(term));
}

function applyFilters() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  let list = state.all.filter((quote) => {
    if (state.author && quote._authorSlug !== state.author) return false;
    if (state.theme && !quote.themes.includes(state.theme)) return false;
    if (state.tag && !quote._tagSlugs.includes(state.tag)) return false;
    if (state.work && quote._workSlug !== state.work) return false;
    if (state.subject && quote._subject !== state.subject) return false;
    if (state.era && quote._era !== state.era) return false;
    if (state.favoritesOnly && !favorites.has(quote.id)) return false;
    return matchesQuery(quote, terms);
  });

  const byAuthor = (a, b) => a.author.localeCompare(b.author, 'en') || a.text.localeCompare(b.text, 'en');

  const sorters = {
    added: (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || byAuthor(a, b),
    oldest: (a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? '') || byAuthor(a, b),
    author: byAuthor,
    work: (a, b) => (a.work ?? '￿').localeCompare(b.work ?? '￿', 'en') || byAuthor(a, b),
    // Undated works sort last rather than pretending to be from year zero.
    // `_year` falls back to the work's date, so a Goodreads import with no
    // year of its own still lands in the right century.
    year: (a, b) => (a._year ?? Infinity) - (b._year ?? Infinity) || byAuthor(a, b),
    length: (a, b) => a.text.length - b.text.length,
  };

  if (state.sort === 'random') {
    const random = seededRandom(state.seed);
    list = list
      .map((quote) => ({ quote, key: random() }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.quote);
  } else {
    list.sort(sorters[state.sort] ?? sorters.added);
  }

  state.visible = list;
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------- */

/**
 * Append text to a node, wrapping matches of the current search terms in
 * <mark>. Built from text nodes rather than innerHTML so that a quotation
 * containing angle brackets stays a quotation.
 */
function appendHighlighted(parent, text, terms) {
  if (!terms.length) {
    parent.append(text);
    return;
  }
  // Quotation marks are curled for display, so a term typed with a straight
  // apostrophe still has to match the curly one on screen.
  const escape = (term) => term
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/['\u2018\u2019]/g, "['\u2018\u2019]")
    .replace(/["\u201c\u201d]/g, '["\u201c\u201d]');
  const pattern = new RegExp(`(${terms.map(escape).join('|')})`, 'gi');
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    parent.append(mark);
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function lengthClass(text) {
  if (text.length <= SHORT_QUOTE) return 'short';
  if (text.length >= LONG_QUOTE) return 'long';
  return 'medium';
}

/**
 * A finer grade, used only by focus mode.
 *
 * The list can live with three bands because every quote there is set near
 * reading size. Focus sets one quotation as large as it will go, and there the
 * difference between forty characters and a hundred and sixty is the difference
 * between a title and a paragraph. Three bands put both at the same size.
 */
const FOCUS_SCALES = [[60, 'xs'], [120, 's'], [200, 'm'], [320, 'l']];
function focusScale(text) {
  return FOCUS_SCALES.find(([limit]) => text.length <= limit)?.[1] ?? 'xl';
}

function buildAttribution(quote, { linked = true } = {}) {
  const attribution = document.createElement('figcaption');
  attribution.className = 'attribution';

  const author = document.createElement(linked ? 'a' : 'span');
  author.className = 'attribution-author';
  author.textContent = quote.author;
  if (linked) {
    author.href = `?author=${encodeURIComponent(quote._authorSlug)}`;
    author.title = t('index.quote.author', { author: quote.author });
  }
  attribution.append(author);

  if (quote.work) {
    const work = document.createElement(linked ? 'a' : 'span');
    work.className = 'attribution-work';
    work.textContent = quote.work;
    if (linked) {
      work.href = `?work=${encodeURIComponent(quote._workSlug)}`;
      work.style.textDecoration = 'none';
    }
    attribution.append(work);
  }

  const shown = quote.year ?? quote._year;
  if (shown) {
    const year = document.createElement('span');
    year.className = 'attribution-year';
    // Negative years are BC. Printing "-350" would be a bug that reads as a
    // typo, and the collection goes back to Sun Tzu.
    year.textContent = shown < 0 ? `${Math.abs(shown)} BC` : String(shown);
    attribution.append(year);
  }

  return attribution;
}

function buildQuote(quote, terms) {
  const item = document.createElement('li');
  item.className = 'quote';
  item.id = quote.id;
  item.dataset.length = lengthClass(quote.text);
  if (quote._pending) item.dataset.pending = 'true';

  const figure = document.createElement('figure');
  figure.style.margin = '0';

  const blockquote = document.createElement('blockquote');
  blockquote.className = 'quote-text';
  blockquote.style.margin = '0';
  if (quote.lang && quote.lang !== 'en') blockquote.lang = quote.lang;
  appendHighlighted(blockquote, typographic(quote.text), terms);
  figure.append(blockquote, buildAttribution(quote));

  if (quote.note) {
    const note = document.createElement('p');
    note.className = 'quote-note';
    note.textContent = typographic(quote.note);
    figure.append(note);
  }

  const meta = document.createElement('div');
  meta.className = 'quote-meta';

  for (const theme of quote.themes ?? []) {
    const link = document.createElement('a');
    link.className = 'tag';
    link.href = `?theme=${encodeURIComponent(theme)}`;
    link.textContent = theme;
    meta.append(link);
  }

  // A quote he filed from the site is on the page before the repository has
  // it. The tag is quiet on purpose: it is a note about the plumbing, not a
  // judgement on the quotation.
  if (quote._pending) {
    const pending = document.createElement('span');
    pending.className = 'pending-tag';
    pending.textContent = t('index.pending');
    pending.title = t('index.pending.title');
    meta.append(pending);
  }

  const status = quote.verification?.status ?? 'unverified';
  if (status !== 'verified' && !quote._pending) {
    const verify = document.createElement('span');
    verify.className = 'verify';
    verify.dataset.status = status;
    verify.textContent = VERIFICATION_LABELS[status]?.short ?? status;
    verify.title = [VERIFICATION_LABELS[status]?.long, quote.verification?.note]
      .filter(Boolean)
      .join(' ');
    meta.append(verify);
  }

  const actions = document.createElement('div');
  actions.className = 'quote-actions';

  const favorite = document.createElement('button');
  favorite.className = 'icon-button';
  favorite.type = 'button';
  favorite.dataset.action = 'favorite';
  favorite.setAttribute('aria-pressed', String(favorites.has(quote.id)));
  favorite.title = t('index.quote.favourite');
  favorite.append(svgIcon(ICONS.star));
  favorite.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: t('index.quote.favouriteOf', { author: quote.author }),
  }));

  const copy = document.createElement('button');
  copy.className = 'icon-button';
  copy.type = 'button';
  copy.dataset.action = 'copy';
  copy.title = t('index.quote.copy');
  copy.append(svgIcon(ICONS.copy));
  copy.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: t('index.quote.copyLong'),
  }));

  const permalink = document.createElement('a');
  permalink.className = 'icon-button';
  permalink.href = `#${quote.id}`;
  permalink.dataset.action = 'permalink';
  permalink.title = t('index.quote.permalink');
  permalink.append(svgIcon(ICONS.link));
  permalink.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: t('index.quote.permalinkLong'),
  }));

  actions.append(favorite, copy, permalink);
  meta.append(actions);
  figure.append(meta);
  item.append(figure);
  if (state.curating) item.append(buildCurateRow(quote));
  return item;
}

/**
 * The edit and remove row, shown only in curate mode.
 *
 * Both controls are ordinary links to a prefilled GitHub issue rather than
 * anything that writes: this is a static site with no server, so the only
 * honest way to change the data is to hand the change to the workflow that
 * owns it. That constraint turns out to be a feature — every deletion leaves
 * a dated record of what was removed and why, which is not true of a button
 * that quietly rewrites a file.
 */
function buildCurateRow(quote) {
  const row = document.createElement('div');
  row.className = 'quote-curate';

  const label = document.createElement('label');
  label.className = 'curate-select';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.action = 'select';
  box.checked = selected.has(quote.id);
  box.setAttribute('aria-label', t('index.quote.select', { author: quote.author }));
  label.append(box, document.createTextNode(t('index.curate.removeThis')));

  const edit = document.createElement('a');
  edit.className = 'curate-link';
  edit.textContent = t('index.curate.edit');
  edit.rel = 'noopener';
  edit.target = '_blank';
  edit.href = editIssueUrl(quote);

  const id = document.createElement('code');
  id.className = 'curate-id';
  id.textContent = quote.id;

  row.append(label, edit, id);
  return row;
}

/** A prefilled "correct this quote" issue, carrying what the record says now. */
function editIssueUrl(quote) {
  const params = new URLSearchParams({
    template: 'edit-quote.yml',
    title: `Edit ${quote.id}`,
    id: quote.id,
    text: quote.text,
    author: quote.author,
    work: quote.work ?? '',
    year: quote._year ? String(quote._year) : '',
  });
  return `${REPO}/issues/new?${params}`;
}

/** A prefilled "remove these" issue for everything currently ticked. */
function removeIssueUrl(ids) {
  const lines = ids.map((id) => {
    const quote = state.all.find((candidate) => candidate.id === id);
    return quote ? `${id}  ${quote.author}: ${quote.text.slice(0, 70)}` : id;
  });
  const params = new URLSearchParams({
    template: 'remove-quote.yml',
    title: ids.length === 1 ? `Remove ${ids[0]}` : `Remove ${ids.length} quotes`,
    ids: ids.join('\n'),
    context: lines.join('\n'),
  });
  return `${REPO}/issues/new?${params}`;
}

/** "239 quotes" / "239 citater" — the number and its word, in one place. */
const fmtNumber = (count) => count.toLocaleString(locale());
const countQuotes = (count) => t(count === 1 ? 'index.count.one' : 'index.count.many', { n: fmtNumber(count) });
const countAuthors = (count) => t(count === 1 ? 'index.authors.one' : 'index.authors.many', { n: fmtNumber(count) });

function renderActiveFilters() {
  const chips = [];
  if (state.author) {
    const match = state.all.find((quote) => quote._authorSlug === state.author);
    chips.push(['author', match ? match.author : state.author]);
  }
  if (state.work) {
    const match = state.all.find((quote) => quote._workSlug === state.work);
    chips.push(['work', match?.work ?? state.work]);
  }
  if (state.subject) chips.push(['subject', sentenceCase(state.subject)]);
  if (state.era) chips.push(['era', ERA_LABELS.get(state.era) ?? state.era]);
  if (state.theme) chips.push(['theme', state.theme]);
  if (state.tag) chips.push(['tag', state.tag]);
  if (state.favoritesOnly) chips.push(['fav', t('index.chip.favourites')]);
  if (state.query) chips.push(['q', `“${state.query}”`]);

  dom.activeFilters.replaceChildren();
  dom.activeFilters.hidden = chips.length === 0;
  if (!chips.length) return;

  dom.activeFilters.append(t('index.showing'));
  for (const [key, label] of chips) {
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.type = 'button';
    chip.dataset.clear = key;
    chip.textContent = label;
    chip.setAttribute('aria-label', t('index.filterOff', { key }));
    dom.activeFilters.append(chip);
  }
  const clearAll = document.createElement('button');
  clearAll.className = 'pill';
  clearAll.type = 'button';
  clearAll.dataset.clear = 'all';
  clearAll.textContent = t('index.clearAll');
  dom.activeFilters.append(clearAll);
}

function render() {
  applyFilters();
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  const fragment = document.createDocumentFragment();
  for (const quote of state.visible) fragment.append(buildQuote(quote, terms));
  dom.collection.replaceChildren(fragment);

  const total = state.all.length;
  const shown = state.visible.length;
  dom.summary.textContent = shown === total
    ? countQuotes(total)
    : t('index.summary.some', { shown: fmtNumber(shown), total: countQuotes(total) });

  dom.empty.hidden = shown > 0;
  if (!shown) {
    dom.emptyDetail.textContent = total === 0
      ? t('index.empty.none')
      : t('index.empty.filtered');
  }

  dom.favoritesCount.textContent = favorites.size ? String(favorites.size) : '';
  dom.favorites.setAttribute('aria-pressed', String(state.favoritesOnly));
  renderActiveFilters();
  renderCurateBar();
  highlightTarget();
}

function highlightTarget() {
  const id = location.hash.slice(1);
  for (const node of dom.collection.querySelectorAll('.quote[data-targeted]')) {
    delete node.dataset.targeted;
  }
  if (!id) return;
  const node = document.getElementById(id);
  if (node?.classList.contains('quote')) node.dataset.targeted = 'true';
}

function populateFilterOptions() {
  const authors = new Map();
  const works = new Map();
  const subjects = new Map();
  const eras = new Map();

  const bump = (map, key, label) => {
    if (!key) return;
    const entry = map.get(key) ?? { label, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  };

  for (const quote of state.all) {
    bump(authors, quote._authorSlug, quote.author);
    bump(works, quote._workSlug, quote.work);
    bump(subjects, quote._subject, sentenceCase(quote._subject || ''));
    bump(eras, quote._era, ERA_LABELS.get(quote._era) ?? quote._era);
  }

  const byCount = (a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, 'en');
  // Subtitles are what make a title unrecognisable in a narrow menu, and they
  // are never the part you are looking for. The full title stays as the option's
  // tooltip and everywhere else on the page.
  const shorten = (label) => (label.length > 42 ? `${label.slice(0, 41).trimEnd()}…` : label);
  const fill = (select, map, sorter = byCount) => {
    for (const [value, { label, count }] of [...map.entries()].sort(sorter)) {
      const option = new Option(`${shorten(label)} (${count})`, value);
      if (label.length > 42) option.title = label;
      select.append(option);
    }
  };

  fill(dom.author, authors);
  fill(dom.work, works);
  fill(dom.subject, subjects);
  // Eras read as a timeline, not a leaderboard: Antiquity before Contemporary
  // regardless of which one the collection happens to hold more of.
  const order = ERAS.map((era) => era.id);
  fill(dom.era, eras, (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

/**
 * The words inside a `<select>`.
 *
 * `hydrate()` cannot reach them: an `<option>`'s label is its text, and the
 * filter menus are half data (author names, which are never translated) and
 * half interface ("All authors", which is). So the option labels that belong
 * to the interface are written here, by value, and rewritten on every
 * language change with the selection left exactly where it was.
 */
function relabelSelects() {
  const heads = [
    [dom.author, 'index.filter.author.all'],
    [dom.work, 'index.filter.work.all'],
    [dom.subject, 'index.filter.subject.all'],
    [dom.era, 'index.filter.era.all'],
  ];
  for (const [select, id] of heads) {
    const first = select?.options?.[0];
    if (first && first.value === '') first.textContent = t(id);
  }

  const relabel = (select, prefix) => {
    if (!select) return;
    const chosen = select.value;
    for (const option of select.options) option.textContent = t(`${prefix}.${option.value}`);
    select.value = chosen;
  };
  relabel(dom.sort, 'index.sort');
  relabel(dom.edition, 'edition');
}

/* ---------------------------------------------------------------------------
 * Focus mode
 * ------------------------------------------------------------------------- */

function openFocus(index = 0) {
  if (!state.visible.length) {
    toast(t('index.focus.nothing'));
    return;
  }
  state.focusIndex = Math.max(0, Math.min(index, state.visible.length - 1));
  dom.focus.hidden = false;
  document.body.style.overflow = 'hidden';
  renderFocus();
  el('close-focus').focus();
}

function closeFocus() {
  dom.focus.hidden = true;
  document.body.style.overflow = '';
  const current = state.visible[state.focusIndex];
  if (current) {
    document.getElementById(current.id)?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  dom.openFocus.focus();
}

function renderFocus() {
  const quote = state.visible[state.focusIndex];
  if (!quote) return;

  dom.focusQuote.dataset.length = lengthClass(quote.text);
  dom.focusQuote.dataset.scale = focusScale(quote.text);
  const blockquote = document.createElement('blockquote');
  blockquote.className = 'quote-text';
  blockquote.style.margin = '0';
  if (quote.lang && quote.lang !== 'en') blockquote.lang = quote.lang;
  blockquote.textContent = typographic(quote.text);

  dom.focusQuote.replaceChildren(blockquote, buildAttribution(quote, { linked: false }));
  dom.focusPosition.textContent = t('index.focus.position', {
    index: fmtNumber(state.focusIndex + 1),
    total: fmtNumber(state.visible.length),
  });
  paintFocusFavorite();
}

/** The star in the focus bar shows the same state the list's star does. */
function paintFocusFavorite() {
  const button = dom.focusFavorite;
  if (!button) return;
  const quote = state.visible[state.focusIndex];
  const on = Boolean(quote && favorites.has(quote.id));
  button.setAttribute('aria-pressed', String(on));
  const label = button.querySelector('.focus-fav-label');
  if (label) label.textContent = t(on ? 'ui.unfavourite' : 'ui.favourite');
}

function toggleFocusFavorite() {
  const quote = state.visible[state.focusIndex];
  if (!quote) return;
  popStar(dom.focusFavorite);
  toggleFavorite(quote.id);
}

function stepFocus(delta) {
  if (!state.visible.length) return;
  const count = state.visible.length;
  slideFocus(delta, () => {
    state.focusIndex = (state.focusIndex + delta + count) % count;
    renderFocus();
  });
}

/**
 * Next and previous move along the direction of travel: the quotation he has
 * finished leaves the way he is going, the next one arrives from behind it.
 * Two animations rather than one crossfade, because a crossfade of two
 * paragraphs at reading size is unreadable for its whole duration.
 *
 * The outgoing animation holds its last frame (`fill: 'forwards'`) so the old
 * words never flash back at full opacity between the two halves, and it is
 * cancelled the instant the incoming one starts, so nothing stays resident.
 *
 * The swap is driven by whichever comes first, the animation finishing or a
 * plain timer. An animation timeline only advances while the browser is
 * painting frames, and a browser that has stopped painting — a background tab,
 * a window dragged off-screen, a headless renderer between screenshots — would
 * otherwise leave the quotation stuck half-faded and the arrow keys dead. The
 * words moving is the feature; the slide is decoration on top of it.
 */
const SLIDE_OUT_MS = 260;
const SLIDE_IN_MS = 380;

function slideFocus(direction, paint) {
  const figure = dom.focusQuote;
  if (!figure || reducedMotion() || typeof figure.animate !== 'function') {
    paint();
    return;
  }
  const away = direction > 0 ? -24 : 24;
  figure.dataset.stepping = direction > 0 ? 'next' : 'previous';

  const out = figure.animate(
    [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${away}px)` }],
    { duration: SLIDE_OUT_MS, easing: EXIT_EASE, fill: 'forwards' },
  );

  let swapped = false;
  const arrive = () => {
    if (swapped) return;
    swapped = true;
    paint();
    const back = figure.animate(
      [{ opacity: 0, transform: `translateX(${-away}px)` }, { opacity: 1, transform: 'translateX(0)' }],
      { duration: SLIDE_IN_MS, easing: ENTER_EASE, fill: 'none' },
    );
    try { out.cancel(); } catch { /* already gone */ }

    const settle = () => {
      delete figure.dataset.stepping;
      // fill: 'none' leaves nothing behind once it finishes; cancelling only
      // matters for the stalled case, where it would otherwise sit there.
      try { if (back.playState !== 'finished') back.cancel(); } catch { /* already gone */ }
    };
    back.finished.then(settle, settle);
    setTimeout(settle, SLIDE_IN_MS + 220);
  };

  out.finished.then(arrive, arrive);
  setTimeout(arrive, SLIDE_OUT_MS + 40);
}

/* ---------------------------------------------------------------------------
 * Reading cursor for J / K
 * ------------------------------------------------------------------------- */

function moveCursor(delta) {
  if (!state.visible.length) return;
  state.cursor = Math.max(0, Math.min(state.cursor + delta, state.visible.length - 1));
  const quote = state.visible[state.cursor];
  const node = document.getElementById(quote.id);
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  for (const other of dom.collection.querySelectorAll('.quote[data-targeted]')) {
    delete other.dataset.targeted;
  }
  if (node) node.dataset.targeted = 'true';
}

function randomQuote() {
  if (!state.visible.length) return;
  state.cursor = Math.floor(Math.random() * state.visible.length);
  moveCursor(0);
}

/* ---------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------- */

/**
 * Curate mode.
 *
 * Off by default, and deliberately not remembered between visits. The page's
 * whole argument is that the writing should be the only thing on it, so the
 * machinery for changing the collection stays out of sight until it is asked
 * for, and goes away again on the next visit.
 */
function setCurating(on) {
  state.curating = Boolean(on);
  document.body.dataset.curate = String(state.curating);
  dom.curate.setAttribute('aria-pressed', String(state.curating));
  dom.curateBar.hidden = !state.curating;
  if (!state.curating) selected.clear();
  render();
}

function renderCurateBar() {
  const count = selected.size;
  dom.curateCount.textContent = count
    ? t('index.curate.selected', { n: countQuotes(count) })
    : t('index.curate.none');
  dom.curateRemove.disabled = count === 0;
  dom.curateClear.disabled = count === 0;
  dom.curateRemove.textContent = count > 1
    ? t('index.curate.removeN', { n: fmtNumber(count) })
    : t('index.curate.remove');
}

function setEdition(edition) {
  const value = EDITIONS.includes(edition) ? edition : 'paper';
  document.documentElement.dataset.edition = value;
  dom.edition.value = value;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[value]);
  try { localStorage.setItem(STORAGE.edition, value); } catch { /* not fatal */ }
}

function update({ push = false } = {}) {
  writeStateToUrl(!push);
  render();
}

let searchTimer;
function wireControls() {
  dom.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = dom.search.value.trim();
      state.cursor = -1;
      update();
    }, 110);
  });

  for (const [key, select] of [['author', dom.author], ['work', dom.work],
    ['subject', dom.subject], ['era', dom.era]]) {
    select.addEventListener('change', () => { state[key] = select.value; update(); });
  }
  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    if (state.sort === 'random') state.seed = Math.floor(Math.random() * 1e9);
    update();
  });
  dom.edition.addEventListener('change', () => setEdition(dom.edition.value));

  // The header's paper/night toggle writes the same key this select reads, so
  // the two controls have to agree without either one owning the other.
  document.addEventListener('quotes:edition', (event) => {
    const value = event?.detail?.edition;
    if (value && dom.edition.value !== value) dom.edition.value = value;
  });

  dom.favorites.addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    update();
  });

  dom.curate.addEventListener('click', () => setCurating(!state.curating));
  dom.curateClear.addEventListener('click', () => { selected.clear(); render(); });
  dom.curateRemove.addEventListener('click', () => {
    if (!selected.size) return;
    window.open(removeIssueUrl([...selected]), '_blank', 'noopener');
    toast(t('index.curate.opened', { n: countQuotes(selected.size) }));
  });

  dom.openFocus.addEventListener('click', () => openFocus(Math.max(0, state.cursor)));
  el('close-focus').addEventListener('click', closeFocus);
  el('focus-prev').addEventListener('click', () => stepFocus(-1));
  el('focus-next').addEventListener('click', () => stepFocus(1));
  el('focus-shuffle').addEventListener('click', () => {
    state.focusIndex = Math.floor(Math.random() * state.visible.length);
    renderFocus();
  });
  if (dom.focusFavorite) {
    dom.focusFavorite.prepend(svgIcon(ICONS.star));
    dom.focusFavorite.addEventListener('click', toggleFocusFavorite);
  }

  // The small "+ Add" beside the shelf pill speaks the same event the header's
  // does, so add-quote.js is the only thing that knows what adding looks like.
  dom.controlsAdd?.addEventListener('click', () => {
    const event = new CustomEvent('quotes:add', { cancelable: true, bubbles: true });
    document.dispatchEvent(event);
    if (!event.defaultPrevented) {
      window.open(`${REPO}/issues/new?template=add-quote.yml`, '_blank', 'noopener');
    }
  });

  dom.activeFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    const key = button.dataset.clear;
    if (key === 'all') {
      Object.assign(state, {
        query: '', author: '', theme: '', tag: '', work: '', subject: '', era: '',
        favoritesOnly: false,
      });
      dom.search.value = '';
    } else if (key === 'q') {
      state.query = '';
      dom.search.value = '';
    } else if (key === 'fav') {
      state.favoritesOnly = false;
    } else {
      state[key] = '';
    }
    syncControlsFromState();
    update({ push: true });
  });

  // Delegated so that re-rendering the list never has to rebind anything.
  dom.collection.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    const item = event.target.closest('.quote');
    if (!action || !item) return;
    const quote = state.all.find((candidate) => candidate.id === item.id);
    if (!quote) return;

    if (action.dataset.action === 'select') {
      if (action.checked) selected.add(quote.id);
      else selected.delete(quote.id);
      item.dataset.selected = String(action.checked);
      renderCurateBar();
      return;
    }

    if (action.dataset.action === 'favorite') {
      popStar(action);
      toggleFavorite(quote.id);
      // Re-rendering while looking at "favourites only" is the one case where
      // the list itself has to change; everywhere else the star repaints in
      // place, which is what lets the pop finish playing.
      if (state.favoritesOnly) setTimeout(() => render(), 360);
      return;
    }

    if (action.dataset.action === 'copy') {
      event.preventDefault();
      const attribution = [quote.author, quote.work].filter(Boolean).join(', ');
      copyText(`“${typographic(quote.text)}”\n— ${attribution}`, t('index.copied'));
      return;
    }

    if (action.dataset.action === 'permalink') {
      event.preventDefault();
      const url = new URL(location.href);
      url.search = '';
      url.hash = quote.id;
      copyText(url.toString(), t('ui.linkCopied'));
      history.replaceState(null, '', `#${quote.id}`);
      highlightTarget();
    }
  });

  // Internal filter links navigate without a page load.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="?"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const params = new URLSearchParams(link.getAttribute('href').slice(1));
    Object.assign(state, {
      author: params.get('author') ?? '',
      theme: params.get('theme') ?? '',
      tag: params.get('tag') ?? '',
      work: params.get('work') ?? '',
      subject: params.get('subject') ?? '',
      era: params.get('era') ?? '',
    });
    syncControlsFromState();
    update({ push: true });
    window.scrollTo({ top: dom.controls.offsetTop, behavior: 'smooth' });
  });

  window.addEventListener('popstate', () => {
    readStateFromUrl();
    syncControlsFromState();
    render();
  });

  window.addEventListener('hashchange', highlightTarget);

  const sentinel = document.createElement('div');
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => {
    dom.controls.dataset.lifted = String(!entry.isIntersecting);
  }).observe(sentinel);

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

    if (event.key === 'Escape') {
      if (!dom.focus.hidden) { closeFocus(); return; }
      if (typing) { event.target.blur(); return; }
      if (state.query) {
        state.query = '';
        dom.search.value = '';
        update();
      }
      return;
    }

    if (!dom.focus.hidden) {
      if (event.key === 'ArrowRight' || event.key === 'j' || event.key === ' ') {
        event.preventDefault();
        stepFocus(1);
      }
      if (event.key === 'ArrowLeft' || event.key === 'k') {
        event.preventDefault();
        stepFocus(-1);
      }
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        toggleFocusFavorite();
      }
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '/') { event.preventDefault(); dom.search.focus(); dom.search.select(); }
    else if (event.key === 'j') { event.preventDefault(); moveCursor(1); }
    else if (event.key === 'k') { event.preventDefault(); moveCursor(-1); }
    else if (event.key === 'f') { event.preventDefault(); openFocus(Math.max(0, state.cursor)); }
    else if (event.key === 'r') { event.preventDefault(); randomQuote(); }
    else if (event.key === 'c') { event.preventDefault(); setCurating(!state.curating); }
  });
}

function syncControlsFromState() {
  dom.search.value = state.query;
  dom.sort.value = state.sort;
  // A filter for a value that is not in the data leaves its select showing
  // "All", so fall the state back to match what is actually displayed rather
  // than filtering by something the reader cannot see or clear.
  for (const [key, select] of [['author', dom.author], ['work', dom.work],
    ['subject', dom.subject], ['era', dom.era]]) {
    select.value = state[key];
    if (select.value !== state[key]) state[key] = select.value;
  }
}

/**
 * Precompute the search haystack and the slugs used for filtering.
 *
 * Done once at load rather than per keystroke: with several hundred quotes and
 * a search that fires on every input event, rebuilding these strings each time
 * is the difference between instant and laggy on a phone.
 */
function prepare(quotes, works) {
  return quotes.map((quote) => {
    const tagSlugs = (quote.tags ?? []).map(slug);
    // Subject and era are properties of the work, looked up rather than
    // stored on the quote: one classification per book cannot drift out of
    // step with itself the way several hundred per-quote labels can, and the
    // year a work was written is a better era signal than the year a line
    // from it happens to carry.
    const record = quote.work ? works.get(quote.work) : null;
    const year = quote.year ?? record?.year ?? null;
    return {
      ...quote,
      themes: quote.themes ?? [],
      tags: quote.tags ?? [],
      _authorSlug: slug(quote.author),
      _workSlug: quote.work ? slug(quote.work) : '',
      _subject: record?.subject ?? '',
      _era: eraFor(year) ?? '',
      _year: year,
      _tagSlugs: tagSlugs,
      // Joined with a newline: search terms are split on whitespace, so no term
      // can ever span two fields, and the separator stays a character nobody
      // can type into the box.
      _haystack: [quote.text, quote.author, quote.work ?? '', quote.note ?? '',
        ...(quote.tags ?? []), ...(quote.themes ?? [])].join('\n').toLowerCase(),
    };
  });
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    // Rendering with a useful message beats a blank page.
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------------------------
 * Quotes filed from the site
 *
 * A quote he adds in the browser is in the Worker's pending list within a
 * second and in `data/quotes.json` at the next sync, which may be hours away.
 * Waiting for the file would make the button feel broken, so the pending ones
 * are folded into the list here and marked, and drop out again by identity the
 * moment the repository copy arrives.
 * ------------------------------------------------------------------------- */

let pendingKey = '';

function withPending(filed) {
  const pending = shelfState().pending ?? [];
  if (!pending.length) return filed;

  const known = new Set(filed.map((quote) => quote.id));
  const extra = [];
  for (const entry of pending) {
    const payload = entry?.payload;
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) continue;
    // Identity, not the Worker's row id: once the sync has written the quote
    // into the repository the two records are the same quotation, and only the
    // filed one should be on the page.
    const id = quoteId(payload.text);
    if (known.has(id)) continue;
    known.add(id);
    extra.push({
      id,
      text: payload.text,
      author: payload.author || '',
      work: payload.work || null,
      year: payload.year ?? null,
      note: payload.note || null,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      themes: [],
      addedAt: entry.createdAt ?? new Date().toISOString(),
      verification: { status: 'unverified' },
      _pending: true,
    });
  }
  return extra.length ? [...prepare(extra, state.works), ...filed] : filed;
}

/** Returns true when the pending list actually changed, so render() is rare. */
function refreshPending() {
  const next = (shelfState().pending ?? []).map((entry) => entry?.id ?? '').join(',');
  if (next === pendingKey) return false;
  pendingKey = next;
  state.all = withPending(state.filed);
  return true;
}

function syncFromStore() {
  favorites = readFavorites();
  if (refreshPending()) {
    populateFilterOptions();
    relabelSelects();
    render();
    renderFooter();
    return;
  }
  paintFavorites();
}

/* ---------------------------------------------------------------------------
 * The footer, the header, and the language
 * ------------------------------------------------------------------------- */

function renderFooter() {
  const authors = new Set(state.all.map((quote) => quote.author)).size;
  dom.footerStats.textContent = state.all.length
    ? t('index.footer.stats', {
      quotes: countQuotes(state.all.length),
      authors: countAuthors(authors),
    })
    : '';
  renderFooterKeys();
}

/**
 * "Press / to search, J and K to move…" with real `<kbd>` keys.
 *
 * Built from a pattern rather than marked up in the HTML, because the Danish
 * sentence puts the keys in different places and `hydrate()` would have to
 * replace the whole line — keys and all — to translate it.
 */
const FOOTER_KEYS = { slash: '/', j: 'J', k: 'K', f: 'F', s: 'S', r: 'R', c: 'C' };
function renderFooterKeys() {
  if (!dom.footerKeys) return;
  const pattern = t('index.footer.keys');
  dom.footerKeys.replaceChildren();
  let last = 0;
  for (const match of pattern.matchAll(/\{(\w+)\}/g)) {
    if (match.index > last) dom.footerKeys.append(pattern.slice(last, match.index));
    const key = document.createElement('kbd');
    key.textContent = FOOTER_KEYS[match[1]] ?? match[1];
    dom.footerKeys.append(key);
    last = match.index + match[0].length;
  }
  if (last < pattern.length) dom.footerKeys.append(pattern.slice(last));
}

/**
 * The shared header.
 *
 * Imported dynamically and allowed to fail: `assets/nav.js` belongs to the
 * shelf, and a collection page that cannot render because the header is not
 * there yet would be a bad trade. If the header did not arrive, the language
 * toggle it carries is put in the control row instead, so the page is never
 * left without a way to switch.
 */
async function mountHeader() {
  try {
    const nav = await import('./nav.js');
    nav.mountNav?.({ active: 'quotes', variant: 'row' });
  } catch {
    /* No shared header yet. */
  }
  if (!document.querySelector('.lang-toggle')) {
    const button = langToggle();
    if (button) dom.edition?.parentElement?.append(button);
  }
  hydrate(document);
  keepToolsClear();
  window.addEventListener('resize', keepToolsClear, { passive: true });
  document.fonts?.ready?.then(keepToolsClear).catch(() => {});
}

/**
 * Keep the header's two toggles off its pills.
 *
 * In the row variant the DA/EN and light/dark buttons are positioned out of
 * the flow so they can sit at the top right, which is right at a desk and
 * wrong on a phone: the pills wrap towards them and the last one ends up
 * underneath. This measures instead of assuming a breakpoint, so it corrects
 * a real collision and does nothing at all when there is none — including if
 * the header is later laid out differently.
 */
function keepToolsClear() {
  const header = document.getElementById('site-nav');
  const tools = header?.querySelector('.nav-tools');
  const links = header?.querySelector('.nav-links');
  if (!header || !tools || !links) return;

  header.style.paddingTop = '';
  const bar = tools.getBoundingClientRect();
  const row = links.getBoundingClientRect();
  const overlaps = bar.left < row.right && bar.right > row.left
    && bar.top < row.bottom && bar.bottom > row.top;
  if (overlaps) header.style.paddingTop = `${Math.ceil(bar.height + 14)}px`;
}

async function init() {
  favorites = readFavorites();
  setEdition(localStorage.getItem(STORAGE.edition) ?? document.documentElement.dataset.edition);
  readStateFromUrl();
  relabelSelects();
  hydrate(document);
  mountHeader();

  // The registry is loaded alongside the quotes but is not required: if it
  // fails, subject and era simply have nothing to offer and the rest of the
  // page is unaffected.
  const [collection, registry] = await Promise.all([
    loadJson(DATA_URL, { quotes: [] }),
    loadJson(WORKS_URL, { works: [] }),
  ]);

  state.works = new Map((registry.works ?? []).map((work) => [work.title, work]));
  state.filed = prepare(collection.quotes ?? [], state.works);
  state.all = state.filed;
  refreshPending();
  populateFilterOptions();
  relabelSelects();
  syncControlsFromState();
  wireControls();
  render();
  renderFooter();

  onLang(() => {
    relabelSelects();
    render();
    renderFooter();
    if (!dom.focus.hidden) renderFocus();
  });

  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    highlightTarget();
  }

  // The Worker's state lands after the page is already readable: favourites
  // made on his phone appear, and so does anything he filed and has not synced.
  onChange(syncFromStore);
  loadState().then(syncFromStore).catch(() => {});
}

init();
