---
name: quote-mine
description: Propose quotations from a named work for Alexander to pick from by number, then file his picks into his quote collection and register the work on its shelf. Use whenever he wants quotes from an essay, paper, document, talk, book, podcast or video — "add quotes from X", "find me quotes in X", "what's worth keeping from X", or a bare YouTube or podcast URL — and above all for works too new or too unpublished to be in a model's memory, which is where it earns its keep. Spoken works are a strong fit; captions are fetched directly, so never decline for want of a transcript. Not for a quote he already has in hand; that is a one-line issue.
---

# Mining a work for quotes

Alexander keeps a quote collection at
[abustrup/Quote-collection](https://github.com/abustrup/Quote-collection), published at
https://abustrup.github.io/Quote-collection/ and cloned at `~/Quote-collection`. He reads a lot and
wants the good lines out of a work without reading it twice with a highlighter.

The job: a ranked shortlist, his picks, the picks filed, the work registered. He cannot read code,
diffs or logs, so what reaches him is a list he can tick and a link to the result. Everything
mechanical is a script in `scripts/` beside this file; speech has its own procedure in
`references/spoken-works.md`. Paths below are relative to this skill's directory in the repo,
`~/Quote-collection/.claude/skills/quote-mine/`.

## The one rule

**Never propose wording you produced from recall alone.** A model's memory of a sentence is a
paraphrase wearing quotation marks, and a wrong quote in a collection whose premise is tracked
attribution is the worst available failure.

The rule is narrower than "only what you read this session": most of the collection's curated
canon was cross-checked, not read in a fresh source, and it is good. Three honest routes, and
`verification.status` records which one you took:

- **Read it in the work itself** — the essay on its author's site, the PDF, the publisher's copy → `verified`.
- **Cross-checked the wording** across several independent sources that agree, for stable and
  widely reproduced text → `reported`, and the note says what you did and did not consult.
- **Read a transcript of speech** — captions, a posted transcript → always `reported`, however
  official. A transcript is someone's typing, not the speaker's words.

Cross-checking works for the canon and fails for anything recent: the few sources copy each other,
and search surfaces mirrors that are summaries ("Amodei argues that…" reads like source text and is
not). **For a work from the last couple of years, read it or drop it.** A search snippet is not
evidence, and a fetch tool that summarises a page has given you a summary, not the page; use
`scripts/fetch-text.py URL out.txt`, which keeps the page's own text and says when it is too short
to be the work. If you can neither read it nor honestly cross-check it, say so and stop. Asking him
to paste it costs ten seconds.

## 1. Get the text

- **A page or essay:** `scripts/fetch-text.py`. `anthropic.com/constitution` also lives CC0 at
  `raw.githubusercontent.com/anthropics/claude-constitution/main/`; arXiv for papers; Gutenberg for
  anything old.
- **His own file:** a PDF or EPUB he has. Source material lands in `~/Downloads` by accident, so look there.
- **Speech (a YouTube or podcast URL):** `python3 scripts/captions.py "<url>" --out <dir>`, then read
  `references/spoken-works.md` before choosing anything. Never ask him to paste a transcript.
- **Otherwise ask him to paste or drop it,** and say which step failed.

Several works at once: fetch them all first, in parallel. If two URLs are one source (a clip and the
episode it was cut from), mine the full one and say the clip is covered.

## 2. Learn what he keeps

`git -C ~/Quote-collection pull -q`, then read `data/quotes.json` (a cloud session is already in the
repo). Derive everything now; any count written in a file goes stale within a month. Take three
things: **length** (he keeps short lines; the median is about a hundred characters, so anything far
above has to earn the space), **density** (what he already holds from this author and area; those
lines set the bar), and **register** (skim twenty others). The collection is a better brief than
anything written here.

## 3. Choose

Read the whole work before proposing. Rank every candidate **strongest first, never in document
order**, and across all works together when there are several. He reads down and stops when the
lines stop earning their place. A ceiling of about twenty-four per work, and a ceiling is not a
quota: stop where the ore runs out and say where. A second pass over a work already mined returns
thinner ore, which is not a sign the selection rule broke.

What he keeps is **a turn of thought, not a statement of position**. The failure to catch is the
well-turned platitude: a sentence that names no one, commits to nothing falsifiable, and survives
having its subject swapped. Prefer the sentence that commits — the mechanism, the agent, the number,
the concrete case — and that this author is placed to say. Fame is not genericness; the most-quoted
line of a work usually commits, so keep it and flag it as widely quoted. Where he already holds
lines from this author or area, the bar is those lines, not the work's average.

Secondarily: lines that survive being lifted out of their paragraph; one idea per quote; range of
register, including some that sit oddly beside what he keeps. Nothing already in the collection.
Lines by the **host or interviewer** are fair game when they are the best sentence in the
conversation; the author is then the host.

Cut, never add or substitute. A repaired quote is your wording. Filler ("um", "you know"), false
starts and caption annotations (`[laughter]`) may go, and every cut is written into the note. If a
line only makes sense with a word changed, drop it and say so. Never trim a hedge that changes the
claim ("I tell myself there has to be room…" keeps "I tell myself").

## 4. Build the candidates once, check them before he sees them

Keep one `candidates.json` in the session scratchpad (never his home directory): the strongest-first
list, each item holding the full record (shape in §6), the `source` text it was read in, and a
`show` block for the card. Its format is in `scripts/select-picks.py`. Then dry-run it:

```
python3 scripts/select-picks.py candidates.json all --out <dir>
```

Anything red is fixed or dropped before the list exists. A number then always means the same line,
and filing is mechanical.

## 5. Present

**One short work:** the list in chat, numbered, each with the quote, where it sits, one clause of
reason. **Several works, or more than about a dozen lines:**

```
python3 scripts/picker.py candidates.json picker.html --lede "…" --left-out "…" --key quote-mine-picks-<date>
```

and publish `picker.html` as an Artifact (private by default). He ticks lines on the page, presses
Copy numbers, and pastes the digits into chat. Chat carries the top five and the link, opening with
the answer (how many lines, from how many works) and then the one thing he does.

Flag on the card anything arguably a passage, widely quoted, a speaker judged from the interview
turn, a figure that is the speaker's own, or wording the transcript leaves uncertain. After the list
say where quality falls off and how the top compares with what he already holds from this work.

Name the work in the locator when the collection holds more than one by that author: both Amodei
essays have a §5 about work and meaning, and a bare "§5" has read as the wrong essay.

## 6. File the picks

One record per pick:

```json
{
  "text": "the quotation, verbatim, no enclosing quotation marks",
  "author": "Full Name",
  "work": "Title",
  "workKind": "book|essay|paper|speech|interview|film|poem|letter|document|song|other",
  "year": 2026,
  "source": { "kind": "curated", "url": "where you actually read it, or null", "locator": "section, chapter or 'who to whom · timestamp, what it is about'" },
  "themes": ["from the controlled list in assets/quote-core.js"],
  "tags": ["free form"],
  "lang": "en",
  "verification": { "status": "verified|reported", "note": "what you read, what you did not, every cut" }
}
```

No `id`: the repository computes it from the text, which is also what stops a quote entering twice.
`verified` only when you read the words in the work itself. Speech is `reported`, and the note names
the caption track, the download date, that the audio was not checked, and every cut and respelling.

Then, in order:

1. **Select and check.** `python3 scripts/select-picks.py candidates.json "<his numbers>" --out <dir>`
   re-checks each pick against its own source and writes `picks.json` and `issue-body.md`. **Do not
   file on a red.** `check-quotes.py` string-matches (exact, normalised, punctuation, trimmed with the
   dropped words listed), checks vocabularies, rejects a video or podcast marked `verified`, catches
   duplicates, and says whether the work is registered. When a caption mangles a name or splits a
   word (`selfregulate`, `open AI`), a `respell` rule in the candidate lets the check match it, and the
   note must say the caption spells it differently.
2. **File.** `gh issue create -R abustrup/Quote-collection --label quote-bulk --title "Quotes: …"
   --body-file <dir>/issue-body.md`. A workflow ingests, commits and closes the issue within about a
   minute (`gh issue view <n> --json state`) and runs only for issues opened by `abustrup`. Without
   `gh`: the prefilled link `https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml&json=<url-encoded JSON>`
   (field id `json`, about 6 KB), or the plain Bulk import link with the JSON in a file.
3. **Register each new work:** `python3 scripts/register-work.py --title "<exactly the work field>"
   --author "…" --year … --kind … --subject … [--url https://…] --commit`. A quote whose work is not
   in `data/works.json` reads fine on the page and is invisible to every subject and era filter, and
   the build only warns. A work with a host and a guest is registered under the guest.

## 7. Confirm

Say how many landed and link the collection; each quote has a permalink at
`https://abustrup.github.io/Quote-collection/#<id>`, and the issue's closing comment lists them.

## Traps already hit

- A fetch tool that summarises. The "essay" it returns is three paragraphs of paraphrase.
- Machine captions: no speaker names (a `>>` marks a change of speaker, nothing more), mangled
  names, a dropped negation that reads perfectly and means the opposite, and sentences cut off
  mid-clause. Read the lines either side of every candidate.
- Two caption tracks of the same audio (an episode and its clip) can disagree on a word. That is
  two readings of one source, not corroboration; choose wording that is stable in both, or flag it.
- A published transcript can contain speech that never happened. When both it and a caption track
  exist, the recording is the authority.
- Titles with a channel suffix (`| Lex Fridman Podcast #299`): the `work` is the episode title
  without it, and the channel goes in the locator.

## Notes

- **Homes.** This file, `scripts/` and `references/` live in the repo, which is what a cloud session
  sees. `~/.claude/skills/quote-mine/SKILL.md` is a stub with the same frontmatter that points
  here; Claude Code does not discover skills through symlinked directories (issues #38051 and
  #37590, checked 2026-09-12). If you change the description, change it in the stub too; it is the
  one line kept in two places.
- **Vocabularies** (themes, work kinds, subjects) are controlled lists in `assets/quote-core.js`;
  anything outside them is dropped silently on the way in. The scripts read them from the repo.
- **Goodreads** syncs every morning and is the collection's largest channel, all `unverified`. This
  skill's niche is what Goodreads cannot reach: essays, papers, documents, talks, unpublished work.
- **A cloud session in this repo sees the repo and nothing else** — no global contract, no memory.
  `.claude/rules/working-with-alexander.md` is the only channel, so what a future session must know
  belongs there or here.
- **yt-dlp.** `captions.py` prefers the Homebrew binary; when YouTube changes break captions,
  `brew upgrade yt-dlp` first.
