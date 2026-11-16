---
name: quote-mine-v2
description: Mine a video, podcast, talk, interview, essay, paper, document or book for the lines worth keeping, then file the ones Alexander picks into his quote collection and register the work on its shelf. Use for "quote mine this video", "quote mine v2", "quote mine <url>", "best quotes from this video / podcast / talk / interview", "add quotes from X", "what's worth keeping from X", or a bare YouTube or podcast URL. For a video or talk it first finds the work's main points, then shows 10 to 20 lines, strongest first, each tied to the main point it carries, worded so it can be pasted into writing (grammar fixed, the speaker's words otherwise intact) and linked to the moment it is said. Above all for works too new or too unpublished to be in a model's memory, which is where it earns its keep. Captions are fetched directly, so never decline for want of a transcript. Not for a quote he already has in hand; that is a one-line issue.
---

# Quote mine v2

Alexander keeps a quote collection at
[abustrup/Quote-collection](https://github.com/abustrup/Quote-collection), published at
https://abustrup.github.io/Quote-collection/ and cloned at `~/Quote-collection`. He reads and watches a
lot and wants the lines worth keeping out of a work without going through it twice with a notebook.

The job. For a video or talk: find its main points, show him the best 10 to 20 lines (15 is the target)
with the strongest first, each marked with the main point it carries and worded so that it can be pasted
into writing as it stands. He answers with numbers. The picks are filed, the work is registered, he gets
the link. He cannot read code, diffs or logs, so what reaches him is a numbered list and a link to the
result. Everything mechanical is a script in `scripts/` beside this file. Speech has its own notes in
`references/spoken-works.md`. Paths below are relative to this skill's folder in the repo,
`~/Quote-collection/.claude/skills/quote-mine-v2/`, so `scripts/captions.py` means
`python3 ~/Quote-collection/.claude/skills/quote-mine-v2/scripts/captions.py` (a cloud session starts in the
repo: `python3 .claude/skills/quote-mine-v2/scripts/captions.py`). Everything you make (the captions folder,
the outline, the drafts, the picker page) goes in the session scratchpad, never in his home directory or the repo.

## The path for a video, at a glance

```
find-in-library.py WORDS            only when he names it and gave no URL
captions.py URL --out DIR           the transcript, the raw caption track, meta.json
collection-profile.py --author X    what he keeps, and what he already holds from X
(read all of transcript.txt)        write outline.md: the thesis and four to eight main points
(choose and word the lines)         write drafts.json
build-candidates.py drafts.json     finds each line, sets time, link and locator, lists the edits, checks
select-picks.py candidates.json all --out DIR      the dry run: every line passes or is fixed
picker.py candidates.json --chat    the numbered list for the chat
(his numbers)                       select-picks.py ... "1-5, 8" --out DIR, then the issue, then register-work.py
```

## The one rule

**Never propose wording you produced from recall alone.** A model's memory of a sentence is a
paraphrase wearing quotation marks, and a wrong quote in a collection whose premise is tracked
attribution is the worst available failure.

The rule is narrower than "only what you read this session": most of the collection's curated canon was
cross-checked and is good. Three honest routes, and `verification.status` records which one you took:

- **Read it in the work itself**: the essay on its author's site, the PDF, the publisher's copy. Status `verified`.
- **Cross-checked the wording** across several independent sources that agree, for stable and widely
  reproduced text. Status `reported`, and the note says what you did and did not consult.
- **Read a transcript of speech**: captions, a posted transcript. Always `reported`, however official. A
  transcript is someone's typing, never the speaker's words.

Cross-checking works for the canon and fails for anything recent: the few sources copy each other, and
search surfaces mirrors that are summaries ("Amodei argues that..." reads like source text and is not).
**For a work from the last couple of years, read it or drop it.** A search snippet is no evidence, and a
fetch tool that summarises a page has given you a summary. Use `scripts/fetch-text.py URL out.txt`, which
keeps the page's own text and says when it is too short to be the work. If you can neither read it nor
honestly cross-check it, say so and stop. Asking him to paste it costs ten seconds.

## 1. Find the work

A URL in his message wins. If he says "this video" with no URL, look in the conversation. If he names it
("the Dwarkesh Karpathy one"), run `python3 scripts/find-in-library.py dwarkesh karpathy`: it searches his
video library (read only) and prints the best few with title, channel, date and URL. Confirm in one line
only when the top two are close. If nothing matches, or there is no library on this machine (a cloud
session has none), ask for the URL in one line. A prompt that arrives from his video library already
carries the URL.

## 2. Get the text

- **A video, talk or podcast (YouTube or another site yt-dlp reads):**
  `python3 scripts/captions.py "<url>" --out <scratchpad>/<name>`, then read
  `references/spoken-works.md` before choosing anything. Never ask him to paste a transcript.
- **A page or essay:** `scripts/fetch-text.py`. `anthropic.com/constitution` also lives CC0 at
  `raw.githubusercontent.com/anthropics/claude-constitution/main/`; arXiv for papers; Gutenberg for anything old.
- **His own file:** a PDF or EPUB he has. Source material lands in `~/Downloads` by accident, so look there.
- **Otherwise ask him to paste or drop it,** and say which step failed.

Several works at once: fetch them all first, in parallel. If two URLs are one source (a clip and the
episode it was cut from), mine the full one and say the clip is covered.

**When `captions.py` fails,** what it prints says why, and the cure differs:
- A video that is unavailable, private or for members only: ask for another link. Upgrading yt-dlp does not help.
- "Too many requests" (429) or a sign-in check: YouTube is limiting this Mac. Wait ten minutes or longer and try once more.
- A playlist, channel or search address: ask for the link to one video. A watch link that carries `&list=` is read as that one video.
- A page yt-dlp cannot read (an article, some podcast pages): `fetch-text.py`, or the show's own transcript, or a YouTube upload of the episode.
- No caption track at all (exit 3): say so. A Whisper package is not installed, so offer a local transcription and never assume it.
- Anything else on exit 2: `brew upgrade yt-dlp`, then try once more.
Say in one line what failed and what you did or need. Never upgrade his tools for a video that is gone.

## 3. Learn what he keeps

`git -C ~/Quote-collection pull -q`, then `python3 scripts/collection-profile.py --author "<speaker>"`
(a cloud session is already in the repo). It prints, from the data as it is today, how long his curated
lines run, which lines he has starred, what he already holds from this author, and the controlled lists
you will draw themes and a subject from. Take its numbers from the output, never from this file.

What he keeps: **the sentence that carries the work's argument.** Short, self-contained, committing to
something (a mechanism, a magnitude, a cause, a rule), and said by someone placed to say it. That is
broader than a vivid detail and tighter than a paragraph. His starred lines, which the profile prints, are the
test: a new line should be at home among them. He has said it plainly: mostly he wants the main points of a
video to be remembered. For a video that argues automating AI research is why superintelligence is near,
that point leads the list. Where he already holds lines from this author, those lines set the bar,
whatever the work's average.

## 4. Find the spine, then the lines

Read the whole transcript, start to finish, before choosing anything. Then write `outline.md` in the
scratchpad:

```
Thesis: the work's claim in one sentence
1. [m:ss] a main point, in one plain sentence
2. [m:ss] ...
```

Four to eight main points. A main point is a claim the work argues for, one that could be agreed or
disputed ("automating AI research is what makes superintelligence near"). A topic ("AI research") and an
aside are no main points. The video's own chapter titles (in `meta.json`) are topics: a useful map, no
more. Essays, papers and documents get the same outline, shorter. A work that argues nothing (a poem, a
rambling conversation) gets the strongest and most distinctive lines instead, and you say so.

Then, for each main point, find the speaker's own single sentence (or two) that carries it most
completely. Those are the lead candidates. Then add the strongest supporting and the most distinctive
lines. Target 15, allowed 10 to 20, ceiling 20. A ceiling is no quota: stop where the ore runs out and say
where. A second pass over a work already mined returns thinner ore, which does not mean the rule broke.

**Rank by how central the line is to the work's argument.** The line that would stand for the whole video
comes first, never document order. Every candidate carries a one-clause **Main point** label that he
reads: which point of the work this line proves. Lines proving the same point carry the same label.

The failure to catch is the well-turned platitude: a sentence that names no one, commits to nothing
falsifiable, and survives having its subject swapped. Prefer the sentence that commits. A famous line can
commit too, and the most-quoted line of a work usually does, so keep it and flag it as widely quoted.
Secondarily: lines that survive being lifted out of their paragraph, one idea per quote, some range of
register. Nothing already in the collection (the check flags a line he holds, and a near copy of one).
Lines by the **host or interviewer** are fair game when they are the best sentence in the conversation; the
author is then the host. Words the speaker reads out from someone else ("quote ... end quote") are not the
speaker's: leave them.

## 5. The text of a quote

The speaker's words, with grammar fixed and nothing else touched. It is meant to be pasted into writing
with no further editing.

**Allowed:**
- capital letters and punctuation; joining broken caption lines into proper sentences
- removing the caption's timestamp markers and annotations such as [laughter]
- removing fillers, stutters, repetitions and false starts
- fixing a machine-caption misrecognition when the transcript or the description proves the right word
  (names, product names)
- fixing a plain grammatical slip of transcription

**Never:** paraphrase; reordering; adding words the speaker did not say (one exception: a small word such as
"to" or "of" that the caption demonstrably dropped, and it is flagged; the check refuses any word that
carries meaning); swapping a word for a better one; trimming a hedge or a qualifier that changes the claim
("I think", "probably", "only", "most", "almost", "for now"), whether inside the line or by starting after it
or stopping before it; joining distant sentences; joining two speakers. If a line only makes sense with a word
changed, drop it and say so. Never repair a caption's dropped negation: that line reads perfectly and says
the opposite.

**A quote is one person's words.** `>>` in the transcript (and a caption line that starts with `-` in an
uploader's track) is a change of speaker, and a line that runs across one is two people's words under one
name: the check refuses it. Take one speaker's turn. If the other speaker only puts in a word or two
(`>> Yeah. >>`) and the same person carries on, cut that remark and say why on the edit.

**A word that is one letter off is not a typo until you say so.** `causal` and `casual`, `quiet` and `quite`,
`stable` and `stale` are different words, and the text cannot tell you which one the speaker said. A
correction needs `"why": "typo: the audio at 3:10 says it"` (or the description, or the other caption track),
and the note carries your reason. A figure is never respelled: `100` is not `10`, whatever the reason.

Keep contractions and the speaker's register. Prefer one to two sentences, 80 to 220 characters. A main
point that needs more may run to about 350 and gets a flag on its card saying why. No timestamps, no
speaker labels, no enclosing quotation marks, no leading "And so" when dropping it loses nothing, no
dangling clause at either end. Start where the speaker's claim starts and stop where it stops: a quote
that begins after "I think" or "I don't think", or ends before "not", says something the speaker did not.

Every edit beyond capitalisation and punctuation is declared as an edit (`cut`, `respell`, `insert`; the
formats are in `scripts/check-quotes.py`), and the scripts write the list into the verification note, for
example: removed "you know" x2; "Whimo" respelled "Waymo" (per the description). A connective left off the
front of the line ("And", "But", "So") or a "you know" left off the end is named in the note too. You never
type that note yourself. A cut that is no filler, a hedge, a typo correction or an added word needs a `why`
on the edit.

Where a line keeps a slip of spoken grammar the rules do not let you fix ("two order magnitude difference",
"gonna", a plural that is missing), keep it and flag it on the card (`flag`) so he can decide. The line pastes
into writing with that slip in it, and he should know before he picks it.

Words that end up in the collection or on a page (locator, about, why, flag) are plain and short, with no
em dashes, and the quote is the same: an em dash that the transcript does not have fails the check. Use a
comma or a full stop.

## 6. Draft, build, check

Write `drafts.json` in the scratchpad, strongest first. The cleaned text goes in `text`; everything else
is what only you can judge:

```json
{
  "transcript": "<the captions folder>",
  "work": {"title": "<the video title, without any channel suffix>", "author": "<speaker>", "workKind": "speech",
           "year": 2026, "prefix": "<speaker>, solo video essay", "short": "<short title>", "themes": ["technology"]},
  "points": ["<main point 1>", "<main point 2>"],
  "items": [
    {"text": "<the line, cleaned>", "point": 1, "about": "on why ...", "why": "<why it is worth keeping, one clause>",
     "themes": ["technology", "progress"], "tags": ["ai"], "flag": ""}
  ]
}
```

`prefix` starts the locator. The locator reads `<speaker> to <host> · m:ss, <what it is about>` for an
interview, and for a solo piece names what it is: `Bill Gates's own video statement · 0:00, opening
line`. Say `host` and the prefix is made for you. A line by someone other than `work.author` takes its own
`speaker` and `prefix`. The collection holds more than one work by some authors, so name the work in the
locator when a bare section number could be read as the wrong one.

An essay, paper or document goes through the same builder: `transcript` is the saved text file from
`fetch-text.py`, and `work` adds `"url"` (the page), `"status": "verified"` and `"note"` (what you read and
when). Each line then takes its own `prefix`, the section, and a line needs no time.

Several works: build each work from its own drafts file, then join the lists into one `candidates.json` in
the order you rank them, strongest first across all of the works (a few lines of Python does it). The
numbers then run across the whole list.

```
python3 scripts/build-candidates.py drafts.json
```

finds each line in the transcript however it was cleaned, reads the second it is said, sets `source.url` to
the video at that second (`https://youtu.be/<id>?t=<seconds>`, so a click lands on the line; another host
keeps its page address) and the locator, fills the verification note, works out the edits and runs the
checks. Read every row. A red row says exactly what is wrong (a word that is not in the transcript, a
negation dropped, a quote that starts after "I think", a link whose time is not the line's). Fix the text
and run it again. Never loosen a check to get a line through. For one line,
`python3 scripts/locate-quote.py <captions folder> --text "..."` shows the time, the link, the transcript
around it and the edits it finds.

When a row says an edit needs a reason (a cut that is no filler, a hedge cut, a typo, an added word), the row
shows the exact snippet. Put it in that item as `"edits": [{"kind": "cut", "from": "I mean", "why":
"filler"}]`. The builder still works out every edit itself; what you add is the reason.

The check judges where a line starts and stops by the words beside it. If they carry a negation, a frame
("I think"), a hedge or quantifier ("only", "most", "nearly", "almost"), a limit in time or degree ("for now",
"at least", "so far"), or if the line runs across a change of speaker, the row is red: start the line where the
claim starts, take those words into the line, or add `"ack": "<why it is the same claim>"` to the draft. The
reason goes into the verification note, so give one you could defend to him. A line that starts or stops
mid-sentence with none of that is only a warning, and fine when it stands alone: read the sentence it sits in,
and if the sentence goes on to qualify what the line says, widen the line. In a track without punctuation the
same findings are only warnings, because the check cannot see where a sentence ends; they still have to be
settled, never skipped. A warning that the same words are said at two times (a teaser in the opening and
the real moment) names both: in a long video the link and the locator use the one after the opening minute,
so check it is the one you mean.

Then the dry run, which is what makes a number always mean the same line and filing mechanical:

```
python3 scripts/select-picks.py candidates.json all --out <dir>
```

Anything red is fixed or dropped before the list exists.

## 7. Present

**One video:** the list in chat, numbered, strongest first:

```
python3 scripts/picker.py candidates.json --chat
```

Paste it as it is. Each line is the quote followed by a plainer second line `m:ss · speaker · Main point:
...`. Open with the answer: how many lines, from what, which three or four main points they cover. Then
one line on what he does: "Reply with numbers, top 5, or all." After the list, say where quality falls
off and how the top compares with what he already holds from the same author (from step 3).

If only machine captions exist (`track.kind` is `asr` in `meta.json`), say so at the top: the lines come from
YouTube's machine captions, names and words may be misheard, and each speaker is judged from the turn.
`picker.py --chat` puts that sentence above the list when it applies, and the picker page carries it too;
keep it when you paste.

**Several works, or more than 12 lines across several works:** the picker page.

```
python3 scripts/picker.py candidates.json picker.html --lede "..." --left-out "..." --key quote-mine-picks-<date>
```

Publish `picker.html` as an Artifact (private by default; the tool wraps the page in its own document). He
ticks lines, presses Copy numbers and pastes the digits into chat. Each card shows the time (a link to that
moment) and the Main point. Chat carries the top five (`picker.py candidates.json --chat --top 5`) and the
link, opening with the answer. To look at the page as a local file, add `--standalone`, which writes a whole
document (doctype, charset, viewport) that opens by itself.

Flag on the card anything arguably a passage, widely quoted, a speaker judged from the interview turn, a
figure that is the speaker's own, wording the transcript leaves uncertain, a line over 220 characters, a
word added or fixed for grammar, or a slip of spoken grammar kept as said.

## 8. File the picks

One record per pick. `select-picks.py` writes them from your candidates; this is what each holds:

```json
{
  "text": "the quotation, cleaned as in section 5, no enclosing quotation marks",
  "author": "Full Name",
  "work": "Title",
  "workKind": "book|essay|paper|speech|interview|film|poem|letter|document|song|other",
  "year": 2026,
  "source": { "kind": "curated", "url": "the video at the second it is said, or the page", "locator": "<speaker> to <host> · m:ss, what it is about" },
  "themes": ["from the controlled list in assets/quote-core.js"],
  "tags": ["free form"],
  "lang": "en",
  "verification": { "status": "verified|reported", "note": "what you read, what you did not, every edit" }
}
```

No `id`: the repository computes it from the text, which is also what stops a quote entering twice.
`verified` only when you read the words in the work itself. Speech is `reported`.

Then, in order:

1. **Select and check.** `python3 scripts/select-picks.py candidates.json "<his numbers>" --out <dir>` (pass
   his reply as he typed it: "3, 7, 11-13", "top 5" for 1-5, "top 5, 8", or "all") re-checks each pick
   against its own source and writes `picks.json` and `issue-body.md`. **Do not file on a red.**
2. **File.** `gh issue create -R abustrup/Quote-collection --label quote-bulk --title "Quotes: ..."
   --body-file <dir>/issue-body.md`. A workflow ingests, commits and closes the issue within about a minute
   (`gh issue view <n> --json state`) and runs only for issues opened by `abustrup`. Without `gh`: the
   prefilled link `https://github.com/abustrup/Quote-collection/issues/new?template=bulk-import.yml&json=<url-encoded JSON>`
   (field id `json`, about 6 KB), or the plain Bulk import link with the JSON in a file.
3. **Register each new work:** `python3 scripts/register-work.py --title "<exactly the work field>" --author
   "..." --year ... --kind ... --subject ... [--url https://...] --commit`. Choose the subject from the
   controlled list in `assets/quote-core.js` by judgement (an AI or technology talk is technology) and ask
   only when it is genuinely unclear. A quote whose work is not in `data/works.json` reads fine on the page
   and is invisible to every subject and era filter, and the build only warns. A work with a host and a
   guest is registered under the guest. Without `--commit` the script still writes `data/works.json`; to
   preview, add `--dry-run`, which shows the record and writes nothing.

## 9. Confirm

Say how many landed and link the collection. Each quote has a permalink at
`https://abustrup.github.io/Quote-collection/#<id>`, and the issue's closing comment lists them.

## Traps already hit

- A fetch tool that summarises. The "essay" it returns is three paragraphs of paraphrase.
- Machine captions: no speaker names (a `>>` marks a change of speaker, nothing more), mangled names, a
  dropped negation that reads perfectly and means the opposite, and sentences cut off mid-clause. Read the
  lines either side of every candidate.
- Two caption tracks of the same audio (an episode and its clip) can disagree on a word. That is two
  readings of one source, never corroboration; choose wording that is stable in both, or flag it.
- A published transcript can contain speech that never happened. When both it and a caption track exist,
  the recording is the authority.
- Titles with a channel suffix (`| Lex Fridman Podcast #299`): the `work` is the episode title without it,
  and the channel goes in the locator.
- A speaker reading out someone else's words ("he writes, quote, ... end quote"). Those words are the
  other person's.
- A video that reads out an essay: the spoken words are what you quote, from the captions.

## Notes

- **Homes.** This file, `scripts/` and `references/` live in the repo, which is what a cloud session sees.
  `~/.claude/skills/quote-mine-v2/SKILL.md` is a stub with the same frontmatter that points here; Claude Code
  does not discover skills through symlinked directories (issues #38051 and #37590, checked 2026-09-12). If
  you change the description, change it in the stub too: it is the one line kept in two places. The folder
  was `quote-mine` until 2026-11-15 (renamed with its history). A candidate without an `edits` list is still
  checked the version-1 way, so older candidate files keep working.
- **Vocabularies** (themes, work kinds, subjects) are controlled lists in `assets/quote-core.js`; anything
  outside them is dropped silently on the way in. The scripts read them from the repo.
- **Goodreads** syncs every morning and is the collection's largest channel, all `unverified`. This skill's
  niche is what Goodreads cannot reach: essays, papers, documents, talks, unpublished work.
- **A cloud session in this repo sees the repo and nothing else**: no global contract, no memory, and no
  video library. `.claude/rules/working-with-alexander.md` is the only channel, so what a future session must
  know belongs there or here.
- **yt-dlp.** `captions.py` prefers the Homebrew binary; when YouTube changes break captions, `brew upgrade
  yt-dlp` first.
- **Tests.** `python3 -m unittest discover -s .claude/skills/quote-mine-v2/scripts -p "test_*.py"` covers
  the word alignment, the edits check, the negation guard and the links. Run it after changing a script.
