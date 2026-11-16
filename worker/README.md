# worker, the write path

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
| `POST /quote` | `{ text, author, work?, year?, note?, tags?, url?, locator?, workKind?, themes?, subject?, lang?, verification? }` | Files a new quote in the pending list; returns `{ ok, id, createdAt, quoteId }`. `quoteId` is the id the quote will have in `data/quotes.json`, so a caller can link to it before the sync has run. The fields after `tags` are the richer intake, below. |
| `POST /ack` | `{ ids: [...] }` | Marks pending quotes as taken, so the sync never offers them twice. The Action calls this after its commit. |

Bodies over 32 KB are refused. Unknown paths are 404, wrong methods 405, bad
input 400 with a sentence a person can read. Nothing ever returns a stack
trace.

### What a quote can carry (`POST /quote`)

Only `text` and `author` are required. Everything else is optional, and a body
with just the old fields (`text`, `author`, `work`, `year`, `note`, `tags`)
files exactly the payload it always did: the newer fields appear in what is
stored only when they were sent. Fields the Worker does not know are ignored,
not refused. The checks live in `worker/src/intake.mjs`, one function with no
Cloudflare in it, so `tests/worker.test.mjs` can run every one of them.

| Field | What is allowed | If it is wrong |
| --- | --- | --- |
| `text` | up to 4000 characters | 400 |
| `author` | up to 200 | 400 |
| `work` | up to 300 | 400 |
| `note` | up to 2000 | 400 |
| `year` | a whole number, -800 to 2100. Send it whenever the work has one: the sync registers a new work only with a year (see below) | 400 |
| `tags` | a list, or a comma-separated string; at most 20 | extras dropped |
| `url` | **https only**, written out as `https://`, at most 500 characters, no spaces, no login in the address. A timestamp is fine: `https://youtu.be/ID?t=754`. `https:evil.example` and `https:/evil.example` are refused, although a URL parser reads them as https; `HTTPS://…` is accepted and filed with the scheme in lower case | 400 |
| `locator` | free text, at most 200 (a time, a page, a chapter) | 400 |
| `workKind` | one of `book`, `essay`, `paper`, `speech`, `interview`, `film`, `poem`, `letter`, `document`, `song`, `other` | 400 |
| `themes` | a list (or comma-separated string) of the controlled themes in `assets/quote-core.js`. Unknown ones are dropped, repeats too, and at most the first **4** known ones are kept | dropped, never a 400 (except a value that is not a list or text) |
| `subject` | one of the `SUBJECTS` in `assets/quote-core.js`. It belongs to the *work*, not the quote: it is what lets the sync register a work the registry has not heard of (together with a `year`), and what the page filters on | 400 |
| `lang` | two letters, such as `en` or `da`. The quote's own language | 400 |
| `verification` | `{ "status": "reported" or "unverified", "note": "…" }`, note at most 500 | 400 |

Case and surrounding spaces are forgiven in `workKind`, `subject`, `themes`
and `lang` (`" Technology "` is `technology`).

A request, as the video library or the Add dialog sends it (the key is whatever
`EDIT_KEY` is, kept out of this file):

```sh
curl -X POST "$WORKER/quote" \
  -H "authorization: Bearer $EDIT_KEY" -H "content-type: application/json" \
  -d '{
    "text": "The bottleneck is how fast people learn to use the models.",
    "author": "Boris Cherny",
    "work": "Building Claude Code", "year": 2026, "workKind": "interview",
    "url": "https://youtu.be/ID?t=754", "locator": "12:34",
    "subject": "technology", "themes": ["technology", "work"], "lang": "en",
    "verification": { "status": "reported", "note": "Heard in the video." }
  }'
# {"ok":true,"id":"…","createdAt":"…","quoteId":"q_…"}
```

A browser may call it from `https://abustrup.github.io` or from `localhost` and
`127.0.0.1` on any port (see CORS below). Any other page is refused by the
browser before the key is sent.

**Nothing stronger than `reported` passes the intake.** `verified` means
someone compared the wording with the primary text, and that happens in the
collection after a quote is filed, never in a request body. A request that
says `verified` (or `disputed`, or anything else off the list) is **refused**
with a 400 and a sentence that says why, rather than quietly weakened: a client
that asks for `verified` has a bug worth hearing about. The sync holds the same
line a second time (see below) for any row that reached the database some other
way.

### What the sync does with them

`scripts/apply-shelf-state.mjs` turns a pending quote into a record the same way
it always has, and now also fills `source` (`{ kind: "manual", url, locator }`),
`workKind`, `themes`, `lang` and `verification` (default `unverified`) from the
payload. A value that is not allowed is dropped with a warning and the quote is
filed anyway: one odd row must not be able to stop every sync after it.

When the quote names a work that is **not** in `data/works.json`, and both a
`subject` and a `year` came with it, the work is registered there too, with
`title`, `author`, `year`, `kind` (the quote's `workKind`, else `other`),
`subject` and, if the quote carried a link, `url` with the time and sharing
parameters taken off a YouTube address (`youtu.be/ID?t=754` becomes
`youtu.be/ID`). It goes in at its place in the registry's order (by title,
ignoring case), the order `register-work.py` keeps.

**The sync needs the year.** `tests/works.test.mjs` says every work
the collection quotes has a subject and an era, an era is computed from the
year, and `register-work.py` insists on `--year` for the same reason. A work
registered without one would turn that test red at the next human push, with a
message nobody on a phone can read, and the sync's own commit does not start CI,
so nobody would see it until then. So with a subject but no year the sync files
the quote, leaves the work unregistered, and says so in the warnings. The quote
is then unclassified, exactly like any quote that names a work the registry has
not heard of, until someone runs `register-work.py` with the year. The Add
dialog asks for the year up front in that case; **a client that files a quote
with a subject for a new work, such as the video library, must send `year`**
(the video's publish year is fine) or the subject is lost. Without a subject
nothing is registered either, and the build warns as it always has.

A title that differs from a registered one only in case, spacing or punctuation
(it slugs the same, which is how the page tells works apart) is read as the
registered one, and the quote is given the registry's spelling, because the page
finds a work by its exact title.

A work is registered for a quote that was filed, or for a quote whose empty
`work` this row filled in, and for no other. A row that only repeats words the
collection already has changes nothing and registers nothing, whatever work and
subject it names, because that work would have no quote under it. Each row keeps
its own subject: two rows with the same words and different works are two
requests, and the first one filed wins. A repeat that names a *different* work
from the one the record already has gives that record no year and no kind of
work either (a repeat sent from a 2020 interview would otherwise stamp 2020 on a
quote from a 1932 novel), and a line in the warnings says so. A quote refused as
removed registers nothing.

A link in a stored payload is held to the Worker's own rule, from the same
function (`addressProblem` in `worker/src/intake.mjs`), so the two cannot
disagree about what an https address is.

A pending quote that fails the collection's own checks is set aside, with a line
in the warnings, and acked so it is not offered again. The Worker only asks for
some text, and one character is not a quotation: left in, it would fail the
whole collection at validation and stop every sync after it, with every rating
and star waiting behind it.

The sync workflow may still write only `data/works.json` and `data/quotes.json`.

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

The Worker imports `../assets/quote-core.js` for the lists of themes, subjects
and kinds of work, so there is one list and the intake cannot drift from the
collection. Wrangler bundles that file into the Worker when it deploys; nothing
has to be copied. (Checked on 2026-11-15 with `wrangler dev --local`, which
bundles the same way.)

The tests run without Cloudflare: `node --test tests/worker.test.mjs` drives the
Worker itself over a real SQLite database built from `schema.sql` (D1 is
SQLite), and needs `node:sqlite`, which Node 22.13 and later have.

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
