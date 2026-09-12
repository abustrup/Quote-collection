# Spoken works: talks, podcasts, interviews, videos

Read this when the work is speech. Goodreads cannot reach any of it, and the collection already
keeps interview and speech quotes — derive the current count from `data/quotes.json` rather than
trusting any number written here.

## Get the transcript

```bash
python3 ~/Quote-collection/.claude/skills/quote-mine/scripts/captions.py "<url>" --out <dir>
```

It writes `transcript.txt` (readable prose, a `[m:ss]` marker every ~30 seconds, the video's own
chapter headings) and `meta.json` (title, channel, date, duration, the full description, which
caption track was used, warnings), and keeps the raw files for audit. Read the description in
full: the speakers' names and roles are usually there, and you need them for `author` and the
locator. Exit 2 is a yt-dlp failure (usually `brew upgrade yt-dlp`; or the site is not one yt-dlp
supports — fetch the page's own transcript instead). Exit 3 is no caption track at all.

**Uploader track or machine track.** The script prefers the uploader's own and says which it used.
Machine captions carry the machine's punctuation and sentence boundaries, mark no speakers, and
mangle names — Grok became "Rockbot" and Waymo "Whimo" on an a16z episode, 2026-08-31. If only a
machine track exists, say so at the top of the shortlist. An uploader track marks a change of
speaker with "- " but never names the speaker.

**Confirm the speaker before filing under a name.** The description, the host addressing them by
name just before the answer, or the picture: download ten seconds at the timestamp and look at a
frame. The browser pane is not for this — YouTube navigation was refused on 2026-08-31, and his
standing rule is that media in the pane stays unplayed.

```bash
yt-dlp -f "best[height<=480]/bestvideo[height<=480]+bestaudio/best" --download-sections "*17:44-17:54" \
  --force-keyframes-at-cuts -o "clip.%(ext)s" "<url>" && ffmpeg -ss 3 -i clip.webm -frames:v 1 frame.jpg
```

Ten seconds of video took ten seconds to fetch on 2026-09-12; then read `frame.jpg`.

**No captions at all.** The audio can be transcribed locally: `ffmpeg` is installed on his Mac, a
Whisper package is not. Offer the install, do not assume it — he declined on 2026-08-04 and was
right, since `reported` was the correct status either way.

## Two views of one source are one source

YouTube's "Show transcript" panel renders the same caption track `captions.py` downloads. He may
point you at it as a second opinion; agreement between the two proves only that your copy is
faithful. The same goes for any page that embeds the YouTube captions.

## Assume the transcript is wrong somewhere, and go looking

Even a publisher's own track errs. On AMD's caption track for AMD's own show, 2026-08-04: the
guest's name misspelt in the opening line, "a genetic process" for "agentic process", "STLC" for
"SDLC" — and at 34:34 a dropped negation, "there **can** be a person sitting there" where he
plainly said *can't*. A negation flip is the dangerous class: it reads perfectly and means the
opposite.

So read the sentences on either side of every candidate. If the passage only makes sense with a
word changed, that word is probably wrong — drop the candidate rather than repair it, because a
repaired quote is your wording. On 2026-08-19 a dozen good Tegmark lines went that way ("component
constant", "one game", "the vacuum tubes of the 2020"), and saying so in the shortlist was the
right output. Flag the softer cases — tense, a garbled clause — on the line and let him decide.

## A published transcript can contain speech that never happened

Mishearing is the failure you expect; interpolation is the one that gets through. On YC's own
Root Access transcript of Altman at Startup School 2026, checked 2026-08-09, two entire exchanges
printed as dialogue appear nowhere in the 39 minutes of audio — smooth, on-topic, exactly the
well-turned-platitude shape §3 of the skill warns about. The same page dropped several of his
best real answers and split one exchange between the wrong speakers, so he appeared to affirm a
growth figure he had just denied. Filing from that page alone would have put fabricated
quotations under a real name.

So when both a published transcript and a caption track exist, **the recording is the authority
and the transcript is the punctuation.** Run the picked lines against the caption track —
`check-quotes.py` against `transcript.txt` does exactly this — and include a control phrase you
know is there, so an absent result means absent rather than a broken search. Where the two
disagree on substance, mine the captions and say so; the good material is often what the
publisher dropped.

## Filing from speech

Always `reported`. The note names the track (`meta.json` has its kind and key), the download
date, that the audio was not checked, and every cut. Cuts are deletions only — a stutter, a
filler, a leading "And" — and `check-quotes.py` reports them as TRIMMED with the dropped words,
which belong in the note.

The locator reads like `The Economist, interviewed by Zanny Minton Beddoes · 03:19, on …`: who is
speaking to whom, the timestamp, what the line is about. The `[m:ss]` markers are block starts at
30-second precision; for the exact cue, grep the raw `source.*.vtt` the script kept.

`work` is the episode or video title without the channel suffix, as the collection already does
("Yuval Noah Harari on the dangers of an AI future", "Lex Fridman Podcast #452"); `workKind` is
`interview` or `speech`; `year` is the upload year unless the talk was given earlier. Register it
with `register-work.py` under the same title, subject usually `technology`.
