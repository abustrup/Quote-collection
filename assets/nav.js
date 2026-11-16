/**
 * nav.js — the one header, mounted by every page.
 *
 * Every page carries the same three controls in the same order: the shelf,
 * which is the one destination worth a coloured pill, then "Add", then a quiet
 * "More". On the pages with a bar they sit at its right end beside the name of
 * the site; on the front page they sit at the end of the controls row. Nothing
 * else is visible at rest. What used to be a pill of its own, the board, read
 * next, the importer, the edition, the language, and on the front page the
 * author, work and era filters, Focus and Curate, lives in the panel that More
 * opens. Two people build the pages; only this file decides what the header is,
 * which is the point of it existing.
 *
 * Three things it owns and nobody else should re-implement:
 *
 *   The edition. The four editions are one select inside the panel. It writes
 *   the same localStorage key the pages read before first paint, and announces
 *   `quotes:edition` so a page that wants to follow along can do so without
 *   polling.
 *
 *   The language toggle, which is `langToggle()` from i18n.js verbatim. There
 *   is exactly one implementation of remembering a language, and it is there.
 *
 *   "Add". It is a real link to the GitHub issue form, so middle-click and
 *   "open in new tab" behave, and it fires a cancellable `quotes:add` first.
 *   A page that can file a quote itself calls preventDefault() and gets the
 *   click; a page that cannot does nothing and the link goes to GitHub, which
 *   is exactly what the site did before any of this existed.
 *
 * A page can put its own tools in the panel by handing `extras` to mountNav:
 * the front page does, with its filters and its Focus and Curate buttons, and
 * the nodes keep their ids and their listeners because they are moved, not
 * copied.
 */

import { hydrate, langToggle, onLang, t } from './i18n.js';

const ISSUE_URL = 'https://github.com/abustrup/Quote-collection/issues/new?template=add-quote.yml';
const EDITION_KEY = 'quotes-edition';
const EDITIONS = ['paper', 'night', 'folio', 'index'];
const THEME_COLOR = { paper: '#f6efe4', night: '#14110d', folio: '#fbf7f0', index: '#eef0f3' };

/** The pages the panel offers. The one you are on is left out of its own menu. */
const PAGES = [
  { id: 'quotes', href: './', label: 'nav.quotes' },
  { id: 'board', href: 'scout.html', label: 'nav.board' },
  { id: 'next', href: 'suggest.html', label: 'nav.next' },
  { id: 'import', href: 'import.html', label: 'nav.import' },
];

const BOOK_GLYPH = 'M4 3.5h5.2c.9 0 1.6.3 2.1.9.5-.6 1.2-.9 2.1-.9H20c.6 0 1 .4 1 1v13c0 .6-.4 1-1 1h-5.4c-.8 0-1.4.3-1.9.9-.4.5-1.2.5-1.6 0-.5-.6-1.1-.9-1.9-.9H4c-.6 0-1-.4-1-1v-13c0-.6.4-1 1-1zm1 2v11h4.2c.7 0 1.3.1 1.9.4V7.3c0-.5-.2-.9-.5-1.2-.3-.4-.8-.6-1.4-.6H5zm14 11v-11h-4.2c-.6 0-1.1.2-1.4.6-.3.3-.5.7-.5 1.2v9.6c.6-.3 1.2-.4 1.9-.4H19z';
const CHEVRON = 'M6 9.5l6 6 6-6';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** An inline icon. Whether it is filled or drawn as a line is the stylesheet's call. */
function glyph(d, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** A word that the language switch can change, set up in one line. */
function word(id, tag = 'span', className = null) {
  const node = el(tag, className);
  node.setAttribute('data-i18n', id);
  node.textContent = t(id);
  return node;
}

/* -------------------------------------------------------------- editions */

export function edition() {
  const current = document.documentElement.dataset.edition;
  return EDITIONS.includes(current) ? current : 'paper';
}

/**
 * Change edition everywhere it is recorded: the attribute the CSS reads, the
 * key the next page load reads before first paint, the browser chrome's colour,
 * and an event for any page that is showing the edition in a control of its own.
 */
export function setEdition(next) {
  const value = EDITIONS.includes(next) ? next : 'paper';
  document.documentElement.dataset.edition = value;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[value]);
  try { localStorage.setItem(EDITION_KEY, value); } catch { /* private window; the session still switches */ }
  try {
    document.dispatchEvent(new CustomEvent('quotes:edition', { detail: { edition: value } }));
  } catch { /* very old browser: the attribute above already did the visible work */ }
  return value;
}

/**
 * The four editions as one select.
 *
 * Paper and night used to be a moon button in the bar, with folio and index
 * reachable only from the front page. Every page can be set in all four, so the
 * choice is one control, in the same place, on every page. The words inside the
 * options are marked for translation, so `hydrate()` rewrites them when the
 * language changes and nothing here has to listen for it.
 */
function editionSelect() {
  const select = el('select', 'pill more-select');
  select.id = 'edition';
  select.setAttribute('data-i18n-title', 'nav.edition.title');
  select.title = t('nav.edition.title');
  for (const id of EDITIONS) {
    const option = el('option');
    option.value = id;
    option.setAttribute('data-i18n', `edition.${id}`);
    option.textContent = t(`edition.${id}`);
    select.append(option);
  }
  select.value = edition();
  select.addEventListener('change', () => setEdition(select.value));
  // Another part of the page changing the edition must not leave this select
  // showing the old one.
  document.addEventListener('quotes:edition', (event) => {
    const value = event?.detail?.edition;
    if (value && select.value !== value) select.value = value;
  });
  return select;
}

/* ------------------------------------------------------------------ add */

function addLink(id) {
  const link = el('a', 'pill is-quiet nav-add');
  if (id) link.id = id;
  link.href = ISSUE_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  const plus = el('span', 'nav-plus', '+');
  plus.setAttribute('aria-hidden', 'true');
  link.append(plus, word('nav.addShort'));
  link.setAttribute('data-i18n-title', 'nav.add');
  link.title = t('nav.add');

  link.addEventListener('click', (event) => {
    // Let the browser's own "open in a new tab" gestures through untouched.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    let handled = false;
    try {
      const ask = new CustomEvent('quotes:add', { bubbles: true, cancelable: true, detail: { source: 'nav' } });
      document.dispatchEvent(ask);
      handled = ask.defaultPrevented;
    } catch { handled = false; }
    if (handled) event.preventDefault();
  });
  return link;
}

/* ---------------------------------------------------------------- shelf */

/** The one coloured pill. A real link, so it opens in a new tab like any other. */
function shelfLink(active, id) {
  const link = el('a', 'pill nav-pill is-primary');
  if (id) link.id = id;
  link.href = 'works.html';
  link.append(glyph(BOOK_GLYPH, 'nav-glyph'), word('nav.shelfShort'));
  link.setAttribute('data-i18n-title', 'nav.shelf.title');
  link.title = t('nav.shelf.title');
  if (active === 'shelf') link.setAttribute('aria-current', 'page');
  return link;
}

/* ----------------------------------------------------------------- more */

/**
 * Put the panel under its button, inside the screen.
 *
 * The button is the last item in a row that wraps, so on a phone it can land
 * anywhere along the second or third line, and a panel pinned to the button's
 * right edge would then run off the left of the screen. Measured on opening
 * instead: right edges line up where there is room, and the panel is pulled
 * back inside the viewport where there is not. It is positioned inside the
 * sticky bar that holds it, so it scrolls with the bar and never floats free.
 */
function placePanel(button, panel) {
  const host = panel.offsetParent;
  if (!host) return;
  const hostBox = host.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  const width = panel.offsetWidth;
  const edge = 8;
  const room = document.documentElement.clientWidth;
  const left = Math.min(Math.max(buttonBox.right - width, edge), Math.max(edge, room - width - edge));
  panel.style.left = `${Math.round(left - hostBox.left)}px`;
  panel.style.top = `${Math.round(buttonBox.bottom - hostBox.top + 6)}px`;
}

/**
 * Open, close, and everything that should close it.
 *
 * A disclosure rather than a menu: focus stays on the button when it opens and
 * Tab walks into the panel, because the panel holds selects and buttons and not
 * a list of commands. Escape closes it and hands focus back to the button.
 * Pressing anywhere else, or tabbing out, closes it too.
 *
 * Escape is heard on the whole document while the panel is open, and not only
 * on the control. A press on the panel's own padding is a press on nothing that
 * takes focus, so focus falls to the page; heard only on the control, Escape
 * then did nothing to the panel and cleared the search instead. It is caught on
 * the way down, so the page's own Escape (clear the search, leave Focus) does
 * not also fire. The listener exists only while the panel is open.
 */
function wireMore(root, button, panel) {
  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close({ restoreFocus: true });
  };
  const close = ({ restoreFocus = false } = {}) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onEscape, true);
    if (restoreFocus) button.focus();
  };
  const open = () => {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onEscape, true);
    placePanel(button, panel);
  };

  button.addEventListener('click', () => (panel.hidden ? open() : close()));

  root.addEventListener('focusout', (event) => {
    if (!panel.hidden && event.relatedTarget && !root.contains(event.relatedTarget)) close();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !root.contains(event.target)) close();
  });

  // Anything marked data-more-close (a page link, Focus, Curate) is a choice
  // that is made, not one that is being browsed, so the panel gets out of the way.
  // A button keeps the reader on the page, and the button that had focus has just
  // been hidden with the panel, so focus goes back to More and not to nothing. A
  // link leaves the page, and there is nowhere to hand it back to.
  panel.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-more-close]');
    if (choice) close({ restoreFocus: !choice.matches('a') });
  });

  const replace = () => { if (!panel.hidden) placePanel(button, panel); };
  window.addEventListener('resize', replace);
  onLang(replace);
}

/** Close the panel from outside, for a page that has just opened something over it. */
export function closeMore() {
  const open = document.querySelector('.more-button[aria-expanded="true"]');
  if (open) open.click();
}

function moreMenu({ active, extras }) {
  const root = el('div', 'more');

  const button = el('button', 'pill is-quiet more-button');
  button.type = 'button';
  button.id = 'more-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'more-panel');
  button.setAttribute('data-i18n-title', 'nav.more.title');
  button.title = t('nav.more.title');
  button.append(word('nav.more'), glyph(CHEVRON, 'more-chevron'));

  const panel = el('div', 'more-panel');
  panel.id = 'more-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('data-i18n-aria', 'nav.more.title');
  panel.setAttribute('aria-label', t('nav.more.title'));

  // The page's own tools come first: they are the reason to open the panel on
  // that page. They arrive hidden, so a page that never mounts the header never
  // shows them half-built.
  if (extras) {
    extras.hidden = false;
    extras.classList.add('more-section', 'more-extras');
    panel.append(extras);
  }

  const pages = el('nav', 'more-section more-pages');
  pages.setAttribute('data-i18n-aria', 'nav.pages');
  pages.setAttribute('aria-label', t('nav.pages'));
  for (const page of PAGES) {
    if (page.id === active) continue;
    const link = el('a', 'more-link');
    link.href = page.href;
    link.setAttribute('data-i18n', page.label);
    link.setAttribute('data-more-close', '');
    link.textContent = t(page.label);
    pages.append(link);
  }
  panel.append(pages);

  const settings = el('div', 'more-section more-settings');
  const editionField = el('div', 'more-field');
  const editionLabel = word('nav.edition', 'label', 'more-label');
  editionLabel.htmlFor = 'edition';
  editionField.append(editionLabel, editionSelect());
  settings.append(editionField);

  const toggle = langToggle();
  if (toggle) {
    const languageField = el('div', 'more-field');
    languageField.append(word('nav.language', 'span', 'more-label'), toggle);
    settings.append(languageField);
  }
  panel.append(settings);

  root.append(button, panel);
  wireMore(root, button, panel);
  return root;
}

/* ---------------------------------------------------------------- mount */

/**
 * Build the header into `host`, or into the page's `<header id="site-nav">`.
 *
 * `active` is one of quotes | shelf | board | next | import and is the page you
 * are on: the shelf pill takes `aria-current`, and the panel leaves that page
 * out of its own list. `variant` is 'bar', the strip along the top that every
 * page but the front page carries, or 'inline', which builds only the three
 * controls into a row the page already has. `extras` is a node of the page's
 * own tools, moved into the panel. `ids` lets a page keep the ids it and its
 * checks have always used for the shelf and add controls.
 */
export function mountNav({
  active = null, variant = 'bar', host = null, extras = null, ids = {},
} = {}) {
  const header = host || document.getElementById('site-nav');
  if (!header) return null;

  const fill = (into) => {
    into.append(shelfLink(active, ids.shelf), addLink(ids.add), moreMenu({ active, extras }));
  };

  header.replaceChildren();
  if (variant === 'inline') {
    header.dataset.variant = 'inline';
    header.classList.add('nav-actions');
    fill(header);
  } else {
    header.dataset.variant = 'bar';
    const row = el('div', 'nav-row');
    const brand = word('nav.brand', 'a', 'nav-brand');
    brand.href = './';
    const actions = el('div', 'nav-actions');
    fill(actions);
    row.append(brand, actions);
    header.append(row);
  }
  hydrate(header);

  // The shelf's control row sticks underneath this one, and needs to know how
  // tall it is. Measured rather than assumed: the bar wraps on a phone.
  const measure = () => {
    const height = header.dataset.variant === 'bar' && getComputedStyle(header).position === 'sticky'
      ? header.offsetHeight
      : 0;
    document.documentElement.style.setProperty('--nav-h', `${Math.round(height)}px`);
  };
  measure();
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(header);
  else window.addEventListener('resize', measure);
  onLang(measure);

  return header;
}

export default mountNav;
