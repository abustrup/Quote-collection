/**
 * The reading experience.
 *
 * Everything here serves one goal: put the words on the screen and get out of
 * the way. Chrome is hidden until asked for, state lives in the URL so any view
 * can be shared, and nothing animates that does not need to.
 */

import { VERIFICATION_LABELS, slug, typographic } from './quote-core.js';

const DATA_URL = 'data/quotes.json';
const STORAGE = {
  edition: 'quotes-edition',
  favorites: 'quotes-favorites',
};
const EDITIONS = ['paper', 'night', 'folio', 'index'];
const THEME_COLORS = { paper: '#f6efe4', night: '#14110d', folio: '#fbf7f0', index: '#eef0f3' };

/** Quotes below this many characters are set large, above it they are set small. */
const SHORT_QUOTE = 120;
const LONG_QUOTE = 320;

const el = (id) => document.getElementById(id);

const dom = {
  search: el('search'),
  author: el('filter-author'),
  theme: el('filter-theme'),
  sort: el('sort'),
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
  openFocus: el('open-focus'),
};

const state = {
  all: [],
  visible: [],
  query: '',
  author: '',
  theme: '',
  tag: '',
  work: '',
  sort: 'added',
  favoritesOnly: false,
  seed: 1,
  cursor: -1,
  focusIndex: -1,
};

let favorites = new Set();

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

function readFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE.favorites) ?? '[]');
    return new Set(Array.isArray(raw) ? raw : []);
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
    toast(ok ? label : 'Could not copy — select the text instead');
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
    year: (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || byAuthor(a, b),
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

function buildAttribution(quote, { linked = true } = {}) {
  const attribution = document.createElement('figcaption');
  attribution.className = 'attribution';

  const author = document.createElement(linked ? 'a' : 'span');
  author.className = 'attribution-author';
  author.textContent = quote.author;
  if (linked) {
    author.href = `?author=${encodeURIComponent(quote._authorSlug)}`;
    author.title = `Show everything by ${quote.author}`;
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

  if (quote.year) {
    const year = document.createElement('span');
    year.className = 'attribution-year';
    year.textContent = String(quote.year);
    attribution.append(year);
  }

  return attribution;
}

function buildQuote(quote, terms) {
  const item = document.createElement('li');
  item.className = 'quote';
  item.id = quote.id;
  item.dataset.length = lengthClass(quote.text);

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

  const status = quote.verification?.status ?? 'unverified';
  if (status !== 'verified') {
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
  favorite.title = 'Keep this one';
  favorite.append(svgIcon(ICONS.star));
  favorite.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: `Favourite this quote by ${quote.author}`,
  }));

  const copy = document.createElement('button');
  copy.className = 'icon-button';
  copy.type = 'button';
  copy.dataset.action = 'copy';
  copy.title = 'Copy the quote';
  copy.append(svgIcon(ICONS.copy));
  copy.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: 'Copy this quote',
  }));

  const permalink = document.createElement('a');
  permalink.className = 'icon-button';
  permalink.href = `#${quote.id}`;
  permalink.dataset.action = 'permalink';
  permalink.title = 'Copy a link to this quote';
  permalink.append(svgIcon(ICONS.link));
  permalink.append(Object.assign(document.createElement('span'), {
    className: 'visually-hidden',
    textContent: 'Copy a permanent link to this quote',
  }));

  actions.append(favorite, copy, permalink);
  meta.append(actions);
  figure.append(meta);
  item.append(figure);
  return item;
}

function pluralise(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`;
}

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
  if (state.theme) chips.push(['theme', state.theme]);
  if (state.tag) chips.push(['tag', state.tag]);
  if (state.favoritesOnly) chips.push(['fav', 'favourites']);
  if (state.query) chips.push(['q', `“${state.query}”`]);

  dom.activeFilters.replaceChildren();
  dom.activeFilters.hidden = chips.length === 0;
  if (!chips.length) return;

  dom.activeFilters.append('Showing');
  for (const [key, label] of chips) {
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.type = 'button';
    chip.dataset.clear = key;
    chip.textContent = label;
    chip.setAttribute('aria-label', `Remove the ${key} filter`);
    dom.activeFilters.append(chip);
  }
  const clearAll = document.createElement('button');
  clearAll.className = 'pill';
  clearAll.type = 'button';
  clearAll.dataset.clear = 'all';
  clearAll.textContent = 'Clear all';
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
    ? pluralise(total, 'quote')
    : `${shown.toLocaleString('en')} of ${pluralise(total, 'quote')}`;

  dom.empty.hidden = shown > 0;
  if (!shown) {
    dom.emptyDetail.textContent = total === 0
      ? 'The collection is empty. Import your Goodreads quotes to fill it.'
      : 'No quote matches that. Try fewer words, or clear the filters.';
  }

  dom.favoritesCount.textContent = favorites.size ? String(favorites.size) : '';
  dom.favorites.setAttribute('aria-pressed', String(state.favoritesOnly));
  renderActiveFilters();
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
  const themes = new Map();

  for (const quote of state.all) {
    authors.set(quote._authorSlug, {
      label: quote.author,
      count: (authors.get(quote._authorSlug)?.count ?? 0) + 1,
    });
    for (const theme of quote.themes ?? []) {
      themes.set(theme, (themes.get(theme) ?? 0) + 1);
    }
  }

  const authorOptions = [...authors.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, 'en'));
  for (const [value, { label, count }] of authorOptions) {
    dom.author.append(new Option(`${label} (${count})`, value));
  }

  for (const [theme, count] of [...themes.entries()].sort((a, b) => b[1] - a[1])) {
    dom.theme.append(new Option(`${theme} (${count})`, theme));
  }
}

/* ---------------------------------------------------------------------------
 * Focus mode
 * ------------------------------------------------------------------------- */

function openFocus(index = 0) {
  if (!state.visible.length) {
    toast('Nothing to focus on');
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
  const blockquote = document.createElement('blockquote');
  blockquote.className = 'quote-text';
  blockquote.style.margin = '0';
  if (quote.lang && quote.lang !== 'en') blockquote.lang = quote.lang;
  blockquote.textContent = typographic(quote.text);

  dom.focusQuote.replaceChildren(blockquote, buildAttribution(quote, { linked: false }));
  dom.focusPosition.textContent = `${state.focusIndex + 1} / ${state.visible.length}`;
}

function stepFocus(delta) {
  if (!state.visible.length) return;
  const count = state.visible.length;
  state.focusIndex = (state.focusIndex + delta + count) % count;
  renderFocus();
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

  dom.author.addEventListener('change', () => { state.author = dom.author.value; update(); });
  dom.theme.addEventListener('change', () => { state.theme = dom.theme.value; update(); });
  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    if (state.sort === 'random') state.seed = Math.floor(Math.random() * 1e9);
    update();
  });
  dom.edition.addEventListener('change', () => setEdition(dom.edition.value));

  dom.favorites.addEventListener('click', () => {
    state.favoritesOnly = !state.favoritesOnly;
    update();
  });

  dom.openFocus.addEventListener('click', () => openFocus(Math.max(0, state.cursor)));
  el('close-focus').addEventListener('click', closeFocus);
  el('focus-prev').addEventListener('click', () => stepFocus(-1));
  el('focus-next').addEventListener('click', () => stepFocus(1));
  el('focus-shuffle').addEventListener('click', () => {
    state.focusIndex = Math.floor(Math.random() * state.visible.length);
    renderFocus();
  });

  dom.activeFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    const key = button.dataset.clear;
    if (key === 'all') {
      Object.assign(state, { query: '', author: '', theme: '', tag: '', work: '', favoritesOnly: false });
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

    if (action.dataset.action === 'favorite') {
      if (favorites.has(quote.id)) favorites.delete(quote.id);
      else favorites.add(quote.id);
      writeFavorites();
      action.setAttribute('aria-pressed', String(favorites.has(quote.id)));
      dom.favoritesCount.textContent = favorites.size ? String(favorites.size) : '';
      if (state.favoritesOnly) render();
      return;
    }

    if (action.dataset.action === 'copy') {
      event.preventDefault();
      const attribution = [quote.author, quote.work].filter(Boolean).join(', ');
      copyText(`“${typographic(quote.text)}”\n— ${attribution}`, 'Quote copied');
      return;
    }

    if (action.dataset.action === 'permalink') {
      event.preventDefault();
      const url = new URL(location.href);
      url.search = '';
      url.hash = quote.id;
      copyText(url.toString(), 'Link copied');
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
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '/') { event.preventDefault(); dom.search.focus(); dom.search.select(); }
    else if (event.key === 'j') { event.preventDefault(); moveCursor(1); }
    else if (event.key === 'k') { event.preventDefault(); moveCursor(-1); }
    else if (event.key === 'f') { event.preventDefault(); openFocus(Math.max(0, state.cursor)); }
    else if (event.key === 'r') { event.preventDefault(); randomQuote(); }
  });
}

function syncControlsFromState() {
  dom.search.value = state.query;
  dom.author.value = state.author;
  dom.theme.value = state.theme;
  dom.sort.value = state.sort;
  // A filter for an author or theme that is not in the data yet leaves the
  // select showing "All", so fall the state back to match what is displayed.
  if (dom.author.value !== state.author) state.author = dom.author.value;
  if (dom.theme.value !== state.theme) state.theme = dom.theme.value;
}

/**
 * Precompute the search haystack and the slugs used for filtering.
 *
 * Done once at load rather than per keystroke: with several hundred quotes and
 * a search that fires on every input event, rebuilding these strings each time
 * is the difference between instant and laggy on a phone.
 */
function prepare(quotes) {
  return quotes.map((quote) => {
    const tagSlugs = (quote.tags ?? []).map(slug);
    return {
      ...quote,
      themes: quote.themes ?? [],
      tags: quote.tags ?? [],
      _authorSlug: slug(quote.author),
      _workSlug: quote.work ? slug(quote.work) : '',
      _tagSlugs: tagSlugs,
      // Joined with a newline: search terms are split on whitespace, so no term
      // can ever span two fields, and the separator stays a character nobody
      // can type into the box.
      _haystack: [quote.text, quote.author, quote.work ?? '', quote.note ?? '',
        ...(quote.tags ?? []), ...(quote.themes ?? [])].join('\n').toLowerCase(),
    };
  });
}

async function init() {
  favorites = readFavorites();
  setEdition(localStorage.getItem(STORAGE.edition) ?? document.documentElement.dataset.edition);
  readStateFromUrl();

  let collection = { quotes: [] };
  try {
    const response = await fetch(DATA_URL, { cache: 'no-cache' });
    if (response.ok) collection = await response.json();
  } catch {
    // Rendering an empty collection with a useful message beats a blank page.
  }

  state.all = prepare(collection.quotes ?? []);
  populateFilterOptions();
  syncControlsFromState();
  wireControls();
  render();

  const authors = new Set(state.all.map((quote) => quote.author)).size;
  dom.footerStats.textContent = state.all.length
    ? `${pluralise(state.all.length, 'quote')} from ${pluralise(authors, 'author')}.`
    : '';

  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
    highlightTarget();
  }
}

init();
