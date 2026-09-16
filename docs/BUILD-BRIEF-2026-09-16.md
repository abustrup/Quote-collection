# Build brief — the shelf and the front page, 2026-09-16

Read `docs/PLAN-2026-09-16.md` (decisions) and `docs/ACCEPTANCE.md` (the bar)
first. This brief is what three design mockups and three judges settled, so
that the two builders start from one picture. The mockups live in
`docs/mockups/{bookseller,swiss,motion}/` with screenshots; they will be
deleted after the build, so lift what is named below into the real files.

## The verdict

**Bookseller won on beauty and fidelity (9 / 6 / 5)**: it is the only mockup
that reads as a shelf — books standing at their real proportions on painted
ledges with a contact shadow, the last book of a short row leaning, a warm
cream room, a gold accent spent on three things, and a dark edition that is
still beautiful. **Swiss won on engineering (8 / 7 / 6)**: one persistent node
per work, a two-field score model, a FLIP that leaves nothing resident.
**Motion owns the best interactions**: the shared-element open, the keyboard
parity, a rating control that survives a keypress, and the pulled quote in the
detail. The build is bookseller's page with swiss's engine and motion's
interactions.

## Two builders, two sets of files

| Builder | Owns | Must not touch |
| --- | --- | --- |
| **Shelf** | `works.html`, `assets/works.js` (rewrite), `assets/shelf.css` (new), `assets/nav.js` + `assets/nav.css` (new, shared — build these FIRST, within the first minutes, because the other builder consumes them), `scripts/checks/shelf.mjs`, and the lazy-image amendment in `scripts/check-ui.mjs` (rule 17 below) | `index.html`, `assets/app.js`, `assets/app.css`, `assets/quote-core.js`, `data/*`, `package.json` |
| **Collection** | `index.html`, `assets/app.js`, `assets/app.css`, `assets/add-quote.js` (new), `scripts/checks/collection.mjs`, and the one-line nav mount in `scout.html`, `suggest.html`, `import.html` | `works.html`, `assets/works.js`, `assets/shelf.css`, `assets/nav.*` (consume only; if it does not exist yet, build the rest first and come back), `assets/quote-core.js`, `data/*`, `package.json` |

Both register their own strings with `register({...})` from `assets/i18n.js`;
neither edits that file. Both read `assets/store.js`; neither edits it. Neither
commits: the orchestrator commits. Neither edits `package.json`: list scripts
in the report.

## The shared header — `assets/nav.js` + `assets/nav.css`

`mountNav({ active, variant })` renders into `<header id="site-nav">`:

- `variant: 'bar'` (the shelf, the board, read-next, import): brand
  "Lines Worth Keeping" left (link to `./`), then Quotes · **Shelf** · Board ·
  Read next as pills, Shelf styled as the primary destination (filled gold pill
  with a small book glyph, as in bookseller's header), then a small outline
  "+ Add" pill, then right: the `DA`/`EN` toggle from `langToggle()` and a
  light/dark toggle (paper ↔ night; from folio or index it goes to night, and
  back to paper).
- `variant: 'row'` (the front page): the same nav pills centred under the
  masthead's dek, with the two toggles top-right of the masthead, exactly as
  bookseller's `frontpage.html` shows.
- "+ Add" dispatches a `quotes:add` CustomEvent on `document`; if nothing
  handles it within the same tick (`event.defaultPrevented` is false), it
  opens the GitHub issue form in a new tab as today.
- All labels via `t()`; the toggles are real `<button class="pill">`s (the
  harness only measures `.pill` tap targets).

## The shelf page — what to build

**Page order:** header (bar) → masthead: stats line in small caps
("92 books · 25 talks & essays · 239 quotes", live counts), display headline
"The shelf" / "Hylden", one-sentence dek → the hero → the control row → the
sections.

**Hero:** the most recently added `reading` book stands large on its own
ledge (bookseller's card, cover ~220 px wide) with `perspective: 1200px` and a
gentle pointer-tracked tilt (±6°) on a spring (motion's `spring2d`), a kicker
"Currently reading", title, author · year · pages, the rating control labelled
"How much do I want to read it", and the primary gold pill "Read the quotes".
Under it one quiet line of text, not tiles: "Also reading: … · …" (the other
`reading` books, linked) and "Last added: … · Best rated: … 10/10". No mini-cards.

**Control row:** search (title or author), chips All · Reading · Read · Want
to read · Did not finish (with counts), and an Arrange select: Shelf status
(default) · Subject · Author · Year written · Date added · Date read · Rating ·
How often quoted. It sticks to the top on scroll, solid (no blur).

**Sections:** by shelf status the order is Reading, Read (newest read first,
then newest added), Want to read (highest want first, then newest added), Did
not finish, then "Not on a shelf yet" (books quoted but never shelved; 4
today), then "Talks & essays" (every non-book work, typographic covers, no
rating or shelf control, but the same open-to-detail and "Read the quotes").
Other arrangements use bookseller's `groupsFor` table (author bands, era
groups for year, year groups for dates, rating bands); talks and essays join
those groups where the key applies (an essay from 2024 belongs in "2020s").

**Books on ledges:** bookseller's `.ledge` (one repeating gradient per
wrapped row, keyed off `--row-h`), `.cover-box::before` spine and paper
highlight, `.cover-box::after` contact shadow. Row height is one constant per
shelf scale; a book with a known page count may vary ±8% from it, one without
stays at the constant (never fabricate). Width comes from `coverSize` when the
registry has it, else 2:3; never crop a cover. The last book of a short row
leans (bookseller's `applyLean`, but computed from the rects you already
measured, not re-read per ledge). Typographic covers for non-books: swiss's
layout (kind · year in small caps over a hairline, the title in the largest
serif the spine allows, author on a baseline at the foot), sized with
container queries (motion's `cqw` clamp), tinted warm and low-chroma from the
slug (bookseller). Titles wrap to two lines with an ellipsis, never hyphenate.

**Hover / focus:** the book lifts 9 px clear of the ledge, tilts up to 4°
toward the pointer, the shadow deepens and the contact shadow spreads; a cream
popover appears beside it (created on demand, viewport-nudged) with serif
title, author, year · pages, the shelf word as an outline pill, the score as
small gold stars, and "N quotes" in gold. Keyboard focus gets the identical
lift (motion's `.book-btn:focus-visible .cover`). Hover transforms are
suspended while a FLIP plays (`.is-flipping`).

**Open (click, tap, Enter):** the detail. A centred sheet at 1440 (max ~880 px
wide), full-screen at 390. Left: the cover at ~280 px wide on a ledge stub
with the same gentle tilt. Right: kicker "literature · book", title, author,
one meta line (year · pages · added · read · N quotes), a pulled quotation
(the shortest from the work; `typographic()` from quote-core) in italic serif
against a 2 px gold left rule, the rating control with its label, the shelf
pills (Reading · Read · Want to read · Did not finish, plus a quiet "Remove
from shelf"), then one filled gold pill "Read the quotes · N" (`./?work=<slug>`,
relative, never root-absolute) with "On Goodreads" and "Find it" as underlined
text links beside it. Below: "Next to it on the shelf", seven neighbours in the
current arrangement at ~90 px tall, each opening its own detail. Top right a
pill "Close  esc". Opening uses the View Transitions API with a single
`view-transition-name` handed from the card cover to the detail cover (motion's
`openBook`/`closeBook`, the name never on two elements at once) and a measured
translate+scale fallback; the meta staggers in 30 ms apart; closing reverses.
Full dialog semantics: `role="dialog" aria-modal="true" aria-labelledby`, focus
moves in, Tab is trapped, Escape and scrim click close, focus returns to the
book that opened it. `works.html#<slug>` deep-links open the detail on load.

**Rating control:** ten gold stars as ten persistent `<button>`s (44 px hit
areas, `radiogroup` semantics, swap only classes and contents so focus
survives). The label is "How good was it" when the edited shelf is read or
abandoned, "How much do I want to read it" otherwise, and flips the instant
the shelf pill changes. Pressing a star: it pops (scale 1 → 1.35 → 1 with a 3°
wobble) and throws an expanding ring that fades; the stars before it fill in
35 ms apart; the number reads "8 of 10". Pressing the current star again
clears. Two fields, never one: read with swiss's `scoreOf()` shape
(`{field: 'rating'|'want', value}`) from the edited shelf; write the same
field via `setWork(slug, {rating|want|shelf})`. Optimistic update; on
`StoreError.code === 'locked'` show the unlock dialog; on `'offline'` a toast
"Saved on this device; it syncs when the connection is back"; on
`'unconfigured'` "Editing is not set up".

**Unlock:** any edit while locked opens a small dialog: "Enter your edit code
to change the shelf" with one input and an "Unlock" button (`unlock(code)`),
and a line saying the code lives in the owner's `.env` file. Remembered per
device. A small lock/unlock glyph in the control row shows the state and lets
him lock again.

**Nav, i18n, editions:** mount the bar; register every label; all four
editions must look right — `assets/shelf.css` adds only `--shelf-*` tokens and
inherits everything else from `app.css`; add per-edition overrides for ledge
colour and shadow depth (night: the contact shadow becomes a spill of warm
light, covers keep full brightness, no light frames).

**Deterministic state hooks for the harness:** `?hover=<n>`, `?open=<slug>`,
`?edition=`, `?lang=`, `?sort=`, and motion's `?probe=1` overflow reporter.

## The front page — what to build

1. Mount the nav as `variant: 'row'` under the masthead; keep the masthead.
2. Add a Shelf pill (book glyph, primary style) at the start of the sticky
   controls' second group so it is reachable while scrolled; make the sticky
   bar solid (remove `backdrop-filter`; background at ~97% opacity).
3. Favourites through `store.js`: `favorites()` is the set; toggling calls
   `setFavorite(id, on)` when unlocked and falls back to the legacy local key
   when locked or offline. The star in the list and the new star in focus mode
   are the same state; the count in the controls updates.
4. Focus mode: a favourite button in the focus bar (star, `aria-pressed`,
   key `S`); next/previous slide the outgoing figure out and the incoming one
   in along the direction of travel (translateX ±24 px + fade, 260 ms out on
   `cubic-bezier(0.3,0,0.8,0.15)`, 380 ms in on `cubic-bezier(0.2,0,0,1)`);
   the star pops the same way the shelf's does (share the keyframes by name).
5. The star on a list quote pops too.
6. `assets/add-quote.js`: handles `quotes:add` (call `preventDefault`) by
   opening an in-page dialog — quote (textarea), author, work (datalist from
   the registry titles), year, note, tags — and saving through `addQuote()`.
   On success the quote appears at the top of the list immediately, marked
   with a quiet "pending" tag until the repo sync commits it: merge
   `state().pending` into the list at load, deduplicated by `quoteId(text)`
   from quote-core. When locked, the dialog offers the unlock field and a
   link to the GitHub form as the fallback.
7. `DA`/`EN`: hydrate every control, footer line, empty state and focus-mode
   label; the sort and filter selects re-label their options on
   `quotes:lang`. Quotes, authors and works are never translated.
8. Mount the bar variant in `scout.html`, `suggest.html` and `import.html`
   (one `<header id="site-nav">` and one module script each) so the header is
   the same on every page.
9. Keep every keyboard shortcut working; add `S` for favourite in focus mode.

## Engineering rules (from the buildability judge; measured, not opinions)

1. One persistent node per work keyed by slug in a `Map`; a re-sort moves
   nodes, never rebuilds them (rebuilding cost 2.2× per work and ~60 ms at 300).
2. Repaint at caption granularity; rebuild only section wrappers.
3. Budget, asserted in `scripts/checks/shelf.mjs`: the synchronous re-sort
   handler under 12 ms at 115 works; under 10 DOM nodes per work.
4. FLIP order is strict: read every rect into a Map → mutate once → read every
   new rect → write transforms. No layout-affecting write inside a measure loop.
5. Never call `getBoundingClientRect()` inside a comparator or a `pointermove`
   handler over many elements; the tilt reads one rect on `pointerenter`.
6. CSS transitions with an inline-style cleanup (swiss's `flip()`), or
   `fill: 'none'`; zero resident animations after eight sorts.
7. `.is-flipping` suspends hover transforms.
8. Never invent a registry value: `shelf` ∈ {read, reading, to-read,
   abandoned, absent}; "not on a shelf yet" and "talks & essays" are derived
   at render time; a `null` override from the Worker means absent.
9. Two score fields; the label and the value both follow the edited shelf.
10. Never fabricate a missing datum into a visual property.
11. `textContent` everywhere; no `innerHTML` with registry data.
12. Links relative to the page.
13. Dialog: labelled, focus in, Tab trapped, Escape and scrim close, focus
    restored.
14. Rating buttons persist across presses.
15. `:focus-visible` treatment identical to hover.
16. Keep `class="pill"` on controls.
17. Covers: the first two rows eager, the rest `loading="lazy"` with
    `decoding="async"` and explicit `width`/`height`; amend `check-ui.mjs`'s
    image check to assert only images within two viewports of the top, then
    scroll to the bottom, wait, and assert the rest.
18. Every cover frame declares its aspect and a background so a missing file
    is a tinted rectangle, never a collapse.
19. Port the deterministic state hooks and the overflow probe.
20. Write `scripts/checks/shelf.mjs` for acceptance cases 6–13 before the
    page, and `scripts/checks/collection.mjs` for 14–19; run
    `npm run check:ui` until green; look at every PNG it produces with the
    Read tool and fix what the eye catches that the assertions did not.

## Motion vocabulary (both builders)

Enter `cubic-bezier(0.2, 0, 0, 1)`, exit `cubic-bezier(0.3, 0, 0.8, 0.15)`;
durations 200–550 ms; sort FLIP 500 ms with 6 ms stagger in visual order;
star pop 420 ms; hover lift 180 ms. `prefers-reduced-motion` reduces the
transition property list to opacity, not just the duration. No
`backdrop-filter`, no blur, anywhere.
