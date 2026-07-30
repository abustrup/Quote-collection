---
name: quote-mine
description: Propose quotations from a named work for Alexander to pick from, then file the ones he picks into his quote collection. Use when he wants quotes from a book, essay, paper or talk — "add quotes from X", "find me quotes in X", "what's worth keeping from X" — including works too new or too unpublished to be in a model's memory. Do NOT use for adding a quote he already has in hand; that is a one-line issue, not this.
---

# Mining a work for quotes

Alexander keeps a quote collection at
[abustrup/Quote-collection](https://github.com/abustrup/Quote-collection),
published at https://abustrup.github.io/Quote-collection/. He reads a lot and
wants the good lines out of a work without reading it twice with a highlighter.

The job: hand him a numbered shortlist, let him pick by number, file the picks.
He should be able to go from "quotes from the new Amodei essay" to seeing them
on the site without typing anything but a few digits.

## The one rule

**Never propose a quotation you have not read in the source this session.**

Not from memory, not from a summary, not from a page that quotes it. A model's
recall of a sentence is a paraphrase wearing quotation marks, and a wrong quote
in a collection whose whole premise is tracked attribution is the worst
available failure.

The trap has already been hit here: searching for a recent essay surfaces
mirrors that are *summaries* — "Amodei argues that powerful AI could compress
50-100 years of progress" — which read like source text and are not. Before
treating a page as the work, check it is long enough to be the work and reads as
continuous prose rather than description.

If you cannot get the text, say so and stop. Asking him to paste it costs him
ten seconds.

## 1. Get the text

In order:

1. **Fetch it.** Most things he wants are online: `darioamodei.com` for the
   Amodei essays, `anthropic.com/constitution` (also CC0 at
   `raw.githubusercontent.com/anthropics/claude-constitution/main/`), arXiv for
   papers, Gutenberg for anything old.
2. **Read a file.** If he has the PDF or EPUB, read it directly.
3. **Ask him to paste or drop it.** Only when the first two fail — normal for
   unpublished or paywalled work, not a failure. Say which step failed and wait.

## 2. Learn what he actually keeps

Before choosing, read his collection:

```
https://raw.githubusercontent.com/abustrup/Quote-collection/main/data/quotes.json
```

Do not carry numbers in from a previous session — derive them now. Two things to
take from it. **Length**: he keeps short lines; check the median yourself and
treat anything far above it as needing to earn the space. **Density**: count what
he already holds from this work and this area, and read those quotes — they set
the bar in §3. Skim twenty others before choosing; the collection is a better
brief than anything written here.

## 3. Choose

Twelve candidates unless he said otherwise. Read the whole work first; do not
propose from the first section you happen to load.

He keeps lines with **a turn of thought** in them, not statements of position.
The failure that rule exists to catch is the well-turned platitude: a sentence
that names no one, commits to nothing falsifiable, and would survive having its
subject swapped. Prefer the sentence that commits — names the mechanism, the
agent, the number, the concrete case — and that this author is placed to say.
Fame is not the same as genericness: his collection is thick with the single
most-quoted line of a work, and those lines commit.

**Where he already holds quotes from this work or this area, the bar is not the
work's average line, it is the lines he already kept.** A candidate has to beat
those, not merely be good: a second pass over a mined work returns thinner ore,
and "these are weaker than your existing five" is a better answer than padding
the list to twelve.

Then, secondarily:

- Lines that survive being lifted out of their paragraph.
- One idea per quote. A sentence that needs the previous one is a passage, not
  a quote.
- Range across register — aphoristic, argumentative, some that sit oddly beside
  what he already keeps.

Avoid: definitions, throat-clearing, anything whose interest is only local to
its chapter, and lines already in the collection — check before proposing.

**What the world already quotes is a discovery channel.** String-match press and
commentary passages back against the source; it surfaces things you skimmed
past. Flag which candidates are widely quoted and let him weigh it.

## 4. Present the shortlist

Numbered, tight enough to scan on a phone. For each: the quote, where it sits,
and one clause on why it is here. Do not explain the quote back to him.

```
3.  "We simply need to break the link between the generation of economic value
     and self-worth and meaning."
     §5, on meaning after work · names the mechanism and what to do to it
```

Then one line: *Reply with the numbers you want. "3, 7, 11" or "all" or
"3-5, 9".*

If a candidate is arguably a passage rather than a quote, or the wording is
uncertain, say so on that line. He can decide.

## 5. File the picks

Build a record per pick:

```json
{
  "text": "the quotation, verbatim, no enclosing quotation marks",
  "author": "Full Name",
  "work": "Title",
  "workKind": "book|essay|paper|speech|interview|film|poem|letter|document|song|other",
  "year": 2026,
  "source": { "kind": "curated", "url": "where you actually read it", "locator": "section or chapter" },
  "themes": ["from the controlled list in assets/quote-core.js"],
  "tags": ["free form"],
  "lang": "en",
  "verification": { "status": "verified", "note": "what you checked it against" }
}
```

Do not set `id` — the repository computes it from the text, which is what stops
the same quote entering twice.

`verification.status` is **`verified`** only when you read the words in the
work itself or a publisher's own copy. A third-party transcription, however
many of them agree, is **`reported`**, and the note says where you read it. Get
this wrong and the field stops meaning anything.

Then, in order of preference:

- **`gh` CLI** (authenticated as `abustrup`) — `gh issue create -R
  abustrup/Quote-collection --label quote-bulk`, JSON array in the body under a
  `### Quotes` heading in a fenced code block. A workflow files, commits and
  closes it; it runs only for issues opened by `abustrup`. If the label errors,
  `gh label create quote-bulk` first.
- **Otherwise** → a prefilled link he clicks once:
  `https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml&quotes=<url-encoded JSON>`
  Under about 6 KB this works; above it, hand him the JSON in a file and the
  plain [Bulk import](https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml)
  link.

Before filing, string-match every picked quote against the source text you
loaded. If one does not match exactly, fix it or drop it — do not file it.

## 6. Confirm

Say how many landed and link the collection. If the sync ran, each quote has its
own permalink at `https://abustrup.github.io/Quote-collection/#<id>`.

## Notes

- This skill lives in two places — `~/.claude/skills/quote-mine/SKILL.md` and the
  copy inside the Quote-collection repo. Edit both or they drift.
- Themes are a controlled list. Anything outside it is dropped silently on the
  way in, so take the list from
  `raw.githubusercontent.com/abustrup/Quote-collection/main/assets/quote-core.js`
  rather than guessing.
- His Goodreads list syncs itself every morning. Do not propose quotes that are
  already coming in that way; this skill is for works he is reading, not for
  things already on his shelf.
