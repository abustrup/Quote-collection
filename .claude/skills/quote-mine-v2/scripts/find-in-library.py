#!/usr/bin/env python3
"""Find a video in Alexander's video library by what he calls it: "the Dwarkesh Karpathy one".

Usage:
  find-in-library.py WORDS... [--limit 5] [--json] [--items PATH] [--include-clips] [--search-descriptions]

Searches the library's pool (default /Users/alexanderbustrup/sendefladen/data/items.json, read only;
$SENDEFLADEN_ITEMS or --items to point elsewhere) for videos and podcasts whose title or channel
match the words (the author field counts as the channel), and prints the best few with title, channel,
date, length and URL. A video is preferred to the podcast page of the same episode, because captions
are fetched from videos. A word that only the description has still counts towards "all the words"
once some other word matches the title or channel; --search-descriptions also lets a video through on
the description alone.

Every word has to match for an item to be a match. When no item has all the words it says so and, as a
help, lists the closest items that have some. No match at all is not an error: exit 0. Exit 2: the
library file is not on this machine (a cloud session has no library; ask for the URL).

Shorts and clips are left out unless --include-clips: they are fragments of something longer.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

DEFAULT_ITEMS = "/Users/alexanderbustrup/sendefladen/data/items.json"
COMMON = 400   # a word that this many items have is too common to point at one video
IGNORE = frozenset(
    "the a an one video videos podcast podcasts episode interview talk talks with on about from by of and "
    "that this new newest latest recent quote mine v2 please find me my in is it for to".split()
)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", fold(s))


def query_tokens(words: list[str]) -> list[str]:
    out = []
    for w in tokens(" ".join(words)):
        if w not in IGNORE and len(w) > 1 and w not in out:
            out.append(w)
    return out


def matches(token: str, field_tokens: set[str]) -> bool:
    if token in field_tokens:
        return True
    return len(token) >= 4 and any(t.startswith(token) for t in field_tokens)


def duration(sec) -> str:
    if not isinstance(sec, (int, float)) or sec <= 0:
        return "?"
    h, rem = divmod(int(sec), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def score_items(items: list[dict], qt: list[str], kinds: set[str], clips: bool, descriptions: bool = False) -> list[dict]:
    rows = []
    for it in items:
        if it.get("kind") not in kinds:
            continue
        fragment = bool(it.get("isShort") or it.get("isClip"))
        if fragment and not clips:
            continue
        title = set(tokens(it.get("title", "")))
        chan = set(tokens(" ".join(filter(None, [it.get("author") or "", (it.get("source") or {}).get("title") or ""]))))
        summary = None
        got_title, got_chan, got_summary = [], [], []
        for t in qt:
            if matches(t, title):
                got_title.append(t)
            elif matches(t, chan):
                got_chan.append(t)
            else:
                if summary is None:
                    summary = set(tokens((it.get("summary") or "")[:1500]))
                if matches(t, summary):
                    got_summary.append(t)
        n = len(got_title) + len(got_chan) + len(got_summary)
        if n == 0 or (not (got_title or got_chan) and not descriptions):
            continue
        rows.append(
            {
                "matched": n,
                "all": n == len(qt),
                "score": 3 * len(got_title) + 2 * len(got_chan) + 0.5 * len(got_summary) + (0.4 if it["kind"] == "video" else 0),
                "words": got_title + got_chan + got_summary,
                "in_summary_only": bool(got_summary) and not (got_title or got_chan),
                "title": it.get("title", ""),
                "channel": (it.get("source") or {}).get("title") or it.get("author") or "",
                "author": it.get("author") or "",
                "date": (it.get("publishedAt") or "")[:10],
                "duration": duration(it.get("durationSec")),
                "kind": it["kind"],
                "url": it.get("url", ""),
                "fragment": fragment,
            }
        )
    # Best match first; among equals the newest. Python's sort is stable, so sort by the weaker key first.
    rows.sort(key=lambda r: r["date"], reverse=True)
    rows.sort(key=lambda r: (-r["matched"], -r["score"]))
    # A word that most of the library has (quantum, AI) says little about which video he means. An item that
    # matches only such words is not offered as a "closest" match.
    df: dict[str, int] = {}
    for r in rows:
        for w in r["words"]:
            df[w] = df.get(w, 0) + 1
    seen, out = set(), []
    for r in rows:
        if not r["all"] and all(df[w] > COMMON for w in r["words"]):
            continue
        key = (fold(r["title"]), r["date"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("words", nargs="+", help="what he calls it, e.g.  dwarkesh karpathy")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--items", default=os.environ.get("SENDEFLADEN_ITEMS", DEFAULT_ITEMS))
    ap.add_argument("--include-clips", action="store_true", help="also search Shorts and clips")
    ap.add_argument("--search-descriptions", action="store_true", help="let a video through on its description alone")
    a = ap.parse_args()

    path = Path(a.items).expanduser()
    if not path.is_file():
        print(f"The video library is not on this machine ({path}). Ask Alexander for the video's URL.", file=sys.stderr)
        sys.exit(2)
    items = json.loads(path.read_text(encoding="utf-8"))
    qt = query_tokens(a.words)
    when = datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()
    if not qt:
        print("Nothing to search for: the words were all filler (the, one, video, ...). Name the channel, the guest or a word of the title.")
        return
    rows = score_items(items, qt, {"video", "podcast"}, a.include_clips, a.search_descriptions)
    full = [r for r in rows if r["all"]]
    shown = (full or rows)[: a.limit]

    if a.json:
        print(json.dumps({"query": qt, "matched_all_words": bool(full), "results": shown}, ensure_ascii=False, indent=2))
        return

    n_videos = sum(1 for it in items if it.get("kind") in ("video", "podcast"))
    print(f'Library search for "{" ".join(qt)}" · {n_videos:,} videos and podcasts, library file of {when}')
    if not rows:
        print(f"No match: no video or podcast in the library fits these words ({', '.join(qt)}). Ask for the URL.")
        return
    if not full:
        print(f"No item has all the words ({', '.join(qt)}). Closest, which have some of them:")
    for i, r in enumerate(shown, 1):
        chan = f" · {r['channel']}" if r["channel"] else ""
        tag = " · podcast page (the video has the captions)" if r["kind"] == "podcast" else ""
        part = "" if r["all"] else f"   [has: {', '.join(r['words'])}]"
        if r["in_summary_only"]:
            part += "   [only in the description]"
        print(f"{i}. {r['title']}{chan} · {r['date']} · {r['duration']}{tag}")
        print(f"   {r['url']}{part}")


if __name__ == "__main__":
    main()
