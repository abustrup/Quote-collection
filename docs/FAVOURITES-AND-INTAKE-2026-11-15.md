# Favourites and the richer intake, 2026-11-15

Two things changed on this day, in one piece of work: his favourites were made
permanent, and the Worker learned to take a fully described quote so the video
library can file one straight into the collection.

This note says what happened, what changed, and what a later session must not
undo.

## What happened to the favourites

The star under a quote kept its answer in the browser (localStorage, under
`quotes-favorites`) unless editing had been unlocked on that device. Unlocked, a
star went to the Worker and from there into `data/quotes.json` at the next sync.
No unlocked device ever saved one. So the repository held none (checked on
2026-11-15: 49 commits touch `data/quotes.json`, the first on 2026-07-29, and no
commit ever added `"favorite": true`), the Worker held none, and every favourite
he had was one cleared browser from gone.

A star pressed while editing was locked also said nothing. It lit, and the only
copy was on that device. That silence is how they were lost.

On 2026-11-15 the live list was read out of his Chrome: 21 quote ids. All 21
quotes still exist in `data/quotes.json`.

## What changed

**The 21 are permanent.** `favorite: true` on exactly these records in
`data/quotes.json`, written with the sync's own tooling so the file's key order,
indentation and trailing newline are untouched. The diff is those 21 flags and
the file's `updatedAt`, nothing else.

```
q_e953bba08991 q_5a4c99cfdb9c q_cac50b1a95eb q_c0322df2721c q_5aa7ae76625f
q_9f51b5b578d5 q_0eda5c164429 q_c93a39ee67d5 q_da9dde0f30bf q_2480f82fc9c8
q_ab67473361ab q_c772217e7356 q_61a86e1a3731 q_8af70fe8f185 q_a02beaa0e8e6
q_a2fba4e3a8f2 q_82157dfdf6c9 q_9e3b0f08117c q_9cb1aff5ffda q_0136c7b60e83
q_c441fc6f7ae1
```

**The page shows them.** Before this day the page ignored a record's own
`favorite` flag, so even with the flags set the star and the Favourites count
would have stayed empty. A star now has four homes, and `store.favorites()`
lays them over each other:

| Layer | Where it lives | What it can do |
| --- | --- | --- |
| 1. Repository | `favorite: true` in `data/quotes.json` | The floor. Survives every browser and device. |
| 2. Worker | `GET /state` `favorites`, written when unlocked | Adds a star. An explicit `on: false` takes away a star the repository has. |
| 3. Old browser list | `quotes-favorites` (stars only, no times) | Adds a star on this browser. Older than the Worker, so any Worker answer beats it. |
| 4. Local choices | `quotes-favorites-choices`: `{ id: { on, at } }` | A star or un-star pressed here while locked. Wins over the Worker only when it is newer. |

With an empty browser and a Worker that knows nothing, the page shows exactly
the 21 (checked in headless Chrome on 2026-11-15: 21 stars pressed, count 21,
and the Favourites filter lists 21 quotes). A locked visitor can still star, and
can still un-star something the repository starred, on that device. The count
only counts quotes the page has, so a star on a removed quote cannot inflate it.

**A locked star says so.** The star is still kept on the device, and now a toast
says "Saved on this device only. Unlock to keep it everywhere." (Danish: "Gemt
kun på denne enhed. Lås op for at beholde det overalt.") with an Unlock action.
It shows at most once per page load, stays seven seconds, and on a phone it
takes the width of the screen and wraps over two lines (without that rule it
was a narrow tower of four lines, because the toast is sized by the half of the
screen to the right of its centre). Unlock opens the existing dialog in
`assets/add-quote.js`, in an unlock-only mode (title "Unlock editing", no quote
fields). There is still one unlock panel in the page, not two.

**Unlocking carries the stars up.** After a successful unlock, and on any later
load that is unlocked, the store sends the Worker what was pressed while locked.
It leaves out stars the repository already has (they could only ever go stale as
database rows), quotes the page does not have, and anything the Worker has a
newer answer on. The old browser list is carried the same way, so stars on his
other devices are recovered the first time he unlocks them.

**The unlock field suits password managers.** It is a real `<form>`: a visible,
read-only username field holding "Alexander" (`autocomplete="username"`) and the
code field as `type="password"`, `name="password"`,
`autocomplete="current-password"`. iCloud Keychain on his iPhone can store the
code once and fill it on every device. The code is never printed, logged or put
in an address. Checked in iOS Safari in the iPhone 17 simulator on 2026-11-15
against a local Worker: tapping Unlock in the toast opens the dialog, focusing
the code field puts the "Passwords" suggestion above the keyboard, and the
Return key submits the form, unlocks, and sends the star that was pressed while
locked to the Worker. Not checked: saving to and filling from a real iCloud
Keychain, which the simulator does not have.

Every field in the dialog is 16px on a touch screen. Below that, iOS Safari
zooms the page when a field gets focus and leaves it zoomed, with the dialog cut
off at the right edge. The code field was 13.6px and did exactly that, which was
found by tapping through it in the simulator.

**The Worker takes a richer quote** (`POST /quote`). New optional fields: `url`
(https only, at most 500 characters, may carry a timestamp), `locator` (200),
`workKind`, `themes` (controlled list, at most 4, unknown ones dropped),
`subject`, `lang` and `verification` (`reported` or `unverified` only, note at
most 500). Unknown fields are ignored and an old payload is stored exactly as
before. The full table is in `worker/README.md`. The reply now also carries
`quoteId`, the id the quote will have in the collection.

**A request that claims `verified` is refused**, with a 400 and a sentence that
says why, instead of being quietly downgraded. A client that asks for it has a
bug and should hear about it. The sync holds the same line for any row that got
into the database some other way: it files such a quote as `unverified` and
puts a line in the warnings.

**The sync turns them into the record.** `scripts/apply-shelf-state.mjs` fills
`source` (`manual`, `url`, `locator`), `themes`, `workKind`, `lang` and
`verification` (default `unverified`). When the quote names a work that is not
in `data/works.json`, and a subject and a year came with it, the work is
registered there (`title`, `author`, `year`, `kind`, `subject`, and a `url` with
the timestamp taken off a YouTube address), at its place in the registry's
order, so the quote is visible under its subject filter after the sync. A title
that differs from a registered one only in case, spacing or punctuation (it
slugs the same, which is how the page tells works apart) takes the registry's
spelling, so the registry never gets two works that the filters cannot tell
apart. A pending quote that fails the collection's own checks, such as a single
character, is set aside with a line in the warnings and acked, because left in
it would fail the whole collection and stop every sync after it (found by
feeding the sync 2,860 odd quotes; 667 of them did exactly that before this
rule). Favourites are now applied after pending quotes are merged, so a star on
a quote that arrives in the same run lands in that run. The sync workflow
itself is unchanged and still writes only `data/works.json` and
`data/quotes.json`.

The rules for what gets registered are in the next section, because they were
settled on review, with a decision in them.

**Pending quotes keep what they carry.** Until the sync runs, a pending quote
lives only in `GET /state` and the page draws it on top of the repository. It
now keeps its source link and place in it, kind, themes, language and
verification. Its subject comes from the work's registry record, and when the
work is not registered yet the sender's own subject is the fallback, so the
quote shows under its subject filter at once.

**The Add dialog** has a Subject select (empty by default, remembers the last
choice in `quotes-add-subject`), a folded "Source details" part (link, where in
it, kind of work), and an address prefill for the video library's fallback link:
`?add=1&text=…&author=…&work=…&year=…&url=…&locator=…&kind=…&subject=…`. The
dialog opens filled in and the parameters are taken out of the address bar, so a
reload does not reopen it. What is read from the address is capped and checked,
set as plain text only, and no secret is read from it.

**One old bug fixed on the way.** Whenever the pending list changed while the
page was open (right after filing a quote, or when the Worker's state arrived),
the filter menus were filled a second time on top of themselves, so every author
and work appeared twice. They are now emptied first.

## Settled on review, 2026-11-16

An independent review of the work above found seven things (one major, six
minor). This is what was done about them, and the one decision in them.

**A work is registered only when a year came with it (the decision).** The first
version registered a new work that had a subject and no year. The page copes
with that, and the registry's validators only warn, but `tests/works.test.mjs`
("every work the collection quotes has a subject and an era") fails on it. So
`npm test` and the Check workflow would go red at the next human push, with a
message Alexander cannot read, and the sync's own commit does not start CI, so
nobody would see it before then. The Add dialog made it likely: Year is optional
and the last Subject is pre-selected. Now:

- The sync registers a new work only with a subject and a year, the same demand
  `register-work.py` makes (`--year` is required there). With no year it files
  the quote, leaves the work unregistered, and says so in the warnings. The
  quote is then unclassified, which is what has always happened to a quote that
  names a work the registry has never heard of. That also fails the era test, and
  the cure is the same as it always was: run `register-work.py` with the year. So
  skipping avoids a new kind of half-registered work. It does not make that test
  green, and this note does not claim it does.
- The Add dialog requires the year when a Subject is chosen and the typed work is
  not one the registry already has. It already loads the titles. A title matches
  in any case, by its slug and after the alias list, as the sync matches it. The
  message appears at the field: "A new work needs a year. Type it, or choose no
  subject." (Danish: "Et nyt værk skal have et år. Skriv det, eller vælg intet
  emne.") If the registry cannot be loaded the dialog does not guess, and asks
  for nothing extra.
- The page draws a pending quote under its subject filter only when the year came
  too (`pendingQuotes`). Otherwise it would show the quote under a subject for up
  to three hours and then drop it out, when the sync leaves the work unregistered.
- The video library must send `year` with `subject` for a new work. Its publish
  year is fine. Without one the subject is lost at the sync.

The alternative was not taken, because it changes a test outside this piece of
work and is Alexander's call: let `tests/works.test.mjs` accept a registered work
with no year. The era filter would simply not list it, and the validators already
treat it as fine. The sync could then register year-less works and every quote
would stay visible under its subject. It is a one-line change to that test. What
it decides is whether "every quoted work has an era" is still the rule.

**A work is registered for a quote that was filed, and for no other.** The sync
now files the pending quotes one at a time and registers a work only for a row
that added a quote, or filled in the empty `work` of one the collection already
had. A row that only repeats words the collection holds changes nothing and
registers nothing, and each row keeps its own subject. Before, there was one
subject per quote id, so two rows with the same words and different works lent
each other theirs, and a repeat left a registry entry with no quote under it. A
repeat that names a different work from the one the record has no longer lends
that record a year or a kind of work either. Before, a repeat from a 2020
interview stamped 2020 on a quote from a 1932 novel (found while testing this
fix). The merge rule in `assets/quote-core.js` fills any empty field from a
repeat and is shared by the importers, so the guard is in the sync.

**A star that could not be saved says so.** `setLocalFavorite` now returns
whether the browser took the write. When site data is blocked or storage is full
the page says "Could not save that on this device." (Danish: "Kunne ikke gemme
det på denne enhed.") and the star goes back. Before, it showed the "Saved on
this device only" toast over a star that had not been saved, which was the old
silence in a new place.

**A bad link in the folded Source details cannot block Add in silence.** The
browser cannot point at a field inside a closed `<details>`, so it refused the
submit and showed nothing. The dialog now unfolds the details when a field inside
them is invalid and focuses the field itself. The focus call matters in Safari:
tried on a small probe page in the iPhone 17 simulator on 2026-11-16, Safari
unfolded the section but focused nothing and showed no message until the handler
focused the field, and then it pointed at it and showed its own "Enter a URL"
bubble. Safari shows no message of its own for the year rule at all (it only moves
the cursor to the field), so both fields also get their words on the page, under
the field, in the language of the page: "That is not a web address. It should
start with https://." and "A new work needs a year. Type it, or choose no
subject." They go as soon as the field is edited. They sit under the field,
because Safari scrolls the field to the top of what is left above the keyboard,
so what is under it stays in view (a first version put them above the field and
they were scrolled out of sight).

**One rule for what an https address is.** `https:evil.example` and
`HTTPS://EXAMPLE.COM/x` were both accepted, because a URL parser reads them as
https, while the registry's validator and `register-work.py` want a literal
`https://`. The Worker and the sync now share one function (`addressProblem` in
`worker/src/intake.mjs`): the text has to start with `https://`, in any case, and
it is filed with the scheme in lower case.

**The shelf page's unlock card is a password-manager form too.** It has the same
username field and `current-password` field as the Add dialog, and 16px fields on
a touch screen. It is still a card of its own (`works.html`). Pointing it at the
dialog in `add-quote.js` would be a larger change to `assets/works.js` and was
not made.

**The page behaviour is checked now.** `scripts/checks/favourites.mjs`, run by
`npm run check:ui`, presses a star in a real browser, with a stand-in for the
Worker. It checks the toast in English and Danish, once per page load, the Unlock
action, the unlock-only dialog, the form attributes, a wrong code kept out of the
address and the calls, the push of every locked star on unlocking, the
storage-blocked case, the folded link, the year rule and the shelf card.

## What a later session must not undo

- **Do not remove the 21 flags, and do not let any tool reset them.** Anything
  that rewrites `data/quotes.json` has to carry `favorite` over. An importer that
  rebuilds records from scratch would quietly un-star all of them.
- **Do not make the page write the whole favourites set into the browser's old
  list.** The old `writeFavorites` did, and with the repository's flags in the set
  that would copy the repository into every browser, after which a star removed
  elsewhere would keep coming back. Only what was pressed is written
  (`setLocalFavorite`).
- **Do not let `verified` through the intake**, and do not loosen https. Checking
  a quote against its source happens in the collection (the quote-mine skill),
  never in a request.
- **Keep `store.js` importing `add-prefill.js`.** It looks like an unused import.
  It is the reason the collection page does not show a filtered, empty list
  behind the dialog: the prefill reuses `author`, `work` and `subject`, which the
  page also reads as filters, and the prefill must take them out of the address
  before `app.js` looks. `store.js` is the one file guaranteed to load first.
- **Keep the unlock panel a real `<form>`** with the username and password
  fields, and keep the quote fields associated to their form with the `form`
  attribute. A form inside a form is not allowed, and a code field that is not in
  a form of its own is invisible to a password manager.
- **Keep the 3-hour sync's reach as it is.** The workflow may write only
  `data/works.json` and `data/quotes.json`, and has no token beyond its own.
- **Keep the sync failing soft on one bad quote.** A pending quote that cannot
  pass the collection's own checks is set aside and acked in
  `preparePending`. Taking that out makes a single one-character quote stop
  every later sync, ratings and stars included, until someone edits the database
  by hand.
- **Do not register a work without a year**, and do not take the year rule out of
  the Add dialog or the matching rule in `pendingQuotes`. See the decision above.
  If the era test is changed to allow year-less works, change all three together.
- **Keep the sync filing quotes one at a time** (`fileQuotes`), with the subject
  on the row and a work registered only for a row that added a quote or filled
  its work. Going back to one subject per quote id brings back the registry
  entries with no quote and the borrowed subjects.
- **Keep `setLocalFavorite` reporting failure, and the page acting on it.** A
  toast that says "saved" over a write the browser refused is how favourites were
  lost in the first place.
- **Keep the capture-phase `invalid` listener in the Add dialog, with its
  `focus()` call.** Without the listener a bad link inside the folded details
  blocks Add with nothing shown. Without the `focus()` Safari unfolds the details
  and points at nothing. Chrome cannot tell you the second is gone, because it
  focuses the field by itself.
- **Keep one rule for https addresses** (`addressProblem`), used by the Worker and
  the sync. A second copy drifts, and that is how the two came to disagree.
- **Keep `scripts/checks/favourites.mjs` in the list in `scripts/check-ui.mjs`.**
  It is the only thing that looks at the toast and the unlock form in a browser.

## What still needs doing

- **Deploy the Worker.** Until it is deployed, the live Worker keeps its old
  intake: it accepts a quote with the new fields and silently drops them, because
  it only ever copied the fields it knew, and its reply has no `quoteId`.
  Nothing breaks, but a quote filed from the Add dialog loses its subject, link,
  place in it and kind until the new Worker is live, and a caller that reads
  `quoteId` gets nothing. The deploy is `npx wrangler deploy --cwd worker`, by Alexander,
  after review. The Worker now bundles `assets/quote-core.js`, which was checked
  to build under `wrangler dev --local`.
- **Try the unlock once on the real iPhone.** Type the code, submit, and see
  whether iOS offers to save it. If it does, the next device fills it. If it
  does not, say so: a possible fix is a short pause between the successful
  unlock and the dialog closing, so Safari sees the form go away. That is a
  guess and was not tried.
- **Decide the year rule** (Alexander): keep it as it is, or let
  `tests/works.test.mjs` accept a registered work with no year. See "Settled on
  review".
- **Tell the video library to send `year`** with `subject`, or the subject is lost
  at the sync when the work is new.
- **The shelf page's unlock card** now has the username and `current-password`
  fields, but it has not been tried on a real iPhone either.

## Where each thing lives

| Thing | File |
| --- | --- |
| The four-layer rule, the local save, the push on unlock | `assets/store.js` (`mergeFavorites`, `setLocalFavorite`, `pushLocalFavorites`) |
| The toast and the star | `assets/app.js` (`toggleFavorite`, `noteDeviceOnly`, `refreshFavorites`) |
| Pending quotes as the page draws them | `assets/store.js` (`pendingQuotes`) and `assets/app.js` (`withPending`) |
| Unlock form, Subject, source details, prefill | `assets/add-quote.js` and `assets/add-prefill.js` |
| What the Worker will file | `worker/src/intake.mjs` |
| Quote and work registration | `scripts/apply-shelf-state.mjs` (`preparePending`, `fileQuotes`, `registryIndex`) |
| The one https rule | `worker/src/intake.mjs` (`addressProblem`, `filedAddress`) |
| The year rule in the Add dialog | `assets/add-quote.js` (`isNewWork`, `syncYearRule`) |
| Tests | `tests/shelf-state.test.mjs`, `tests/favorites.test.mjs`, `tests/worker.test.mjs`, `tests/prefill.test.mjs` |
| The page, in a real browser | `scripts/checks/favourites.mjs`, run by `npm run check:ui` |
