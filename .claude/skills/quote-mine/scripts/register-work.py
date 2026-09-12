#!/usr/bin/env python3
"""Register a work in data/works.json so its quotes get a subject and an era on the shelf.

Usage:
  register-work.py --title T --author A --year YYYY --kind KIND --subject SUBJECT [--url https://…]
                   [--repo DIR] [--dry-run] [--commit]

A quote whose work has no registry record reads perfectly on the page and is invisible to every
subject and era filter, and the build only warns. This inserts the record in the registry's own
order (by title, case-insensitive), runs the repo's validator, and with --commit pulls, commits and
pushes data/works.json. Already registered: says so and changes nothing.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import find_repo, load_json, vocab  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--title", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--year", required=True, type=int)
    ap.add_argument("--kind", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--url")
    ap.add_argument("--repo")
    ap.add_argument("--dry-run", action="store_true", help="show the record and the validation, write nothing")
    ap.add_argument("--commit", action="store_true", help="pull, commit and push data/works.json")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    lists = vocab(repo)
    if args.kind not in lists["WORK_KINDS"]:
        raise SystemExit(f"kind must be one of: {', '.join(lists['WORK_KINDS'])}")
    if args.subject not in lists["SUBJECTS"]:
        raise SystemExit(f"subject must be one of: {', '.join(lists['SUBJECTS'])}")
    if not (-800 <= args.year <= 2100):
        raise SystemExit("year out of range")
    if args.url and not args.url.startswith("https://"):
        raise SystemExit("url must be https")

    path = repo / "data" / "works.json"
    registry = load_json(path)
    works = registry["works"]
    title = args.title.strip()
    for w in works:
        if w["title"].strip().lower() == title.lower():
            print(f"Already registered: {w['title']} — {w['author']} ({w.get('year')}, {w.get('kind')}, {w.get('subject')}). Nothing changed.")
            return

    record = {"title": title, "author": args.author.strip(), "year": args.year, "kind": args.kind, "subject": args.subject}
    if args.url:
        record["url"] = args.url
    quoted = {q.get("work") for q in load_json(repo / "data" / "quotes.json")["quotes"]}
    if title not in quoted:
        print(f"note: no quote in data/quotes.json names {title!r} yet (fine if the import is still running; the title must match the quotes exactly).")

    works.append(record)
    works.sort(key=lambda w: w["title"].lower())
    print("Record:", json.dumps(record, ensure_ascii=False))
    if args.dry_run:
        print("Dry run — nothing written.")
        return

    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    check = subprocess.run(["node", "scripts/validate-works.mjs"], cwd=repo, capture_output=True, text=True)
    sys.stdout.write(check.stdout)
    if check.returncode != 0:
        sys.stderr.write(check.stderr)
        subprocess.run(["git", "checkout", "--", "data/works.json"], cwd=repo)
        raise SystemExit("The registry did not validate; the change was reverted.")
    print(f"Registered {title} in {path}.")

    if args.commit:
        cmds = [
            ["git", "pull", "--rebase", "--quiet", "--autostash"],
            ["git", "add", "data/works.json"],
            ["git", "commit", "--quiet", "-m", f"quote-mine: register {title} ({args.author.strip()}, {args.year})"],
            ["git", "push", "--quiet"],
        ]
        for cmd in cmds:
            r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
            if r.returncode != 0:
                sys.stderr.write(r.stdout + r.stderr)
                raise SystemExit(f"{' '.join(cmd[:2])} failed — the record is written locally; fix git and push by hand.")
        print("Committed and pushed.")


if __name__ == "__main__":
    main()
