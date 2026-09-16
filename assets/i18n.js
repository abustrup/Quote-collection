/**
 * The language layer: Danish or English, for the interface only.
 *
 * Quotations, titles and author names are data and are never translated. What
 * flips is the chrome around them: labels, buttons, tooltips, headings, empty
 * states and the words that surround a number.
 *
 * The dictionary is keyed by a short id and carries both languages side by
 * side, so a half-translated string degrades to the other language rather than
 * to a bare key. Each page registers the strings it alone needs with
 * `register({...})`, which is why two people can add strings to two pages
 * without ever editing the same lines.
 *
 * It must also import cleanly under Node, so every touch of `document`,
 * `localStorage` and `navigator` is guarded: `tests/i18n.test.mjs` runs the
 * lookup, the fallback and the substitution with no browser anywhere.
 */

const KEY = 'quotes-lang';
const LANGS = ['en', 'da'];

const hasDocument = () => typeof document !== 'undefined' && document !== null;

/** English unless the browser has remembered Danish, or asks for Danish first. */
function initialLang() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) {
      const saved = localStorage.getItem(KEY);
      if (LANGS.includes(saved)) return saved;
    }
  } catch { /* private mode, or a browser with storage switched off */ }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      if (navigator.language.toLowerCase().startsWith('da')) return 'da';
    }
  } catch { /* not a browser */ }
  return 'en';
}

let current = initialLang();
if (hasDocument() && document.documentElement) document.documentElement.lang = current;

/** The dictionary. Shared strings only — pages add their own with register(). */
export const T = {
  // ---- moving between the pages
  'nav.quotes': { en: 'Quotes', da: 'Citater' },
  'nav.shelf': { en: 'The shelf', da: 'Hylden' },
  'nav.board': { en: 'The board', da: 'Tavlen' },
  'nav.next': { en: 'Read next', da: 'Læs næste' },
  'nav.add': { en: 'Add a quote', da: 'Tilføj et citat' },

  // ---- how the collection is set
  'edition.paper': { en: 'Paper', da: 'Papir' },
  'edition.night': { en: 'Night', da: 'Nat' },
  'edition.folio': { en: 'Folio', da: 'Folio' },
  'edition.index': { en: 'Index', da: 'Register' },

  // ---- the language toggle itself. Each string is written in the language it
  // switches TO, because that is the one the reader who needs it can read.
  'lang.title': { en: 'Skift til dansk', da: 'Switch to English' },
  'lang.aria': { en: 'Vis siden på dansk', da: 'Show the page in English' },

  // ---- controls that appear on more than one page
  'ui.close': { en: 'Close', da: 'Luk' },
  'ui.search': { en: 'Search', da: 'Søg' },
  'ui.clear': { en: 'Clear', da: 'Ryd' },
  'ui.copy': { en: 'Copy', da: 'Kopiér' },
  'ui.copied': { en: 'Copied', da: 'Kopieret' },
  'ui.link': { en: 'Copy link', da: 'Kopiér link' },
  'ui.linkCopied': { en: 'Link copied', da: 'Link kopieret' },
  'ui.favourite': { en: 'Favourite', da: 'Favorit' },
  'ui.unfavourite': { en: 'Remove favourite', da: 'Fjern favorit' },
  'ui.previous': { en: 'Previous', da: 'Forrige' },
  'ui.next': { en: 'Next', da: 'Næste' },
  'ui.shuffle': { en: 'Shuffle', da: 'Bland' },
  'ui.focus': { en: 'Focus', da: 'Fokus' },

  // ---- the four shelves he brought over from Goodreads, plus everything that
  // is on no shelf at all (essays, talks, documents).
  'shelf.read': { en: 'Read', da: 'Læst' },
  'shelf.reading': { en: 'Reading', da: 'Læser' },
  'shelf.to-read': { en: 'Want to read', da: 'Vil læse' },
  'shelf.abandoned': { en: 'Did not finish', da: 'Ikke færdig' },
  'shelf.unshelved': { en: 'Not shelved', da: 'Ikke på hylden' },

  // ---- what a work is about, and when it was written. Shared rather than
  // page-owned: the shelf groups by them and the collection filters by them,
  // and two dictionaries for one set of fourteen subjects is how one page ends
  // up saying "Teknologi" while the other says "Technology" [2026-09-16].
  'shelf.subject.literature': { en: 'Literature', da: 'Litteratur' },
  'shelf.subject.philosophy': { en: 'Philosophy', da: 'Filosofi' },
  'shelf.subject.ethics': { en: 'Ethics', da: 'Etik' },
  'shelf.subject.politics': { en: 'Politics', da: 'Politik' },
  'shelf.subject.economics': { en: 'Economics', da: 'Økonomi' },
  'shelf.subject.psychology': { en: 'Psychology', da: 'Psykologi' },
  'shelf.subject.sociology': { en: 'Sociology', da: 'Sociologi' },
  'shelf.subject.science': { en: 'Science', da: 'Naturvidenskab' },
  'shelf.subject.technology': { en: 'Technology', da: 'Teknologi' },
  'shelf.subject.history': { en: 'History', da: 'Historie' },
  'shelf.subject.military': { en: 'Strategy', da: 'Krigskunst' },
  'shelf.subject.religion': { en: 'Religion', da: 'Religion' },
  'shelf.subject.law': { en: 'Law', da: 'Jura' },
  'shelf.subject.education': { en: 'Education', da: 'Uddannelse' },
  'shelf.subject.none': { en: 'Unclassified', da: 'Uden emne' },

  'shelf.era.antiquity': { en: 'Antiquity', da: 'Antikken' },
  'shelf.era.medieval': { en: 'Medieval', da: 'Middelalderen' },
  'shelf.era.early-modern': { en: 'Early modern', da: 'Tidlig moderne' },
  'shelf.era.c19': { en: '19th century', da: '1800-tallet' },
  'shelf.era.c20': { en: '20th century', da: '1900-tallet' },
  'shelf.era.contemporary': { en: 'Contemporary', da: 'Nutiden' },

  // ---- two questions, because one number would change meaning the day a book
  // moves from "want to read" to "read".
  'rating.good': { en: 'How good was it', da: 'Hvor god var den' },
  'rating.want': { en: 'How much do I want to read it', da: 'Hvor meget vil jeg læse den' },

  // ---- editing: locked by default, unlocked per device, offline when the
  // write path cannot be reached.
  'edit.locked': { en: 'Editing is locked', da: 'Redigering er låst' },
  'edit.unlock': { en: 'Unlock', da: 'Lås op' },
  'edit.unlocked': { en: 'Editing is unlocked', da: 'Redigering er låst op' },
  'edit.offline': { en: 'Editing is offline', da: 'Offline, kan ikke redigere' },
  'edit.code.placeholder': { en: 'Edit code', da: 'Redigeringskode' },
};

/**
 * Merge more strings in. Later registrations win, so a page may sharpen a
 * shared string for its own context; ids are namespaced by page prefix
 * (`shelf.*`, `focus.*`) to make that deliberate rather than accidental.
 */
export function register(strings) {
  if (!strings) return T;
  for (const [id, pair] of Object.entries(strings)) {
    if (!pair || typeof pair !== 'object') continue;
    T[id] = { ...(T[id] || {}), ...pair };
  }
  return T;
}

export const lang = () => current;
export const locale = () => (current === 'da' ? 'da-DK' : 'en-GB');

/**
 * Switch language, remember it, and bring the page with it.
 *
 * Re-hydrating and announcing happen here rather than only in the toggle, so
 * any other route into a language change (a URL parameter, a settings panel)
 * behaves identically. Scripts that render from JavaScript listen for
 * `quotes:lang` on `document` and re-render.
 */
export function setLang(next) {
  current = next === 'da' ? 'da' : 'en';
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) localStorage.setItem(KEY, current);
  } catch { /* nothing to remember it with; the session still switches */ }
  if (hasDocument()) {
    if (document.documentElement) document.documentElement.lang = current;
    hydrate(document);
    try {
      document.dispatchEvent(new CustomEvent('quotes:lang', { detail: { lang: current } }));
    } catch { /* very old browser; hydrate already did the visible work */ }
  }
  return current;
}

/** Run `fn` whenever the language changes. Returns a function that stops it. */
export function onLang(fn) {
  if (!hasDocument()) return () => {};
  const handler = (event) => fn(event?.detail?.lang ?? current);
  document.addEventListener('quotes:lang', handler);
  return () => document.removeEventListener('quotes:lang', handler);
}

/**
 * Look a string up.
 *
 * Falls back current → English → Danish → the id itself. The id is a last
 * resort on purpose: a visible `shelf.read` in the interface is a bug report
 * anybody can file, where silent blankness is not.
 *
 * `{name}` in the string is replaced by `vars.name`. A placeholder with no
 * value is left standing, for the same reason.
 */
export function t(id, vars) {
  const entry = T[id];
  let out = entry ? (entry[current] ?? entry.en ?? entry.da ?? id) : id;
  if (vars && typeof out === 'string' && out.includes('{')) {
    out = out.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : match
    ));
  }
  return out;
}

/** A date in the reader's language: "14 March 2024" / "14. marts 2024". */
export function fmtDate(value, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(locale(), options).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Fill in everything marked up for translation, under `root`.
 *
 *   data-i18n="id"              → textContent
 *   data-i18n-title="id"        → title
 *   data-i18n-placeholder="id"  → placeholder
 *   data-i18n-aria="id"         → aria-label
 *
 * textContent, never innerHTML: nothing in a dictionary is ever parsed as
 * markup. That means `data-i18n` REPLACES an element's children, so when a
 * label sits next to a live number, put the label in its own <span> and mark
 * that, not the button.
 */
export function hydrate(root) {
  const scope = root || (hasDocument() ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
  let filled = 0;
  const apply = (attribute, set) => {
    for (const node of scope.querySelectorAll(`[${attribute}]`)) {
      const id = node.getAttribute(attribute);
      if (!id) continue;
      set(node, t(id));
      filled += 1;
    }
  };
  apply('data-i18n', (node, value) => { node.textContent = value; });
  apply('data-i18n-title', (node, value) => { node.title = value; });
  apply('data-i18n-placeholder', (node, value) => { node.placeholder = value; });
  apply('data-i18n-aria', (node, value) => node.setAttribute('aria-label', value));
  return filled;
}

/**
 * The DA/EN button, ready to append to a header.
 *
 * It shows the language it would switch TO, which is how every bilingual site
 * he uses behaves and the only version that tells you what pressing it does.
 */
export function langToggle() {
  if (!hasDocument()) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill lang-toggle';
  button.setAttribute('data-i18n-title', 'lang.title');
  button.setAttribute('data-i18n-aria', 'lang.aria');
  const paint = () => {
    button.textContent = current === 'en' ? 'DA' : 'EN';
    button.title = t('lang.title');
    button.setAttribute('aria-label', t('lang.aria'));
  };
  paint();
  button.addEventListener('click', () => setLang(current === 'en' ? 'da' : 'en'));
  document.addEventListener('quotes:lang', paint);
  return button;
}

export const STORAGE_KEY = KEY;
