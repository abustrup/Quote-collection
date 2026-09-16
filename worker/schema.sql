-- The whole store: two tables, both small, both readable by eye in the D1 console.
--
-- `overrides` is a layer, not a copy. One row per thing he has changed from the
-- site — a rating, a want, a shelf, a starred quote — keyed so the site can
-- lay it straight over the repository JSON without matching anything up. The
-- rows stay after the sync Action has written them into data/works.json,
-- because applying the same override twice is a no-op and losing the layer
-- between a change and the next sync would make the change flicker away on
-- every other device.
--
-- `pending_quotes` is the opposite: an inbox. A quote added from the site sits
-- here until the Action has committed it, then gets an `acked_at` and is never
-- offered again. Acked rows are kept rather than deleted so there is a record
-- of what came in this way.

CREATE TABLE IF NOT EXISTS overrides (
  key        TEXT PRIMARY KEY,   -- 'work:<slug>' or 'favorite:<quote id>'
  kind       TEXT NOT NULL,      -- 'work' | 'favorite'
  value      TEXT NOT NULL,      -- JSON: {rating,want,shelf} or {on}
  updated_at TEXT NOT NULL       -- ISO 8601, UTC
);

CREATE INDEX IF NOT EXISTS overrides_by_kind ON overrides (kind);

CREATE TABLE IF NOT EXISTS pending_quotes (
  id         TEXT PRIMARY KEY,   -- crypto.randomUUID()
  payload    TEXT NOT NULL,      -- JSON: {text,author,work,year,note,tags}
  created_at TEXT NOT NULL,      -- ISO 8601, UTC
  acked_at   TEXT                -- NULL until the sync Action has committed it
);

CREATE INDEX IF NOT EXISTS pending_unacked ON pending_quotes (acked_at);
