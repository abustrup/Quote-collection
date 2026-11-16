/**
 * store.js — the site's half of the write path.
 *
 * Everything the pages need in order to change something: read the Worker's
 * state, lay it over the repository JSON, hold the edit key for this device,
 * and send changes. One module so `index.html` and `works.html` cannot drift
 * apart on what a favourite is or where a rating lives.
 *
 * Three rules shape all of it.
 *
 * The page must render whether or not the Worker answers. A static site backed
 * by a git repository is the thing that has to keep working; the Worker is an
 * improvement on top. So every read has a 2.5 second budget, falls back to the
 * last good copy in localStorage, and says `status.online === false` rather
 * than throwing. Nothing here ever blocks a render.
 *
 * A change must never look saved when it is not. Writes update the local copy
 * first, so the star fills the moment it is pressed, and then either land or
 * throw a small tagged error the page can put into words: `locked` (the key is
 * wrong or gone), `unconfigured` (nobody has set a key yet), `offline` (the
 * network failed — the change is queued and replayed on the next load).
 *
 * The favourites people already have must survive. `app.js` has always kept
 * them in localStorage under `quotes-favorites`, and some of them predate the
 * Worker by months. A star now has four homes (the repository, the Worker, that
 * old list and this browser's own choices) and `favorites()` reads all four;
 * the section at the foot of this file says which one wins when they disagree.
 */

// Loaded for what it does when it loads, not for anything it exports here: it
// takes the Add dialog's `?add=1&…` parameters out of the address bar, and it
// has to do that before `app.js` reads the address as filters. `app.js` imports
// this file, so this is the one place that is guaranteed to run first.
import './add-prefill.js';
import { SUBJECTS, quoteId } from './quote-core.js';

const API_FALLBACK = 'https://quote-shelf.abustrup.workers.dev';
const SOURCES_URL = 'data/sources.json';
const TIMEOUT_MS = 2500;

const KEY = {
  state: 'shelf-state',
  code: 'shelf-edit-code',
  queue: 'shelf-queue',
  legacyFavorites: 'quotes-favorites',
  // Stars and un-stars pressed on this device while editing was locked, each
  // with the time it was pressed: { "q_…": { on: true, at: "2026-…Z" } }.
  choices: 'quotes-favorites-choices',
};

const EMPTY = { works: {}, favorites: {}, pending: [], generatedAt: null };

/** What the pages read to decide what to say. Kept current, never replaced. */
export const status = {
  online: false,
  unlocked: false,
  apiUrl: API_FALLBACK,
};

let cache = null;          // the state as we last knew it, server or cached
let apiPromise = null;     // the one-time lookup of the API url
const listeners = new Set();

/* ---------------------------------------------------------------------------
 * localStorage, defensively
 *
 * Private windows, cleared site data and a full quota all make these throw.
 * A page that cannot remember a favourite is a small loss; a page that will
 * not render is a large one.
 * ------------------------------------------------------------------------- */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function forget(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do about it */
  }
}

/* ---------------------------------------------------------------------------
 * Talking to the Worker
 * ------------------------------------------------------------------------- */

/** The API url, from data/sources.json, looked up once and then remembered. */
async function apiUrl() {
  if (!apiPromise) {
    apiPromise = (async () => {
      try {
        const response = await withTimeout((signal) => fetch(SOURCES_URL, { signal }));
        if (!response.ok) throw new Error(String(response.status));
        const sources = await response.json();
        const url = sources?.shelfApi?.url;
        return typeof url === 'string' && /^https?:\/\//.test(url) ? url.replace(/\/+$/, '') : API_FALLBACK;
      } catch {
        // A missing or unreadable sources.json is not a reason to lose the
        // write path: the deployed url is also compiled in above.
        return API_FALLBACK;
      }
    })().then((url) => {
      status.apiUrl = url;
      return url;
    });
  }
  return apiPromise;
}

function withTimeout(run, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.resolve(run(controller.signal)).finally(() => clearTimeout(timer));
}

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const locked = () => new StoreError('locked', 'Editing is locked on this device.');
const unconfigured = () => new StoreError('unconfigured', 'Editing is not set up yet.');
const offline = () => new StoreError('offline', 'Could not reach the shelf service.');

/** POST to the Worker with this device's key, turning failures into codes. */
async function send(path, body) {
  const code = editCode();
  if (!code) throw locked();
  const base = await apiUrl();

  let response;
  try {
    response = await withTimeout((signal) => fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${code}` },
      body: JSON.stringify(body),
      signal,
    }));
  } catch {
    status.online = false;
    throw offline();
  }

  if (response.status === 401) {
    // The key stopped working. Keeping it would mean every later change fails
    // the same silent way, so it goes and the page can offer to unlock again.
    forget(KEY.code);
    status.unlocked = false;
    throw locked();
  }
  if (response.status === 503) throw unconfigured();
  if (!response.ok) throw new StoreError('failed', `The shelf service said ${response.status}.`);

  status.online = true;
  return response.json().catch(() => ({}));
}

/* ---------------------------------------------------------------------------
 * The key for this device
 * ------------------------------------------------------------------------- */

function editCode() {
  const code = read(KEY.code, null);
  return typeof code === 'string' && code ? code : null;
}

export function isUnlocked() {
  status.unlocked = Boolean(editCode());
  return status.unlocked;
}

/**
 * Try a code against the Worker, and remember it only if it works.
 *
 * Remembering first and finding out later is how a device ends up quietly
 * unable to save anything, so this is a real round trip every time.
 */
export async function unlock(code) {
  const candidate = String(code ?? '').trim();
  if (!candidate) return false;
  const base = await apiUrl();

  let response;
  try {
    response = await withTimeout((signal) => fetch(`${base}/ping`, {
      method: 'POST',
      headers: { authorization: `Bearer ${candidate}` },
      signal,
    }));
  } catch {
    status.online = false;
    throw offline();
  }

  if (response.status === 503) throw unconfigured();
  if (!response.ok) {
    status.unlocked = false;
    return false;
  }

  status.online = true;
  write(KEY.code, candidate);
  status.unlocked = true;
  announce();
  // Whatever was starred on this device while it was locked is kept everywhere
  // from now on. Not awaited: unlocking is done, and this is housekeeping.
  void pushLocalFavorites();
  return true;
}

export function lock() {
  forget(KEY.code);
  status.unlocked = false;
  announce();
}

/* ---------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */

function normalize(state) {
  return {
    works: state?.works && typeof state.works === 'object' ? state.works : {},
    favorites: state?.favorites && typeof state.favorites === 'object' ? state.favorites : {},
    pending: Array.isArray(state?.pending) ? state.pending : [],
    generatedAt: state?.generatedAt ?? null,
  };
}

/** The state without a network call: the cache, or an empty shelf. */
export function state() {
  if (!cache) cache = normalize(read(KEY.state, EMPTY));
  return cache;
}

/**
 * Fetch the Worker's state, falling back to whatever we last saw.
 *
 * Replaying the queue first matters: a change made on a train should land the
 * next time the page loads with a network, and it should land *before* the
 * state it would otherwise be missing from is read back.
 */
export async function loadState() {
  cache = normalize(read(KEY.state, EMPTY));
  await replayQueue();

  const base = await apiUrl();
  try {
    const response = await withTimeout((signal) => fetch(`${base}/state`, { signal, cache: 'no-store' }));
    if (!response.ok) throw new Error(String(response.status));
    cache = normalize(await response.json());
    write(KEY.state, cache);
    status.online = true;
  } catch {
    status.online = false;
  }

  isUnlocked();
  announce();
  // Unlocked here, and the Worker answered: anything starred while locked,
  // before the key was entered on this device, is carried across now.
  if (status.online && status.unlocked) void pushLocalFavorites();
  return cache;
}

/* ---------------------------------------------------------------------------
 * The queue
 *
 * A change made with no network is not lost and not pretended away: it stays
 * in the local copy, so the page keeps showing it, and it sits in this queue
 * until a load with a working network sends it. Same-target changes collapse,
 * because replaying "rating 7" and then "rating 9" only ever meant 9.
 * ------------------------------------------------------------------------- */

function queue(path, body) {
  const pending = read(KEY.queue, []);
  const list = Array.isArray(pending) ? pending : [];
  const target = path === '/work' ? `work:${body.work}` : path === '/favorite' ? `favorite:${body.id}` : null;
  const kept = target
    ? list.filter((entry) => `${entry.path === '/work' ? 'work' : 'favorite'}:${entry.body?.work ?? entry.body?.id}` !== target)
    : list;
  kept.push({ path, body, at: new Date().toISOString() });
  write(KEY.queue, kept.slice(-200));
}

async function replayQueue() {
  const list = read(KEY.queue, []);
  if (!Array.isArray(list) || !list.length) return;
  if (!editCode()) return;

  const left = [];
  for (const entry of list) {
    try {
      await send(entry.path, entry.body);
    } catch (error) {
      // Offline: keep it and try again next time. Anything else — a rejected
      // key, a body the Worker will never accept — would replay forever, so it
      // is dropped and the local copy stands as the only record.
      if (error.code === 'offline') left.push(entry);
    }
  }
  write(KEY.queue, left);
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------- */

/** Change a book. `{ rating, want, shelf }`; null clears a field. */
export async function setWork(slug, patch) {
  const current = state();
  const before = current.works[slug] ? { ...current.works[slug] } : null;

  const next = { ...(before ?? {}) };
  for (const field of ['rating', 'want', 'shelf']) {
    if (!(field in patch)) continue;
    // A null is kept, not deleted. It is the tombstone the Worker stores and
    // `applyWork` already knows how to read: "this was cleared on the site,
    // ignore what the repository still says." Deleting it here instead left the
    // registry's own value showing, so clearing a rating or taking a book off
    // the shelf changed nothing on screen until the next reload fetched the
    // Worker's copy of the same fact.
    next[field] = patch[field];
  }
  next.updatedAt = new Date().toISOString();

  const hasValue = ['rating', 'want', 'shelf'].some((field) => next[field] !== undefined);
  if (hasValue) current.works[slug] = next;
  else delete current.works[slug];
  write(KEY.state, current);
  announce();

  try {
    await send('/work', { work: slug, ...patch });
  } catch (error) {
    if (error.code === 'offline') {
      queue('/work', { work: slug, ...patch });
      throw error;
    }
    // A refused change should not keep showing as saved.
    if (before) current.works[slug] = before;
    else delete current.works[slug];
    write(KEY.state, current);
    announce();
    throw error;
  }
  return next;
}

/** Star or unstar a quote, in both the server's record and the old local one. */
export async function setFavorite(id, on) {
  const current = state();
  const before = current.favorites[id] ? { ...current.favorites[id] } : null;
  const wasLocal = legacyFavorites().has(id);
  current.favorites[id] = { on: Boolean(on), updatedAt: new Date().toISOString() };
  write(KEY.state, current);
  writeLegacyFavorite(id, on);
  announce();

  try {
    await send('/favorite', { id, on: Boolean(on) });
  } catch (error) {
    if (error.code === 'offline') {
      queue('/favorite', { id, on: Boolean(on) });
      throw error;
    }
    if (before) current.favorites[id] = before;
    else delete current.favorites[id];
    write(KEY.state, current);
    writeLegacyFavorite(id, wasLocal);
    announce();
    throw error;
  }
  // The Worker holds it now, so a choice made earlier on this device, while it
  // was locked, has nothing left to say.
  forgetChoice(id);
  return Boolean(on);
}

/**
 * File a new quote.
 *
 * Not queued when offline: unlike a rating, a quote has no place to sit in the
 * local state, and a silently queued one would look filed while being one
 * cleared browser away from gone. The page says it could not send it and keeps
 * the words in the form.
 */
export async function addQuote(payload) {
  const result = await send('/quote', payload);
  const current = state();
  current.pending = [...current.pending, {
    id: result.id,
    payload,
    createdAt: result.createdAt ?? new Date().toISOString(),
  }];
  write(KEY.state, current);
  announce();
  return result;
}

/**
 * The Worker's pending quotes as records the page can draw.
 *
 * A pending quote is on the page before the sync has put it in the repository,
 * and it keeps everything the sender gave: a source link and a place in it, a
 * kind of work, themes, a language, a note on how well it was checked.
 *
 * The subject is the exception, because it does not belong to the quote. The
 * page finds a quote's subject by looking its work up in the registry by title,
 * and a work the registry has never heard of has no entry to look in until the
 * sync registers it. So the sender's own subject rides along as `_subjectHint`,
 * for the page to use when the lookup finds nothing, and it is shared by every
 * pending quote that names the same work. A work whose title differs from the
 * registry's only in case or spacing is read as the registry's (`titles` maps
 * the lower-cased title to the registry's spelling), which is what the sync
 * does when it files the quote.
 *
 * The hint is only trusted when a year came with the subject. The sync
 * registers a new work only with a year (the registry's era filter needs one,
 * and so does the repository's own test), so a subject with no year would show
 * the quote under its subject filter until the sync ran and then drop it out
 * again. The page promises only what the sync will keep.
 *
 * `known` is the ids already on the page: identity is the hash of the words,
 * not the Worker's row id, so once the repository has the quote, only that copy
 * is drawn. Pure, so the shape can be tested without a browser.
 */
export function pendingQuotes(pending, { known = new Set(), titles = new Map() } = {}) {
  const seen = new Set(known);
  const subjectOf = new Map();
  const records = [];

  for (const entry of Array.isArray(pending) ? pending : []) {
    const payload = entry?.payload;
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) continue;
    const id = quoteId(payload.text);
    if (seen.has(id)) continue;
    seen.add(id);

    const named = typeof payload.work === 'string' ? payload.work.trim() : '';
    const work = named ? (titles.get(named.toLowerCase()) ?? named) : null;
    if (work && SUBJECTS.includes(payload.subject) && Number.isInteger(payload.year) && !subjectOf.has(work)) {
      subjectOf.set(work, payload.subject);
    }

    records.push({
      id,
      text: payload.text,
      author: payload.author || '',
      work,
      workKind: payload.workKind || null,
      year: payload.year ?? null,
      source: { kind: 'manual', url: payload.url || null, locator: payload.locator || null },
      note: payload.note || null,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      themes: Array.isArray(payload.themes) ? payload.themes : [],
      lang: payload.lang || 'en',
      addedAt: entry.createdAt ?? new Date().toISOString(),
      verification: payload.verification?.status ? payload.verification : { status: 'unverified' },
      _pending: true,
      _subjectHint: '',
    });
  }

  for (const record of records) record._subjectHint = (record.work && subjectOf.get(record.work)) || '';
  return records;
}

/* ---------------------------------------------------------------------------
 * Favourites
 *
 * Until 2026-11-15 a star lived in two places that could both be empty: the
 * Worker, which only an unlocked device writes to, and this browser's
 * localStorage. No unlocked device ever starred anything, so the repository held
 * none, the Worker held none, and every favourite he had was one cleared
 * browser from gone. These are the four homes a star has now, from the most
 * durable down:
 *
 *   1. The repository. `favorite: true` on a quote in data/quotes.json. It
 *      survives every browser and every device, which is the point. The page
 *      tells this file what it read, with `setCollection()`.
 *   2. The Worker's overrides (`state().favorites`): a star or un-star made
 *      while unlocked, kept until the sync writes it into the repository. An
 *      explicit `on: false` takes away a star the repository still has.
 *   3. This browser's old list, `quotes-favorites`: stars only, no times. It is
 *      older than the Worker, so any word from the Worker beats it.
 *   4. This browser's choices, `quotes-favorites-choices`: a star or an un-star
 *      pressed here while editing was locked, with the time it was pressed. The
 *      only way to un-star, on this device, something the repository has
 *      starred. It wins over the Worker only when it is newer.
 *
 * The repository is the floor and the rest are layers over it, newest word
 * last. Unlocking carries every local choice up to the Worker, and the Worker's
 * word is then the only one that is left.
 * ------------------------------------------------------------------------- */

let repoFavorites = new Set();   // ids that data/quotes.json flags as favourites
let knownQuotes = new Set();     // every id on the page, filed or pending; empty until the page says

function legacyFavorites() {
  const raw = read(KEY.legacyFavorites, []);
  return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
}

function writeLegacyFavorite(id, on) {
  const set = legacyFavorites();
  if (on) set.add(id);
  else set.delete(id);
  return write(KEY.legacyFavorites, [...set]);
}

function localChoices() {
  const raw = read(KEY.choices, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function forgetChoice(id) {
  const choices = localChoices();
  if (!(id in choices)) return;
  delete choices[id];
  write(KEY.choices, choices);
}

/**
 * Tell the store what the page has: every quote it shows, and which of them the
 * repository flags. Called once the data has loaded, and again when a pending
 * quote arrives. Quotes are `{ id, favorite }` records, as in data/quotes.json.
 */
export function setCollection(quotes) {
  const list = Array.isArray(quotes) ? quotes : [];
  repoFavorites = new Set(list.filter((quote) => quote?.favorite === true && quote.id).map((quote) => quote.id));
  knownQuotes = new Set(list.map((quote) => quote?.id).filter(Boolean));
}

/**
 * The effective favourites, from the four layers. Pure, so the rules can be
 * tested without a browser.
 *
 *   repo     ids the repository flags
 *   legacy   ids in this browser's old list
 *   worker   { id: { on, updatedAt } }, the Worker's overrides
 *   choices  { id: { on, at } }, this browser's own presses
 *   known    ids the page has; when given and not empty, anything else is
 *            dropped, so the count matches the stars that can be seen
 *
 * The Worker's explicit off removes a repository star. A local choice then
 * applies only if it is newer than the Worker's word on that quote: the one
 * that was pressed last is the one that is meant.
 */
export function mergeFavorites({ repo = [], legacy = [], worker = {}, choices = {}, known = null } = {}) {
  const set = new Set(repo);
  for (const id of legacy) set.add(id);

  for (const [id, entry] of Object.entries(worker ?? {})) {
    if (entry?.on) set.add(id);
    else set.delete(id);
  }

  for (const [id, choice] of Object.entries(choices ?? {})) {
    const theirs = worker?.[id];
    if (theirs && !(String(choice?.at ?? '') > String(theirs.updatedAt ?? ''))) continue;
    if (choice?.on) set.add(id);
    else set.delete(id);
  }

  if (known && known.size) {
    for (const id of [...set]) if (!known.has(id)) set.delete(id);
  }
  return set;
}

/** Every starred quote id, as this device should show it. */
export function favorites() {
  return mergeFavorites({
    repo: repoFavorites,
    legacy: legacyFavorites(),
    worker: state().favorites,
    choices: localChoices(),
    known: knownQuotes,
  });
}

/**
 * Star or un-star on this device only. This is what a press does while editing
 * is locked: it must never throw and never pretend to be more than it is. The
 * choice is kept with its time, and the old list is kept in step with it so an
 * older copy of the page still finds the star.
 *
 * Returns whether this device kept the press. It is false when the browser will
 * not take the write (site data blocked, a private window that refuses
 * storage, a full quota), and then nothing was saved: the page must not say
 * that it was. The choices list is the one that has to land, because it is what
 * makes an un-star of a repository star stick; the old list is best effort.
 */
export function setLocalFavorite(id, on) {
  const choices = localChoices();
  // A press is later than anything the Worker has already said about this
  // quote, because the page had that answer when the press happened. A device
  // clock running behind the Worker's must not turn that around, or the star
  // would light and then go out again, with nothing to say why.
  let at = new Date().toISOString();
  const theirs = Date.parse(state().favorites[id]?.updatedAt);
  if (Number.isFinite(theirs) && theirs >= Date.now()) at = new Date(theirs + 1).toISOString();
  choices[id] = { on: Boolean(on), at };
  const kept = write(KEY.choices, choices);
  writeLegacyFavorite(id, Boolean(on));
  announce();
  return kept;
}

/**
 * Send the Worker whatever this device decided while it was locked and the
 * Worker has not heard. Runs after unlocking and on a load that is unlocked, so
 * a star pressed before the key was entered is not left behind.
 *
 * Left out, on purpose: a quote the page does not have (it would only produce a
 * warning at every sync), a star the repository already has (it would put a
 * row in the database that can only ever go stale), and any quote the Worker
 * has already given a newer word on. Stops at the first failure; what is left
 * stays local and is tried again at the next load.
 */
let pushing = false;

async function pushLocalFavorites() {
  if (pushing || !knownQuotes.size || !editCode()) return;
  pushing = true;
  try {
    const worker = state().favorites;
    const wanted = new Map();

    for (const id of legacyFavorites()) {
      if (knownQuotes.has(id) && !repoFavorites.has(id) && !worker[id]) wanted.set(id, true);
    }
    for (const [id, choice] of Object.entries(localChoices())) {
      if (!knownQuotes.has(id)) continue;
      const theirs = worker[id];
      if (theirs && !(String(choice?.at ?? '') > String(theirs.updatedAt ?? ''))) {
        forgetChoice(id);
        continue;
      }
      if (!theirs && Boolean(choice?.on) === repoFavorites.has(id)) {
        forgetChoice(id);
        continue;
      }
      wanted.set(id, Boolean(choice?.on));
    }

    let sent = 0;
    for (const [id, on] of wanted) {
      if (sent >= 100) break;
      try {
        await setFavorite(id, on);
        sent += 1;
      } catch {
        break;
      }
    }
  } finally {
    pushing = false;
  }
}

/** The override for one book, or null. `{ rating?, want?, shelf?, updatedAt }` */
export function workOverride(slug) {
  return state().works[slug] ?? null;
}

/** Lay the overrides over a registry record, so a page can render one object. */
export function applyWork(work, slug) {
  const override = workOverride(slug);
  if (!override) return work;
  const merged = { ...work };
  for (const field of ['rating', 'want', 'shelf']) {
    if (override[field] === undefined) continue;
    // A null override is a tombstone from the Worker: the value was cleared on
    // the site after the repo had already recorded it. Render it as absent.
    if (override[field] === null) delete merged[field];
    else merged[field] = override[field];
  }
  return merged;
}

/* ---------------------------------------------------------------------------
 * Telling the pages
 * ------------------------------------------------------------------------- */

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  for (const fn of listeners) {
    try {
      fn(cache ?? state());
    } catch (error) {
      console.error('shelf store listener failed', error);
    }
  }
}

export { StoreError };
