#!/usr/bin/env python3
"""Where in the video was this said? The time, a link that lands on it, the transcript around it,
and what the quote changed.

Usage:
  locate-quote.py SRC --text "the cleaned quote" [--text "another"] [--lines 2] [--json]
  locate-quote.py SRC --text-file quote.txt
  SRC is the folder captions.py wrote, or its transcript.txt (meta.json and the raw caption track are
  looked for beside it; --meta and --vtt point at them when they are elsewhere).

The quote may have been cleaned: case and punctuation changed, fillers and repetitions left out, a
name respelled. It is lined up against the transcript word by word, so it is found anyway, and
every difference is listed as an edit, ready to paste into a candidate's `edits`. The verdict
line says how well it matched, and whether those edits would pass the checks (a filler may go; a
hedge, a negation or a different word may not).

The start time is the second the quote's first word is said, in m:ss and in seconds. For YouTube
the link is https://youtu.be/<id>?t=<seconds>; any other host keeps its page address. The time is read
from the raw caption track (to the second, to the word for machine captions); without one it falls
back to the [m:ss] markers in transcript.txt, good to about 30 seconds, and says so.

When the same words are said at more than one time (a teaser in the opening and the real moment later), the one
after the opening is used and the warning names both times. When the quote joins two stretches of speech that are far
apart, it says so and gives the time of the first.

Exit 0: found. Exit 1: not found in the transcript. Exit 2: a problem reading the inputs.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _text import analyze, edits_sentence, fmt_time, render_span  # noqa: E402
from _timing import load_work  # noqa: E402


def locate(work, text: str, lines: int = 2) -> dict:
    an = analyze(text, work.idx, None, derive=True, meta_text=work.meta_text, clock=work.seconds_at)
    out = {
        "text": text,
        "found": an.alignment is not None and an.alignment.coverage >= 0.6,
        "state": an.state,
        "fails": an.fails,
        "warns": an.warns,
        "edits": an.suggested,
        "seconds": None,
        "m_ss": None,
        "url": None,
        "matched": an.alignment.matched if an.alignment else 0,
        "words": an.alignment.cand_len if an.alignment else len(an.ctoks),
        "coverage": round(an.alignment.coverage, 3) if an.alignment else 0.0,
        "marked": "",
        "span_text": "",
        "context": [],
        "note": "",
    }
    if not out["found"]:
        out["span_text"] = an.nearest
        return out
    sec = work.seconds_at(an.start)
    if sec is not None:
        out["seconds"] = int(sec)
        out["m_ss"] = fmt_time(sec)
        out["url"] = work.url_at(sec)
    out["marked"] = render_span(an, work.idx)
    out["span_text"] = an.span_text
    out["context"] = work.lines_around(an.start, an.end, lines, lines)
    out["note"] = edits_sentence(an)
    return out


def show(r: dict, work) -> None:
    print(f'"{r["text"]}"')
    if not r["found"]:
        print(f'  NOT FOUND: {r["matched"]} of {r["words"]} words found together in order.')
        if r["span_text"]:
            print(f'  nearest stretch: {r["span_text"][:300]}')
        for f in r["fails"]:
            print(f"  FAIL {f}")
        return
    when = f'{r["m_ss"]} ({r["seconds"]} s)' if r["m_ss"] else "unknown"
    print(f"  said at   {when}")
    print(f"  link      {r['url'] or 'no URL in meta.json'}")
    n_cut = sum(1 for e in r["edits"] if e["kind"] == "cut")
    n_resp = sum(1 for e in r["edits"] if e["kind"] == "respell")
    n_ins = sum(1 for e in r["edits"] if e["kind"] == "insert")
    pct = int(round(r["coverage"] * 100))
    print(f"  matched   {r['matched']} of {r['words']} words in order ({pct}%) · {n_cut} cut · {n_resp} respelled · {n_ins} added · state {r['state']}")
    if r["context"]:
        print("  the transcript here ( > marks the lines the quote is in):")
        for l in r["context"]:
            print(f"    {'>' if l['inside'] else ' '} {fmt_time(l['start']):>7}  {l['text']}")
    if r["edits"]:
        print("  the quote differs from the transcript here (cut {…}, changed {old -> new}, added {+…}):")
        print(f"    {r['marked']}")
        print("  edits found, to declare as they are or to correct:")
        print("    " + json.dumps(r["edits"], ensure_ascii=False))
    print(f"  note      {r['note']}")
    for f in r["fails"]:
        print(f"  FAIL {f}")
    for w in r["warns"]:
        print(f"  warn {w}")
    print(f"  ({work.timing})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="the folder captions.py wrote, or its transcript.txt")
    ap.add_argument("--text", action="append", default=[], help="a quote to find; repeatable")
    ap.add_argument("--text-file", help="a file holding one quote")
    ap.add_argument("--meta", help="meta.json, when it is not beside the transcript")
    ap.add_argument("--vtt", help="the raw caption track, when it is not named in meta.json")
    ap.add_argument("--lines", type=int, default=2, help="caption lines to show either side (default 2)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    a = ap.parse_args()

    texts = list(a.text)
    if a.text_file:
        texts.append(Path(a.text_file).read_text(encoding="utf-8").strip())
    texts = [t.strip() for t in texts if t and t.strip()]
    if not texts:
        print("Give the quote with --text \"...\" or --text-file FILE.", file=sys.stderr)
        sys.exit(2)

    work = load_work(a.src, a.meta, a.vtt)
    results = [locate(work, t, a.lines) for t in texts]
    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for i, r in enumerate(results):
            if i:
                print()
            show(r, work)
    sys.exit(0 if all(r["found"] for r in results) else 1)


if __name__ == "__main__":
    main()
