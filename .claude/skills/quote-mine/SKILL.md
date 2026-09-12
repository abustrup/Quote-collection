---
name: quote-mine
description: Propose quotations from a named work for Alexander to pick from by number, then file his picks into his quote collection and register the work on its shelf. Use whenever he wants quotes from an essay, paper, document, talk, book, podcast or video — "add quotes from X", "find me quotes in X", "what's worth keeping from X", or a bare YouTube or podcast URL — and above all for works too new or too unpublished to be in a model's memory, which is where it earns its keep. Spoken works are a strong fit; captions are fetched directly, so never decline for want of a transcript. Not for a quote he already has in hand; that is a one-line issue.
---

# Mining a work for quotes

Alexander keeps a quote collection at
[abustrup/Quote-collection](https://github.com/abustrup/Quote-collection), published at
https://abustrup.github.io/Quote-collection/ and cloned at `~/Quote-collection` on his Mac. He
reads a lot and wants the good lines out of a work without reading it twice with a highlighter.

The job: a numbered shortlist, his picks by number, the picks filed and the work registered. From
"quotes from the new Amodei essay" to seeing them on the site, he types a few digits.

This file carries what a session cannot see from where it runs: his taste as recorded, the
repository's mechanics, and the traps already hit. The mechanical parts are scripts in `scripts/`
next to this file; talks, podcasts and videos have their own procedure in
`references/spoken-works.md`. Paths below are relative to this skill's directory in the repo,
`~/Quote-collection/.claude/skills/quote-mine/`.

## The one rule

**Never propose wording you produced from recall alone.** A model's memory of a sentence is a
paraphrase wearing quotation marks, and a wrong quote in a collection whose whole premise is
tracked attribution is the worst available failure.

The prohibition is deliberately narrower than "only quote what you read this session". Measured
2026-07-30: 43 of the 62 curated quotes then in the collection had never been read in a source
from this environment, and they were good — Hume's "surpriz'd" kept as his own spelling, the
Aristotle entry excluding "we are what we repeatedly do" because that is Will Durant summarising
him. A rule forbidding those would delete the collection's most productive mode.

So there are three honest routes to a quotation, and `verification.status` records which:

- **Read it in the work** — the essay, the PDF, the publisher's own copy → `verified`.
- **Cross-checked the wording** against several independent sources that agree, where the text is
  stable and widely reproduced → `reported`, with a note saying what you did and did not consult,
  and the translator where there is one.
- **Read a transcript of speech** — captions, a podcast transcript, a posted interview → **always
  `reported`, never `verified`**, however official the transcript. A transcript is someone's
  typing, not the speaker's words, and it is wrong more often than it looks; the evidence is in
  the spoken-works reference.

Cross-checking works for the canon and fails for anything recent or obscure, where the few sources
copy each other. **For a work from the last couple of years, read it or drop it.** The trap has
been hit here: searching for a recent essay surfaces mirrors that are summaries — "Amodei argues
that powerful AI could compress 50–100 years of progress" reads like source text and is not.
Before treating a page as the work, check it is long enough to be the work and reads as
continuous prose. A search snippet is not evidence, and a subagent's summary of a page is not the
page.

If you can neither read it nor honestly cross-check it, say so and stop. Asking him to paste it
costs him ten seconds.

## 1. Get the text

1. **Fetch it.** `darioamodei.com` for the Amodei essays, `anthropic.com/constitution` (also CC0
   at `raw.githubusercontent.com/anthropics/claude-constitution/main/`), arXiv for papers,
   Gutenberg for anything old.
2. **Read his file.** A PDF or EPUB he has; real source material also lands in `~/Downloads` by
   accident, so look there before concluding he does not have it.
3. **Spoken work** → `python3 scripts/captions.py "<url>" --out <dir>` and then read
   `references/spoken-works.md` before choosing anything. Never ask him to paste a transcript.
4. **Ask him to paste or drop it.** Only when the others fail — normal for unpublished or
   paywalled work. Say which step failed and wait.

## 2. Learn what he actually keeps

`git -C ~/Quote-collection pull -q`, then read `data/quotes.json` there (a cloud session is
already in the repo). Derive everything now: this file once carried counts that were stale within
a month. Take three things. **Length** — he keeps short lines; anything far above the median has
to earn the space. **Density** — what he already holds from this work and this area; those lines
set the bar in §3. **Register** — skim twenty others. The collection is a better brief than
anything written here.

## 3. Choose

Up to twenty-four candidates, **ranked strongest first, never in the order they appear**. He
reads down the list and stops when the lines stop earning their place; document order makes him
do the sorting. Read the whole work before proposing — twenty-four is enough that skimming shows.

Twenty-four is a ceiling, not a quota. Stop where the ore runs out and say where. A second pass
over a mined work returns thinner ore: on 2026-07-30 a 2-of-14 hit rate on an Amodei essay was
read as a broken selection rule, and the essay had been mined the day before. "Everything below
twelve is weaker than what you already keep" is worth more than nine lines of padding.

What he keeps is **a turn of thought, not a statement of position**. The failure to catch is the
well-turned platitude: a sentence that names no one, commits to nothing falsifiable, and would
survive having its subject swapped. Prefer the sentence that commits — names the mechanism, the
agent, the number, the concrete case — and that this author is placed to say. Fame is not
genericness: the collection is thick with the single most-quoted line of a work, and those lines
commit. **Where he already holds quotes from this work or this area, the bar is those lines, not
the work's average.**

Secondarily: lines that survive being lifted out of their paragraph; one idea per quote (a
sentence that needs the previous one is a passage); range across register, including some that
sit oddly beside what he keeps. Nothing already in the collection.

What the world already quotes is a discovery channel: string-match press and commentary passages
back against the source, and flag which candidates are widely quoted so he can weigh it.

## 4. Present the shortlist

Numbered in rank order. For each: the quote, where it sits, one clause of reason — no more, or
the list stops being scannable on a phone. Do not explain the quote back to him.

```
3.  "We simply need to break the link between the generation of economic value
     and self-worth and meaning."
     The Adolescence of Technology, §5 · names the mechanism and what to do to it
```

Name the work in the locator when the collection holds more than one by that author: both Amodei
essays have a §5 about work and meaning, and a bare "§5" has already read as the wrong essay.
Flag on the line anything that is arguably a passage, or whose wording the transcript leaves
uncertain. After the list, say where the quality fell off and how the top compares to what he
already holds from this work — the one judgement he cannot reconstruct from the list. Then:
*Reply with the numbers you want. "3, 7, 11" or "all" or "3-5, 9".*

One work fits in chat. Several works at once, or more than about twenty-four lines, go to a file
in the session scratchpad with the top five in chat and a link to the rest — never his home
directory. The 2026-08-30 shortlist written there was not opened again.

## 5. File the picks

One record per pick:

```json
{
  "text": "the quotation, verbatim, no enclosing quotation marks",
  "author": "Full Name",
  "work": "Title",
  "workKind": "book|essay|paper|speech|interview|film|poem|letter|document|song|other",
  "year": 2026,
  "source": { "kind": "curated", "url": "where you actually read it, or null", "locator": "section, chapter or timestamp" },
  "themes": ["from the controlled list in assets/quote-core.js"],
  "tags": ["free form"],
  "lang": "en",
  "verification": { "status": "verified|reported", "note": "what you read and what you did not" }
}
```

No `id`: the repository computes it from the text, which is what stops a quote entering twice.

`verified` only when you read the words in the work itself or the publisher's own copy *of the
text*. Speech reaches you through someone's typing, so a talk, podcast or interview is `reported`
even when the captions are the publisher's own, and the note names the track and says the audio
was not checked. Get this wrong and the field stops meaning anything.

He may ask for a line to be "made grammatical". **Cut, never add or substitute** — a repaired
quote is your wording — and disclose every cut in the note. On 2026-08-31 "is like half the task"
was dropped from an Askell line and the note says so; stutters and fillers go the same way.

Then, in order:

1. **Check.** `python3 scripts/check-quotes.py picks.json source.txt` — `source.txt` is the text
   you read the quotes in, the transcript from `captions.py` or the work saved as plain text. It
   string-matches every pick (exact, normalised, punctuation, or trimmed with the dropped words
   listed), checks the vocabularies, rejects a video or podcast source marked `verified`, catches
   duplicates and removed quotes, and says whether the work is registered. **Do not file on a
   red.** Fix or drop.
2. **File.** `gh issue create -R abustrup/Quote-collection --label quote-bulk --title "Quotes: …"
   --body-file body.md`, where the body holds the JSON array in a fenced `json` block under a
   `### Quotes` heading. A workflow files, commits and closes the issue within about a minute
   (`gh issue view <n> --json state`); it runs only for issues opened by `abustrup`. Without `gh`,
   a prefilled link he clicks once:
   `https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml&json=<url-encoded JSON>`
   — the form field's id is `json`, and the link holds about 6 KB; above that, the JSON in a file
   plus the plain [Bulk import](https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml)
   link.
3. **Register the work** when it is new to the collection:
   `python3 scripts/register-work.py --title "<exactly the work field>" --author "…" --year …
   --kind … --subject … [--url https://…] --commit` — subject from the controlled list, url only
   where the primary text has a stable home. A quote whose work is not in `data/works.json` reads
   perfectly on the page and is invisible to every subject and era filter on the shelf, and the
   build only warns. Every work this skill filed between 2026-07-30 and 2026-08-31 was registered
   afterwards by a routine instead of by the skill; that routine is retiring, so this step is
   now the only one.

## 6. Confirm

Say how many landed and link the collection. Each quote has a permalink at
`https://abustrup.github.io/Quote-collection/#<id>`, and the issue's closing comment lists them.

## Notes

- **Homes.** This file, `scripts/` and `references/` live in the repo at
  `.claude/skills/quote-mine/`, which is what a cloud session sees.
  `~/.claude/skills/quote-mine/SKILL.md` is a stub carrying the same frontmatter and pointing
  here; a symlink was tried instead and rejected, because Claude Code does not discover skills
  through symlinked directories (Claude Code issues #38051 and #37590, checked 2026-09-12). If
  you change the description, change it in the stub too — that is the one line still in two
  places.
- **Vocabularies** — themes, work kinds, subjects — are controlled lists in `assets/quote-core.js`;
  anything outside them is dropped silently on the way in. The scripts read the lists from the
  repo, so check rather than guess.
- **Goodreads** syncs every morning and is the collection's largest channel, all `unverified`. It
  carries only what he highlighted on Goodreads itself, not his read shelf, so a book he has
  finished is a fair target; the check is `data/quotes.json` for that work. This skill's niche is
  what Goodreads cannot reach — essays, papers, documents, talks, unpublished work.
- **A cloud session in this repo sees the repo and nothing else** — no global contract, no
  memory. `.claude/rules/working-with-alexander.md` is the only channel, so anything a future
  session must know belongs there or here. This skill was first written in that blind state on
  2026-07-30, which is how its original rule came to forbid two-thirds of the collection.
- **yt-dlp.** The `yt-dlp` binary from Homebrew (2026.08.19, installed 2026-09-12) is what
  `captions.py` prefers; the python module on the Mac is a year older and runs on a Python that
  yt-dlp has deprecated. When YouTube changes break captions, `brew upgrade yt-dlp` first.
