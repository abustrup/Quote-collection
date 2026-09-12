#!/usr/bin/env python3
"""Check a set of picked quotes before they are filed. Pass or fail, mechanically.

Usage:
  check-quotes.py PICKS.json SOURCE.txt [--repo DIR]

PICKS.json is the array you are about to file. SOURCE.txt is the text you read the quotes in — the
transcript.txt from captions.py, or the work saved as plain text.

For every record:
  words   EXACT       verbatim in the source (whitespace and typographic quote/dash variants aside)
          NORMALISED  same words; only quote marks, dashes or case differ
          PUNCTUATION same words in order; only punctuation differs (a full stop where the sentence was cut)
          TRIMMED     every word is in the source, in order, and only deletions separate them —
                      allowed, but the verification note has to say what was cut
          MISSING     not in the source — shown with the nearest passage so you can see the real wording
  fields  workKind, themes, verification.status against the repo's own lists; no id; source.kind curated;
          a work reached through a video or podcast host is never `verified`
  dupes   the same text already in data/quotes.json, or on the removed list (it would not be re-added)
  work    whether data/works.json has a record for the work, and the author it holds

Exit 0 only when nothing is MISSING, no field is wrong, and nothing is a duplicate. Warnings do not fail it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import find_repo, load_json, vocab  # noqa: E402

SPOKEN_HOSTS = ("youtube.com", "youtu.be", "podcasts.apple.com", "open.spotify.com", "vimeo.com", "soundcloud.com")
MARKER = re.compile(r"^\[\d+:\d\d(?::\d\d)?\]\s*", re.M)
CHAPTER = re.compile(r"^## .*$", re.M)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[‒–—―]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def loose(s: str) -> str:
    return norm(s).lower()


def tokens(s: str) -> list[str]:
    return re.findall(r"[\w']+", loose(s))


def trimmed_match(q: list[str], src: list[str]):
    """Is q a subsequence of a window of src? Returns the dropped words for the best anchor, or None."""
    if len(q) < 3:
        return None
    anchors = [i for i in range(len(src) - 1) if src[i] == q[0] and src[i + 1] == q[1]]
    if not anchors:
        anchors = [i for i, w in enumerate(src) if w == q[0]]
    best = None
    for a in anchors[:3000]:
        window_end = min(len(src), a + len(q) * 3 + 40)
        qi = 0
        dropped = []
        for si in range(a, window_end):
            if src[si] == q[qi]:
                qi += 1
                if qi == len(q):
                    break
            elif qi > 0:
                dropped.append(src[si])
        if qi == len(q) and (best is None or len(dropped) < len(best)):
            best = dropped
            if not dropped:
                break
    return best


def nearest(q: list[str], src_loose: str) -> str:
    for k in range(min(8, len(q)), 2, -1):
        for probe in (" ".join(q[:k]), " ".join(q[-k:])):
            i = src_loose.find(probe)
            if i != -1:
                lo, hi = max(0, i - 160), min(len(src_loose), i + len(probe) + 200)
                return "…" + src_loose[lo:hi].strip() + "…"
    return "(no anchor found — not even three consecutive words of it are in the source)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("picks")
    ap.add_argument("source")
    ap.add_argument("--repo")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    lists = vocab(repo)
    existing = load_json(repo / "data" / "quotes.json")["quotes"]
    existing_loose = {loose(q["text"]): q for q in existing}
    removed_path = repo / "data" / "removed.json"
    removed = load_json(removed_path) if removed_path.is_file() else []
    removed_items = removed.get("removed", removed) if isinstance(removed, dict) else removed
    removed_loose = {loose(r.get("text", "")) for r in removed_items if isinstance(r, dict) and r.get("text")}
    works = {w["title"]: w for w in load_json(repo / "data" / "works.json")["works"]}

    picks = load_json(Path(args.picks))
    if not isinstance(picks, list) or not picks:
        raise SystemExit("PICKS.json must be a non-empty JSON array of quote records.")

    raw = Path(args.source).read_text(encoding="utf-8")
    raw = CHAPTER.sub("", MARKER.sub("", raw))
    src_ws = re.sub(r"\s+", " ", raw)
    src_loose = loose(raw)
    src_tokens = tokens(raw)

    failures = 0
    warnings_total = 0
    for i, q in enumerate(picks, 1):
        problems, warns = [], []
        text = q.get("text") if isinstance(q, dict) else None
        if not isinstance(text, str) or len(text.strip()) < 2:
            print(f"{i}. FAIL — no text\n")
            failures += 1
            continue
        t = text.strip()
        if (t[0] in "\"'“‘" and t[-1] in "\"'”’") or t.startswith("“"):
            problems.append("text is wrapped in quotation marks — store the words only")
        if "id" in q:
            problems.append("carries an id — leave it out, the repo computes it from the text")
        if not q.get("author"):
            problems.append("no author")
        if not q.get("work"):
            problems.append("no work")
        wk = q.get("workKind")
        if wk is not None and wk not in lists["WORK_KINDS"]:
            problems.append(f"workKind {wk!r} is not one of {', '.join(lists['WORK_KINDS'])}")
        year = q.get("year")
        if year is not None and not isinstance(year, int):
            problems.append(f"year must be an integer, got {year!r}")
        bad_themes = [th for th in (q.get("themes") or []) if th not in lists["THEMES"]]
        if bad_themes:
            problems.append(f"themes not in the controlled list (they would be dropped silently): {', '.join(bad_themes)}")
        if not q.get("themes"):
            warns.append("no themes")
        src = q.get("source") or {}
        if src.get("kind") != "curated":
            problems.append("source.kind must be 'curated' for anything this skill files")
        url = src.get("url")
        if url and not str(url).startswith("https://"):
            problems.append("source.url must be https")
        ver = q.get("verification") or {}
        status = ver.get("status")
        if status not in lists["VERIFICATION"]:
            problems.append(f"verification.status {status!r} is not one of {', '.join(lists['VERIFICATION'])}")
        if not ver.get("note"):
            problems.append("verification.note is empty — say what you read and what you did not")
        if status == "verified" and url and any(h in str(url) for h in SPOKEN_HOSTS):
            problems.append("a video or podcast source is someone's typing of speech: `reported`, never `verified`")
        elif status == "verified" and wk in ("interview", "speech"):
            warns.append("verified is only right if you read the publisher's own *text*, not a transcript")

        # The words.
        state = "MISSING"
        detail = ""
        if norm(text) in norm(src_ws) or text.strip() in src_ws:
            state = "EXACT"
        elif loose(text) in src_loose:
            state = "NORMALISED"
            detail = "same words; quote marks, dashes or case differ"
        else:
            dropped = trimmed_match(tokens(text), src_tokens)
            if dropped == []:
                state = "PUNCTUATION"
                detail = "same words in order; only punctuation differs — usually a full stop where the sentence was cut"
            elif dropped is not None:
                state = "TRIMMED"
                detail = "deletions only: " + (", ".join(f"'{w}'" for w in dropped[:12]) + ("…" if len(dropped) > 12 else ""))
                if not re.search(r"trim|cut|drop|remov|omit|stutter|filler|shorten", ver.get("note", ""), re.I):
                    problems.append("TRIMMED but the verification note does not say what was cut")
            else:
                detail = "nearest: " + nearest(tokens(text), src_loose)
                problems.append("MISSING from the source — do not file this wording")

        # Duplicates and tombstones.
        if loose(text) in existing_loose:
            problems.append(f"already in the collection as {existing_loose[loose(text)]['id']}")
        if loose(text) in removed_loose:
            problems.append("on data/removed.json — he removed this before; the importer will not re-add it")

        # The work.
        work = q.get("work")
        if work and work in works:
            reg = works[work]
            if reg.get("author") != q.get("author"):
                warns.append(f"registry has author {reg.get('author')!r} for this work")
            work_line = f"registered ({reg.get('subject')}, {reg.get('kind')}, {reg.get('year')})"
        elif work:
            work_line = "not registered"
            warns.append("work NOT REGISTERED — run register-work.py after filing, or its quotes vanish from the shelf's filters")
        else:
            work_line = "no work"

        verdict = "FAIL" if problems else ("ok  " if not warns else "ok ~")
        print(f"{i}. {verdict} {state:<11} {q.get('author', '?')} — {work or '?'}")
        print(f"      \"{t[:110]}{'…' if len(t) > 110 else ''}\"")
        if detail:
            print(f"      {detail}")
        for p in problems:
            print(f"      ✗ {p}")
        for w in warns:
            print(f"      ~ {w}")
        print(f"      work: {work_line}")
        print()
        failures += bool(problems)
        warnings_total += len(warns)

    n = len(picks)
    print(f"{n - failures} of {n} pass, {failures} fail, {warnings_total} warnings.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
