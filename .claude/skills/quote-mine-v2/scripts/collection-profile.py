#!/usr/bin/env python3
"""What does Alexander keep? Numbers and lines from the collection as it is today, so nothing is written down to go stale.

Usage:
  collection-profile.py [--author NAME] [--work TITLE] [--repo DIR]

Prints, derived from data/quotes.json when it runs: how many lines there are, how long the curated ones
are, which lines he has starred (the bar a new line has to clear), and the controlled lists a record
draws its themes and subject from. With --author or --work it lists what he already holds from that
author or work, so a shortlist can say how its top compares. NAME and TITLE match any part of the name,
case aside.
"""
from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import find_repo, load_json, vocab  # noqa: E402
from _text import percentile  # noqa: E402


def short(text: str, n: int = 150) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--author")
    ap.add_argument("--work")
    ap.add_argument("--repo")
    a = ap.parse_args()

    repo = find_repo(a.repo)
    data = load_json(repo / "data" / "quotes.json")
    quotes = data["quotes"]
    works = load_json(repo / "data" / "works.json")["works"]
    lists = vocab(repo)
    curated = [q for q in quotes if (q.get("source") or {}).get("kind") == "curated"]
    stars = [q for q in quotes if q.get("favorite")]
    stars_cur = [q for q in stars if q in curated]
    lens = [len(q["text"]) for q in curated]
    asof = str(data.get("updatedAt") or "")[:10] or "undated"

    print(f"data/quotes.json as of {asof}: {len(quotes)} quotes; {len(curated)} curated from {len({q.get('work') for q in curated})} works, the rest imported from Goodreads.")
    if lens:
        print(
            f"Length of the {len(curated)} curated lines, in characters: median {int(statistics.median(lens))}, "
            f"10th percentile {int(percentile(lens, 10))}, 90th percentile {int(percentile(lens, 90))}."
        )
    if stars:
        sl = [len(q["text"]) for q in stars_cur]
        extra = f"; the {len(stars_cur)} curated ones have a median length of {int(statistics.median(sl))} characters" if sl else ""
        print(f"Starred: {len(stars)} of {len(quotes)}{extra}.")
    else:
        print("Starred: none in this copy of data/quotes.json. His stars arrive with the data, so pull first; until then the curated lines above are the only guide.")
    if stars_cur:
        print("\nStarred curated lines (what he keeps; a new line should be at home among them):")
        for q in stars_cur:
            print(f"  * {q['author']}: {short(q['text'])}")

    def listing(title: str, rows: list) -> None:
        print(f"\n{title}: {len(rows)} line{'s' if len(rows) != 1 else ''}")
        for q in rows:
            star = "*" if q.get("favorite") else " "
            kind = "curated" if (q.get("source") or {}).get("kind") == "curated" else "goodreads"
            print(f" {star} {q['id']} · {len(q['text'])} chars · {kind} · {q.get('work') or 'no work'}")
            print(f"     {short(q['text'], 170)}")

    if a.author:
        key = a.author.lower()
        rows = [q for q in quotes if key in (q.get("author") or "").lower()]
        listing(f"Held from authors matching {a.author!r}", rows)
        regs = [w for w in works if key in (w.get("author") or "").lower()]
        if regs:
            print("  Works registered under them: " + "; ".join(f"{w['title']} ({w.get('kind')}, {w.get('subject')}, {w.get('year')})" for w in regs))
    if a.work:
        key = a.work.lower()
        rows = [q for q in quotes if key in (q.get("work") or "").lower()]
        listing(f"Held from works matching {a.work!r}", rows)
        regs = [w for w in works if key in (w.get("title") or "").lower()]
        for w in regs:
            print(f"  Registered: {w['title']} by {w.get('author')} ({w.get('kind')}, {w.get('subject')}, {w.get('year')})")

    print("\nControlled lists, for the record of each line and for registering a work:")
    print("  themes:    " + ", ".join(lists["THEMES"]))
    print("  subjects:  " + ", ".join(lists["SUBJECTS"]))
    print("  workKinds: " + ", ".join(lists["WORK_KINDS"]))


if __name__ == "__main__":
    main()
