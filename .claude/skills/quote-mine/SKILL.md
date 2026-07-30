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

The trap is specific and has already been hit here: searching for a recent
essay surfaces mirrors that are *summaries* — "Amodei argues that powerful AI
could compress 50-100 years of progress" — which read like source text and are
not. Before treating a page as the work, check that it is long enough to be the
work and that it reads as continuous prose rather than description.

If you cannot get the text, say so and stop. An honest "I could not reach it,
paste it or drop the file in" costs him ten seconds. A fabricated quote costs
him the collection's credibility.

## 1. Get the text

In order:

1. **Fetch it.** Most things he wants are online: `darioamodei.com` for the
   Amodei essays, `anthropic.com/constitution` (also CC0 at
   `raw.githubusercontent.com/anthropics/claude-constitution/main/`), arXiv for
   papers, Gutenberg for anything old.
2. **Read a file.** If he has the PDF or EPUB, read it directly.
3. **Ask him to paste or drop it.** Only when the first two fail, and say which
   one failed and why.

Unpublished or paywalled works land in (2) or (3). That is normal, not a
failure — say what you need in one line and wait.

## 2. Find what the world already quotes

One reader's judgement is a narrow instrument. Before choosing, find out which
lines from this work other people actually pull out — that is real evidence
about what carries, gathered from thousands of readers rather than one pass.

Where to look, best first:

- **Goodreads' page for the work** (`goodreads.com/work/quotes/<id>`, reachable
  from its book page). The like counts are an honest popularity ranking, and it
  is the only source here that is structured rather than anecdotal. Goodreads
  refuses some automated clients with a 403; if that happens, do not retry it,
  just fall back to the next two.
- **Web search for distinctive phrases from the work.** Search a few striking
  fragments you found in §1 and see which come back with the most independent
  discussion. Also search `"<title>" quotes` and `"<title>" "most quoted"` —
  for a work with no Goodreads page this is the whole of the signal.
- **Coverage and commentary.** For a recent essay — the usual case for the
  things he reads — what reviewers, newsletters and critics chose to pull out
  is the same signal in a different form. Two independent write-ups landing on
  the same sentence is a real result.

### The rule that makes this safe

**Popularity decides what to look for. The source decides the words.**

Never file text taken from a quote page, a listicle, a review, or a search
result. Find the line's *location* in the primary text and quote what is
actually there.

This is not a hypothetical risk, it is the normal case. Of the four
most-circulated lines from Claude's Constitution, checked against Anthropic's
own CC0 text, **three were wrong**:

| What circulates | What the text says |
|---|---|
| "more like a trellis than a cage: it provides structure and support while **also** leaving room for organic growth" | "A constitution in this sense is **less like a cage and more like a trellis**: **something that** provides structure and support while leaving room for organic growth" |
| "Claude can be like a brilliant friend who **also** has the knowledge of a doctor, lawyer, and financial advisor, who will speak frankly … and treat users like intelligent adults capable of deciding what is good for them" | Two sentences from **different sections**, welded into one. The real one: "Think about what it means to have access to a brilliant friend who **happens to** have the knowledge of a doctor, lawyer, financial advisor, **and expert in whatever you need**." |
| "we **want** all current Claude models to **be** … **Broadly safe**: not undermining appropriate human mechanisms to oversee AI during the current phase of development" | "we **believe** all current Claude models **should** be … not undermining appropriate human mechanisms to oversee **the dispositions and actions of** AI during the current phase of development" |
| "never engage or assist in an attempt to kill or disempower the vast majority of humanity or the human species as whole" | Verbatim. This one is real. |

Every wrong version reads perfectly. That is the point: a smoothed paraphrase
is *more* quotable than the original, which is exactly why it out-competes it
online. Filing any of the first three would have put a paraphrase in the
collection wearing a **verified** badge.

So: search to find out *which sentence* matters, then go back to the text and
copy the sentence.

### When a popular line is wrong or absent

Say so, prominently, in a short **Misquotes found** section under the
shortlist. A line the internet attributes to a work in words the work does not
use is worth more to him than another candidate: it is a mistake he would
otherwise have repeated in public. Give the circulating version, the real one,
and where you checked.

## 3. Learn what he actually keeps

Now read his collection:

```
https://raw.githubusercontent.com/abustrup/Quote-collection/main/data/quotes.json
```

Do not carry numbers in from a previous session — derive them now. What matters:
which authors and themes recur, and the length distribution, which is the
clearest signal of the kind of line he keeps. Skim twenty of the existing quotes
before choosing; the collection is a better brief than anything written here.

Two things that hold across it: he keeps lines with **a turn of thought in
them** rather than statements of position, and he keeps them **short** — check
the median length yourself and treat anything far above it as needing to earn
the space.

## 4. Choose

Twelve candidates unless he said otherwise, drawn from both signals. Read the
whole work first; do not propose from the first section you happen to load.

Roughly: a third that the world quotes most, a third that fit his collection,
a third that do both. **The overlap is the strongest thing on the list** —
a line that strangers keep pulling out *and* that matches what he already keeps
is the closest this gets to a sure thing, so lead with those.

Keep a widely quoted line even when it is not obviously his taste. He asked for
this signal precisely so the shortlist is not only a mirror of what he already
has.

Prefer:

- Lines that survive being lifted out of their paragraph.
- One idea per quote. A sentence that needs the previous one is a passage, not
  a quote.
- Range. Some aphoristic, some argumentative, some that would sit oddly beside
  what he already keeps.

Avoid: throat-clearing, anything whose interest is only local to its chapter,
and lines already in the collection — check before proposing.

## 5. Present the shortlist

Numbered, tight enough to scan on a phone. For each: the quote, where it sits,
one clause on why it is here, and which signal put it there. Do not explain the
quote back to him.

Mark provenance plainly — `widely quoted`, `fits your collection`, or `both`:

```
3.  "Values that are genuinely held — understood, examined, and endorsed —
     are more robust."
     Concluding thoughts · both · the line commentators kept pulling out, and
     it answers the question your Arendt and MacIntyre quotes keep circling
```

Then one line: *Reply with the numbers you want. "3, 7, 11" or "all" or
"3-5, 9".*

If a candidate is arguably a passage rather than a quote, or the wording is
uncertain, say so on that line. He can decide.

Under the list, if §2 turned any up, a short **Misquotes found** section: the
circulating wording, the real wording, and where you checked. Keep it to a
table. It is not part of the numbering and nothing there gets filed.

## 6. File the picks

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

- **GitHub connector available** → create an issue on `abustrup/Quote-collection`
  with the label `quote-bulk` and the JSON array in the body under a
  `### Quotes` heading, inside a fenced code block. A workflow files it, commits,
  and closes the issue.
- **Otherwise** → give him a prefilled link he clicks once:
  `https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml&quotes=<url-encoded JSON>`
  Under about 6 KB of JSON this works; above that, hand him the JSON in a file
  and the plain
  [Bulk import](https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml)
  link.

Before filing, string-match every picked quote against the source text you
loaded. If one does not match exactly, fix it or drop it — do not file it.

## 7. Confirm

Say how many landed and link the collection. If the sync ran, each quote has its
own permalink at `https://abustrup.github.io/Quote-collection/#<id>`.

## Notes

- The collection already holds quotes from *Machines of Loving Grace*, *Claude's
  Constitution* and *The Adolescence of Technology*. Check what is there before
  proposing, and say which of your candidates are additions rather than
  duplicates.
- Themes are a controlled list. Anything outside it is dropped silently on the
  way in, so take the list from
  `raw.githubusercontent.com/abustrup/Quote-collection/main/assets/quote-core.js`
  rather than guessing.
- His Goodreads list syncs itself every morning. Do not propose quotes that are
  already coming in that way; this skill is for works he is reading, not for
  things already on his shelf.
