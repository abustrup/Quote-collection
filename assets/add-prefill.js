/**
 * The Add dialog, filled in from the address bar.
 *
 * A link such as
 *
 *   ?add=1&text=…&author=…&work=…&year=…&url=…&locator=…&kind=…&subject=…
 *
 * opens the dialog on load with those fields filled in. It exists for the video
 * library's fallback: when that page cannot file a quote itself, it sends him
 * here with everything it knows, and the last step is his.
 *
 * Three rules.
 *
 * What is read from the address is capped and checked, field by field. The
 * address is anything anybody can put in a link, so a year that is not a year,
 * a kind or subject that is not on the lists and a link that is not https are
 * dropped, and nothing longer than the Worker would accept is kept.
 *
 * Values are only ever handed on as plain text. This module returns strings and
 * numbers; the dialog sets them with `.value`, never as markup.
 *
 * No secret travels this way, in either direction. The edit code is never read
 * from the address, never written to it, and there is no parameter for it.
 *
 * The capture happens when this module is first loaded, and it is loaded by
 * `store.js`, which `app.js` imports. That is deliberate and it matters: the
 * collection page reads its own filters from the address (`?author=`, `?work=`,
 * `?subject=`), the prefill reuses three of those names, and a page that read
 * them first would show a filtered, empty list behind the dialog. Taking the
 * parameters out of the address before the page looks is what stops that. It
 * also means a reload does not open the dialog a second time.
 */

import { SUBJECTS, WORK_KINDS } from './quote-core.js';

/** Every parameter the prefill owns, and so every parameter it removes. */
export const PREFILL_PARAMS = ['add', 'text', 'author', 'work', 'year', 'url', 'locator', 'kind', 'subject'];

/** The Worker's own ceilings, so nothing is kept that it would refuse. */
const LIMITS = {
  text: 4000, author: 200, work: 300, year: 6, url: 500, locator: 200, kind: 20, subject: 30,
};

/** Control characters other than tab and line breaks, which a pasted quote may hold. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * The fields to fill, or null when the address does not ask for the dialog.
 * Accepts a query string (with or without the `?`) or a `URLSearchParams`.
 */
export function parsePrefill(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  if (params.get('add') !== '1') return null;

  const take = (name) => String(params.get(name) ?? '').replace(CONTROL, '').trim().slice(0, LIMITS[name]);
  const values = {
    text: take('text'),
    author: take('author'),
    work: take('work'),
    year: null,
    url: '',
    locator: take('locator'),
    kind: '',
    subject: '',
  };

  const year = take('year');
  if (/^-?\d{1,4}$/.test(year) && Number(year) >= -800 && Number(year) <= 2100) values.year = Number(year);

  // A link too long to keep is dropped, not cut short: half an address points
  // somewhere else, and the Worker would refuse it anyway.
  const url = String(params.get('url') ?? '').replace(CONTROL, '').trim();
  if (url.length <= LIMITS.url && /^https:\/\/\S+$/.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname && !parsed.username && !parsed.password) values.url = url;
    } catch { /* not an address; leave the field empty */ }
  }

  const kind = take('kind').toLowerCase();
  if (WORK_KINDS.includes(kind)) values.kind = kind;

  const subject = take('subject').toLowerCase();
  if (SUBJECTS.includes(subject)) values.subject = subject;

  return values;
}

/** The query string without the prefill's parameters; everything else is kept as it was. */
export function withoutPrefill(search) {
  const params = new URLSearchParams(String(search ?? ''));
  for (const name of PREFILL_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Read the prefill from the page's address and take it out of the address bar.
 * Returns null outside a browser, or when the address does not ask for the dialog.
 */
export function capturePrefill(where = globalThis.location, history = globalThis.history) {
  if (!where || typeof where.search !== 'string') return null;
  const values = parsePrefill(where.search);
  if (!values) return null;

  try {
    history?.replaceState?.(history.state ?? null, '', `${where.pathname}${withoutPrefill(where.search)}${where.hash ?? ''}`);
  } catch { /* a sandboxed frame may refuse; the dialog still opens */ }
  return values;
}

let captured = capturePrefill();

/** The prefill found at load, once. The second call, and every later one, gets null. */
export function takePrefill() {
  const values = captured;
  captured = null;
  return values;
}
