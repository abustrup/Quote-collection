#!/usr/bin/env python3
"""Turn Alexander's numbers into checked, ready-to-file records.

Usage:
  select-picks.py CANDIDATES.json "3, 7, 11-13"  --out DIR      (or "all")

CANDIDATES.json is the shortlist, strongest first, kept in the session scratchpad so a number
always means the same line. A list of items:

  {
    "record": { …the full quote record from the skill, no id… },
    "source": "/path/to/the text it was read in (transcript.txt, essay.txt)",
    "respell": ["selfregulate=self-regulate"],        # optional: caption misspellings, see check-quotes.py
    "check_source": "/path/to/other.txt",             # optional: when the wording was read in another track
    "show": { "by", "work_short", "where", "about", "why", "flag" }   # what picker.py puts on the card
  }

For each picked number this runs check-quotes.py on that one record against its own source (with its
own respell rules), then writes DIR/picks.json (every record that passed) and DIR/issue-body.md
(the bulk-import body: a "### Quotes" heading and the JSON in a fenced block). Exit 1 if any pick
fails; nothing is filed by this script.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse_numbers(spec: str, n: int) -> list[int]:
    if spec.strip().lower() == "all":
        return list(range(1, n + 1))
    out: list[int] = []
    for part in re.split(r"[,\s]+", spec.strip()):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", part)
        if m:
            out.extend(range(int(m.group(1)), int(m.group(2)) + 1))
        elif part.isdigit():
            out.append(int(part))
        else:
            raise SystemExit(f"Cannot read {part!r} in the picks. Expected numbers like '3, 7, 11-13' or 'all'.")
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

    good, failed = [], []
    for n in picked:
        it = items[n - 1]
        one = out / f"check-{n}.json"
        one.write_text(json.dumps([it["record"]], ensure_ascii=False), encoding="utf-8")
        cmd = [sys.executable, str(HERE / "check-quotes.py"), str(one), it.get("check_source") or it["source"]]
        for r in it.get("respell", []):
            cmd += ["--respell", r]
        if a.repo:
            cmd += ["--repo", a.repo]
        res = subprocess.run(cmd, capture_output=True, text=True)
        status = next((l.split()[3] for l in res.stdout.splitlines() if re.match(r"^1\. ok", l)), "?")
        head = it["record"]["text"][:70].replace("\n", " ")
        if res.returncode == 0:
            good.append(it["record"])
            print(f"  {n:>3}  ok    {status:<12} {head}")
        else:
            failed.append(n)
            print(f"  {n:>3}  FAIL  {head}\n{res.stdout}")
        one.unlink()

    (out / "picks.json").write_text(json.dumps(good, ensure_ascii=False, indent=2), encoding="utf-8")
    body = "### Quotes\n\n```json\n" + json.dumps(good, ensure_ascii=False, indent=2) + "\n```\n"
    (out / "issue-body.md").write_text(body, encoding="utf-8")
    by_work: dict[tuple, list[str]] = {}
    for r in good:
        by_work.setdefault((r["work"], r.get("year"), r.get("workKind")), [])
        if r["author"] not in by_work[(r["work"], r.get("year"), r.get("workKind"))]:
            by_work[(r["work"], r.get("year"), r.get("workKind"))].append(r["author"])
    print(f"\n{len(good)} of {len(picked)} picks pass. Wrote {out/'picks.json'} and {out/'issue-body.md'}.")
    print("Works to register after filing (a host and a guest register under the guest):")
    for (title, year, kind), authors in sorted(by_work.items(), key=lambda kv: kv[0][0].lower()):
        print(f"  {title}  ·  {' / '.join(authors)}  ·  {year}  ·  {kind}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
