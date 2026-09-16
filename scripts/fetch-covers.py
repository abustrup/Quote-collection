#!/usr/bin/env python3
"""
Find a front cover for every book in data/works.json and file it under
assets/covers/<slug>.webp.

Why this exists rather than a folder of hand-saved JPEGs: the shelf is 90
books and will grow, the covers have to be a consistent shape or the grid
looks broken, and a wrong cover has to be traceable. So every cover is
fetched, measured against the same three tests, resized to the same ceiling,
and recorded with `coverSource` saying exactly where the picture came from.

Sources, best first:

  1. Open Library by ISBN, then by title and author. Its *original* file
     (https://covers.openlibrary.org/b/id/<id>.jpg, no size suffix) is often
     1000px or taller, which is what makes a cover look like a cover on a
     retina screen rather than a thumbnail stretched.
  2. Goodreads' largest, which is the export's `coverLarge` with the
     `._SY475_` size suffix removed — about 500px tall, the floor.

A candidate has to be at least 500px tall, between 0.55 and 0.80 wide over
tall (the shape of a printed book; anything squarer is usually a CD, a logo or
a placeholder), and not a near-uniform rectangle, which is what Open Library's
"no cover" images and Goodreads' nophoto look like.

Usage:
  python3 scripts/fetch-covers.py                 # fill in what is missing
  python3 scripts/fetch-covers.py --force         # re-fetch everything
  python3 scripts/fetch-covers.py --only 1984 --only Hamlet
  python3 scripts/fetch-covers.py --dry-run       # look, decide, write nothing

Stdlib plus Pillow. The site itself has no dependencies and this keeps that
promise for everything that runs in CI; Pillow is a local tool, not a build
step.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
WORKS = REPO / "data" / "works.json"
GOODREADS = REPO / "docs" / "goodreads-export-2026-09-16.json"
COVERS = REPO / "assets" / "covers"

MIN_HEIGHT = 500
MIN_ASPECT = 0.55
MAX_ASPECT = 0.80
# Below this, stretching a picture up to the floor is a lie rather than a
# rescue: 330px is about two thirds of 500, which is soft but still reads as
# a cover at shelf size. Anything shorter is reported missing instead.
UPSCALE_FLOOR = 330
MAX_HEIGHT = 800
MAX_BYTES = 120 * 1024
QUALITY_STEPS = (82, 74, 66, 58)

# Covers chosen by hand, because the catalogue cannot be talked into finding
# them and because this is a shelf he looks at every day. Each is a real front
# cover of the right book in English; the reason is the part worth keeping,
# since a future run would otherwise "fix" them back.
#
# A pin is `title: (source, url)`. The source is what lands in `coverSource`,
# so a pinned cover is as traceable as a found one, and a pin still has to pass
# the same size, shape and detail tests as anything else — a pin that fails
# them falls through to the ordinary search rather than being forced through.
GR = "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books"
OL_ID = "https://covers.openlibrary.org/b/id/{}.jpg?default=false"
OL_ISBN = "https://covers.openlibrary.org/b/isbn/{}.jpg?default=false"

COVER_PINS = {
    # Open Library has no English standalone edition of Derrida's "Force of
    # Law" at all — the English text lives inside "Acts of Religion", under
    # that title — so this is the Spanish Tecnos edition, which is the one he
    # owns (ISBN 8430930949) and the one whose cover says "Fuerza de ley".
    "Force of Law": ("openlibrary:14165428", OL_ID.format(14165428)),

    # The search kept finding scans of old library copies: worn cloth bindings,
    # barcode stickers, and seventeenth-century quarto title pages. All are the
    # right book and none of them is a cover anybody would want on a shelf.
    "1984": ("goodreads:61439040", f"{GR}/1657781256l/61439040.jpg"),                    # Signet, Pynchon foreword
    "The Idiot": ("goodreads:12505", f"{GR}/1657539107l/12505.jpg"),                     # Vintage Classics
    "The Maniac": ("goodreads:75665931", f"{GR}/1679411721l/75665931.jpg"),              # Penguin Press, English
    "Hamlet": ("openlibrary:15171356", OL_ID.format(15171356)),
    "Romeo and Juliet": ("openlibrary:15137021", OL_ID.format(15137021)),                # Penguin
    "The Tempest": ("openlibrary:12621675", OL_ID.format(12621675)),
    "The Great Gatsby": ("openlibrary:14314120", OL_ID.format(14314120)),                # Scribner, Celestial Eyes
    "The Old Man and the Sea": ("openlibrary:14827822", OL_ID.format(14827822)),         # Vintage Classics
    "Groundwork of the Metaphysics of Morals": ("openlibrary:9581515", OL_ID.format(9581515)),
    "Thus Spoke Zarathustra": ("openlibrary-isbn:0140441182", OL_ISBN.format("0140441182")),

    # Open Library holds no cover for Deep Utopia under either ISBN, and the
    # edition he shelved has only a 228px thumbnail. This is another Goodreads
    # edition of the same English book, at the floor and sharp.
    "Deep Utopia: Life and Meaning in a Solved World": ("goodreads:211858058", f"{GR}/1718971000l/211858058.jpg"),
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------------------
# slug(), ported from assets/quote-core.js so a cover filename and a ?work=
# filter value can never drift apart. Checked against the JS in the tests below
# and by `node -e` during the port.
# ---------------------------------------------------------------------------

TRANSLITERATIONS = {
    "ø": "o", "æ": "ae", "å": "a", "ð": "d", "þ": "th",
    "œ": "oe", "ß": "ss", "đ": "d", "ł": "l", "ı": "i",
}


def slug(text: str) -> str:
    lowered = str(text or "").lower()
    lowered = "".join(TRANSLITERATIONS.get(ch, ch) for ch in lowered)
    decomposed = unicodedata.normalize("NFD", lowered)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    hyphenated = re.sub(r"[^a-z0-9]+", "-", stripped)
    return hyphenated.strip("-")


# ---------------------------------------------------------------------------
# Polite HTTP: one host at a time, at most two requests a second, and a real
# User-Agent. Open Library is free and run by a library; hammering it would be
# rude and would get this script blocked, which costs more than the wait.
# ---------------------------------------------------------------------------

_last_request: dict[str, float] = {}
MIN_GAP = 0.5


def fetch(url: str, *, attempts: int = 3, timeout: int = 40) -> bytes | None:
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(attempts):
        gap = MIN_GAP - (time.monotonic() - _last_request.get(host, 0))
        if gap > 0:
            time.sleep(gap)
        _last_request[host] = time.monotonic()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            # 404 means "there is no cover", which is an answer, not a failure.
            if error.code in (403, 404, 410):
                return None
            wait = (2 ** attempt) + random.random()
        except Exception:
            wait = (2 ** attempt) + random.random()
        if attempt < attempts - 1:
            time.sleep(wait)
    return None


def fetch_json(url: str) -> dict | None:
    raw = fetch(url)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Is this actually a front cover?
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    source: str
    url: str
    data: bytes
    image: Image.Image
    verdict: "str | None" = None
    preferred: bool = False
    pinned: bool = False

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size

    @property
    def aspect(self) -> float:
        width, height = self.image.size
        return width / height if height else 0.0


def looks_blank(image: Image.Image) -> bool:
    """True for a picture that is not a front cover: a flat placeholder, or a
    photograph of a plain cloth or leather binding with nothing printed on it.

    Two measurements, because the two failures look different. A placeholder is
    near-uniform in colour, so the spread of each channel is tiny. A blank
    binding can be a rich brown and still carry no design at all, so what
    separates it is detail: the average difference between neighbouring pixels.
    Measured over a hundred covers the gap is wide and clean — featureless
    bindings sit at 1-2, a legible title page at 5, and a designed cover at 7
    to 15 — so the line is drawn at 3 and neither kind of picture is close to
    it.
    """
    small = image.convert("RGB").resize((32, 48))
    channels = list(zip(*list(small.getdata())))
    if sum(max(channel) - min(channel) for channel in channels) / 3 < 26:
        return True

    grey = image.convert("L").resize((64, 96))
    pixels = list(grey.getdata())
    width, height = 64, 96
    total = 0
    for y in range(height):
        row = y * width
        for x in range(width - 1):
            total += abs(pixels[row + x] - pixels[row + x + 1])
    for y in range(height - 1):
        row, below = y * width, (y + 1) * width
        for x in range(width):
            total += abs(pixels[row + x] - pixels[below + x])
    return total / (height * (width - 1) + (height - 1) * width) < 3.0


def judge(candidate: Candidate) -> str | None:
    """None when the picture passes; otherwise why it did not."""
    width, height = candidate.size
    if len(candidate.data) < 3000:
        return f"{len(candidate.data)}B, too small to be a cover"
    if height < MIN_HEIGHT:
        return f"{width}x{height}, under {MIN_HEIGHT}px tall"
    if not (MIN_ASPECT <= candidate.aspect <= MAX_ASPECT):
        return f"{width}x{height}, aspect {candidate.aspect:.2f} outside {MIN_ASPECT}-{MAX_ASPECT}"
    if looks_blank(candidate.image):
        return f"{width}x{height}, no design on it: a placeholder or a blank binding"
    return None


def load(source: str, url: str) -> Candidate | None:
    data = fetch(url)
    if not data:
        return None
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        return None
    return Candidate(source=source, url=url, data=data, image=image)


# ---------------------------------------------------------------------------
# Where covers come from
# ---------------------------------------------------------------------------

OPENLIBRARY_FIELDS = "key,cover_i,title,author_name,cover_edition_key,edition_key,language,first_publish_year"


def openlibrary_search(query: str) -> list:
    url = f"https://openlibrary.org/search.json?{query}&fields={OPENLIBRARY_FIELDS}&limit=10"
    payload = fetch_json(url)
    return (payload or {}).get("docs", []) or []


def plain(name: str) -> str:
    """An author's name with the accents folded away and any middle initial
    dropped. Open Library files Acemoglu where Goodreads files Acemoğlu, and
    Anderson where the registry says Elizabeth S. Anderson; a search that
    insists on the exact string quietly returns nothing at all."""
    folded = slug(name).replace("-", " ")
    return " ".join(word for word in folded.split() if len(word) > 1)


# A study guide is not the book. Open Library files Coles Notes on The
# Stranger and Hodder's "Study & Revise" for Never Let Me Go as editions of the
# novels themselves, and both have handsome big scans, so without this the
# largest-that-passes rule picks the revision guide over the novel.
GUIDE = re.compile(
    r"\b(notes?|study|revise|revision|guide|companion|handbook|sparknotes|cliffsnotes|"
    r"coles|summary|summaries|analysis|casebook|criticism|critical|workbook|"
    r"teacher|student edition|readers guide|reading guide)\b",
    re.IGNORECASE,
)


# The other half of the same problem, and the only thing that betrays it: a
# revision guide's edition record can be titled exactly "Never Let Me Go" and
# give nothing away but its publisher.
STUDY_PRESS = re.compile(
    r"(education|educational|revision|study|notes|schools|coles|sparknotes|"
    r"cliffs|letts|york press|barron|perfection learning|san val)",
    re.IGNORECASE,
)


def is_study_edition(entry: dict) -> bool:
    return any(STUDY_PRESS.search(str(name)) for name in (entry.get("publishers") or []))


def is_guide(title: str, wanted: str) -> bool:
    """True when a title advertises itself as a book *about* the book. The
    wanted title is checked too, so a book actually called Notes from
    Underground is not thrown out by its own name."""
    if GUIDE.search(str(wanted or "")):
        return False
    return bool(GUIDE.search(str(title or "")))


def title_key(text: str) -> str:
    """A title reduced to the part that identifies the book: no subtitle, no
    series bracket, no leading article, no punctuation."""
    head = re.split(r"[:(]", str(text or ""))[0]
    head = re.sub(r"^(the|a|an)\s+", "", head.strip().lower())
    return re.sub(r"[^a-z0-9]+", " ", head).strip()


def title_matches(candidate: str, wanted: str) -> bool:
    left, right = title_key(candidate), title_key(wanted)
    return bool(left) and (left == right or left.startswith(right) or right.startswith(left))


def author_matches(names: list, author: str) -> bool:
    """Surnames agree, or there is no Latin name to disagree with.

    Enough to tell Isaacson's Elon Musk from the dozen other books called Elon
    Musk, and forgiving enough to survive a middle initial or a missing accent.
    The second half matters more than it looks: Open Library files 1Q84 under
    村上春樹 and Anna Karenina under Лев Толстой, and a surname test that
    insists on Latin letters throws away the right book for the two authors
    most likely to be catalogued in their own script.
    """
    names = names or []
    surname = (plain(author).split() or [""])[-1]
    if surname and any(surname in plain(name).split() for name in names):
        return True
    return bool(names) and not any(re.search(r"[A-Za-z]", name) for name in names)


def matching_works(title: str, author: str, isbn: str) -> list:
    """Open Library work keys for this book — the ones whose title and author
    both agree, and nothing else.

    This is the part that stops the search handing back a cover of the wrong
    book. Everything asked for afterwards belongs to one of *these* works, so a
    study guide about Anna Karenina, a different author's Elon Musk biography
    and Greg Egan's other novel are not in the running at all — which is
    exactly how the first run of this script went wrong: it took the largest
    picture that looked like a book rather than the largest picture of the
    right book.

    Several keys rather than one, because Open Library routinely holds the same
    novel as half a dozen work records, and the one an ISBN happens to resolve
    to is often the sparsest of them.
    """
    keys, covers = [], []

    def consider(doc: dict, checked: bool) -> None:
        if is_guide(doc.get("title", ""), title):
            return
        if not checked and not (
            title_matches(doc.get("title", ""), title) and author_matches(doc.get("author_name"), author)
        ):
            return
        if doc.get("key"):
            keys.append(doc["key"])
        if doc.get("cover_i"):
            covers.append(doc["cover_i"])

    if isbn:
        for doc in openlibrary_search(f"isbn={urllib.parse.quote(isbn)}"):
            consider(doc, checked=True)

    short, simple = title_key(title) or title, plain(author)
    for query in (
        f"title={urllib.parse.quote(title)}&author={urllib.parse.quote(author)}",
        f"title={urllib.parse.quote(short)}&author={urllib.parse.quote(simple)}",
        f"q={urllib.parse.quote(short + ' ' + simple)}",
    ):
        if len(keys) >= 4:
            break
        for doc in openlibrary_search(query):
            consider(doc, checked=False)

    return list(dict.fromkeys(keys))[:4], list(dict.fromkeys(covers))


def work_covers(work_key: str, title: str, limit: int = 8) -> list:
    """Cover ids from one work's own editions, best edition first.

    English first, because he reads these in English and a Russian Lolita or a
    Japanese Steve Jobs is the right book wearing the wrong face. Then a title
    that matches, which separates a novel's own printing from the omnibus it
    was bound into. Then the newer printing, whose scan is usually the bigger
    one.
    """
    payload = fetch_json(f"https://openlibrary.org{work_key}/editions.json?limit=200")
    entries = (payload or {}).get("entries", []) or []

    named, rest = [], []
    for entry in entries:
        covers = [c for c in (entry.get("covers") or []) if isinstance(c, int) and c > 0]
        if not covers or is_guide(entry.get("title", ""), title) or is_study_edition(entry):
            continue
        languages = [language.get("key", "") for language in (entry.get("languages") or [])]
        english = 1 if "/languages/eng" in languages else (0 if languages else 0.5)
        year = re.search(r"(1[5-9]\d{2}|20[0-2]\d)", str(entry.get("publish_date") or ""))
        row = (english, int(year.group(1)) if year else 0, covers[0])
        (named if title_matches(entry.get("title", ""), title) else rest).append(row)

    # Editions actually called by this book's name first, and the others only
    # if those run out: an omnibus or a paired volume is the right text wearing
    # someone else's cover, and its scan is often the biggest one on offer.
    named.sort(reverse=True)
    rest.sort(reverse=True)
    ordered = [(cover_id, english == 1) for english, _, cover_id in named]
    ordered += [(cover_id, False) for _, _, cover_id in rest]
    seen, unique = set(), []
    for cover_id, preferred in ordered:
        if cover_id in seen:
            continue
        seen.add(cover_id)
        unique.append((cover_id, preferred))
    return unique[:limit]


def candidates_for(work: dict, goodreads_cover: str, verbose: bool) -> list:
    """Every picture worth considering for this book, all measured before any
    is chosen, because the aim is the largest that passes rather than the
    first. One shortcut: a candidate already at the 800px ceiling cannot be
    improved on, so the search stops there rather than asking a free library
    for files it would only throw away."""
    gathered = []
    seen_urls = set()
    title = work["title"]
    author = work.get("author", "")
    isbn = (work.get("goodreads") or {}).get("isbn") or ""

    def good_enough() -> bool:
        return any(c.verdict is None and c.preferred and c.size[1] >= MAX_HEIGHT for c in gathered)

    def add(source: str, url: str, preferred: bool = True, pinned: bool = False) -> None:
        if url in seen_urls or good_enough():
            return
        seen_urls.add(url)
        candidate = load(source, url)
        if candidate is None:
            return
        candidate.verdict = judge(candidate)
        candidate.preferred = preferred
        candidate.pinned = pinned
        gathered.append(candidate)
        if verbose:
            width, height = candidate.size
            state = "ok " if candidate.verdict is None else "no "
            print(f"      {state} {source:<28} {width}x{height} {candidate.verdict or ''}".rstrip())

    # 0. A pinned cover, chosen by hand for a book the catalogue gets wrong.
    pin = COVER_PINS.get(title)
    if pin:
        add(pin[0], pin[1], pinned=True)
        # A pin is a decision somebody made with the picture in front of them,
        # so it outranks the height floor — several of these covers are the
        # publisher's own file at 499px, one pixel short, and falling through
        # to "the largest thing the catalogue can find" is exactly the failure
        # the pin exists to prevent. Shape and detail still have to hold.
        if any(c.pinned and c.verdict is None for c in gathered):
            return gathered
        near = [c for c in gathered if c.pinned and c.size[1] >= UPSCALE_FLOOR
                and MIN_ASPECT <= c.aspect <= MAX_ASPECT and not looks_blank(c.image)]
        if near:
            return near

    # 1. The exact edition Goodreads recorded, which is the one he owns.
    if isbn:
        add(f"openlibrary-isbn:{isbn}", f"https://covers.openlibrary.org/b/isbn/{isbn}.jpg?default=false")

    # 2. Everything else Open Library holds for the same book.
    keys, search_covers = matching_works(title, author, isbn)
    cover_ids = [(cover_id, False) for cover_id in search_covers]
    for key in keys:
        if good_enough():
            break
        cover_ids += work_covers(key, title)
    seen_ids = set()
    for cover_id, preferred in cover_ids[:14]:
        if cover_id in seen_ids:
            continue
        seen_ids.add(cover_id)
        add(f"openlibrary:{cover_id}", f"https://covers.openlibrary.org/b/id/{cover_id}.jpg?default=false", preferred)

    # 3. Goodreads' own largest, about 500px tall — the floor, not the aim.
    if goodreads_cover and not good_enough():
        add(f"goodreads:{(work.get('goodreads') or {}).get('id', '')}", goodreads_cover)

    return gathered


def best_of(gathered: list[Candidate]) -> tuple[Candidate | None, bool]:
    """The tallest picture that passed, and whether it had to be stretched.

    Goodreads' largest is typically 499px tall — one pixel under the floor,
    which is an arithmetic accident rather than a judgement about the picture.
    So when nothing passes and the only thing on offer is a correctly-shaped
    cover that is merely short, it is taken and scaled up to the floor. That is
    a real loss of sharpness and it is recorded: `coverSource` keeps a
    `+upscaled` marker so the contact sheet and this script's own summary can
    say which covers are the soft ones."""
    def tallest(pool: list[Candidate]) -> Candidate | None:
        if not pool:
            return None
        return sorted(
            pool,
            key=lambda c: (c.size[1], c.size[0], 0 if c.source.startswith("goodreads") else 1),
            reverse=True,
        )[0]

    # Language before size. A sharp Czech "Stařec a moře" is the right book
    # wearing the wrong face, and on an English shelf that reads as a mistake
    # even though it is not one; a slightly smaller English cover does not.
    pinned = tallest([c for c in gathered if c.pinned])
    if pinned is not None:
        return pinned, pinned.verdict is not None

    passed = tallest([c for c in gathered if c.verdict is None and c.preferred])
    if passed is None:
        passed = tallest([c for c in gathered if c.verdict is None])
    if passed is not None:
        return passed, False

    near = [
        c
        for c in gathered
        if c.verdict is not None
        and UPSCALE_FLOOR <= c.size[1] < MIN_HEIGHT
        and MIN_ASPECT <= c.aspect <= MAX_ASPECT
        and len(c.data) >= 3000
        and not looks_blank(c.image)
    ]
    return tallest(near), True


def save_webp(candidate: Candidate, destination: Path) -> tuple[int, int, int, int]:
    """Write the cover: at least MIN_HEIGHT and at most MAX_HEIGHT tall, and
    under MAX_BYTES. Says what it cost.

    Two levers, pulled in that order. Quality first, because a busy cover
    photograph can be 160 KB at quality 82 and 90 KB at 66 with no difference
    anyone sees at shelf size. Height second, and only for the handful of
    grainy scans that are still too heavy at the bottom of the quality ladder —
    a shorter file is a difference people do see on a retina screen, so it is
    the last resort and it never goes below the 500px floor."""
    image = candidate.image.convert("RGB")
    source_width, source_height = image.size
    target = MAX_HEIGHT if source_height > MAX_HEIGHT else max(source_height, MIN_HEIGHT)

    best = None
    height = target
    while True:
        width = round(source_width * height / source_height)
        frame = image if height == source_height else image.resize((width, height), Image.LANCZOS)
        for quality in QUALITY_STEPS:
            buffer = io.BytesIO()
            frame.save(buffer, format="WEBP", quality=quality, method=6)
            best = (buffer, quality, width, height)
            if buffer.tell() <= MAX_BYTES:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(buffer.getvalue())
                return width, height, buffer.tell(), quality
        if height <= MIN_HEIGHT:
            break
        height = max(MIN_HEIGHT, round(height * 0.88))

    buffer, quality, width, height = best
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(buffer.getvalue())
    return width, height, buffer.tell(), quality


# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-fetch covers that are already there")
    parser.add_argument("--only", action="append", default=[], metavar="TITLE", help="just this book (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="decide but write nothing")
    parser.add_argument("--quiet", action="store_true", help="one line per book, not one per candidate")
    parser.add_argument("--originals", default=os.environ.get("COVER_ORIGINALS", ""),
                        help="a directory to keep the downloaded originals in")
    args = parser.parse_args()

    registry = json.loads(WORKS.read_text(encoding="utf-8"))
    goodreads_covers = {}
    if GOODREADS.exists():
        for book in json.loads(GOODREADS.read_text(encoding="utf-8")):
            url = re.sub(r"\._[A-Z]{2}\d+_", "", book.get("coverLarge") or "")
            if url and "nophoto" not in url:
                goodreads_covers[str(book["bookId"])] = url

    originals = Path(args.originals) if args.originals else None
    wanted = {title.lower() for title in args.only}

    books = [w for w in registry["works"] if w.get("kind") == "book"]
    if wanted:
        books = [w for w in books if w["title"].lower() in wanted or slug(w["title"]) in wanted]

    done, skipped, failed, upscaled = 0, 0, [], []
    for index, work in enumerate(books, 1):
        name = slug(work["title"])
        destination = COVERS / f"{name}.webp"
        if destination.exists() and not args.force:
            # Measured from the file rather than remembered, so the registry
            # cannot drift from what is on disk if a cover is replaced by hand.
            with Image.open(destination) as existing:
                work["coverSize"] = list(existing.size)
            work["cover"] = f"assets/covers/{name}.webp"
            skipped += 1
            continue

        print(f"[{index:>3}/{len(books)}] {work['title']}")
        goodreads_cover = goodreads_covers.get((work.get("goodreads") or {}).get("id", ""))
        gathered = candidates_for(work, goodreads_cover, verbose=not args.quiet)
        best, stretched = best_of(gathered)
        if best is None:
            print("      -- nothing passed")
            failed.append(work["title"])
            continue
        stretched = stretched and best.size[1] < MIN_HEIGHT * 0.98
        source = f"{best.source}+upscaled" if stretched else best.source
        if stretched:
            upscaled.append(f"{work['title']} ({best.size[0]}x{best.size[1]} -> {MIN_HEIGHT}px)")

        if args.dry_run:
            print(f"      => {source} {best.size[0]}x{best.size[1]} (dry run)")
            done += 1
            continue

        if originals:
            originals.mkdir(parents=True, exist_ok=True)
            suffix = (best.image.format or "jpg").lower().replace("jpeg", "jpg")
            (originals / f"{name}.{suffix}").write_bytes(best.data)

        width, height, size, quality = save_webp(best, destination)
        work["cover"] = f"assets/covers/{name}.webp"
        work["coverSize"] = [width, height]
        work["coverSource"] = source
        print(f"      => {source} {best.size[0]}x{best.size[1]} -> {width}x{height} {size // 1024}KB"
              + (f" at quality {quality}" if quality != QUALITY_STEPS[0] else ""))
        done += 1

        # Written after every book, not at the end: a run that dies halfway
        # through leaves the registry agreeing with the files on disk.
        WORKS.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if not args.dry_run:
        WORKS.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n{done} fetched, {skipped} already there, {len(upscaled)} stretched to the floor, {len(failed)} without a cover")
    for title in upscaled:
        print(f"  soft:    {title}")
    for title in failed:
        print(f"  missing: {title}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
