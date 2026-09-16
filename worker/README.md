# worker — the write path

The site is a static page on GitHub Pages. It can read `data/works.json` and
`data/quotes.json`, and it cannot write a word back. This little Worker is the
missing half: rate a book, move it to another shelf, star a quote or add a
quote from the phone, and the change lands here immediately and reaches the
repository within three hours, when `.github/workflows/sync-shelf.yml` folds it
into the data files. The repository stays the archive. This is the inbox.

- **Live:** <https://quote-shelf.abustrup.workers.dev>
- **Database:** D1, `quote-shelf`, id `64f30891-d818-4b4d-8e39-f92af6b82016`
- **Cost:** nothing. Workers free tier is 100,000 requests a day; D1 free tier
  is 5 GB and 5 million row reads a day. This stores a few hundred small rows
  and is read once per page load.

## What it can do, and what it cannot

The Worker holds one D1 database and nothing else. It cannot reach GitHub, it
has no token for anything, and it cannot read or change the repository. The
worst a stolen edit key can do is write wrong ratings and junk quotes into this
database, which the next sync would carry into a commit that is visible in the
history and revertible in one click. That is the whole blast radius, and it is
why the key is a plain shared secret rather than a login.

## Endpoints

`GET /state` is public and unauthenticated. Everything else needs
`Authorization: Bearer <EDIT_KEY>`.

| Endpoint | Body | Does |
| --- | --- | --- |
| `GET /state` | — | `{ works, favorites, pending, generatedAt }` — the layer the site draws over the repository JSON |
| `POST /ping` | — | Answers 200 if the key is right. This is what "unlock" on the site calls. |
| `POST /work` | `{ work, rating?, want?, shelf? }` | Merges into that book's row. `null` removes a field; a row with nothing left is deleted. `POST /rate` is an alias. |
| `POST /favorite` | `{ id, on }` | Stars or unstars a quote. `on: false` is stored, not deleted, because the repository may already say `favorite: true`. |
| `POST /quote` | `{ text, author, work?, year?, note?, tags? }` | Files a new quote in the pending list; returns its `id`. |
| `POST /ack` | `{ ids: [...] }` | Marks pending quotes as taken, so the sync never offers them twice. The Action calls this after its commit. |

Bodies over 32 KB are refused. Unknown paths are 404, wrong methods 405, bad
input 400 with a sentence a person can read. Nothing ever returns a stack
trace.

`shelf` is one of `read`, `reading`, `to-read`, `abandoned`. `rating` and
`want` are whole numbers 0–10. `work` is the slug of the title, the same one
`assets/quote-core.js` makes, e.g. `crime-and-punishment`.

## The key

`EDIT_KEY` is a Worker secret. **While it is unset, every write answers 503
`{"error":"editing not configured"}`** — deliberately not 401, because 401
would say "you got the key wrong" when the truth is that nobody has set one
yet. The site reads that 503 and says editing is not set up, rather than
pretending the change was saved.

To set it (Alexander, or whoever is holding the key — it never passes through
a chat or a file in this repository):

```sh
cd worker
npx wrangler secret put EDIT_KEY      # paste the value at the prompt
```

The same value goes into the repository secret `SHELF_EDIT_KEY` so the sync
Action can call `POST /ack`, and into the site's unlock box once per device.

## Working on it

```sh
cd worker
npx wrangler dev --local --var EDIT_KEY:localtest   # a throwaway test key
npx wrangler d1 execute quote-shelf --local --file=schema.sql
npx wrangler deploy
npx wrangler tail                                   # watch live requests
```

`--var EDIT_KEY:localtest` only exists inside that local session. Deploying
never carries it anywhere.

## CORS

Replies carry `Access-Control-Allow-Origin` only for
`https://abustrup.github.io`, `http://localhost:<port>` and
`http://127.0.0.1:<port>`, echoed back exactly. Never `*`: the write endpoints
carry a key, and a wildcard would let any page on the internet spend it.

## Where the data goes

`overrides` rows stay forever and are applied on every sync. That is on
purpose: the same override applied twice is a no-op, and throwing the row away
after the first sync would make a rating flicker off on every other device
between the change and the next run.

`pending_quotes` rows are an inbox with a receipt: the sync Action acks them
after its commit lands, and an acked row is kept rather than deleted so there
is a record of what arrived this way.
