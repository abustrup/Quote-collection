# Quote Collection

A personal library of lines worth keeping – philosophy, technology, literature,
and the sentences that would not leave. It is a plain website with no build
step and no server: the quotations live in one JSON file, and the site reads it.

**Read it here:** https://abustrup.github.io/Quote-collection/

---

## The three things you will actually do

### 1. Add a quote (no terminal, works from a phone)

Open **[Add a quote](https://github.com/abustrup/Quote-collection/issues/new?template=add-quote.yml)**,
fill in the quotation and who said it, and submit. Within a minute or two a
robot files it into the collection, the site rebuilds, and it replies with a
direct link to your new quote. Then it closes the issue.

That is the whole loop. You never touch a file.

### 2. Import your Goodreads quotes

Your Goodreads list is not something this site can fetch on its own, so it is
brought over once by hand:

1. Go to your Goodreads quotes list and print each page to PDF
   (in Chrome or Safari: **File → Print → Save as PDF**). Six pages, six files.
2. Open **[the importer](https://abustrup.github.io/Quote-collection/import.html)**.
3. Drag all six PDFs onto the page.

It reads them in your browser – nothing is uploaded anywhere – shows you exactly
what it found, and lets you delete anything it got wrong. Then press
**Copy JSON**, open
**[Bulk import](https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml)**,
paste, and submit. Same robot, same result.

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
| **Filter** | Click an author or a theme to see only those |
| **Editions** | *Paper* to read slowly, *Night* for the dark, *Folio* for one line at a time, *Index* to scan hundreds fast |
| **Focus** | One quote, nothing else. Press <kbd>F</kbd>, or the Focus button |
| **Keyboard** | <kbd>/</kbd> search · <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>F</kbd> focus · <kbd>R</kbd> random · <kbd>Esc</kbd> clear |
| **Links** | Every quote has its own permanent link, so you can send one to someone |
| **Favourites** | The star keeps a quote in your own shortlist, stored on your device |

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
index.html          the collection
import.html         the Goodreads importer
suggest.html        reading suggestions
data/quotes.json    every quotation – the only file that really matters
data/library.json   the curated works the recommender can suggest
data/schema.json    the shape data/quotes.json must keep to
assets/             styles, fonts, and the code the pages run
scripts/            the validator and the issue-to-quote importer
.github/            the issue forms and the robot that files your quotes
```

`data/quotes.json` is plain text and will still open in any editor in twenty
years, with or without this website.

---

## For anyone poking at the code

No build step, no dependencies, no framework. Serve the folder and it works.

```sh
npm run serve    # http://localhost:8080
npm run check    # validate data/quotes.json
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
