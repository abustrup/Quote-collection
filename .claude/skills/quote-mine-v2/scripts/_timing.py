"""When was it said? Times for the words of a transcript, from the raw caption track captions.py keeps.

`Work` bundles what the scripts need about one fetched video or talk: the transcript tokenised
(`_text.SourceIndex`), meta.json, and a time for every word. The times come from the raw
`source.<key>.vtt` (to the second, or to the word for YouTube's machine captions). When there is
no raw track they come from the `[m:ss]` markers in transcript.txt, which are good to 30 seconds,
and `timing` says so.
"""
from __future__ import annotations

import bisect
import datetime
import difflib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import captions  # noqa: E402
from _text import SourceIndex, fmt_time, link_with_time, tokenize  # noqa: E402

OPENING_SECONDS = 60      # the first minute of a long video is often a teaser of what is said later
OPENING_MIN_VIDEO = 600   # a video shorter than ten minutes has no teaser worth the name


@dataclass
class Timed:
    words: List[str]
    times: List[float]
    entries: List[dict]          # {"i0", "i1", "start", "end", "text"}: caption lines, as word ranges
    source: str                  # "vtt" or "markers"
    _starts: List[int] = field(default_factory=list)

    def __post_init__(self):
        self._starts = [e["i0"] for e in self.entries]

    def entry_of(self, i: int) -> int:
        return max(0, bisect.bisect_right(self._starts, i) - 1)


def from_vtt(vtt_text: str, kind: str) -> Timed:
    cues = captions.parse_vtt(vtt_text)
    entries = captions.entries_timed(cues, kind, captions.Cleaner())
    words: List[str] = []
    times: List[float] = []
    out: List[dict] = []
    for start, end, text, wt in entries:
        pieces = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
        if wt and len(wt) == len(pieces):
            piece_times = [t for _w, t in wt]
        else:
            total = max(1, len(text))
            span = max(0.0, end - start)
            piece_times = [start + span * (a / total) for a, _b in pieces]
        i0 = len(words)
        pi = 0
        for tok in tokenize(text):
            while pi + 1 < len(pieces) and pieces[pi][1] <= tok.start:
                pi += 1
            words.append(tok.w)
            times.append(piece_times[pi] if piece_times else start)
        out.append({"i0": i0, "i1": len(words), "start": start, "end": end, "text": text})
    return Timed(words, times, out, "vtt")


_BLOCK = re.compile(r"^\[(?:(\d+):)?(\d+):(\d\d)\]\s*(.*)$")


def from_markers(raw: str) -> Optional[Timed]:
    words: List[str] = []
    times: List[float] = []
    out: List[dict] = []
    cur: Optional[float] = None
    seen_marker = False
    for line in raw.splitlines():
        if line.startswith("## "):
            continue
        m = _BLOCK.match(line)
        if m:
            seen_marker = True
            cur = int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
            text = m.group(4)
        else:
            text = line
        if not text.strip():
            continue
        if cur is None:
            cur = 0.0
        i0 = len(words)
        for tok in tokenize(text):
            words.append(tok.w)
            times.append(float(cur))
        out.append({"i0": i0, "i1": len(words), "start": float(cur), "end": float(cur), "text": text.strip()})
    return Timed(words, times, out, "markers") if words and seen_marker else None


@dataclass
class Work:
    transcript: Path
    idx: SourceIndex
    meta: dict
    meta_path: Optional[Path]
    timed: Optional[Timed]
    timing: str                          # how the times were got, in words
    index_map: Optional[List[int]] = None  # transcript word -> timed word, when the two disagree

    @property
    def meta_text(self) -> str:
        """Title, channel, description and chapter names: the places a name is spelled right."""
        m = self.meta
        bits = [m.get("title") or "", m.get("channel") or "", m.get("description") or ""]
        bits += [c.get("title") or "" for c in m.get("chapters") or []]
        return "\n".join(b for b in bits if b)

    def auto_note(self) -> str:
        """The base verification note for a work fetched by captions.py."""
        track = self.meta.get("track") or {}
        which = "the uploader's own caption track" if track.get("kind") == "uploader" else "YouTube's machine caption track"
        key = f" ({track['key']})" if track.get("key") else ""
        fetched = self.meta.get("fetched") or ""
        if not fetched and self.meta_path is not None:
            # meta.json written before captions.py recorded the day: the day the file was written is the day it was fetched.
            fetched = datetime.date.fromtimestamp(self.meta_path.stat().st_mtime).isoformat()
        when = f", fetched with yt-dlp on {fetched}" if fetched else ""
        return (
            f"Read in {which}{key} of the video{when}, and lined up against that transcript word by word. "
            "Not checked against the audio."
        )

    def mark_opening(self) -> None:
        """Tell the index where the opening ends, so that a line said in the opening teaser and again in the body
        is placed in the body. Only a video long enough to have a teaser has one."""
        n = len(self.idx.w)
        if self.timed is None or n == 0:
            return
        total = self.seconds_at(n - 1)
        if total is None or total < OPENING_MIN_VIDEO:
            return
        for i in range(n):
            sec = self.seconds_at(i)
            if sec is not None and sec >= OPENING_SECONDS:
                self.idx.teaser_end = i
                return

    def seconds_at(self, i: int) -> Optional[float]:
        """The second word i of the transcript starts."""
        if self.timed is None or not (0 <= i < len(self.idx.w)):
            return None
        if self.index_map is not None:
            j = self.index_map[i]
            return self.timed.times[j] if j >= 0 else None
        return self.timed.times[i]

    def url_at(self, seconds: float) -> Optional[str]:
        url = self.meta.get("url")
        return link_with_time(url, seconds) if url else None

    def lines_around(self, i0: int, i1: int, before: int = 2, after: int = 2) -> List[dict]:
        """Caption lines holding words i0..i1-1, with `before` and `after` more each side, each marked
        as inside or outside the span."""
        if self.timed is None:
            return []
        if self.index_map is not None:
            a, b = self.index_map[i0], self.index_map[max(i0, i1 - 1)]
            if a < 0 or b < 0:
                return []
            j0, j1 = a, b + 1
        else:
            j0, j1 = i0, i1
        ents = self.timed.entries
        first, last = self.timed.entry_of(j0), self.timed.entry_of(max(j0, j1 - 1))
        out = []
        for k in range(max(0, first - before), min(len(ents), last + after + 1)):
            e = ents[k]
            out.append({"start": e["start"], "text": e["text"], "inside": first <= k <= last})
        return out


def _find(src: Path, meta: Optional[str], vtt: Optional[str]):
    if src.is_dir():
        base, transcript = src, src / "transcript.txt"
    else:
        base, transcript = src.parent, src
    meta_path = Path(meta) if meta else base / "meta.json"
    meta_data: dict = {}
    if meta_path.is_file():
        meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        meta_path = None
    vtt_path = Path(vtt) if vtt else None
    if vtt_path is None and meta_data:
        f = (meta_data.get("track") or {}).get("file")
        if f and ((meta_path.parent / f).is_file() if meta_path else False):
            vtt_path = meta_path.parent / f
    if vtt_path is None:
        found = sorted(base.glob("source.*.vtt"))
        vtt_path = found[0] if found else None
    return transcript, meta_path, meta_data, vtt_path


def load_work(src: str, meta: Optional[str] = None, vtt: Optional[str] = None) -> Work:
    """src is transcript.txt or the folder captions.py wrote."""
    transcript, meta_path, meta_data, vtt_path = _find(Path(src).expanduser(), meta, vtt)
    if not transcript.is_file():
        raise SystemExit(f"No transcript at {transcript}")
    raw = transcript.read_text(encoding="utf-8")
    # An uploader's own track marks a change of speaker with a caption line that starts with "-"; a machine track with
    # ">>". The hyphen is only read as that mark when the track is known to be an uploader's.
    idx = SourceIndex.from_raw(raw, hyphen_turns=(meta_data.get("track") or {}).get("kind") == "uploader")
    timed: Optional[Timed] = None
    timing = "no times: neither a raw caption track nor [m:ss] markers were found"
    if vtt_path and vtt_path.is_file():
        kind = (meta_data.get("track") or {}).get("kind")
        text = vtt_path.read_text(encoding="utf-8")
        if kind not in ("uploader", "asr"):
            kind = "asr" if "<c>" in text else "uploader"
        timed = from_vtt(text, kind)
        timing = f"times from the raw caption track {vtt_path.name}"
        if kind == "asr" and "<c>" in text:
            timing += " (timed word by word)"
        else:
            timing += " (timed per caption line, good to about a second)"
    if timed is None or not timed.words:
        timed = from_markers(raw)
        if timed is not None:
            timing = "times from the [m:ss] markers in transcript.txt, good to about 30 seconds only"
    work = Work(transcript, idx, meta_data, meta_path, timed, timing)
    if timed is not None and timed.source == "vtt" and timed.words != idx.w:
        mapping = _map_indices(idx.w, timed.words)
        if mapping is None:
            work.timed = None
            work.timing = "no times: transcript.txt and the raw caption track differ and are too long to match up"
        else:
            work.index_map = mapping
            work.timing = timing + "; transcript.txt and the raw track differ in places, so the times were matched word by word"
    work.mark_opening()
    return work


def _map_indices(a: List[str], b: List[str]) -> Optional[List[int]]:
    if len(a) * len(b) > 400_000_000:
        return None
    out = [-1] * len(a)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for i, j, n in sm.get_matching_blocks():
        for k in range(n):
            out[i + k] = j + k
    # a word with no match takes the time of the nearest matched word before it
    last = -1
    for i in range(len(out)):
        if out[i] >= 0:
            last = out[i]
        elif last >= 0:
            out[i] = last
    return out


def describe_time(seconds: Optional[float]) -> str:
    return "unknown" if seconds is None else f"{fmt_time(seconds)} ({int(seconds)} s)"
