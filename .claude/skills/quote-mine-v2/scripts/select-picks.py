#!/usr/bin/env python3
"""Turn Alexander's numbers into checked, ready-to-file records.

Usage:
  select-picks.py CANDIDATES.json "3, 7, 11-13"  --out DIR      (or "all", or "top 5" for 1-5, or "top 5, 8";
                                                              his reply as typed: "1, 3 og 5", "alle", "#3, #5", "1 til 4")

CANDIDATES.json is the shortlist, strongest first, kept in the session scratchpad so a number
always means the same line. A list of items:

  {
    "record": { …the full quote record from the skill, no id… },
    "source": "/path/to/the text it was read in (transcript.txt, essay.txt)",
    "edits": [ {"kind": "cut", "from": "you know"}, … ],   # version 2: every word cut, respelled or added; [] for none
    "ack": "why it starts or stops mid-sentence",       # optional, version 2: see check-quotes.py
    "main_point": "the point of the work this line carries",   # version 2: what the card and the chat list show
    "start": 754,                                       # version 2: the second it is said, from build-candidates.py
    "respell": ["selfregulate=self-regulate"],          # version 1: caption misspellings, see check-quotes.py
    "check_source": "/path/to/other.txt",               # optional: when the wording was read in another track
    "show": { "by", "work_short", "where", "about", "why", "flag" }   # what picker.py puts on the card
  }

For each picked number this runs check-quotes.py on that one item against its own source, then writes
DIR/picks.json (every record that passed) and DIR/issue-body.md (the bulk-import body: a "### Quotes"
heading and the JSON in a fenced block). Exit 1 if any pick fails; nothing is filed by this script.

A version-2 item (one that has an `edits` key) is checked word by word against the transcript, and
this script writes its edit list into the record's verification note, so the filed note always says
exactly what was cut, respelled or added. Version-2 lists also get these checks: at most 20 lines from
one work; a line over 220 characters needs a flag on its card; a line that has no main point is flagged.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _text import LONG_QUOTE, analyze, edits_sentence, fmt_time, strip_edits_sentence  # noqa: E402

CEILING = 20


def parse_numbers(spec: str, n: int) -> list[int]:
    """His reply as he types it, in English or Danish: numbers and ranges ("3, 7, 11-13", "1 - 4", "1 til 4", "#3 og #5"),
    "all" ("alle"), and "top 5" (which is 1-5; a top longer than the list is the whole list)."""
    spec = spec.strip().lower().replace("#", " ")
    if re.fullmatch(r"(?:all|alle|alt|everything)(?:\s+(?:of\s+them|sammen|of\s+it))?\W*", spec):
        return list(range(1, n + 1))

    def top(m):
        k = int(m.group(1))
        if k < 1:
            raise SystemExit(f"Cannot read {m.group(0)!r} in the picks. Expected numbers like '3, 7, 11-13', 'top 5' or 'all'.")
        return f" 1-{min(k, n)} "

    spec = re.sub(r"\b(?:top|first|første)\s*(\d+)", top, spec)
    spec = re.sub(r"(\d)\s*(?:[-–—‒]|to|til|through|thru)\s*(\d)", r"\1-\2", spec)
    out: list[int] = []
    for part in re.split(r"[,;\s]+", spec):
        if not part or part in ("and", "plus", "also", "the", "og", "samt", "også", "nr", "no", "number", "numbers", "nummer", "numre", "lines", "line"):
            continue
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            if lo > hi:
                lo, hi = hi, lo
            out.extend(range(lo, hi + 1))
        elif part.isdigit():
            out.append(int(part))
        else:
            raise SystemExit(f"Cannot read {part!r} in the picks. Expected numbers like '3, 7, 11-13', 'top 5' or 'all'.")
    if not out:
        raise SystemExit("No numbers in the picks. Expected numbers like '3, 7, 11-13', 'top 5' or 'all'.")
    bad = [x for x in out if not 1 <= x <= n]
    if bad:
        raise SystemExit(f"These numbers are not on the list (1-{n}): {bad}")
    return sorted(dict.fromkeys(out))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates")
    ap.add_argument("numbers")
    ap.add_argument("--out", required=True)
    ap.add_argument("--repo")
    a = ap.parse_args()

    items = json.loads(Path(a.candidates).read_text(encoding="utf-8"))
    picked = parse_numbers(a.numbers, len(items))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    v2_list = any("edits" in it for it in items)
    list_fails: list[str] = []
    if v2_list:
        per_work = Counter(it["record"].get("work") for it in items)
        for work_title, n in per_work.items():
            if n > CEILING:
                list_fails.append(f"{n} lines from {work_title!r}: the ceiling is {CEILING}. Stop where the ore runs out.")
        if any(it.get("main_point") for it in items):
            lacking = [i for i, it in enumerate(items, 1) if not it.get("main_point")]
            if lacking:
                print(f"  ~ no main point on line(s) {', '.join(map(str, lacking))}: every line should say which point of the work it carries\n")

    works_cache: dict = {}
    good, failed = [], []
    for n in picked:
        it = items[n - 1]
        rec = copy.deepcopy(it["record"])
        head = rec["text"][:70].replace("\n", " ")
        v2 = "edits" in it
        wrapper_or_record = [rec]
        extra_fail = []
        if v2:
            from _timing import load_work  # noqa: E402

            src_path = it["source"]
            key = (src_path, it.get("meta"))
            if key not in works_cache:
                works_cache[key] = load_work(src_path, it.get("meta"))
            work = works_cache[key]
            if it.get("respell"):
                extra_fail.append("carries both `edits` and `respell`: declare the respelling as an edit and drop `respell`")
            if len(rec["text"].strip()) > LONG_QUOTE and not (it.get("show") or {}).get("flag"):
                extra_fail.append(
                    f"{len(rec['text'].strip())} characters: a line over {LONG_QUOTE} needs a flag on its card saying why it needs the room (show.flag)"
                )
            flagged = bool((it.get("show") or {}).get("flag"))
            an = analyze(rec["text"], work.idx, it["edits"], meta_text=work.meta_text, author=rec.get("author", ""), ack=it.get("ack", ""), flagged=flagged, clock=work.seconds_at)
            ver = rec.setdefault("verification", {})
            base = (ver.get("note") or "").strip()
            if not base or base == "{auto}":
                base = work.auto_note()
            ver["note"] = (strip_edits_sentence(base) + " " + edits_sentence(an)).strip()
            wrapper_or_record = [{"record": rec, "edits": it["edits"], "ack": it.get("ack", ""), "meta": it.get("meta"), "flagged": flagged}]
        one = out / f"check-{n}.json"
        one.write_text(json.dumps(wrapper_or_record, ensure_ascii=False), encoding="utf-8")
        check_source = it.get("check_source") or it["source"]
        cmd = [sys.executable, str(HERE / "check-quotes.py"), str(one), check_source]
        if not v2:
            for r in it.get("respell", []):
                cmd += ["--respell", r]
        if a.repo:
            cmd += ["--repo", a.repo]
        res = subprocess.run(cmd, capture_output=True, text=True)
        m = next((re.match(r"^1\. ok(?: ~)?\s+(\S+)", l) for l in res.stdout.splitlines() if re.match(r"^1\. ok", l)), None)
        status = m.group(1) if m else "?"
        when = f" {fmt_time(it['start']):>7}" if isinstance(it.get("start"), (int, float)) else ""
        if res.returncode == 0 and not extra_fail:
            good.append(rec)
            print(f"  {n:>3}  ok    {status:<12}{when} {head}")
        else:
            failed.append(n)
            print(f"  {n:>3}  FAIL  {head}\n{res.stdout}")
            for f in extra_fail:
                print(f"      ✗ {f}\n")
        one.unlink()

    (out / "picks.json").write_text(json.dumps(good, ensure_ascii=False, indent=2), encoding="utf-8")
    body = "### Quotes\n\n```json\n" + json.dumps(good, ensure_ascii=False, indent=2) + "\n```\n"
    (out / "issue-body.md").write_text(body, encoding="utf-8")
    by_work: dict[tuple, list[str]] = {}
    for r in good:
        by_work.setdefault((r["work"], r.get("year"), r.get("workKind")), [])
        if r["author"] not in by_work[(r["work"], r.get("year"), r.get("workKind"))]:
            by_work[(r["work"], r.get("year"), r.get("workKind"))].append(r["author"])
    for f in list_fails:
        print(f"\n  ✗ {f}")
    print(f"\n{len(good)} of {len(picked)} picks pass. Wrote {out/'picks.json'} and {out/'issue-body.md'}.")
    if v2_list:
        points = Counter(items[n - 1].get("main_point") for n in picked if items[n - 1].get("main_point"))
        if points:
            print(f"Main points covered ({len(points)}): " + "; ".join(f"{p} (x{c})" for p, c in points.items()))
    print("Works to register after filing (a host and a guest register under the guest):")
    for (title, year, kind), authors in sorted(by_work.items(), key=lambda kv: kv[0][0].lower()):
        print(f"  {title}  ·  {' / '.join(authors)}  ·  {year}  ·  {kind}")
    sys.exit(1 if (failed or list_fails) else 0)


if __name__ == "__main__":
    main()
