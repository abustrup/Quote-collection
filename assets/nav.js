/**
 * nav.js — the one header, mounted by every page.
 *
 * `mountNav({ active, variant })` fills `<header id="site-nav">` with the same
 * four destinations, the same "+ Add", and the same two toggles, so that moving
 * between the collection and the shelf never feels like moving between two
 * sites. Two people build those pages; only this file decides what the header
 * is, which is the point of it existing.
 *
 * Three things it owns and nobody else should re-implement:
 *
 *   The edition toggle. Paper and night are the pair a reader switches between;
 *   folio and index are deliberate settings chosen from the collection's own
 *   control, so the toggle treats anything that is not night as "go to night"
 *   and night as "come back to paper". It writes the same localStorage key the
 *   pages read before first paint, and announces `quotes:edition` so a page
 *   with its own edition control can follow along without polling.
 *
 *   The language toggle, which is `langToggle()` from i18n.js verbatim. There
 *   is exactly one implementation of remembering a language, and it is there.
 *
 *   "+ Add". It is a real link to the GitHub issue form, so middle-click and
 *   "open in new tab" behave, and it fires a cancellable `quotes:add` first.
 *   A page that can file a quote itself calls preventDefault() and gets the
 *   click; a page that cannot does nothing and the link goes to GitHub, which
 *   is exactly what the site did before any of this existed.
 */

import { hydrate, langToggle, onLang, register, t } from './i18n.js';

const ISSUE_URL = 'https://github.com/abustrup/Quote-collection/issues/new?template=add-quote.yml';
const EDITION_KEY = 'quotes-edition';
const EDITIONS = ['paper', 'night', 'folio', 'index'];
const THEME_COLOR = { paper: '#f6efe4', night: '#14110d', folio: '#fbf7f0', index: '#eef0f3' };

register({
  'nav.sections': { en: 'Sections', da: 'Sektioner' },
  'nav.addShort': { en: 'Add', da: 'Tilføj' },
  'nav.toNight': { en: 'Switch to the night edition', da: 'Skift til nataudgaven' },
  'nav.toPaper': { en: 'Switch to the paper edition', da: 'Skift til papiraudgaven' },
});

/** The four pills, in the order they are read. */
const LINKS = [
  { id: 'quotes', href: './', label: 'nav.quotes' },
  { id: 'shelf', href: 'works.html', label: 'nav.shelf', primary: true },
  { id: 'board', href: 'scout.html', label: 'nav.board' },
  { id: 'next', href: 'suggest.html', label: 'nav.next' },
];

const BOOK_GLYPH = 'M4 3.5h5.2c.9 0 1.6.3 2.1.9.5-.6 1.2-.9 2.1-.9H20c.6 0 1 .4 1 1v13c0 .6-.4 1-1 1h-5.4c-.8 0-1.4.3-1.9.9-.4.5-1.2.5-1.6 0-.5-.6-1.1-.9-1.9-.9H4c-.6 0-1-.4-1-1v-13c0-.6.4-1 1-1zm1 2v11h4.2c.7 0 1.3.1 1.9.4V7.3c0-.5-.2-.9-.5-1.2-.3-.4-.8-.6-1.4-.6H5zm14 11v-11h-4.2c-.6 0-1.1.2-1.4.6-.3.3-.5.7-.5 1.2v9.6c.6-.3 1.2-.4 1.9-.4H19z';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function bookGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'nav-glyph');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', BOOK_GLYPH);
  svg.append(path);
  return svg;
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

function editionToggle() {
  const button = el('button', 'pill nav-toggle nav-edition');
  button.type = 'button';
  const paint = () => {
    const dark = edition() === 'night';
    button.textContent = dark ? '☀' : '☾';
    const title = t(dark ? 'nav.toPaper' : 'nav.toNight');
    button.title = title;
    button.setAttribute('aria-label', title);
  };
  paint();
  button.addEventListener('click', () => { setEdition(edition() === 'night' ? 'paper' : 'night'); paint(); });
  document.addEventListener('quotes:edition', paint);
  onLang(paint);
  return button;
}

/* ------------------------------------------------------------------ add */

function addLink() {
  const link = el('a', 'pill is-quiet nav-add');
  link.href = ISSUE_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  const plus = el('span', null, '+');
  plus.setAttribute('aria-hidden', 'true');
  const label = el('span');
  label.setAttribute('data-i18n', 'nav.addShort');
  label.textContent = t('nav.addShort');
  link.append(plus, label);
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

/* ---------------------------------------------------------------- mount */

/**
 * Fill the page's `<header id="site-nav">`.
 *
 * `active` is one of quotes | shelf | board | next and marks that pill as the
 * current page. `variant` is 'bar' everywhere except the front page, which
 * passes 'row' to get the same pills centred under its masthead.
 */
export function mountNav({ active = null, variant = 'bar', host = null } = {}) {
  const header = host || document.getElementById('site-nav');
  if (!header) return null;

  header.dataset.variant = variant === 'row' ? 'row' : 'bar';
  header.replaceChildren();

  const row = el('div', 'nav-row');

  const brand = el('a', 'nav-brand', 'Lines Worth Keeping');
  brand.href = './';
  row.append(brand);

  const nav = el('nav', 'nav-links');
  nav.setAttribute('data-i18n-aria', 'nav.sections');
  nav.setAttribute('aria-label', t('nav.sections'));

  for (const link of LINKS) {
    const pill = el('a', `pill nav-pill${link.primary ? ' is-primary' : ''}`);
    pill.href = link.href;
    if (link.primary) pill.append(bookGlyph());
    const label = el('span');
    label.setAttribute('data-i18n', link.label);
    label.textContent = t(link.label);
    pill.append(label);
    if (link.id === active) pill.setAttribute('aria-current', 'page');
    nav.append(pill);
  }
  nav.append(addLink());
  row.append(nav);

  const tools = el('div', 'nav-tools');
  const lang = langToggle();
  if (lang) tools.append(lang);
  tools.append(editionToggle());
  row.append(tools);

  header.append(row);
  hydrate(header);

  // The shelf's control row sticks underneath this one, and needs to know how
  // tall it is. Measured rather than assumed: the bar is two rows on a phone.
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
