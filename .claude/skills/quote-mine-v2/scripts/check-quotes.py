#!/usr/bin/env python3
"""Check a set of picked quotes before they are filed. Pass or fail, mechanically.

Usage:
  check-quotes.py PICKS.json SOURCE.txt [--repo DIR] [--respell CAPTION=WORDS ...] [--meta META.json]

PICKS.json is the array you are about to file. SOURCE.txt is the text you read the quotes in — the
transcript.txt from captions.py, or the work saved as plain text. Each item is a quote record, or a
candidate that wraps one: {"record": {…}, "edits": […], "ack": "…", "meta": "meta.json", "flagged": true}.

A bare record is checked the version-1 way:
  words   EXACT       verbatim in the source (whitespace and typographic quote/dash variants aside)
          NORMALISED  same words; only quote marks, dashes or case differ
          PUNCTUATION same words in order; only punctuation differs (a full stop where the sentence was cut)
          TRIMMED     every word is in the source, in order, and only deletions separate them —
                      allowed, but the verification note has to say what was cut
          MISSING     not in the source — shown with the nearest passage so you can see the real wording

A candidate that carries an `edits` list (an empty list means "no edits") is checked the version-2 way.
The quote is lined up against the transcript word by word, so a cleaned quote is found wherever it was
said, and every difference becomes an edit that has to be declared:
  {"kind": "cut",     "from": "you know"}                      a filler, a repetition, a false start
  {"kind": "respell", "from": "Whimo", "to": "Waymo"}          a name the caption misheard, proven by the
                                                               description or the transcript
  {"kind": "respell", "from": "limmerick", "to": "limerick",
   "why": "typo: the audio at 0:04 says limerick"}              a typo, on your word with the reason (two real words a
                                                               letter apart, causal and casual, are not a typo)
  {"kind": "insert",  "to": "to", "why": "the other track has it"}   a small word the caption dropped (to, a, of;
                                                               a word that carries meaning is refused)
  {"kind": "case"|"punct", "from": "…", "to": "…"}             cosmetic, never needs declaring
Optional on an edit: "why" (the reason, where the check asks for one), "count" (how many times).
  words   EXACT / NORMALISED / PUNCTUATION as above, and
          EDITED      every difference is a declared edit and every declared edit happened
          UNEXPLAINED some difference is not declared (or a declared edit did not happen)
The check refuses: a word added or changed that no edit declares; a figure respelled; a cut that takes a hedge,
a negation or a stretch that is not a filler, a repetition or a false start; a negation dropped or added, also
at the edge (a quote that starts after "I don't think" or stops before "not"); a quote that starts
after "I think" or after "he writes, quote"; a quote that starts or stops right beside a hedge, a quantifier or
a limit ("only", "most", "almost", "for now", "at least"); a quote that runs across a change of speaker (">>");
a join of two distant stretches; text carrying a timestamp, a [laughter] mark, a speaker label, enclosing quotation
marks or an em dash the transcript does not have; a locator or link whose time is not when the line is
said; a verification note that does not list the edits. "ack" is a reason for starting or stopping
where the sentence does not, or for a line across a change of speaker; it turns those failures into warnings
and goes in the note.
  fields  workKind, themes, verification.status against the repo's own lists; no id; source.kind curated;
          a work reached through a video or podcast host is never `verified`
  dupes   the same text already in data/quotes.json, or on the removed list (it would not be re-added);
          version 2 also the same words apart from punctuation, and near-duplicates (a warning)
  work    whether data/works.json has a record for the work, and the author it holds

Exit 0 only when nothing is MISSING, no field is wrong, and nothing is a duplicate. Warnings do not fail it.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import find_repo, load_json, vocab  # noqa: E402
from _text import (  # noqa: E402
    CHAPTER,
    MARKER,
    analyze,
    edits_sentence,
    fmt_time,
    identity,
    loose,
    locator_seconds,
    near_duplicates,
    norm,
    tokens,
    url_seconds,
    youtube_id,
)

SPOKEN_HOSTS = ("youtube.com", "youtu.be", "podcasts.apple.com", "open.spotify.com", "vimeo.com", "soundcloud.com")


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


def unwrap(item):
    """(record, edits or None, ack, meta path or None, flagged) for a bare record or a candidate wrapping one."""
    if isinstance(item, dict) and isinstance(item.get("record"), dict):
        return item["record"], item.get("edits"), str(item.get("ack") or ""), item.get("meta"), bool(item.get("flagged"))
    return item, None, "", None, False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("picks")
    ap.add_argument("source")
    ap.add_argument("--repo")
    ap.add_argument("--respell", action="append", default=[], metavar="CAPTION=WORDS",
                    help="the caption misspells or splits a word (selfregulate, open AI, antonyym): "
                         "treat CAPTION as WORDS when matching. Repeatable. Say it in the verification note. "
                         "Version-2 candidates declare a respell edit instead.")
    ap.add_argument("--meta", help="meta.json of the fetched work (names the description a respelling is proven by, "
                                   "and the raw caption track the line's time is read from); default: beside SOURCE")
    args = ap.parse_args()

    repo = find_repo(args.repo)
    lists = vocab(repo)
    existing = load_json(repo / "data" / "quotes.json")["quotes"]
    existing_loose = {loose(q["text"]): q for q in existing}
    existing_identity = {identity(q["text"]): q for q in existing}
    removed_path = repo / "data" / "removed.json"
    removed = load_json(removed_path) if removed_path.is_file() else []
    removed_items = removed.get("removed", removed) if isinstance(removed, dict) else removed
    removed_loose = {loose(r.get("text", "")) for r in removed_items if isinstance(r, dict) and r.get("text")}
    works = {w["title"]: w for w in load_json(repo / "data" / "works.json")["works"]}

    picks = load_json(Path(args.picks))
    if not isinstance(picks, list) or not picks:
        raise SystemExit("PICKS.json must be a non-empty JSON array of quote records.")

    source_path = Path(args.source)
    if source_path.is_dir():  # the folder captions.py wrote
        source_path = source_path / "transcript.txt"
    args.source = str(source_path)
    raw = source_path.read_text(encoding="utf-8")
    raw = CHAPTER.sub("", MARKER.sub("", raw))
    for rule in args.respell:
        wrong, _, right = rule.partition("=")
        if not wrong or not right:
            raise SystemExit(f"--respell wants CAPTION=WORDS, got {rule!r}")
        hits = len(re.findall(re.escape(wrong), raw, flags=re.I))
        raw = re.sub(re.escape(wrong), right, raw, flags=re.I)
        print(f"respelled in the source for matching: {wrong!r} -> {right!r} ({hits} place{'s' if hits != 1 else ''}) — name it in the note\n")
    src_ws = re.sub(r"\s+", " ", raw)
    src_loose = loose(raw)
    src_tokens = tokens(raw)

    work = None  # the version-2 view of the source: words, meta, times; loaded when a candidate needs it

    failures = 0
    warnings_total = 0
    for i, item in enumerate(picks, 1):
        q, edits, ack, meta_path, flagged = unwrap(item)
        problems, warns = [], []
        extra = []
        text = q.get("text") if isinstance(q, dict) else None
        if not isinstance(text, str) or len(text.strip()) < 2:
            print(f"{i}. FAIL — no text\n")
            failures += 1
            continue
        t = text.strip()
        # (A version-2 candidate gets this check, with the rest of the shape of a quote, from the word-by-word analysis below.)
        if edits is None and ((t[0] in "\"'“‘" and t[-1] in "\"'”’") or t.startswith("“")):
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
        if edits is None:
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
        else:
            if work is None:
                from _timing import load_work  # noqa: E402  (reads the raw caption track; only candidates need it)
                work = load_work(args.source, meta_path or args.meta)
            if args.respell:
                warns.append("--respell flags do not apply to a candidate with edits; declare a respell edit")
            an = analyze(text, work.idx, edits, meta_text=work.meta_text, author=q.get("author", ""), ack=ack, flagged=flagged, clock=work.seconds_at)
            state = an.state
            problems += an.fails
            warns += an.warns
            if an.alignment and an.alignment.coverage >= 0.6:
                a0, a1 = an.start, an.end
                sec = work.seconds_at(a0)
                when = f" at {fmt_time(sec)}" if sec is not None else ""
                detail = f"stretch of {a1 - a0} words{when}; {an.alignment.matched} of {len(an.ctoks)} quote words matched in order"
                extra.append("edits: " + edits_sentence(an))
                for u in an.used:
                    shown = f"{u.from_surface!r}" + (f" -> {u.to_surface!r}" if u.to_surface else "")
                    extra.append(f"  {u.edit.kind}: {shown}" + (f" ({u.label})" if u.label else ""))
                if an.ok:
                    expected = edits_sentence(an)
                    if expected not in (ver.get("note") or ""):
                        problems.append("the verification note does not carry the edit list; append: " + expected)
                # The link and the locator land where the line is said.
                tol = 3 if (work.timed and work.timed.source == "vtt") else 35
                if sec is not None:
                    t_url = url_seconds(str(url or ""))
                    t_loc = locator_seconds(str(src.get("locator") or ""))
                    if t_url is not None and abs(t_url - sec) > tol:
                        problems.append(f"the link starts at {fmt_time(t_url)} but the line is said at {fmt_time(sec)}")
                    if t_loc is not None and abs(t_loc - sec) > tol:
                        problems.append(f"the locator says {fmt_time(t_loc)} but the line is said at {fmt_time(sec)}")
                    if t_url is None and youtube_id(str(url or "")):
                        warns.append(f"the link has no timestamp; it should start at {fmt_time(sec)} (build-candidates.py sets it)")
                    if t_loc is None and wk in ("interview", "speech"):
                        warns.append(f"the locator has no time; it should say {fmt_time(sec)}")
            else:
                detail = "nearest: " + (an.nearest[:300] if an.nearest else "(nothing close)")
            for sim, other in near_duplicates(text, existing):
                warns.append(f"close to a line he holds ({other['id']}, {int(sim * 100)}% of the same words): {other['text'][:90]}…")
            if identity(text) in existing_identity and loose(text) not in existing_loose:
                problems.append(
                    f"same words as {existing_identity[identity(text)]['id']} apart from punctuation or case: "
                    "the importer treats them as one quote and would drop this"
                )

        # Duplicates and tombstones.
        if loose(text) in existing_loose:
            problems.append(f"already in the collection as {existing_loose[loose(text)]['id']}")
        if loose(text) in removed_loose:
            problems.append("on data/removed.json — he removed this before; the importer will not re-add it")

        # The work.
        work_title = q.get("work")
        if work_title and work_title in works:
            reg = works[work_title]
            if reg.get("author") != q.get("author"):
                warns.append(f"registry has author {reg.get('author')!r} for this work")
            work_line = f"registered ({reg.get('subject')}, {reg.get('kind')}, {reg.get('year')})"
        elif work_title:
            work_line = "not registered"
            warns.append("work NOT REGISTERED — run register-work.py after filing, or its quotes vanish from the shelf's filters")
        else:
            work_line = "no work"

        verdict = "FAIL" if problems else ("ok  " if not warns else "ok ~")
        print(f"{i}. {verdict} {state:<11} {q.get('author', '?')} — {work_title or '?'}")
        print(f"      \"{t[:110]}{'…' if len(t) > 110 else ''}\"")
        if detail:
            print(f"      {detail}")
        for line in extra:
            print(f"      {line}")
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
