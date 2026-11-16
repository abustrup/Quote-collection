"""Shared helpers for the quote-mine scripts: find the repository, read its controlled vocabularies."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path


def find_repo(explicit: str | None = None) -> Path:
    """The Quote-collection checkout: --repo, then $QUOTE_REPO, then a parent of cwd, then ~/Quote-collection."""
    candidates = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.environ.get("QUOTE_REPO"):
        candidates.append(Path(os.environ["QUOTE_REPO"]).expanduser())
    here = Path.cwd()
    candidates.extend([here, *here.parents])
    candidates.append(Path.home() / "Quote-collection")
    for c in candidates:
        if (c / "data" / "quotes.json").is_file() and (c / "assets" / "quote-core.js").is_file():
            return c
    raise SystemExit(
        "Cannot find the Quote-collection checkout. Pass --repo DIR, or clone it:\n"
        "  git clone https://github.com/abustrup/Quote-collection ~/Quote-collection"
    )


def vocab(repo: Path) -> dict[str, list[str]]:
    """THEMES, WORK_KINDS, SUBJECTS and VERIFICATION statuses, read from the repo so they never drift from it."""
    core = (repo / "assets" / "quote-core.js").read_text(encoding="utf-8")
    out: dict[str, list[str]] = {}
    for name in ("THEMES", "WORK_KINDS", "SUBJECTS"):
        m = re.search(r"export const %s = \[(.*?)\];" % name, core, re.S)
        if not m:
            raise SystemExit(f"Could not read {name} from assets/quote-core.js — has the file changed shape?")
        out[name] = re.findall(r"'([^']+)'", m.group(1))
    schema = json.loads((repo / "data" / "schema.json").read_text(encoding="utf-8"))
    out["VERIFICATION"] = schema["$defs"]["verification"]["properties"]["status"]["enum"]
    return out


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))
