/**
 * What the Worker is willing to file as a new quote.
 *
 * Kept apart from `index.mjs` and free of anything Cloudflare-specific, so the
 * same function runs in the tests under plain Node and in the Worker in
 * production: a rule that cannot be run without a deployed Worker is a rule
 * nobody checks.
 *
 * The vocabularies come from `assets/quote-core.js`, the same file the page and
 * the sync use, so there is one list of themes, subjects and kinds of work and
 * the intake cannot drift away from the collection it feeds.
 *
 * Three rules shape it.
 *
 * Old payloads are accepted exactly as before. A body with only `text`,
 * `author`, `work`, `year`, `note` and `tags` produces the same stored payload
 * it always did: the newer fields are added only when they were sent.
 *
 * Fields it does not know are ignored, not refused, so a newer page can talk to
 * this Worker and an older page to a newer one.
 *
 * Nothing stronger than "reported" passes through. `verified` means somebody
 * compared the wording with the primary text, and that happens in the
 * collection after a quote is filed, never in a request body. A request that
 * claims it is refused with a sentence that says so, rather than quietly
 * weakened: a client that asks for `verified` has a bug worth hearing about.
 */

import { SUBJECTS, THEMES, WORK_KINDS } from '../../assets/quote-core.js';

/** A problem with what was sent, phrased for whoever sent it. The router turns it into a 400. */
export class BadRequest extends Error {}

export const LIMITS = {
  text: 4000,
  author: 200,
  work: 300,
  note: 2000,
  url: 500,
  locator: 200,
  verificationNote: 500,
  tags: 20,
  themes: 4,
};

/** The only verification statuses a request may carry. */
export const INTAKE_STATUSES = ['reported', 'unverified'];

/** Text that may be missing. `required: false` turns "nothing" into null rather than an error. */
export function trimmed(value, field, { max = LIMITS.text, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequest(`${field} is missing`);
    return null;
  }
  if (typeof value !== 'string') throw new BadRequest(`${field} must be text`);
  const text = value.trim();
  if (required && !text) throw new BadRequest(`${field} is missing`);
  if (text.length > max) throw new BadRequest(`${field} is too long`);
  return text || null;
}

/** One of a fixed list, case and spaces forgiven. Nothing sent means nothing chosen. */
function choice(value, field, list) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequest(`${field} must be text`);
  const picked = value.trim().toLowerCase();
  if (!picked) return null;
  if (!list.includes(picked)) throw new BadRequest(`${field} must be one of ${list.join(', ')}`);
  return picked;
}

/** The scheme and both slashes, in so many words. The scheme may be in any case. */
const HTTPS_PREFIX = /^https:\/\//i;

/**
 * What is wrong with a web address, as a sentence, or null when it can be filed.
 *
 * It is not enough to ask `new URL()` whether the text is an https address,
 * because it also says yes to `https:evil.example` (no slashes) and
 * `https:/evil.example`. The registry's own validator and `register-work.py`
 * both ask for a literal `https://`, so the intake holds the same line on the
 * text itself and not only on what the parser makes of it. Also refused: spaces
 * and control characters, and a login embedded in the address.
 *
 * Exported because the sync (`scripts/apply-shelf-state.mjs`) holds a stored
 * payload to exactly this rule, so the two cannot drift apart.
 */
export function addressProblem(text) {
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return 'url must not contain spaces';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return 'url does not look like a web address';
  }
  if (parsed.protocol !== 'https:' || !HTTPS_PREFIX.test(text)) return 'url must start with https://';
  if (!parsed.hostname) return 'url does not look like a web address';
  if (parsed.username || parsed.password) return 'url must not carry a login';
  return null;
}

/** The address as it is filed: as it was sent, except that the scheme is in lower case. */
export const filedAddress = (text) => `https://${text.slice('https://'.length)}`;

/**
 * An https link, with a timestamp if it has one.
 *
 * `https://youtu.be/ID?t=754` is the case this exists for, so the query string
 * stays. The text is otherwise kept as it was sent, not rewritten into a
 * normalised form, so what is filed is what was pasted. The one change is that
 * `HTTPS://` becomes `https://`, which is what every validator downstream asks
 * for.
 */
function link(value) {
  const text = trimmed(value, 'url', { max: LIMITS.url, required: false });
  if (!text) return null;
  const problem = addressProblem(text);
  if (problem) throw new BadRequest(problem);
  return filedAddress(text);
}

/**
 * Themes are a hint, not a promise, so an unknown one is dropped rather than
 * failing a whole quote over a word. The first four known ones are kept.
 */
function themes(value) {
  if (value === undefined || value === null || value === '') return [];
  let list;
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(',');
  else throw new BadRequest('themes must be a list');

  const kept = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const theme = item.trim().toLowerCase();
    if (THEMES.includes(theme) && !kept.includes(theme)) kept.push(theme);
    if (kept.length === LIMITS.themes) break;
  }
  return kept;
}

function language(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequest('lang must be text');
  const code = value.trim().toLowerCase();
  if (!code) return null;
  if (!/^[a-z]{2}$/.test(code)) throw new BadRequest('lang must be two letters, like en or da');
  return code;
}

function verification(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequest('verification must be an object like {"status": "reported", "note": "…"}');
  }
  let status = 'unverified';
  if (value.status !== undefined && value.status !== null) {
    if (typeof value.status !== 'string') throw new BadRequest('verification.status must be text');
    status = value.status.trim().toLowerCase();
  }
  if (!INTAKE_STATUSES.includes(status)) {
    throw new BadRequest(
      `verification.status must be ${INTAKE_STATUSES.join(' or ')}: a quote is checked against its source after it is filed, not when it is sent`,
    );
  }
  const note = trimmed(value.note, 'verification.note', { max: LIMITS.verificationNote, required: false });
  return note ? { status, note } : { status };
}

/**
 * Turn a request body into the payload that goes into the pending list.
 * Throws `BadRequest` with a readable sentence when something is wrong.
 */
export function readQuotePayload(body) {
  const source = body && typeof body === 'object' ? body : {};

  const payload = {
    text: trimmed(source.text, 'text', { max: LIMITS.text }),
    author: trimmed(source.author, 'author', { max: LIMITS.author }),
    work: trimmed(source.work, 'work', { max: LIMITS.work, required: false }),
    note: trimmed(source.note, 'note', { max: LIMITS.note, required: false }),
    year: null,
    tags: [],
  };

  if (source.year !== undefined && source.year !== null && source.year !== '') {
    const year = Number(source.year);
    if (!Number.isInteger(year) || year < -800 || year > 2100) throw new BadRequest('year looks wrong');
    payload.year = year;
  }
  if (source.tags !== undefined && source.tags !== null) {
    const tags = Array.isArray(source.tags) ? source.tags : String(source.tags).split(',');
    payload.tags = tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, LIMITS.tags);
  }

  // Everything below is new, and appears in the stored payload only when it was
  // sent, so an old request files exactly the payload it always did.
  const url = link(source.url);
  if (url) payload.url = url;

  const locator = trimmed(source.locator, 'locator', { max: LIMITS.locator, required: false });
  if (locator) payload.locator = locator;

  const workKind = choice(source.workKind, 'workKind', WORK_KINDS);
  if (workKind) payload.workKind = workKind;

  const kept = themes(source.themes);
  if (kept.length) payload.themes = kept;

  const subject = choice(source.subject, 'subject', SUBJECTS);
  if (subject) payload.subject = subject;

  const lang = language(source.lang);
  if (lang) payload.lang = lang;

  const checked = verification(source.verification);
  if (checked) payload.verification = checked;

  return payload;
}
