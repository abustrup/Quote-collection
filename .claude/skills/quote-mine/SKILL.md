---
name: quote-mine
description: Propose quotations from a named work for Alexander to pick from, then file the ones he picks into his quote collection. Use when he wants quotes from an essay, paper, document, talk or book — "add quotes from X", "find me quotes in X", "what's worth keeping from X" — and above all for works too new or too unpublished to be in a model's memory, which is where it earns its keep; his Goodreads sync already covers the books on his shelf. Do NOT use for adding a quote he already has in hand; that is a one-line issue, not this.
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

**Never propose wording you produced from recall alone.** A model's memory of a
sentence is a paraphrase wearing quotation marks, and a wrong quote in a
collection whose whole premise is tracked attribution is the worst available
failure.

That is the prohibition, and it is deliberately narrower than "only quote what
you read this session". Measured 2026-07-30: **43 of the 62 curated quotes here
were never read in a source from this environment, and they are good.** Hume's
archaic "surpriz'd" is kept and flagged as his own spelling rather than a typo;
the Aristotle entry excludes the famous "we are what we repeatedly do" because
that is Will Durant summarising him, not Aristotle. A rule forbidding those
would delete the collection's most productive mode.

So there are two honest ways to reach a quotation, and the difference is the
whole point of `verification.status`:

- **Read it in the work** — the essay, the PDF, the publisher's own copy.
  → `verified`.
- **Cross-check the wording** against several independent sources that agree,
  where the text is stable and widely reproduced. → `reported`, with a note
  saying plainly what you did and did not consult, and the translator where one
  exists.

Cross-checking is trustworthy for the canon and untrustworthy for anything
recent or obscure, where the few sources mostly copy each other. **For a work
published in the last couple of years, read it or drop it** — there is no third
option, and that is where the trap below lives.

The trap has already been hit here: searching for a recent essay surfaces
mirrors that are *summaries* — "Amodei argues that powerful AI could compress
50-100 years of progress" — which read like source text and are not. Before
treating a page as the work, check it is long enough to be the work and reads as
continuous prose rather than description. The general form, worth carrying: **a
search snippet is not evidence, and a subagent's summary of a page is not the
page.**

If you can neither read it nor honestly cross-check it, say so and stop. Asking
him to paste it costs him ten seconds.

## 1. Get the text

In order:

1. **Fetch it.** Most things he wants are online: `darioamodei.com` for the
   Amodei essays, `anthropic.com/constitution` (also CC0 at
   `raw.githubusercontent.com/anthropics/claude-constitution/main/`), arXiv for
   papers, Gutenberg for anything old.
2. **Read a file.** If he has the PDF or EPUB, read it directly.
3. **Ask him to paste or drop it.** Only when the first two fail — normal for
   unpublished or paywalled work, not a failure. Say which step failed and wait.

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

Do not carry numbers in from a previous session — derive them now. Two things to
take from it. **Length**: he keeps short lines; check the median yourself and
treat anything far above it as needing to earn the space. **Density**: count what
he already holds from this work and this area, and read those quotes — they set
the bar in §3. Skim twenty others before choosing; the collection is a better
brief than anything written here.

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

Avoid: throat-clearing, anything whose interest is only local to its chapter,
and lines already in the collection — check before proposing.

**What §2 turned up is also a discovery channel, not only a ranking.**
String-match the passages press and commentary quoted back against the source:
it surfaces things you skimmed past on the first read.

## 5. Present the shortlist

Numbered, tight enough to scan on a phone. For each: the quote, where it sits,
one clause on why it is here, and which signal put it there. Do not explain the
quote back to him.

Mark provenance plainly — `widely quoted`, `fits your collection`, or `both`:

```
3.  "We simply need to break the link between the generation of economic value
     and self-worth and meaning."
     §5, on meaning after work · both · names the mechanism and what to do to
     it, and it is the line the commentary kept pulling out
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

## 7. Confirm

Say how many landed and link the collection. If the sync ran, each quote has its
own permalink at `https://abustrup.github.io/Quote-collection/#<id>`.

## Notes

- This skill lives in two places — `~/.claude/skills/quote-mine/SKILL.md` and the
  copy inside the Quote-collection repo. Edit both or they drift.
- Themes are a controlled list. Anything outside it is dropped silently on the
  way in, so take the list from
  `raw.githubusercontent.com/abustrup/Quote-collection/main/assets/quote-core.js`
  rather than guessing.
- His Goodreads list syncs itself every morning and is by far the collection's
  largest channel — 173 of 235 quotes on 2026-07-30, all of them `unverified`.
  Do not propose quotes already coming in that way. This skill's real niche is
  what Goodreads cannot reach: essays, papers, documents, and unpublished work.
  Re-derive that split from `quotes.json` rather than quoting the number here.
- A cloud session in this repo sees the repo and nothing else — no global
  contract, no harness log, no memory. `.claude/rules/working-with-alexander.md`
  is the only channel, so anything a future session must know belongs there or
  in this file. This skill was written in exactly that blind state on
  2026-07-30, which is how its original rule came to forbid two-thirds of the
  collection.
