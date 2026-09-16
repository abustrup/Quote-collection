/**
 * quote-shelf — the write path for the quote collection's shelf.
 *
 * The site is a static page on GitHub Pages: it can read the repository's JSON
 * but it cannot write to it. This Worker is the missing half. It accepts four
 * kinds of change from the site — a book's rating, a book's want, a book's
 * shelf, a starred quote — plus whole new quotes, and holds them in D1 until
 * .github/workflows/sync-shelf.yml folds them into data/works.json and
 * data/quotes.json. The repository remains the archive and the plain-text
 * promise of the README holds; this is only the inbox in front of it.
 *
 * Two deliberate shapes:
 *
 * GET /state is public. It is the layer the site draws over the repository
 * JSON on load, so a rating made on his phone shows on his laptop before the
 * sync has run. The collection is public anyway — it is a public site backed by
 * a public repository — so a key on the read path would buy nothing and would
 * cost the site its ability to render for anyone who has not unlocked it.
 *
 * Writes need `Authorization: Bearer <EDIT_KEY>`, and when EDIT_KEY is not set
 * every write answers 503 "editing not configured" rather than 401. The
 * difference matters to whoever is looking at it: 401 says "wrong key", 503
 * says "nobody has set a key yet, this is not your fault". The Worker is
 * deployed before the key exists on purpose, so this is the normal state for a
 * while rather than an error.
 */

const MAX_BODY = 32 * 1024;
const SHELVES = ['read', 'reading', 'to-read', 'abandoned'];
const QUOTE_ID = /^q_[0-9a-f]{12}$/;
const WORK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ---------------------------------------------------------------------------
 * Replies
 * ------------------------------------------------------------------------- */

function cors(origin) {
  // Echoed back only when it matches, never `*`: the write endpoints are
  // credential-bearing, and a wildcard on them would let any page on the
  // internet spend a key a browser is holding. localhost and 127.0.0.1 on any
  // port are here so `npm run serve` can exercise the real Worker.
  if (!origin) return {};
  const ok = origin === 'https://abustrup.github.io'
    || /^http:\/\/localhost(:\d{1,5})?$/.test(origin)
    || /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/.test(origin);
  if (!ok) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const json = (body, status, origin) => new Response(`${JSON.stringify(body)}\n`, {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...cors(origin),
  },
});

/* ---------------------------------------------------------------------------
 * The gate
 * ------------------------------------------------------------------------- */

/**
 * Compare two secrets without leaking their contents through how long it takes.
 *
 * Hashing both first is what makes this safe when the lengths differ: the
 * digests are always 32 bytes, so the comparison runs over a fixed width and
 * says nothing about how much of the key was right.
 */
async function sameSecret(given, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** null when allowed; otherwise the Response to send back instead. */
async function refuseWrite(request, env, origin) {
  if (!env.EDIT_KEY) return json({ error: 'editing not configured' }, 503, origin);
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return json({ error: 'not authorised' }, 401, origin);
  if (!(await sameSecret(match[1], env.EDIT_KEY))) return json({ error: 'not authorised' }, 401, origin);
  return null;
}

/* ---------------------------------------------------------------------------
 * Reading the body
 * ------------------------------------------------------------------------- */

class BadRequest extends Error {}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) throw new BadRequest('that is too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new BadRequest('that is too large');
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequest('that is not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequest('expected a JSON object');
  }
  return parsed;
}

/** undefined means "not mentioned, leave it alone"; null means "remove it". */
function readScore(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new BadRequest(`${field} must be a whole number from 0 to 10, or null`);
  }
  return value;
}

function readShelf(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !SHELVES.includes(value)) {
    throw new BadRequest(`shelf must be one of ${SHELVES.join(', ')}, or null`);
  }
  return value;
}

function trimmed(value, field, { max = 4000, required = true } = {}) {
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

/* ---------------------------------------------------------------------------
 * Endpoints
 * ------------------------------------------------------------------------- */

async function getState(env, origin) {
  const [overrides, pending] = await Promise.all([
    env.DB.prepare('SELECT key, kind, value, updated_at FROM overrides').all(),
    env.DB.prepare('SELECT id, payload, created_at FROM pending_quotes WHERE acked_at IS NULL ORDER BY created_at').all(),
  ]);

  const works = {};
  const favorites = {};
  for (const row of overrides.results ?? []) {
    let value;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue; // A row nobody can parse is a row nobody should be served.
    }
    if (row.kind === 'work') {
      works[row.key.slice('work:'.length)] = { ...value, updatedAt: row.updated_at };
    } else if (row.kind === 'favorite') {
      favorites[row.key.slice('favorite:'.length)] = { on: Boolean(value.on), updatedAt: row.updated_at };
    }
  }

  const quotes = (pending.results ?? []).map((row) => {
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
    }
    return payload ? { id: row.id, payload, createdAt: row.created_at } : null;
  }).filter(Boolean);

  return json({ works, favorites, pending: quotes, generatedAt: new Date().toISOString() }, 200, origin);
}

async function postWork(request, env, origin) {
  const body = await readJson(request);
  const workSlug = trimmed(body.work, 'work', { max: 200 });
  if (!WORK_SLUG.test(workSlug)) throw new BadRequest('work must be a slug like crime-and-punishment');

  const rating = readScore(body.rating, 'rating');
  const want = readScore(body.want, 'want');
  const shelf = readShelf(body.shelf);
  if (rating === undefined && want === undefined && shelf === undefined) {
    throw new BadRequest('nothing to change: send rating, want or shelf');
  }

  const key = `work:${workSlug}`;
  const row = await env.DB.prepare('SELECT value FROM overrides WHERE key = ?').bind(key).first();
  let current = {};
  if (row) {
    try {
      current = JSON.parse(row.value);
    } catch {
      current = {};
    }
  }

  // Merge, keeping an explicit null. A null is a tombstone, not an absence:
  // once a rating has been synced into data/works.json, "clear it" has to
  // travel too, or the site would show the repo's old value again after the
  // next load. The sync script turns a null into a removal in the repo; until
  // then the page treats null and undefined alike.
  const next = { ...current };
  for (const [field, value] of [['rating', rating], ['want', want], ['shelf', shelf]]) {
    if (value === undefined) continue;
    next[field] = value;
  }

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO overrides (key, kind, value, updated_at) VALUES (?, 'work', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, JSON.stringify(next), updatedAt).run();

  return json({ ok: true, work: workSlug, value: next, updatedAt }, 200, origin);
}

async function postFavorite(request, env, origin) {
  const body = await readJson(request);
  const id = trimmed(body.id, 'id', { max: 40 });
  if (!QUOTE_ID.test(id)) throw new BadRequest('id must be a quote id like q_0123456789ab');
  if (typeof body.on !== 'boolean') throw new BadRequest('on must be true or false');

  const updatedAt = new Date().toISOString();
  // `on: false` is stored rather than deleted: the repository may already hold
  // `favorite: true` for this quote, and only an explicit false can undo it.
  await env.DB.prepare(
    `INSERT INTO overrides (key, kind, value, updated_at) VALUES (?, 'favorite', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(`favorite:${id}`, JSON.stringify({ on: body.on }), updatedAt).run();

  return json({ ok: true, id, on: body.on, updatedAt }, 200, origin);
}

async function postQuote(request, env, origin) {
  const body = await readJson(request);
  const payload = {
    text: trimmed(body.text, 'text', { max: 4000 }),
    author: trimmed(body.author, 'author', { max: 200 }),
    work: trimmed(body.work, 'work', { max: 300, required: false }),
    note: trimmed(body.note, 'note', { max: 2000, required: false }),
    year: null,
    tags: [],
  };
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < -800 || year > 2100) throw new BadRequest('year looks wrong');
    payload.year = year;
  }
  if (body.tags !== undefined && body.tags !== null) {
    const tags = Array.isArray(body.tags) ? body.tags : String(body.tags).split(',');
    payload.tags = tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO pending_quotes (id, payload, created_at, acked_at) VALUES (?, ?, ?, NULL)')
    .bind(id, JSON.stringify(payload), createdAt).run();

  return json({ ok: true, id, createdAt }, 200, origin);
}

async function postAck(request, env, origin) {
  const body = await readJson(request);
  if (!Array.isArray(body.ids)) throw new BadRequest('ids must be an array');
  const ids = body.ids.map((id) => String(id)).filter((id) => id && id.length <= 64).slice(0, 500);
  if (!ids.length) return json({ ok: true, acked: 0 }, 200, origin);

  const ackedAt = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `UPDATE pending_quotes SET acked_at = ? WHERE acked_at IS NULL AND id IN (${placeholders})`,
  ).bind(ackedAt, ...ids).run();

  return json({ ok: true, acked: result.meta?.changes ?? 0, ackedAt }, 200, origin);
}

/* ---------------------------------------------------------------------------
 * The router
 * ------------------------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      const headers = cors(origin);
      // A preflight from an origin that is not allowed gets a bare 204: no CORS
      // headers, so the browser refuses the real request, which is the point.
      return new Response(null, { status: 204, headers });
    }

    if (path === '/' || path === '/state') {
      if (request.method !== 'GET') return json({ error: 'GET only' }, 405, origin);
      if (!env.DB) return json({ error: 'no database bound' }, 503, origin);
      if (path === '/') {
        return json({
          service: 'quote-shelf',
          editing: env.EDIT_KEY ? 'configured' : 'not configured',
          endpoints: ['GET /state', 'POST /ping', 'POST /work', 'POST /favorite', 'POST /quote', 'POST /ack'],
        }, 200, origin);
      }
      return getState(env, origin);
    }

    // `/rate` is the name docs/ACCEPTANCE.md item 25 uses for the same thing.
    // Keeping it as an alias costs one line and means the acceptance test can
    // be run literally as written rather than translated first.
    const writes = {
      '/ping': async () => json({ ok: true }, 200, origin),
      '/work': () => postWork(request, env, origin),
      '/rate': () => postWork(request, env, origin),
      '/favorite': () => postFavorite(request, env, origin),
      '/quote': () => postQuote(request, env, origin),
      '/ack': () => postAck(request, env, origin),
    };

    if (!(path in writes)) return json({ error: 'no such endpoint' }, 404, origin);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
    if (!env.DB) return json({ error: 'no database bound' }, 503, origin);

    const refusal = await refuseWrite(request, env, origin);
    if (refusal) return refusal;

    try {
      return await writes[path]();
    } catch (error) {
      if (error instanceof BadRequest) return json({ error: error.message }, 400, origin);
      // Nothing from the exception reaches the caller. What went wrong is in
      // the Worker's own log, where it belongs, not in a public reply.
      console.error(error?.stack || String(error));
      return json({ error: 'something went wrong here' }, 500, origin);
    }
  },
};
