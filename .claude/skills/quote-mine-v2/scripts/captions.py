#!/usr/bin/env python3
"""Fetch the caption track of a spoken work and turn it into a clean, timestamped transcript.

Usage:
  captions.py URL [--out DIR] [--lang en]

Writes into DIR (default: ./captions-<video id>):
  transcript.txt   readable prose with a [m:ss] marker every ~30 s and chapter headings where the video has them
  meta.json        title, channel, date, duration, description, which track was used, the day it was
                   fetched, warnings
  source.*         the raw files yt-dlp produced, kept for audit; the raw caption track (source.<key>.vtt)
                   is what locate-quote.py reads to find the exact second a line is said

Prefers the uploader's own caption track over YouTube's machine one and says which it used. Prefers
the yt-dlp binary on PATH (brew install yt-dlp) and falls back to the python module with the
player-client workaround the old module needs. One video only: a watch link that carries &list=... is read as
that one video, and a playlist or channel address is refused.
Exit 2: yt-dlp failed, or the address is no single video (what to do about it is printed, and it depends on why:
a removed video and a rate limit are not cured by upgrading yt-dlp). Exit 3: no caption track.
"""
from __future__ import annotations

import argparse
import datetime
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

TS = r"(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}"
CUE_HEADER = re.compile(r"^\s*(?:\d+\s+)?(" + TS + r")\s*-->\s*(" + TS + r")")
# The same shape when it turns up *inside* a caption line — some tracks leak their own cue headers.
STRAY_HEADER = re.compile(r"(?:\b\d+\s+)?" + TS + r"\s*-->\s*" + TS + r"(?:\s+[a-z]+:\S+)*")
TAG = re.compile(r"<[^>]*>")  # <c>, </c>, <00:00:00.480>, <b>, <i>, <v Speaker>
ENTITY = re.compile(r"&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")
BLOCK_SECONDS = 30


def to_seconds(ts: str) -> float:
    ts = ts.replace(",", ".")
    parts = ts.split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def fmt(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def ytdlp_cmd() -> list[str]:
    binary = shutil.which("yt-dlp")
    if binary:
        return [binary]
    # The module on this Mac is old; without naming the player clients YouTube answers
    # "The page needs to be reloaded" [verified 2026-09-12]. The brew binary needs no such flag.
    return [sys.executable, "-m", "yt_dlp", "--extractor-args", "youtube:player_client=android,web,ios"]


# One video, never a list. A watch link copied out of a playlist carries &list=..., and without --no-playlist yt-dlp
# walks the whole list; --playlist-items 1 is the belt to that pair of braces.
ONE_VIDEO = ["--no-playlist", "--playlist-items", "1"]


def not_one_video(url: str) -> str | None:
    """Why this address is no single video (a playlist, a channel, a search), or None when it may be one."""
    u = urlparse(url if "://" in url else "https://" + url)
    host = (u.hostname or "").lower()
    if not (host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")):
        return None
    path = u.path.rstrip("/")
    has_video = bool(parse_qs(u.query).get("v"))
    if (path == "/playlist" or path == "/watch") and not has_video:
        return "This is a playlist, not one video. Give me the link to one video in it."
    if path.startswith(("/@", "/channel/", "/c/", "/user/", "/feed")) and not has_video:
        return "This is a channel page, not one video. Give me the link to one video."
    if path == "/results":
        return "This is a search page, not one video. Give me the link to one video."
    return None


def explain_failure(stderr: str) -> str:
    """What to do about a yt-dlp failure, from what it said. Most failures are not a stale yt-dlp, and upgrading
    the tool for a video that is gone only wastes the afternoon."""
    s = stderr.lower()
    if "429" in s or "too many requests" in s:
        return (
            "YouTube is limiting this Mac for now (HTTP 429, too many requests). Wait ten minutes or longer, then try once more. "
            "Upgrading yt-dlp will not help."
        )
    if "not a bot" in s or "sign in to confirm" in s or "confirm your age" in s or "age-restricted" in s:
        return (
            "YouTube wants a sign-in check before it shows this video. Try again later, or ask for another link or a transcript. "
            "Upgrading yt-dlp will not help."
        )
    if any(m in s for m in ("members-only", "members only", "join this channel", "private video", "video is private", "sign in if you've been granted access")):
        return "This video is private or for channel members only. Ask for another link. Upgrading yt-dlp will not help."
    if any(m in s for m in ("video unavailable", "this video is unavailable", "has been removed", "been terminated", "not available in your country", "blocked it", "no longer available", "does not exist")):
        return "This video is not available (removed, private, or blocked where this Mac is). Ask for another link. Upgrading yt-dlp will not help."
    if any(m in s for m in ("unsupported url", "is not a valid url", "unable to download webpage", "http error 404", "no video formats", "unable to extract")):
        return (
            "yt-dlp cannot read this address as a video. Check the link. A web page or an essay goes through fetch-text.py; "
            "for a podcast page, look for the show's own transcript or a YouTube upload of the episode."
        )
    return (
        "yt-dlp failed for a reason this script does not know. YouTube changes break old versions often; the fix is then usually\n"
        "  brew upgrade yt-dlp\n"
        "If the site is not YouTube, yt-dlp may simply not support it: fetch the page's own transcript instead."
    )


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(line for line in proc.stderr.splitlines() if "NotOpenSSL" not in line and "warnings.warn" not in line)[-1500:]
        sys.stderr.write(tail + "\n")
        sys.stderr.write("\n" + explain_failure(proc.stderr) + "\n")
        sys.exit(2)


def info_args(url: str, base: Path) -> list[str]:
    return ["--skip-download", "--write-info-json", "--no-warnings", *ONE_VIDEO, "-o", f"{base}.%(ext)s", url]


def fetch_info(url: str, out: Path) -> dict:
    base = out / "source"
    run(ytdlp_cmd() + info_args(url, base))
    info = out / "source.info.json"
    if not info.is_file():
        sys.stderr.write("yt-dlp ran but wrote no source.info.json, so there is nothing to work from.\n")
        sys.exit(2)
    data = json.loads(info.read_text(encoding="utf-8"))
    if data.get("_type") in ("playlist", "multi_video") or data.get("entries"):
        n = len(data.get("entries") or [])
        sys.stderr.write(f"This address is a list of {n or 'several'} items, not one video. Give me the link to one video.\n")
        sys.exit(2)
    return data


def pick_key(info: dict, lang: str):
    """(kind, key, name) for the best track on offer: the uploader's own first, then machine (ASR)."""
    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    for key, formats in subs.items():
        if key.split("-")[0] == lang:
            name = next((f.get("name") for f in formats if f.get("name")), "")
            return "uploader", key, name
    for key in (f"{lang}-orig", lang):
        if key in auto:
            return "asr", key, "YouTube machine captions"
    for key in auto:
        if key.split("-")[0] == lang:
            return "asr", key, "YouTube machine captions"
    return None


def track_args(url: str, out: Path, kind: str, key: str) -> list[str]:
    flag = "--write-subs" if kind == "uploader" else "--write-auto-subs"
    return ["--skip-download", flag, "--sub-langs", key, "--sub-format", "vtt", "--no-warnings", *ONE_VIDEO,
            "-o", f"{out / 'source'}.%(ext)s", url]


def fetch_track(url: str, out: Path, kind: str, key: str) -> Path:
    run(ytdlp_cmd() + track_args(url, out, kind, key))
    path = out / f"source.{key}.vtt"
    if not path.is_file():
        sys.stderr.write(f"yt-dlp reported a {key} track but wrote no {path.name}.\n")
        sys.exit(2)
    return path


def parse_vtt(text: str):
    """Cues as (start, end, body lines). Line-based on purpose: YouTube's machine track puts a
    whitespace-only line inside a cue, and splitting on blank lines silently dropped those cues —
    including the first sentence of the work [verified 2026-09-12]."""
    cues = []
    current = None
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        m = CUE_HEADER.match(line)
        if m:
            current = (to_seconds(m.group(1)), to_seconds(m.group(2)), [])
            cues.append(current)
        elif current is not None:
            current[2].append(line)
    return cues


class Cleaner:
    def __init__(self):
        self.entities = 0
        self.stray = 0

    def line(self, raw: str) -> str:
        # Unescape first: a stray header arrives as "00:01:02.000 --&gt; 00:01:04.000" and the
        # regex misses every one if the entities are still there [verified 2026-08-04].
        self.entities += len(ENTITY.findall(raw))
        s = html.unescape(raw)
        s, n = STRAY_HEADER.subn(" ", s)
        self.stray += n
        s = TAG.sub("", s)
        return re.sub(r"\s+", " ", s).strip()


TIME_TAG = re.compile(r"<(\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})>")
_SENT_OPEN, _SENT_CLOSE = "", ""  # private-use marks that carry a word's time through the cleaner
_SENT = re.compile(_SENT_OPEN + r"([0-9.]+)" + _SENT_CLOSE)


def _word_times(cleaned: str, cue_start: float):
    """[(word, start seconds)] from a cleaned machine-caption line that still carries time marks."""
    cur = cue_start
    out = []
    for piece in cleaned.split():
        marks = list(_SENT.finditer(piece))
        # A mark at the very start of a word times that word; a mark inside or after it times the next ones.
        first = float(marks[0].group(1)) if marks and marks[0].start() == 0 else cur
        word = _SENT.sub("", piece)
        if word:
            out.append((word, first))
        if marks:
            cur = float(marks[-1].group(1))
    return out


def entries_timed(cues, kind: str, cleaner: Cleaner):
    """(start, end, text, word_times) per caption entry, with the rolling duplication of machine
    tracks removed. word_times is [(word, seconds)] when the track times every word (YouTube's
    machine captions do), else None; the text is the same either way."""
    tagged = any("<c>" in l for _, _, body in cues for l in body)
    out = []
    if kind == "asr" and tagged:
        # YouTube's machine track repeats the previous line in every cue and marks the new
        # words with <c> tags; hold cues (10 ms) carry only the repeat. Keep the tagged lines.
        for start, end, body in cues:
            fresh = [l for l in body if "<c>" in l or re.search(r"<\d{2}:\d{2}", l)]
            if not fresh:
                continue
            marked = TIME_TAG.sub(lambda m: f"{_SENT_OPEN}{to_seconds(m.group(1)):.3f}{_SENT_CLOSE}", " ".join(fresh))
            cleaned = cleaner.line(marked)
            text = re.sub(r"\s+", " ", _SENT.sub("", cleaned)).strip()
            if text:
                out.append((start, end, text, _word_times(cleaned, start)))
        return out
    last = None
    for start, end, body in cues:
        if kind == "uploader":
            text = cleaner.line(" ".join(body))
            if text:
                out.append((start, end, text, None))
            continue
        for l in body:
            text = cleaner.line(l)
            if not text or text == last:
                continue
            out.append((start, end, text, None))
            last = text
    return out


def entries_from(cues, kind: str, cleaner: Cleaner):
    """(start, text) pairs with the rolling duplication of machine tracks removed."""
    return [(start, text) for start, _end, text, _words in entries_timed(cues, kind, cleaner)]


def write_transcript(entries, chapters, path: Path) -> int:
    chapters = sorted(
        [(float(c.get("start_time") or 0), c.get("title") or "") for c in chapters if c.get("title")],
        key=lambda c: c[0],
    )
    lines = []
    block = []
    block_start = None
    next_chapter = 0
    words = 0

    def flush():
        nonlocal block, block_start
        if block:
            lines.append(f"[{fmt(block_start)}] " + " ".join(block))
            lines.append("")
        block = []
        block_start = None

    for start, text in entries:
        while next_chapter < len(chapters) and chapters[next_chapter][0] <= start:
            flush()
            lines.append(f"## {chapters[next_chapter][1]}  ({fmt(chapters[next_chapter][0])})")
            lines.append("")
            next_chapter += 1
        if block_start is not None and start - block_start >= BLOCK_SECONDS:
            flush()
        if block_start is None:
            block_start = start
        block.append(text)
        words += len(text.split())
    flush()
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return words


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--out", help="directory to write into (default ./captions-<id>)")
    ap.add_argument("--lang", default="en", help="caption language (default en)")
    args = ap.parse_args()

    problem = not_one_video(args.url)
    if problem:
        sys.stderr.write(problem + "\n")
        sys.exit(2)
    vid = re.search(r"(?:v=|youtu\.be/|/videos/|/watch/)([A-Za-z0-9_-]{6,})", args.url)
    out = Path(args.out) if args.out else Path(f"captions-{vid.group(1) if vid else 'work'}")
    out.mkdir(parents=True, exist_ok=True)

    info = fetch_info(args.url, out)
    track = pick_key(info, args.lang)
    warnings = []
    if track is None:
        langs = sorted(set(list((info.get("subtitles") or {}).keys()) + list((info.get("automatic_captions") or {}).keys())))
        sys.stderr.write(
            f"No {args.lang} caption track for this work. Languages available: {', '.join(langs) or 'none'}.\n"
            "Options: a transcript the publisher posted (read it, but treat it as derived — see references/spoken-works.md),\n"
            "or a local transcription of the audio (ffmpeg is installed on his Mac; a Whisper package is not — offer, don't assume).\n"
        )
        sys.exit(3)
    kind, key, name = track
    vtt = fetch_track(args.url, out, kind, key).read_text(encoding="utf-8")
    cues = parse_vtt(vtt)
    cleaner = Cleaner()
    entries = entries_from(cues, kind, cleaner)
    words = write_transcript(entries, info.get("chapters") or [], out / "transcript.txt")

    if kind == "asr":
        marks = (out / "transcript.txt").read_text(encoding="utf-8").count(">>")
        turns = (f"'>>' marks {marks} changes of speaker, but it misses some and invents some, so judge every turn from context or a published transcript"
                 if marks else "no change of speaker is marked")
        warnings.append(f"Machine captions only: punctuation and sentence boundaries are the machine's, {turns}, and names are often mangled. Every quote from this is `reported`.")
    else:
        marks = len(re.findall(r"(?m)^- ", vtt))
        turns = (f"'- ' marks {marks} changes of speaker, not who is speaking. Confirm the speaker before filing under a name."
                 if marks else "No change of speaker is marked, so judge the turns from context or a published transcript and say so in the note.")
        warnings.append(f"Uploader captions: {turns} Still someone's typing: `reported`, not `verified`.")
    if cleaner.stray:
        warnings.append(f"Removed {cleaner.stray} stray cue headers that had leaked into the caption text.")
    if cleaner.entities:
        warnings.append(f"Cleaned {cleaner.entities} HTML entities (such as &nbsp;) out of the caption text. Nothing to fix.")
    if len(entries) < 20:
        warnings.append(f"Only {len(entries)} caption entries — check the track is really the whole work.")

    upload = info.get("upload_date") or ""
    meta = {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "upload_date": f"{upload[:4]}-{upload[4:6]}-{upload[6:8]}" if len(upload) == 8 else upload or None,
        "duration": fmt(info.get("duration") or 0),
        "url": info.get("webpage_url") or args.url,
        "video_id": info.get("id"),
        "fetched": datetime.date.today().isoformat(),
        "track": {"kind": kind, "key": key, "name": name, "file": f"source.{key}.vtt"},
        "entries": len(entries),
        "words": words,
        "chapters": [{"start": fmt(float(c.get("start_time") or 0)), "title": c.get("title")} for c in (info.get("chapters") or [])],
        "description": info.get("description"),
        "warnings": warnings,
        "transcript": str((out / "transcript.txt").resolve()),
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{meta['title']}")
    print(f"  {meta['channel']} · {meta['upload_date']} · {meta['duration']}")
    print(f"  track: {kind} ({key}{' — ' + name if name else ''}) · {len(entries)} entries · {words} words · {len(meta['chapters'])} chapters")
    print(f"  transcript: {meta['transcript']}")
    print(f"  meta:       {(out / 'meta.json').resolve()}")
    for w in warnings:
        print(f"  ! {w}")
    desc = (info.get("description") or "").strip().replace("\n", " ")
    if desc:
        print(f"  description: {desc[:240]}{'…' if len(desc) > 240 else ''}")
    print("  (speaker names and roles are usually in the description: read it in full from meta.json)")


if __name__ == "__main__":
    main()
