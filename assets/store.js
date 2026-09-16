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
 * Worker by months. So `favorites()` is the union of the server's and that
 * list, and toggling writes both.
 */

const API_FALLBACK = 'https://quote-shelf.abustrup.workers.dev';
const SOURCES_URL = 'data/sources.json';
const TIMEOUT_MS = 2500;

const KEY = {
  state: 'shelf-state',
  code: 'shelf-edit-code',
  queue: 'shelf-queue',
  legacyFavorites: 'quotes-favorites',
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
    if (patch[field] === null) delete next[field];
    else next[field] = patch[field];
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
    writeLegacyFavorite(id, Boolean(before?.on));
    announce();
    throw error;
  }
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

/* ---------------------------------------------------------------------------
 * Favourites
 * ------------------------------------------------------------------------- */

function legacyFavorites() {
  const raw = read(KEY.legacyFavorites, []);
  return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
}

function writeLegacyFavorite(id, on) {
  const set = legacyFavorites();
  if (on) set.add(id);
  else set.delete(id);
  write(KEY.legacyFavorites, [...set]);
}

/**
 * Every starred quote id: the server's, plus the ones this browser has held
 * since before there was a server.
 *
 * Union rather than replacement, and the server's explicit `off` wins over the
 * old list — unstarring has to be able to remove something that was starred
 * here first, or nothing could ever be unstarred.
 */
export function favorites() {
  const current = state();
  const set = legacyFavorites();
  for (const [id, entry] of Object.entries(current.favorites)) {
    if (entry?.on) set.add(id);
    else set.delete(id);
  }
  return set;
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
