---
name: quote-mine
description: Propose quotations from a named work for Alexander to pick from, then file the ones he picks into his quote collection. Use when he wants quotes from an essay, paper, document, talk, book, podcast or video — "add quotes from X", "find me quotes in X", "what's worth keeping from X", or a bare YouTube/podcast URL — and above all for works too new or too unpublished to be in a model's memory, which is where it earns its keep. Spoken works count and are a strong fit: captions can be fetched directly, so never decline for want of a transcript. His Goodreads sync only carries books he highlighted in Goodreads itself, so it does not cover his read shelf — a book he has finished is a fair target, and the check is `data/quotes.json` for that work, never the assumption that the shelf is already represented. Do NOT use for adding a quote he already has in hand; that is a one-line issue, not this.
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

So there are three honest ways to reach a quotation, and the difference is the
whole point of `verification.status`:

- **Read it in the work** — the essay, the PDF, the publisher's own copy.
  → `verified`.
- **Cross-check the wording** against several independent sources that agree,
  where the text is stable and widely reproduced. → `reported`, with a note
  saying plainly what you did and did not consult, and the translator where one
  exists.
- **Read a transcript of speech** — captions, a podcast transcript, a posted
  interview text. → **always `reported`, never `verified`**, however official
  the transcript is. See §1b; the reason is that a transcript is someone's
  typing, not the speaker's words, and it is wrong more often than it looks.

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
3. **A video or podcast** → §1b. Don't ask him to paste a transcript; you can
   almost always get one yourself, and the whole 41 minutes beats whatever he
   can scroll and copy out of a panel.
4. **Ask him to paste or drop it.** Only when the others fail — normal for
   unpublished or paywalled work, not a failure. Say which step failed and wait.

## 1b. When the work is spoken

Talks, podcasts and interviews are a real channel here — the collection already
holds interview quotes, and Goodreads cannot reach any of them.

**Get the captions with yt-dlp.** It is not on PATH on his Mac but the module is
installed, so invoke it as a module. Bare invocation fails on YouTube with `The
page needs to be reloaded`; naming the player clients fixes it [verified
2026-08-04]:

```bash
python3 -m yt_dlp --extractor-args "youtube:player_client=android,web,ios" \
  --skip-download --write-subs --write-auto-subs --sub-langs "en.*" \
  --sub-format "vtt" -o "vid.%(ext)s" "<url>"
```

`--dump-json` on the same call gives title, channel, `upload_date` and
`description` — that is where the speakers' names and roles usually are, and you
need them for `author` and the locator.

Two things to check in what comes back, because they change the job:

- **Uploader track or machine track.** yt-dlp splits these: a language under
  `subtitles` is the uploader's own, under `automatic_captions` it is YouTube's
  ASR. The uploader's is much better and usually has real punctuation. If only
  ASR exists, say so — ASR is unpunctuated and you would be inventing the
  sentence boundaries, which is exactly the prohibition at the top.
- **Malformed cue headers inside the text.** Some tracks carry stray
  `123 01:02:03,456 --> 01:02:05,678` fragments *inside* the caption body. They
  are HTML-escaped, so **unescape before you strip them** or the regex silently
  misses every one. Missing this left 140 words of timestamp junk in an
  otherwise clean 8,000-word transcript [verified 2026-08-04].

**The trap: YouTube's "Show transcript" panel is the same file.** He may point
you at it, and it looks like a second opinion. It is not — it renders the exact
track yt-dlp downloads, so agreement between them proves nothing about accuracy.
It is a useful check that *your copy is faithful*, and nothing more. The general
form, matching the §"one rule" trap: **two views of one source are one source.**

**Assume the transcript is wrong somewhere, and go looking.** Even a publisher's
own caption track errs. On AMD's own track for its own show, 2026-08-04: the
guest's name misspelt in the opening line, "a genetic process" for "agentic
process", "STLC" for "SDLC" — and at 34:34 a dropped negation, "this means that
there **can** be a person sitting there" where he plainly said *can't*. A
negation flip is the dangerous class: it reads perfectly and means the opposite.

So before proposing a line, read the sentences on either side of it. If the
passage only makes sense with a word changed, that word is probably wrong — drop
the candidate rather than repairing it, because a repaired quote is your wording.
Flag the softer cases on the line itself (tense, a garbled clause) and let him
decide.

**A published transcript can contain speech that never happened.** Mishearings
are the failure you expect; interpolation is the one that gets through. On
YC's own Root Access transcript of Altman at Startup School 2026, 2026-08-09:
two entire exchanges printed as dialogue appear nowhere in the 39 minutes of
audio — smooth, plausible, on-topic startup advice, of exactly the well-turned-
platitude shape §3 tells you to avoid. The same page omitted several of his
best real answers and split one exchange between the wrong speakers, so Altman
appeared to affirm a growth figure he had just denied. Filing from that page
alone would have produced fabricated quotations under a real name.

So when both a published transcript and a caption track exist, **the recording
is the authority and the transcript is the punctuation.** Run the picked lines
against the audio track, not just against the page you read them on; include a
control phrase you know is there, so an absent result means absent rather than
a broken search. Where the two disagree on substance, mine the audio and say
so — the good material is often the part the publisher dropped.

Where wording genuinely matters and he wants it settled, the audio can be
transcribed locally: `ffmpeg` is installed on his Mac, a Whisper package is not.
Offer it, don't assume it — he declined the install on 2026-08-04 and was right
to, since `reported` was the correct status either way.

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

Twenty-four candidates unless he said otherwise, **ranked strongest first —
never in the order they appear in the work.** He reads down the list and stops
when the lines stop earning their place, so the ranking is what carries his
attention; document order throws that away and makes him do the sorting.

Twenty-four is a ceiling, not a quota. **Stop where the ore runs out and say
where you stopped** — "everything below 15 is weaker than what you already
keep" is worth more than nine lines of padding, and on a second pass over a
mined work the list will legitimately run short. Twelve strong beats
twenty-four with a soft tail.

Read the whole work first; do not propose from the first section you happen to
load. Twenty-four is enough that skimming shows: it forces you to the parts of
the work you would otherwise have passed over.

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
the list out to its ceiling.

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

Numbered in rank order — **1 is the strongest line in the work, not the first
one in it.** Tight enough to scan on a phone: at twenty-four the reason has to
stay one clause, or the list stops being scannable and the ranking stops being
readable. For each: the quote, where it sits, and that one clause. Do not
explain the quote back to him.

```
3.  "We simply need to break the link between the generation of economic value
     and self-worth and meaning."
     The Adolescence of Technology, §5 · names the mechanism and what to do to it
```

Name the work in the locator when the collection holds more than one by that
author. Both Amodei essays have a section 5 about work and meaning, and a bare
"§5, on meaning after work" has already read as if it came from whichever essay
was being mined.

After the list, say plainly where the quality fell off, and how the top of it
compares to what he already holds from this work. That sentence is the one
piece of judgement he cannot reconstruct from the list itself.

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
work itself or a publisher's own copy *of the text*. A transcription is not
that, however many agree and whoever published it — spoken words reach you
through someone's typing, so a talk, podcast or interview is **`reported`** even
when the captions are the publisher's own. The note says exactly what you read
and what you did not: name the track, and say you did not check it against the
audio. Get this wrong and the field stops meaning anything.

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

- This skill lives in two places — `~/.claude/skills/quote-mine/SKILL.md` and
  `~/Quote-collection/.claude/skills/quote-mine/SKILL.md`. Edit both. They had
  already drifted by 2026-08-04 (the repo copy still carried a retired claim
  about Goodreads covering his shelf), so **diff them before editing** and carry
  the newer text across rather than assuming your copy is current.
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
