#!/usr/bin/env python3
"""From the lines you chose to a candidates.json the other scripts read. You write the words and
the judgement; this finds where each line is said, sets the link and the locator, works out the edits
and checks each line, so no time, link or note is ever typed by hand.

Usage:
  build-candidates.py DRAFTS.json [--out candidates.json] [--repo DIR]

DRAFTS.json, strongest first:

  {
    "transcript": "<the folder captions.py wrote, or its transcript.txt>",
    "work": {
      "title": "Recursive self-improvement has started",   # the work field: the video title without the channel suffix
      "author": "Dwarkesh Patel",                          # who speaks, unless a line says otherwise
      "workKind": "speech",                                # or interview
      "year": 2026,
      "prefix": "Dwarkesh Patel, solo video essay",        # locator start. Without it: "<author> to <host>" or "<author>, <what>"
      "host": "", "what": "",                              # the pieces the prefix is made of when it is not given
      "short": "Recursive self-improvement",               # the short name on the picker's filter chips
      "themes": ["technology"], "tags": [], "lang": "en"   # defaults for the lines
      # an essay, paper or document instead of a video: "transcript" is the saved text file, and the work says
      # "url": "<the page>", "status": "verified", "note": "Read in the essay on its author's site on <date>."
      # (the default, for captions, is status reported and a note made from meta.json). Give each line its own
      # "prefix" (the section) and leave out "about" if the section says enough.
    },
    "points": ["Automating AI research is what makes superintelligence near", "…"],   # the outline's main points
    "items": [
      {
        "text": "the cleaned quote",
        "point": 1,                      # which main point it carries (an index into points), or "main_point": "…"
        "about": "on why …",             # the end of the locator, and the line on the card
        "why": "why it is worth keeping, one clause",
        "flag": "",                      # amber note on the card: widely quoted, long, a figure that is the speaker's own
        "speaker": "",                   # when the line is by someone else than work.author
        "prefix": "",                    # when its locator needs another start than the work's
        "themes": ["technology", "progress"], "tags": ["ai"],
        "edits": [{"kind": "cut", "from": "I mean", "why": "filler"}],   # optional notes on the edits found (a "why"); the builder works out the full list itself
        "ack": ""                        # optional: why it starts or stops mid-sentence, if the check asks
      }
    ]
  }

For each line this finds it in the transcript (even though it was cleaned), reads the second it is said
from the raw caption track, sets source.url to the video at that second and the locator to
"<prefix> · m:ss, <about>", fills the verification note, and runs the word-by-word checks that select-picks.py
runs on each pick (the shape of the text, the edits, negations, the words beside the quote, a change of speaker).
The dry run with select-picks.py adds the checks on the collection itself: duplicates, the fields and the work.
It prints one row per line: the time, how much matched, the edits, and anything wrong. Exit 1 if
any line fails; the file is written either way so the failures can be read next to the lines.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import find_repo, vocab  # noqa: E402
from _text import analyze, edits_sentence, fmt_time, link_with_time, words  # noqa: E402
from _timing import load_work  # noqa: E402


def merge_edits(derived: list, notes: list) -> list:
    """The edits found, each carrying the reason the draft gave for it. A note that matches no edit found stays in
    the list, and the check then says it is not a difference between the transcript and the quote."""
    def key(e: dict):
        return (e.get("kind"), tuple(words(e.get("from", ""))), tuple(words(e.get("to", ""))))

    spare = list(notes)
    out = []
    for d in derived:
        merged = dict(d)
        for n in spare:
            if isinstance(n, dict) and key(n) == key(d):
                if n.get("why"):
                    merged["why"] = n["why"]
                spare.remove(n)
                break
        out.append(merged)
    return out + [n for n in spare if isinstance(n, dict)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("drafts")
    ap.add_argument("--out", help="default: candidates.json beside the drafts")
    ap.add_argument("--repo")
    a = ap.parse_args()

    drafts_path = Path(a.drafts)
    d = json.loads(drafts_path.read_text(encoding="utf-8"))
    out_path = Path(a.out) if a.out else drafts_path.with_name("candidates.json")
    work = load_work(d["transcript"], d.get("meta"), d.get("vtt"))
    w = d.get("work") or {}
    lists = vocab(find_repo(a.repo))
    meta = work.meta

    title = w.get("title") or meta.get("title") or ""
    author = w.get("author") or ""
    year = w.get("year") or (int(str(meta.get("upload_date") or "0")[:4]) or None)
    kind = w.get("workKind") or "speech"
    short = w.get("short") or title
    default_status = w.get("status") or "reported"
    default_prefix = w.get("prefix") or (
        f"{author} to {w['host']}" if w.get("host") else (f"{author}, {w['what']}" if w.get("what") else author)
    )
    points = d.get("points") or []
    transcript_path = str(work.transcript.resolve())
    meta_path = str(work.meta_path.resolve()) if work.meta_path else None

    print(f"{title}  ·  {len(d.get('items', []))} lines  ·  {work.timing}")
    if title and "|" in title:
        print("  ~ the work title has a | in it: the work field is the title without the channel suffix")
    items_out = []
    rows = []
    spans = []
    labels = []
    any_fail = False
    for n, it in enumerate(d.get("items", []), 1):
        text = str(it["text"]).strip()
        speaker = it.get("speaker") or author
        notes = it.get("edits")
        ack = it.get("ack", "")
        first = analyze(text, work.idx, None, meta_text=work.meta_text, derive=True, author=speaker, ack=ack, flagged=bool(it.get("flag")), clock=work.seconds_at)
        # The builder always works out the full list of edits. What the draft gives is a reason ("why") for some of them.
        final_edits = merge_edits(first.suggested, notes) if notes is not None else first.suggested
        an = analyze(text, work.idx, final_edits, meta_text=work.meta_text, author=speaker, ack=ack, flagged=bool(it.get("flag")), clock=work.seconds_at)
        found = an.alignment is not None and an.alignment.coverage >= 0.6
        seconds = work.seconds_at(an.start) if found else None

        point_label = it.get("main_point")
        if not point_label and it.get("point") is not None:
            try:
                point_label = points[int(it["point"]) - 1]
            except (ValueError, IndexError):
                point_label = None
                an.fails.append(f"point {it['point']!r} is not in `points` (1 to {len(points)})")
        if not point_label:
            an.warns.append("no main point: say which point of the work this line carries")

        themes = it.get("themes") or w.get("themes") or []
        bad = [t for t in themes if t not in lists["THEMES"]]
        if bad:
            an.fails.append(f"themes not in the controlled list: {', '.join(bad)}")

        if it.get("prefix"):
            prefix = it["prefix"]
        elif speaker == author:
            prefix = default_prefix
        elif w.get("host") and speaker == w["host"]:
            prefix = f"{speaker} to {author}"
        else:
            prefix = speaker
            an.warns.append(f"the line is by {speaker}, not {author}: give it a `prefix` that says who is speaking to whom")
        about = (it.get("about") or "").strip()
        when = fmt_time(seconds) if seconds is not None else None
        locator = f"{prefix} · {when}, {about}" if when and about else (f"{prefix} · {when}" if when else (f"{prefix}, {about}" if about else prefix))

        page_url = w.get("url") or meta.get("url")
        url = link_with_time(page_url, seconds) if (seconds is not None and page_url) else page_url
        if seconds is None and found:
            an.warns.append("no time for this line (no raw caption track): the link has no timestamp")

        base_note = w.get("note") or (work.auto_note() if meta else "Read in the transcript; not checked against the audio.")
        record = {
            "text": text,
            "author": speaker,
            "work": title,
            "workKind": kind,
            "year": year,
            "source": {"kind": "curated", "url": url, "locator": locator},
            "themes": themes,
            "tags": it.get("tags") or w.get("tags") or [],
            "lang": w.get("lang") or "en",
            "verification": {"status": default_status, "note": base_note},
        }
        cand = {
            "record": record,
            "source": transcript_path,
            "edits": final_edits,
            "main_point": point_label or "",
            "start": int(seconds) if seconds is not None else None,
            "show": {
                "by": speaker,
                "work_short": short,
                "where": when or "",
                "about": about,
                "why": it.get("why", ""),
                "flag": it.get("flag", ""),
            },
        }
        if ack:
            cand["ack"] = ack
        if meta_path:
            cand["meta"] = meta_path
        items_out.append(cand)

        # The same two rules select-picks applies, so they are seen here first.
        if len(text) > 220 and not it.get("flag"):
            an.fails.append(f"{len(text)} characters: a line over 220 needs a flag on its card saying why it needs the room")
        if found:
            for a0, a1, other in spans:
                if a0 < an.end and an.start < a1 and (min(an.end, a1) - max(an.start, a0)) > 0.5 * min(an.end - an.start, a1 - a0):
                    an.warns.append(f"overlaps line {other}: much the same stretch of speech")
            spans.append((an.start, an.end, n))
        labels.append(point_label)
        rows.append((n, when, an, final_edits, text))
        any_fail = any_fail or bool(an.fails) or not found

    out_path.write_text(json.dumps(items_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print()
    for n, when, an, edits, text in rows:
        cov = f"{int(round(an.alignment.coverage * 100))}%" if an.alignment else "-"
        label = "FAIL" if an.fails or an.alignment is None else ("ok ~" if an.warns else "ok  ")
        summary = edits_sentence(an) if an.alignment and an.alignment.coverage >= 0.6 else "not found"
        print(f"{n:>3}  {label}  {when or '?':>7}  {cov:>4}  {text[:70]}{'…' if len(text) > 70 else ''}")
        print(f"                       {summary}")
        for f in an.fails:
            print(f"                       ✗ {f}")
        for wmsg in an.warns:
            print(f"                       ~ {wmsg}")
    n_fail = sum(1 for _n, _w, an, _e, _t in rows if an.fails or an.alignment is None)
    print(f"\n{len(rows) - n_fail} of {len(rows)} lines pass the checks that can be made before filing. Wrote {out_path}.")
    covered = []
    for label in labels:
        if label and label not in covered:
            covered.append(label)
    top = []
    for label in labels[:5]:
        if label and label not in top:
            top.append(label)
    if top:
        print(f"The top 5 lines carry {len(top)} main point{'s' if len(top) != 1 else ''}: " + "; ".join(top) + ".")
    if points:
        print(f"Main points covered: {len(covered)} of {len(points)}.")
        for i, p in enumerate(points, 1):
            hits = [n for n, lab in enumerate(labels, 1) if lab == p]
            print(f"  {i}. {p}: " + (", ".join(f"line {h}" for h in hits) if hits else "no line yet"))
    sys.exit(1 if any_fail else 0)


if __name__ == "__main__":
    main()
