#!/usr/bin/env python3
"""Save a web page's own text, raw, so quotes can be checked against it.

Usage:
  fetch-text.py URL OUT.txt

Why this exists: a summarising fetch tool returns a summary of the page, and a summary is not the
work. This downloads the page and keeps the article text as written, one paragraph per block, then
prints the word count and the first lines so you can see whether it is the work or a stub.
Pages that need JavaScript or a login come back short; the script says so. For those, ask Alexander
for the text.
"""
from __future__ import annotations

import html
import re
import sys
import urllib.request
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    url, out = sys.argv[1], Path(sys.argv[2])
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (quote-mine)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        page = r.read().decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    page = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", "", page)
    m = re.search(r"(?is)<article.*?</article>", page) or re.search(r"(?is)<main.*?</main>", page)
    body = m.group(0) if m else page
    body = re.sub(r"(?i)</(p|h[1-6]|li|blockquote|div|tr)>", "\n\n", body)
    body = re.sub(r"(?i)<br\s*/?>", "\n", body)
    text = html.unescape(re.sub(r"<[^>]+>", "", body))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    out.write_text(text, encoding="utf-8")
    words = len(text.split())
    print(f"{out}  ·  {words} words")
    print("\n".join(text.splitlines()[:6])[:700])
    if not m:
        print("\n! No <article> or <main> found: this is the whole page, navigation and footer included.")
    if words < 800:
        print("\n! Under 800 words. If the work is longer than that, this is a stub, a paywall or a "
              "JavaScript page, not the work. Do not quote from it.")


if __name__ == "__main__":
    main()
