# Spoken works: talks, podcasts, interviews, videos

Read this when the work is speech. Goodreads cannot reach any of it, and the collection already keeps
interview and speech quotes. Derive the current count from `data/quotes.json` (or
`scripts/collection-profile.py`) rather than trusting any number written here.

## Get the transcript

```bash
python3 ~/Quote-collection/.claude/skills/quote-mine-v2/scripts/captions.py "<url>" --out <dir>
```

It writes `transcript.txt` (readable prose, a `[m:ss]` marker every ~30 seconds, the video's own chapter
headings) and `meta.json` (title, channel, date, duration, the day it was fetched, the full description,
which caption track was used, warnings), and keeps the raw files for audit. The raw caption track
(`source.<key>.vtt`) is what gives every line its exact second: `build-candidates.py` and
`locate-quote.py` read it, and the links they set start the video at that second. Read the description in
full: the speakers' names and roles are usually there, you need them for `author` and the locator, and it
is also where a misheard name is proven right. Exit 2 is a yt-dlp failure, or an address that is no single
video (a playlist, a channel; a watch link that carries `&list=` is read as that one video). The message says
which, and the cure differs: a removed video or a rate limit is not cured by `brew upgrade yt-dlp` (SKILL.md
section 2 has the list). Exit 3 is no caption track at all.

**Uploader track or machine track.** The script prefers the uploader's own and says which it used.
Machine captions carry the machine's punctuation and sentence boundaries (some tracks have none), mark no
speakers, and mangle names: Grok became "Rockbot" and Waymo "Whimo" on an a16z episode, 2026-08-31. If only
a machine track exists, say so at the top of the shortlist (`picker.py --chat` puts the sentence there when
`meta.json` says the track is machine captions). An uploader track may mark a change of speaker with "- " and a
machine track does with ">>"; neither ever names the speaker, and many uploader tracks mark nothing at all.
When one person asks and another answers, the turn tells you who is speaking. Say "judged from the turn" in the
flag for any line attributed that way, and most of all for a host's line. The check reads ">>" (and the hyphen,
in an uploader track) as a change of speaker and refuses a quote that runs across one: a quote is one person's.

When the speaker call rests on turn order, check the raw `source.*.vtt` that `captions.py` keeps:
`transcript.txt` has been seen to drop a very short turn (a lone ">> Yes.") that the raw track has, which
makes the turn count wrong.

**Clips and cuts.** A clip channel (Lex Clips and the like) carries a slice of a longer episode. It is one
work: mine the full episode, locate the line there, and file under the episode's title and timestamp. The
clip's own caption run is a second reading of the same audio, and the two can differ on a word ("second
day work" in one, "second day of work" in the other). A disagreement is a warning to flag, and proves
neither.

**Caption cut-offs.** Machine tracks drop a sentence's last word and sometimes end a sentence mid-clause
at a cue boundary. A line that ends oddly is not filed; say it was dropped for that.

**Caption spellings.** Names and compounds arrive split or misspelt (`selfregulate`, `open AI`,
`antonyym`, `alpha fold two`). A respell edit puts the right spelling in the quote and the note says so.
The check allows it when the right spelling is proven (the description or the rest of the transcript
spells it that way), when only the spacing differs (`open AI` and `OpenAI`, `Repl.it` and `Replit`), or, on
your word and with the reason in `"why": "typo: ..."`, when it is a typo in a long word (`limmerick`). A letter
or two off is also how real words differ (`causal` and `casual`), so the reason has to say how you know
(the audio at that second, the other caption track). A name or acronym that nothing proves can be respelled on
your word, with `"why": "name: ..."`, and it is listed in the note as it is. It is for spelling only, and a
figure is never respelled: `100` and `10` are two numbers. If a word could be a different word, drop the line.

**Confirm the speaker before filing under a name.** The description, the host addressing them by name
just before the answer, or the picture: download ten seconds at the timestamp and look at a frame. The
browser pane is no use for this: YouTube navigation was refused on 2026-08-31, and his standing rule is
that media in the pane stays unplayed.

```bash
yt-dlp -f "best[height<=480]/bestvideo[height<=480]+bestaudio/best" --download-sections "*17:44-17:54" \
  --force-keyframes-at-cuts -o "clip.%(ext)s" "<url>" && ffmpeg -ss 3 -i clip.webm -frames:v 1 frame.jpg
```

Ten seconds of video took ten seconds to fetch on 2026-09-12; then read `frame.jpg`.

**No captions at all.** The audio can be transcribed locally: `ffmpeg` is installed on his Mac, a Whisper
package is not. Offer the install, never assume it: he declined on 2026-08-04 and was right, since
`reported` was the correct status either way.

## Panels, press conferences and two guests

Where several people speak, `>>` (machine track) or a leading `-` (uploader track) misses real changes
of speaker and adds false ones, so the check that refuses a quote across a turn cannot be trusted alone.
Build a timed turn view yourself (the pauses, the questions, who is addressed) and, if the publisher
posted a labelled transcript, read the turns from it with `fetch-text.py` (it is a derived source, see
above). Attribute a line only when you are sure who said it; when you judged it from the turn, flag the
card and say "judged from the turn" in the note. A line whose speaker you cannot name is dropped, however
good. Each line carries its own `speaker`; `work.author` is the person the work is about or the main
guest. A work with two equal guests is registered under the first named in the title, and the locator
names who speaks. A press conference is `speech`, an interview with a host and a guest is `interview`.

## Two views of one source are one source

YouTube's "Show transcript" panel renders the same caption track `captions.py` downloads. He may point you
at it as a second opinion; agreement between the two proves only that your copy is faithful. The same
goes for any page that embeds the YouTube captions.

## Assume the transcript is wrong somewhere, and go looking

Even a publisher's own track errs. On AMD's caption track for AMD's own show, 2026-08-04: the guest's name
misspelt in the opening line, "a genetic process" for "agentic process", "STLC" for "SDLC", and at 34:34 a
dropped negation, "there **can** be a person sitting there" where he plainly said *can't*. A negation
flip is the dangerous class: it reads perfectly and means the opposite.

So read the sentences on either side of every candidate. If the passage only makes sense with a word
changed, that word is probably wrong. Drop the candidate rather than repair it, because a repaired quote
is your wording. On 2026-08-19 a dozen good Tegmark lines went that way ("component constant", "one game",
"the vacuum tubes of the 2020"), and saying so in the shortlist was the right output. Flag the softer
cases (tense, a garbled clause) on the line and let him decide.

The version-2 check backs this up where it can. It refuses a negation dropped or added by any edit, a
quote that starts after a negation or after "I think" in the same sentence, a quote that stops before a
"not", a quote that starts or stops right beside a hedge or a limit ("only", "almost", "for now", "at least"),
and a quote that runs across a change of speaker. It cannot see a negation the caption never wrote, so the
reading stays yours.

## A published transcript can contain speech that never happened

Mishearing is the failure you expect; interpolation is the one that gets through. On YC's own Root Access
transcript of Altman at Startup School 2026, checked 2026-08-09, two entire exchanges printed as dialogue
appear nowhere in the 39 minutes of audio. They are smooth and on-topic, exactly the well-turned platitude
shape the skill warns about. The same page dropped several of his best real answers and split one exchange
between the wrong speakers, so he appeared to affirm a growth figure he had just denied. Filing from that
page alone would have put fabricated quotations under a real name.

So when both a published transcript and a caption track exist, **the recording is the authority and the
transcript is the punctuation.** Run the picked lines against the caption track (`check-quotes.py` against
`transcript.txt` does exactly this) and include a control phrase you know is there, so an absent result
means absent and never a broken search. Where the two disagree on substance, mine the captions and say so;
the good material is often what the publisher dropped.

## Words the speaker reads out

Speakers quote other people ("Toby Ord writes, quote, ... end quote"). Those words belong to the person
quoted, and a line lifted from inside one would go in under the wrong name. The check refuses any quote
with "quote" in its sentence or just beside it. Leave such lines out.

## Filing from speech

Always `reported`. The note names the caption track (`meta.json` has its kind and key), the day it was
fetched, that the audio was not checked, and every edit. `build-candidates.py` writes the first three from
`meta.json` and `select-picks.py` appends the edit list, so the note always matches what the check
verified. Edits are deletions of fillers, stutters, repetitions and false starts, respellings the
description or the transcript proves, and a rare small word (to, of, a) the caption demonstrably dropped. Each is listed.

The locator reads like `The Economist, interviewed by Zanny Minton Beddoes · 3:19, on ...`: who is
speaking to whom, the time, what the line is about. For a solo piece, name what it is (`Bill Gates's own
video statement · 0:00, opening line`). The time in the locator and the `t` in the link are the same
second, read from the raw track; the check fails a line whose link or locator is more than 3 seconds from
where the line is said (30 seconds when only the block markers are available).

`work` is the episode or video title without the channel suffix, as the collection already does ("Yuval
Noah Harari on the dangers of an AI future", "Lex Fridman Podcast #452"); `workKind` is `interview` or
`speech`; `year` is the upload year unless the talk was given earlier. Register it with `register-work.py`
under the same title; the subject is chosen from the controlled list by judgement, and an AI or technology
talk is `technology`.
