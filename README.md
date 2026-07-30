# Quote Collection

A personal library of lines worth keeping – philosophy, technology, literature,
and the sentences that would not leave. It is a plain website with no build
step and no server: the quotations live in one JSON file, and the site reads it.

**Read it here:** https://abustrup.github.io/Quote-collection/

---

## The four things you will actually do

### 1. Add a quote (no terminal, works from a phone)

Open **[Add a quote](https://github.com/abustrup/Quote-collection/issues/new?template=add-quote.yml)**,
fill in the quotation and who said it, and submit. Within a minute or two a
robot files it into the collection, the site rebuilds, and it replies with a
direct link to your new quote. Then it closes the issue.

That is the whole loop. You never touch a file.

### 1b. Remove or fix one (press **Curate**)

On the collection, press **Curate** (or the <kbd>C</kbd> key). Every quote grows
a tick box, an **Edit** link and its id. Tick the ones you want gone, press
**Remove selected**, and submit the issue it opens. One issue removes any number
of quotes.

Removals stick, and that is less obvious than it sounds. A quote's id is a hash
of its own text, so simply deleting one would not work: the next morning's
Goodreads sync would derive the same id from the same words, find it missing,
and file it again. So every removal is written to `data/removed.json` with the
full text, and every importer consults that list first.

Which also makes it reversible. Delete an entry from `data/removed.json` and the
next sync brings the quote back with its original link.

**Edit** opens the same kind of form, prefilled with what the record says now.
Anything you leave blank stays as it is. Changing the *wording* can give the
quote a new link – identity is a hash of the text – and the reply tells you
when it did.

### 2. Nothing, for Goodreads

The Goodreads list looks after itself. A job runs every morning, reads the
public quote list at the profile recorded in `data/sources.json`, and adds
anything new. It has already brought over all 174.

If you ever want it sooner, run
**[Sync from Goodreads](https://github.com/abustrup/Quote-collection/actions/workflows/sync-goodreads.yml)**
and press the button. Nothing needs typing; the profile is remembered.

Quotes arriving this way are marked *unverified*, because Goodreads
quotations are transcribed by other readers and nobody has checked them.

<details>
<summary>If the sync ever breaks — the manual way in</summary>

The importer still works, and does not depend on Goodreads being readable by a
robot. Print each page of your quotes list to PDF (in Chrome or Safari:
**File → Print → Save as PDF**), open
**[the importer](https://abustrup.github.io/Quote-collection/import.html)**, and
drag the files on. It reads them in your browser, nothing is uploaded, and it
shows you what it found so you can delete anything wrong. Then press
**Copy JSON**, open
**[Bulk import](https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml)**,
paste, and submit.

</details>

### 2b. Tick what is worth keeping (the board)

**[The board](https://abustrup.github.io/Quote-collection/scout.html)** is where
lines arrive that nobody went looking for. Once a week a routine reads the
collection, works out what it implies, goes and finds quotes from works that are
*not* in here, and posts what it found. Tick the ones worth keeping and press
**Add to the collection**; it opens an issue already filled in, and the same
robot files them.

Nothing on the board is in the collection until you put it there. The routine
cannot add a quote itself – it may only propose, and that is enforced rather
than promised: `data/quotes.json` is not among the files it may write.

A line gets **two showings**. If it is still sitting there after the second, it
is retired and never proposed again, so the board stays mostly new instead of
becoming a list you have already said no to.

The picks travel as ids rather than as quotations, because a prefilled link
carrying whole records runs out of URL after about five of them. The words come
back out of `data/proposals.json`, which is also what lets the page show which
past proposals you kept and which you let go.

### 3. Find something to read next

**[What to read next](https://abustrup.github.io/Quote-collection/suggest.html)**
looks at the shape of what you have kept – which authors you return to, which
questions your quotes keep circling – and suggests works from a hand-checked
library. It says *why* it suggested each one, so you can tell when it has
guessed wrong.

It runs entirely on your device and costs nothing. There is also an optional
mode that asks Claude instead; that one needs your own Anthropic API key and
bills your own account, so it stays switched off until you turn it on.

---

## Reading the collection

| | |
|---|---|
| **Search** | Type anything – words in the quote, an author, a book |
| **Filter** | By author, **work**, **subject** or **era**. Every filter is in the URL, so any view can be sent to someone |
| **The shelf** | [works.html](https://abustrup.github.io/Quote-collection/works.html) – every book quoted here, arranged by subject, era, author or how often you quote it |
| **Editions** | *Paper* to read slowly, *Night* for the dark, *Folio* for one line at a time, *Index* to scan hundreds fast |
| **Focus** | One quote, nothing else. Press <kbd>F</kbd>, or the Focus button |
| **Keyboard** | <kbd>/</kbd> search · <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>F</kbd> focus · <kbd>R</kbd> random · <kbd>C</kbd> curate · <kbd>Esc</kbd> clear |
| **Links** | Every quote has its own permanent link, so you can send one to someone |
| **Favourites** | The star keeps a quote in your own shortlist, stored on your device |

---

## Subjects, eras, and why they are not themes

The filters you would reach for first are the ones nobody has to agree with you
about:

| | Where it comes from | Judgement involved |
|---|---|---|
| **Work** | the quote's own attribution | none |
| **Era** | arithmetic on the work's year | none |
| **Subject** | `data/works.json`, one field per book | one decision per book, checkable against a library record |

**Subject belongs to the work, not to the line.** Asking "what is this sentence
about?" gets a different answer from every honest reader – *meaning*,
*character*, *certainty* are readings, not facts. Asking "what field is this
book in?" is the question a library catalogue already answers. So fifty-nine
books get classified once, instead of several hundred sentences getting
interpreted one at a time, and anyone can check the whole taxonomy in an
afternoon.

Era is not stored at all. It is computed from the year, so it cannot drift out
of step with the date, and a work with no year simply has no era rather than
being guessed into one.

The old `themes` are still on each quote and still clickable, but they have been
demoted out of the filter row to what they always were: one reader's tags.

---

## How the attribution is tracked

A quote collection is only worth as much as its attributions, so every entry
records how far it has actually been checked:

| | |
|---|---|
| **Verified** | The wording was confirmed against the primary text |
| **Reported** | The attribution is well established, but the original was not consulted |
| **Unverified** | Carried over from an import and not independently checked |
| **Disputed** | Commonly misattributed or circulated in paraphrase – treat with care |

Anything imported from Goodreads starts as *unverified*, because Goodreads
quotations are transcribed by other readers and nobody has checked them. That is
not a criticism of the quotes; it is just the honest label. Verified entries
show no badge at all – the badge appears only when there is something to say.

---

## What is in here

```
index.html            the collection
works.html            the shelf – every book quoted here
scout.html            the board – proposed lines, waiting to be kept or let go
import.html           the Goodreads importer
suggest.html          reading suggestions
data/quotes.json      every quotation – the only file that really matters
data/proposals.json   the board: what has been proposed, and what became of it
data/works.json       one record per work: its subject, year and kind
data/removed.json     quotes deliberately deleted, so no importer re-adds them
data/sources.json     which Goodreads profile the daily sync reads
data/library.json     the curated works the recommender can suggest
data/schema.json      the shape data/quotes.json must keep to
scout-log.md          what the weekly scout tried, and how often it was right
assets/               styles, fonts, and the code the pages run
scripts/              the validators, the issue-to-quote importer, and curate.mjs
.github/              the issue forms, the daily Goodreads sync, and the checks
```

`data/quotes.json` is plain text and will still open in any editor in twenty
years, with or without this website.

---

## For anyone poking at the code

No build step, no dependencies, no framework. Serve the folder and it works.

```sh
npm run serve    # http://localhost:8080
npm run check    # validate the collection and the library
npm test         # run the parser tests
```

`assets/quote-core.js` is the one file everything agrees on: it defines what a
quote is, how its identity is computed, and how two records merge. A quote's
`id` is a hash of its own text, which is what lets an import run twice without
creating duplicates, and what keeps a permalink working after a typo is fixed in
the surrounding metadata.

Typography and palette are inherited from
[Alexanders Brief](https://abustrup.github.io/alexanders-brief/) so the two
sites read as one hand.
