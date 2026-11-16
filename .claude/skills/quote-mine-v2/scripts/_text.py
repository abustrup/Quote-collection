"""Pure text logic for quote-mine-v2: words, alignment, edits, guards, times and links.

No file or network access lives here, so the tests import it directly. The scripts around it
(check-quotes.py, locate-quote.py, build-candidates.py, select-picks.py) read files and print.

The idea in one paragraph. A quote is the speaker's own words, tidied. To prove that, the cleaned
text is aligned word by word against the transcript: the best-matching span is found even when
the quote left fillers out or respelled a name, and every difference between the span and the
quote becomes an edit (a cut, a respell, an insert). Each edit has to be declared, and each
declared edit is judged: a filler may go, a hedge may not, a word may not be swapped for a better
one, a negation may never be dropped or added.
"""
from __future__ import annotations

import difflib
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional, Sequence, Set, Tuple

# --------------------------------------------------------------------------- normalising


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[‒–—―]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def loose(s: str) -> str:
    return norm(s).lower()


def tokens(s: str) -> List[str]:
    """The version-1 tokeniser, kept exactly so that the old checks behave exactly as before."""
    return re.findall(r"[\w']+", loose(s))


# A word, with the full stops inside it kept: "Repl.it", "U.S.A" and "3.5" are one word each, so a name a caption
# splits with a dot lines up with the name written whole. A full stop followed by a space ends a sentence and
# belongs to no word.
_WORD = re.compile(r"[\w'’‘]+(?:\.[\w'’‘]+)*")


def words(s: str) -> List[str]:
    """Lower-case words with apostrophes inside them kept and the ones that only quote them dropped."""
    out = []
    for w in _WORD.findall(loose(s)):
        w = w.strip("'")
        if w:
            out.append(w)
    return out


def identity(s: str) -> str:
    """What the importer compares: words and numbers only, lower case (assets/quote-core.js normalizeForIdentity)."""
    return re.sub(r"[\W_]+", " ", loose(s)).strip()


MARKER = re.compile(r"^\[\d+:\d\d(?::\d\d)?\]\s*", re.M)
CHAPTER = re.compile(r"^## .*$", re.M)


def strip_transcript(raw: str) -> str:
    """transcript.txt without its [m:ss] block markers and chapter headings: just what was said."""
    return CHAPTER.sub("", MARKER.sub("", raw))


# --------------------------------------------------------------------------- tokens with places


@dataclass
class Tok:
    w: str          # the word, normalised
    raw: str        # the word as written
    start: int      # character offsets in the text it came from
    end: int
    after: str = ""  # the characters between this word and the next one (punctuation, spaces)
    turn: bool = False  # a change of speaker comes right after this word (set by SourceIndex, which knows the marks)


def tokenize(text: str) -> List[Tok]:
    out: List[Tok] = []
    for m in _WORD.finditer(text):
        w = loose(m.group(0)).strip("'")
        if w:
            out.append(Tok(w, m.group(0), m.start(), m.end()))
    for i, t in enumerate(out):
        nxt = out[i + 1].start if i + 1 < len(out) else len(text)
        t.after = text[t.end:nxt]
    return out


def surface(text: str, toks: Sequence[Tok], idxs: Sequence[int]) -> str:
    """The words idxs as they were written: one stretch of the text when they are side by side, so a
    7,000 stays 7,000 and an annotation keeps its brackets."""
    idxs = list(idxs)
    if not idxs:
        return ""
    if idxs == list(range(idxs[0], idxs[0] + len(idxs))):
        a, b = toks[idxs[0]].start, toks[idxs[-1]].end
        bracketed = a > 0 and b < len(text) and text[a - 1] == "[" and text[b] == "]"
        out = re.sub(r"\s+", " ", text[a:b]).strip()
        return f"[{out}]" if bracketed else out
    return " ".join(toks[i].raw for i in idxs)


_BOUNDARY_MID = re.compile(r"[.?!…][\"'”’)\]]*\s")
_BOUNDARY_END = re.compile(r"[.?!…]")

# A change of speaker, as the caption tracks write it. YouTube's machine captions put ">>" between two speakers. An
# uploader's own track marks it with a caption line that starts with "-"; once the lines are joined that is a hyphen
# standing alone after the end of a sentence (or at the start of a block). The hyphen is only read as a mark in a
# track known to be an uploader's (an essay's bullet list is no change of speaker).
_TURN_CHEVRON = re.compile(r">>")
_TURN_HYPHEN = re.compile(r">>|(?:[.?!…][\"'”’)\]]*[ \t]+|\n[ \t]*)-\s")


def _punct_end(toks: Sequence[Tok], i: int) -> bool:
    """Does the punctuation end a sentence after word i? A full stop glued to the next word (3.5, U.S.A) is not an end."""
    if i == len(toks) - 1:
        return bool(_BOUNDARY_END.search(toks[i].after))
    return bool(_BOUNDARY_MID.search(toks[i].after))


def ends_sentence(toks: Sequence[Tok], i: int) -> bool:
    """Does the sentence end after word i? It does where the punctuation says so, and where a speaker's turn ends:
    the next words are another person's."""
    if i < 0:
        return True
    return _punct_end(toks, i) or toks[i].turn


_BRACKETS = re.compile(r"\[[^\]\n]{1,60}\]|\([^)\n]{1,40}\)")


def bracket_ranges(text: str) -> List[Tuple[int, int]]:
    """Where the caption put annotations: [laughter], [music], (inaudible)."""
    return [(m.start(), m.end()) for m in _BRACKETS.finditer(text)]


# --------------------------------------------------------------------------- small word lists

DISFLUENCY = frozenset("um umm uh uhh uhm er erm ah hmm hm mm mhm eh".split())
FILLER_PAIRS = frozenset({("you", "know"), ("i", "mean"), ("you", "see")})
DISCOURSE = frozenset(
    "and so but well now okay ok right look anyway basically actually literally honestly obviously".split()
)
HEDGES = frozenset(
    "probably maybe perhaps possibly likely unlikely might could may seems apparently roughly approximately "
    "somewhat suppose presumably arguably plausibly hopefully guess think believe suspect imagine sort kind "
    "mostly largely about around nearly almost".split()
)
# Words that make what comes next somebody's opinion, a maybe, or somebody else's words. A quote that starts
# after them, or stops before them, says more flatly than the speaker did.
FRAME_WORDS = frozenset(
    "think thought believe guess suppose suspect imagine reckon probably maybe perhaps possibly likely unlikely "
    "seems seem apparently presumably arguably plausibly hopefully might could may claim claims argue argues "
    "say says said wrote writes according reported reports announced estimated estimates concluded found "
    "quote unquote".split()
)
# Words that set how much a claim claims. Taking one out says more, or less, than the speaker did.
QUANTIFIERS = frozenset(
    "only all every each most some few any always often sometimes rarely usually mostly much many more less "
    "least fewer fewest both either".split()
)
# Words and phrases that set how much, how often or how sure a claim is, or for how long. A quote that starts right
# after one, or stops right before one, claims more than the speaker did ("Only the best startups are big" is not
# "The best startups are big"). The frames above (think, believe, ...) are judged apart.
EDGE_QUALIFIERS = (
    (HEDGES - frozenset("about around kind sort guess think believe suspect imagine suppose".split()))
    | QUANTIFIERS
    | frozenset("virtually practically hardly barely scarcely seldom merely yet unless except provided assuming".split())
)
# After a pause only these still reach back over the quote ("It works in the lab, but only for now").
TRAIL_QUALIFIERS = frozenset("only almost nearly mostly largely mainly usually sometimes hardly barely unless except provided assuming".split())
QUALIFIER_PHRASES = tuple(
    tuple(p.split())
    for p in (
        "sort of", "kind of", "at least", "at most", "at best", "for now", "so far", "right now", "for the moment",
        "at the moment", "for the time being", "as of now", "if at all", "or so", "or more", "or less", "in part",
        "to some extent", "in some cases", "in most cases", "most of the time", "for the most part", "in general",
    )
)
CONJUNCTIONS = frozenset("and but though although yet while whereas except".split())
_NUMBERISH = re.compile(
    r"^\d|^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|"
    r"seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|double|triple)$"
)
NEG_ALONE = frozenset("no never none nothing nobody nowhere neither nor without".split())
# Slips a caption makes between words that sound the same or differ by one letter.
GRAMMAR_PAIRS = frozenset(
    {
        ("a", "an"), ("an", "a"), ("its", "it's"), ("it's", "its"), ("their", "there"), ("there", "their"),
        ("they're", "their"), ("their", "they're"), ("there", "they're"), ("they're", "there"),
        ("your", "you're"), ("you're", "your"), ("then", "than"), ("than", "then"), ("were", "we're"),
        ("we're", "were"), ("who's", "whose"), ("whose", "who's"), ("to", "too"), ("too", "to"),
        ("of", "have"), ("have", "of"), ("lose", "loose"), ("loose", "lose"), ("affect", "effect"),
        ("effect", "affect"), ("is", "are"), ("are", "is"), ("was", "were"), ("were", "was"),
        ("don't", "doesn't"), ("doesn't", "don't"), ("has", "have"), ("have", "has"),
    }
)
STOP = frozenset(
    "a an and are as at be but by for from has have he her his i if in into is it its me my not of on or "
    "our she so that the their them then there these they this to us was we were what when which who will "
    "with you your".split()
)
# The only words a caption may be said to have dropped: small ones. A caption loses "to" or "of" between two
# words it heard; it does not lose a word that carries meaning, and a meaning-bearing word put back "because the
# caption dropped it" is a word the speaker may never have said.
SMALL_WORDS = STOP | frozenset("do does did am been being had would could should can than because about over out up off".split())

# Words an English sentence almost never ends on, or starts with: a quote that does was cut in the middle of a phrase.
DANGLING_END = frozenset(
    "the a an and or but nor because although unless whereas while my your its our their which whose than if".split()
)
DANGLING_START = frozenset("of which whose whom than nor".split())

MAX_CUT_RUN = 12        # a single cut longer than this joins distant material
WARN_CUT_RUN = 8
MAX_INSERTED = 2
MAX_GRAMMAR = 2
MIN_COVERAGE = 0.6
LONG_QUOTE = 220
MAX_QUOTE = 360


def neg_class(w: str) -> Optional[str]:
    if w in ("not", "cannot") or w.endswith("n't"):
        return "not"
    if w in NEG_ALONE:
        return w
    return None


def neg_signature(ws: Sequence[str]) -> Counter:
    c: Counter = Counter()
    for w in ws:
        k = neg_class(w)
        if k:
            c[k] += 1
    return c


# --------------------------------------------------------------------------- the source


class SourceIndex:
    """A transcript, tokenised once, with the lookups the aligner and the guards need."""

    def __init__(self, text: str, hyphen_turns: bool = False, teaser_end: int = 0):
        self.text = text
        self.toks = tokenize(text)
        self.w = [t.w for t in self.toks]
        self.brackets = bracket_ranges(text)
        self._grams: Dict[int, Dict[tuple, List[int]]] = {}
        self._norm: Optional[str] = None
        self._loose: Optional[str] = None
        # Where the speaker changes: ">>" always, and a hyphen that starts a caption line when the track is an uploader's.
        self.hyphen_turns = hyphen_turns
        turn = _TURN_HYPHEN if hyphen_turns else _TURN_CHEVRON
        for t in self.toks:
            t.turn = bool(turn.search(t.after))
        # The first words of a long video are often a teaser of what is said later. Words before this index are
        # the opening; when a line is said there and again further on, the later one is the one a link should land on.
        self.teaser_end = teaser_end
        ends = sum(1 for i in range(len(self.toks)) if _punct_end(self.toks, i))
        # Machine tracks without punctuation have no sentence ends worth the name.
        self.punctuated = bool(self.toks) and ends / len(self.toks) > 0.01

    @classmethod
    def from_raw(cls, raw: str, hyphen_turns: bool = False) -> "SourceIndex":
        return cls(strip_transcript(raw), hyphen_turns=hyphen_turns)

    def grams(self, k: int) -> Dict[tuple, List[int]]:
        g = self._grams.get(k)
        if g is None:
            g = {}
            w = self.w
            for i in range(len(w) - k + 1):
                g.setdefault(tuple(w[i:i + k]), []).append(i)
            self._grams[k] = g
        return g

    def in_brackets(self, i: int) -> bool:
        t = self.toks[i]
        return any(a <= t.start and t.end <= b for a, b in self.brackets)

    @property
    def norm_text(self) -> str:
        if self._norm is None:
            self._norm = norm(self.text)
        return self._norm

    @property
    def loose_text(self) -> str:
        if self._loose is None:
            self._loose = self.norm_text.lower()
        return self._loose

    def span_text(self, a: int, b: int, closing: bool = False) -> str:
        """The transcript from word a to word b-1; with closing=True, up to the space after the last word,
        so that a full stop or a closing quotation mark stays with it."""
        if not self.toks or a >= b:
            return ""
        end = self.toks[b - 1].end
        if closing:
            end += len(re.match(r"\S*", self.toks[b - 1].after).group(0))
        return re.sub(r"\s+", " ", self.text[self.toks[a].start:end]).strip()

    def words_text(self, idxs: Sequence[int]) -> str:
        return surface(self.text, self.toks, idxs)


# --------------------------------------------------------------------------- alignment

# Costs. What the alignment must never do is explain away a quote's own words: start late and call its first
# words "added", or pair them with a filler that happens to stand beside the rest. So a word matched exactly
# earns a lot, a word with no counterpart (added) costs more than a word replaced, and a word skipped is cheapest:
# the honest reading of "We think, um, you know, that this" is three cuts, not two replacements.
C_MATCH, C_SUB, C_DEL, C_INS = -3000, 1500, 1000, 2500
C_DEL_CHEAP = 100   # the pass that looks for a join of two distant stretches


@dataclass
class Alignment:
    ops: List[Tuple[str, int, int]]   # ("M"|"S"|"D"|"I", candidate index or -1, source index or -1)
    start: int                        # first and one-past-last source word of the span
    end: int
    cost: int
    matched: int
    cand_len: int
    repeats: List[int] = field(default_factory=list)  # where else the same words are said (first source word of each)

    @property
    def coverage(self) -> float:
        return self.matched / self.cand_len if self.cand_len else 0.0


def _dp(c: Sequence[str], s: Sequence[str], lo: int, hi: int, c_del: int = C_DEL) -> Optional[Alignment]:
    """Best alignment of all of c against some stretch of s[lo:hi]; words of s outside the stretch are free."""
    m, n = len(c), hi - lo
    if m == 0 or n <= 0:
        return None
    prev = [0] * (n + 1)
    bp = [bytearray(n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        ci = c[i - 1]
        cur = [0] * (n + 1)
        row = bp[i]
        cur[0] = prev[0] + C_INS
        row[0] = 2
        for j in range(1, n + 1):
            diag = prev[j - 1] + (C_MATCH if ci == s[lo + j - 1] else C_SUB)
            dele = cur[j - 1] + c_del
            ins = prev[j] + C_INS
            if diag <= dele and diag <= ins:
                cur[j] = diag
                row[j] = 0
            elif dele <= ins:
                cur[j] = dele
                row[j] = 1
            else:
                cur[j] = ins
                row[j] = 2
        prev = cur
    jbest = min(range(n + 1), key=lambda j: (prev[j], j))
    cost = prev[jbest]
    ops: List[Tuple[str, int, int]] = []
    i, j = m, jbest
    while i > 0:
        step = bp[i][j]
        if step == 0:
            same = c[i - 1] == s[lo + j - 1]
            ops.append(("M" if same else "S", i - 1, lo + j - 1))
            i -= 1
            j -= 1
        elif step == 1:
            ops.append(("D", -1, lo + j - 1))
            j -= 1
        else:
            ops.append(("I", i - 1, -1))
            i -= 1
    ops.reverse()
    src = [o[2] for o in ops if o[2] >= 0]
    if not src:
        return None
    matched = sum(1 for o in ops if o[0] == "M")
    return Alignment(ops, min(src), max(src) + 1, cost, matched, m)


def _windows(c: Sequence[str], idx: SourceIndex, slack: int = 40, top: int = 4) -> List[Tuple[int, int, int]]:
    """Stretches of the source worth aligning against: where runs of the quote's words turn up together."""
    m, n = len(c), len(idx.w)
    for k in (3, 2):
        if m < k:
            continue
        grams = idx.grams(k)
        hits: List[Tuple[int, int]] = []
        for i in range(m - k + 1):
            pos = grams.get(tuple(c[i:i + k]))
            if pos and len(pos) <= 400:
                hits.extend((p - i, i) for p in pos)
        if not hits:
            continue
        hits.sort()
        clusters: List[List[Tuple[int, int]]] = []
        for d, i in hits:
            if clusters and d - clusters[-1][-1][0] <= m + 20:
                clusters[-1].append((d, i))
            else:
                clusters.append([(d, i)])
        scored = sorted(clusters, key=lambda cl: (-len({i for _, i in cl}), cl[0][0]))[:top]
        wins = []
        for cl in scored:
            dmin, dmax = cl[0][0], cl[-1][0]
            wins.append((max(0, dmin - slack), min(n, dmax + m + slack), len({i for _, i in cl})))
        return wins
    return []


def longest_skip(a: Alignment) -> int:
    """The longest stretch of source words an alignment steps over."""
    best = run = 0
    for op, _ci, _si in a.ops:
        run = run + 1 if op == "D" else 0
        best = max(best, run)
    return best


JOIN_REACH = 400    # how far either side of the best match the join pass looks for a second stretch
MIN_STRETCH = 3     # matched words a piece needs to be a stretch of speech and not one stray word


def stretch_sizes(a: Alignment) -> List[int]:
    """Matched words in each piece of an alignment, where a piece ends at every skip longer than a cut may be."""
    sizes: List[int] = []
    matched = run = 0
    for op, _ci, _si in a.ops:
        if op == "D":
            run += 1
            continue
        if run > MAX_CUT_RUN:
            sizes.append(matched)
            matched = 0
        run = 0
        if op == "M":
            matched += 1
    sizes.append(matched)
    return sizes


def is_join(a: Alignment) -> bool:
    """Is this alignment two real stretches of speech with a long skip between them? A name the caption misspelt
    here and spelt right elsewhere also lines up with far-off words, but those are single words, not stretches."""
    sizes = stretch_sizes(a)
    return len(sizes) >= 2 and all(s >= MIN_STRETCH for s in sizes)


def align(c: Sequence[str], idx: SourceIndex, max_full: int = 8_000_000) -> Optional[Alignment]:
    """Where in the source was this said? None when nothing in it resembles the quote.
    When the same words are said twice and nothing else tells them apart, the one after the opening wins (a teaser
    of what comes later is not where the line is said), and `repeats` lists the others."""
    if not c or not idx.w:
        return None
    best: Optional[Alignment] = None
    best_key = None
    found: List[Alignment] = []
    for lo, hi, support in _windows(c, idx):
        a = _dp(c, idx.w, lo, hi)
        if a is None:
            continue
        found.append(a)
        key = (a.cost, -support, a.start < idx.teaser_end, a.start)
        if best is None or key < best_key:
            best, best_key = a, key
    if best is not None:
        slack = C_SUB - C_MATCH  # one word different counts as the same words said again
        best.repeats = sorted(
            {a.start for a in found if a is not best and a.coverage >= MIN_COVERAGE and a.cost <= best.cost + slack
             and (a.end <= best.start or a.start >= best.end)}
        )
    if (best is None or best.coverage < MIN_COVERAGE) and len(c) * len(idx.w) <= max_full:
        full = _dp(c, idx.w, 0, len(idx.w))
        if full is not None and (best is None or full.cost < best.cost):
            best = full
    # A quote made of two stretches far apart ("joining distant sentences") aligns badly, because
    # skipping twenty words costs more than swapping four. With skipping made cheap the join shows.
    if best is not None and best.matched < best.cand_len:
        lo, hi = max(0, best.start - JOIN_REACH), min(len(idx.w), best.end + JOIN_REACH)
        joined = _dp(c, idx.w, lo, hi, c_del=C_DEL_CHEAP)
        if joined is not None and joined.matched >= best.matched + 2 and longest_skip(joined) > MAX_CUT_RUN and is_join(joined):
            return joined
    return best


# --------------------------------------------------------------------------- runs and edits


@dataclass
class Run:
    f: List[int] = field(default_factory=list)  # source words removed or replaced
    t: List[int] = field(default_factory=list)  # quote words added or replacing


def runs_from_ops(ops: Sequence[Tuple[str, int, int]]) -> List[Run]:
    runs: List[Run] = []
    cur: Optional[Run] = None
    for op, ci, si in ops:
        if op == "M":
            cur = None
            continue
        if cur is None:
            cur = Run()
            runs.append(cur)
        if op in ("S", "D"):
            cur.f.append(si)
        if op in ("S", "I"):
            cur.t.append(ci)
    return runs


KINDS = ("cut", "respell", "insert", "case", "punct")


@dataclass
class Edit:
    kind: str
    frm: str = ""
    to: str = ""
    why: str = ""
    count: int = 1
    f: Tuple[str, ...] = ()
    t: Tuple[str, ...] = ()
    cosmetic: bool = False

    def as_dict(self) -> dict:
        d = {"kind": self.kind}
        if self.frm:
            d["from"] = self.frm
        if self.to:
            d["to"] = self.to
        if self.why:
            d["why"] = self.why
        if self.count != 1:
            d["count"] = self.count
        return d


def parse_edits(raw: object, errors: List[str]) -> List[Edit]:
    """Read the declared edits. Mistakes in the declaration itself go into `errors`."""
    out: List[Edit] = []
    if raw is None:
        return out
    if not isinstance(raw, list):
        errors.append("edits must be a list of {kind, from, to} objects")
        return out
    for n, item in enumerate(raw, 1):
        label = f"edit {n}"
        if not isinstance(item, dict):
            errors.append(f"{label}: not an object")
            continue
        kind = item.get("kind")
        if kind not in KINDS:
            errors.append(f"{label}: kind must be one of {', '.join(KINDS)}, got {kind!r}")
            continue
        frm, to = str(item.get("from") or ""), str(item.get("to") or "")
        why = str(item.get("why") or "").strip()
        try:
            count = int(item.get("count", 1))
        except (TypeError, ValueError):
            count = 0
        if count < 1:
            errors.append(f"{label}: count must be a whole number of 1 or more")
            continue
        f, t = tuple(words(frm)), tuple(words(to))
        if kind in ("case", "punct"):
            if f != t:
                errors.append(f"{label}: declared as {kind} but the words differ ({frm!r} to {to!r}); that is a respell")
                continue
            out.append(Edit(kind, frm, to, why, count, f, t, True))
            continue
        if kind == "cut" and (not f or t):
            errors.append(f"{label}: a cut names the words taken out in `from` and has no `to`; a replacement is a respell")
            continue
        if kind == "insert" and (f or not t):
            errors.append(f"{label}: an insert names the added words in `to` and has no `from`")
            continue
        if kind == "respell" and (not f or not t):
            errors.append(f"{label}: a respell needs both `from` and `to`")
            continue
        # Context words that only repeat on both sides say nothing about the change.
        while f and t and f[0] == t[0]:
            f, t = f[1:], t[1:]
        while f and t and f[-1] == t[-1]:
            f, t = f[:-1], t[:-1]
        out.append(Edit(kind, frm, to, why, count, f, t, not f and not t))
    return out


# --------------------------------------------------------------------------- the verdict on one quote


@dataclass
class Used:
    edit: Edit
    f_idx: List[int]
    t_idx: List[int]
    category: str = ""
    label: str = ""
    from_surface: str = ""
    to_surface: str = ""


@dataclass
class Analysis:
    text: str
    ctoks: List[Tok] = field(default_factory=list)
    alignment: Optional[Alignment] = None
    runs: List[Run] = field(default_factory=list)
    used: List[Used] = field(default_factory=list)
    unexplained: List[Run] = field(default_factory=list)
    unused: List[Edit] = field(default_factory=list)
    declared: List[Edit] = field(default_factory=list)
    suggested: List[dict] = field(default_factory=list)
    fails: List[str] = field(default_factory=list)
    warns: List[str] = field(default_factory=list)
    state: str = "MISSING"
    span_text: str = ""
    tidied: bool = False
    nearest: str = ""
    ack_used: bool = False
    ack: str = ""
    edges: List[Tuple[str, str]] = field(default_factory=list)  # ("starts after" | "stops before", the words)
    trimmed: List[Tuple[str, str]] = field(default_factory=list)  # ("opening" | "closing", a filler or connective left outside the quote)
    interjections: List[str] = field(default_factory=list)  # a short remark by the other speaker, cut, with the same person carrying on

    @property
    def start(self) -> Optional[int]:
        return self.alignment.start if self.alignment else None

    @property
    def end(self) -> Optional[int]:
        return self.alignment.end if self.alignment else None

    @property
    def ok(self) -> bool:
        return not self.fails


def _sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def _squash(ws: Sequence[str]) -> str:
    return re.sub(r"[^\w]", "", "".join(ws))


def pair_run(F: Sequence[str], T: Sequence[str]) -> List[Tuple[List[int], List[int]]]:
    """Pair the words a run removed with the words it added, by spelling. Returns (f positions, t positions)
    pieces in order; a piece with no t is a cut, one with no f an insert, one with both a respell."""
    a, b = len(F), len(T)
    GAP = 0.9
    INF = 1e9
    dp = [[INF] * (b + 1) for _ in range(a + 1)]
    back: List[List[Optional[Tuple[int, int]]]] = [[None] * (b + 1) for _ in range(a + 1)]
    dp[0][0] = 0.0
    for i in range(a + 1):
        for j in range(b + 1):
            cur = dp[i][j]
            if cur >= INF:
                continue
            moves = []
            if i < a:
                moves.append((i + 1, j, GAP))
            if j < b:
                moves.append((i, j + 1, GAP))
            if i < a and j < b:
                moves.append((i + 1, j + 1, 1.0 - _sim(F[i], T[j])))
            if i + 1 < a and j < b:
                g = _sim(_squash(F[i:i + 2]), _squash(T[j:j + 1]))
                if g >= 0.7:
                    moves.append((i + 2, j + 1, 1.05 - g))
            if i < a and j + 1 < b:
                g = _sim(_squash(F[i:i + 1]), _squash(T[j:j + 2]))
                if g >= 0.7:
                    moves.append((i + 1, j + 2, 1.05 - g))
            for ni, nj, cost in moves:
                if cur + cost < dp[ni][nj] - 1e-9:
                    dp[ni][nj] = cur + cost
                    back[ni][nj] = (i, j)
    pieces: List[Tuple[List[int], List[int]]] = []
    i, j = a, b
    while (i, j) != (0, 0):
        pi, pj = back[i][j]
        pieces.append((list(range(pi, i)), list(range(pj, j))))
        i, j = pi, pj
    pieces.reverse()
    return pieces


def _split_cut(ws: Sequence[str], offset: int = 0) -> List[List[int]]:
    """Split a run of cut words into the pieces a person would name: each filler on its own, the rest together."""
    pieces: List[List[int]] = []
    i, rest = 0, []
    def flush():
        nonlocal rest
        if rest:
            pieces.append(rest)
            rest = []
    while i < len(ws):
        if ws[i] in DISFLUENCY:
            flush()
            pieces.append([offset + i])
            i += 1
        elif tuple(ws[i:i + 2]) in FILLER_PAIRS:
            flush()
            pieces.append([offset + i, offset + i + 1])
            i += 2
        else:
            rest.append(offset + i)
            i += 1
    flush()
    return pieces


def suggest_edits(idx: SourceIndex, ctoks: Sequence[Tok], runs: Sequence[Run], text: str) -> List[dict]:
    """The edits that explain every difference, as declarations ready to paste into a candidate."""
    found: List[Tuple[str, str, str]] = []
    for run in runs:
        F = [idx.w[i] for i in run.f]
        T = [ctoks[i].w for i in run.t]
        cut_buf: List[int] = []

        def flush():
            if not cut_buf:
                return
            for piece in _split_cut([F[p] for p in cut_buf]):
                found.append(("cut", idx.words_text([run.f[cut_buf[q]] for q in piece]), ""))
            cut_buf.clear()

        for fp, tp in pair_run(F, T):
            if fp and tp:
                flush()
                found.append(("respell", idx.words_text([run.f[p] for p in fp]), surface(text, ctoks, [run.t[p] for p in tp])))
            elif fp:
                cut_buf.extend(fp)
            else:
                flush()
                found.append(("insert", "", surface(text, ctoks, [run.t[p] for p in tp])))
        flush()
    counts = Counter(found)
    seen: Set[Tuple[str, str, str]] = set()
    out: List[dict] = []
    for item in found:
        if item in seen:
            continue
        seen.add(item)
        kind, frm, to = item
        d: dict = {"kind": kind}
        if frm:
            d["from"] = frm
        if to:
            d["to"] = to
        if counts[item] > 1:
            d["count"] = counts[item]
        out.append(d)
    return out


def _explain_run(F: Sequence[str], T: Sequence[str], atoms: Sequence[Edit], remaining: Tuple[int, ...], budget: List[int]):
    """Every way to tile the run's removed and added words with the declared edits.
    Yields ([(edit index, start in F, start in T)], what is left of each edit's count)."""
    def rec(fi: int, ti: int, used: list, rem: Tuple[int, ...], saw_cut: bool, saw_ins: bool):
        if fi == len(F) and ti == len(T):
            yield used, rem
            return
        budget[0] -= 1
        if budget[0] < 0:
            return
        for k, a in enumerate(atoms):
            if rem[k] <= 0 or a.cosmetic:
                continue
            lf, lt = len(a.f), len(a.t)
            if tuple(F[fi:fi + lf]) != a.f or tuple(T[ti:ti + lt]) != a.t:
                continue
            is_cut, is_ins = lf > 0 and lt == 0, lt > 0 and lf == 0
            # A cut and an insert side by side are a replacement in disguise; it has to be declared as one.
            if (is_cut and saw_ins) or (is_ins and saw_cut):
                continue
            rem2 = rem[:k] + (rem[k] - 1,) + rem[k + 1:]
            yield from rec(fi + lf, ti + lt, used + [(k, fi, ti)], rem2, saw_cut or is_cut, saw_ins or is_ins)
    yield from rec(0, 0, [], remaining, False, False)


def _solve(runs_ft: Sequence[Tuple[List[str], List[str]]], atoms: Sequence[Edit]):
    """Explain all the runs at once if that can be done (a list per run), else None."""
    results: list = [None] * len(runs_ft)
    budget = [20000]

    def rec(r: int, rem: Tuple[int, ...]) -> bool:
        if r == len(runs_ft):
            return True
        F, T = runs_ft[r]
        for used, rem2 in _explain_run(F, T, atoms, rem, budget):
            results[r] = used
            if rec(r + 1, rem2):
                return True
        results[r] = None
        return False

    return results if rec(0, tuple(a.count for a in atoms)) else None


def _greedy(runs_ft: Sequence[Tuple[List[str], List[str]]], atoms: Sequence[Edit]):
    """As many runs explained as can be, one after the other; None for a run nothing declared explains."""
    rem = tuple(a.count for a in atoms)
    budget = [20000]
    results: list = []
    for F, T in runs_ft:
        got = None
        for used, rem2 in _explain_run(F, T, atoms, rem, budget):
            got, rem = used, rem2
            break
        results.append(got)
    return results


def _is_repetition(idx: SourceIndex, f_abs: Sequence[int]) -> bool:
    F = [idx.w[i] for i in f_abs]
    n = len(F)
    first, last = f_abs[0], f_abs[-1]
    before = idx.w[max(0, first - n):first]
    after = idx.w[last + 1:last + 1 + n]
    if before == F or after == F:
        return True
    # a stutter that breaks off inside a word: "the bottle- the bottleneck"
    if len(after) == n and all(a.startswith(f) for f, a in zip(F, after)):
        return True
    return False


def _flank(idx: SourceIndex, f_abs: Sequence[int]) -> bool:
    """Is the cut set off the way a filler is on the page: it opens a sentence, or a comma, a dash or a full
    stop stands on both sides of it? A comma on one side only is how a clause ends ("if it is done well, you
    get ..."), and the word before that comma is part of what was said."""
    first, last = f_abs[0], f_abs[-1]
    if first == 0 or ends_sentence(idx.toks, first - 1):
        return True
    before = bool(re.search(r"[,;:—–-]", idx.toks[first - 1].after))
    after = bool(re.search(r"[,;:—–.?!…-]", idx.toks[last].after))
    return before and after


def cut_category(idx: SourceIndex, f_abs: Sequence[int]) -> str:
    F = [idx.w[i] for i in f_abs]
    if all(idx.in_brackets(i) for i in f_abs):
        return "annotation"
    if _is_repetition(idx, f_abs):
        return "repetition"
    flank = _flank(idx, f_abs)
    i = 0
    ok = True
    while i < len(F):
        if F[i] in DISFLUENCY:
            i += 1
        elif tuple(F[i:i + 2]) in FILLER_PAIRS and flank:
            i += 2
        elif F[i] == "like" and bool(re.search(r"[,;:—–.?!…]", idx.toks[f_abs[i]].after)) and _flank(idx, [f_abs[i]]):
            i += 1  # ", like, " is a filler; "if you like, you can" is a verb
        else:
            ok = False
            break
    if ok:
        return "disfluency"
    if len(F) <= 3 and all(w in DISCOURSE for w in F) and flank:
        return "discourse"
    return "other"


def _typo_distance(a: str, b: str) -> int:
    """Edit distance counting a swap of two neighbouring letters as one edit."""
    la, lb = len(a), len(b)
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[la][lb]


_INFLECTIONS = ("s", "es", "ed", "d", "ing", "er", "ers", "est", "ly", "'s")


def _inflection_of(a: str, b: str) -> bool:
    """Is one word the other plus an ending (result, results; scale, scaled)? Those are different words, not typos."""
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return long_.startswith(short) and long_[len(short):] in _INFLECTIONS


def _spelled_as_a_name(to_surface: str, text: str) -> bool:
    """Is the word found in this text, and only ever with a capital letter? A name is (Waymo); a plain word is
    sometimes written without one (large), so finding it proves nothing."""
    if not text or not to_surface.split() or not re.search(r"[^\W\d_]", to_surface):
        return False
    pat = re.compile(r"(?<![\w])" + r"\s+".join(re.escape(p) for p in to_surface.split()) + r"(?![\w])", re.I)
    found = [m.group(0) for m in pat.finditer(text)]
    return bool(found) and all(all(w[0].isupper() for w in hit.split() if w[0].isalpha()) for hit in found)


def _figures(squashed: str) -> str:
    """The digits of a word or phrase, in order: what a figure is, whatever the letters around it."""
    return "".join(re.findall(r"\d", squashed))


def respell_class(f: Sequence[str], t: Sequence[str], to_surface: str, why: str, description: str, outside: str) -> str:
    """Why a respelling may stand, or "swap" when it may not.
    spacing / proven-description / proven-transcript / grammar-slip / typo-claimed / grammar-claimed / name-claimed,
    or "typo-unproven" for a word a letter or two off that nothing says the caption misspelt."""
    sf, st = _squash(f), _squash(t)
    if sf == st:
        return "spacing"
    similar = _sim(sf.lower(), st.lower())
    digits = bool(re.search(r"\d", sf + st))
    # A figure is never respelled: 100 and 10 are two numbers, and no reason makes one of them the other. Only the
    # letters around the same digits may change (GBT3 and GPT-3).
    figures_change = _figures(sf) != _figures(st)
    if not digits and len(f) == 1 and len(t) == 1 and _inflection_of(f[0], t[0]) and (f[0], t[0]) not in GRAMMAR_PAIRS:
        return "swap"  # result and results are two words; a name found elsewhere does not prove a plural away
    if similar >= 0.4 and not digits:
        # A name the caption misheard: the right spelling is in the description or elsewhere in the transcript.
        if _spelled_as_a_name(to_surface, description):
            return "proven-description"
        if _spelled_as_a_name(to_surface, outside):
            return "proven-transcript"
    if not digits and len(f) == 1 and len(t) == 1 and (f[0], t[0]) in GRAMMAR_PAIRS:
        return "grammar-slip"
    if not digits and len(f) == 1 and len(t) == 1 and _inflection_of(f[0], t[0]):
        return "swap"
    w = why.lower().strip()
    # A typo, not another word: a letter or two off in a word long enough that the right one is not in doubt. But
    # causal and casual, quiet and quite, stable and stale are one or two letters apart and are different words, and
    # nothing in the text says which one the speaker said. So a typo is accepted on the editor's word, with the
    # reason (how it was confirmed) written into the note.
    shorter = min(len(sf), len(st))
    if not digits and shorter >= 5 and _typo_distance(sf.lower(), st.lower()) <= (1 if shorter < 8 else 2):
        return "typo-claimed" if w.startswith(("typo", "spelling", "misspell")) else "typo-unproven"
    if not digits and w.startswith("grammar") and len(f) <= 2 and len(t) <= 2 and similar >= 0.4:
        return "grammar-claimed"
    if w.startswith("name") and re.search(r"[A-Z0-9]", to_surface) and similar >= 0.6 and not figures_change:
        return "name-claimed"
    return "swap"


# --------------------------------------------------------------------------- shape of the text itself

_EM_DASH = re.compile(r"[—―]|(?<=\s)--(?=\s)")
_TIMESTAMP = re.compile(r"\[\s*\d{1,2}:\d{2}|^\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}:\d{2}\b")
_ANNOTATION = re.compile(r"\[[^\]\n]{1,40}\]")
_LEAD = re.compile(r"^(?:and|so|but|well|yeah|okay|ok|right|um|uh)\b[ ,]", re.I)


def shape_issues(text: str, author: str = "", flagged: bool = False) -> Tuple[List[str], List[str]]:
    """What a quote must look like to be pasted into writing as it stands. Returns (fails, warns)."""
    fails: List[str] = []
    warns: List[str] = []
    t = text.strip()
    if _TIMESTAMP.search(t):
        fails.append("the text carries a timestamp; the time belongs in the link and the locator, never in the quote")
    if _ANNOTATION.search(t):
        fails.append("the text carries a caption annotation such as [laughter]; take it out and declare it as a cut")
    if re.match(r"^(?:>>|-\s)", t):
        fails.append("the text starts with a speaker-change mark (>> or -); it is not part of the words")
    elif ">>" in t or re.search(r"[.?!…][\"'”’)\]]*\s+-\s", t):
        fails.append("the text carries a speaker-change mark (>> or a hyphen starting a caption line): a quote is one speaker's words, never two")
    if t and ((t[0] in "\"'“‘" and t[-1] in "\"'”’") or t.startswith("“")):
        fails.append("the text is wrapped in quotation marks; store the words only")
    first = (author or "").split()[0] if author else ""
    if first and re.match(r"^" + re.escape(first) + r"\s*:", t, re.I):
        fails.append("the text starts with a speaker label; the author field holds the name")
    if len(t) > MAX_QUOTE:
        fails.append(f"{len(t)} characters is too long to paste into writing (limit {MAX_QUOTE}); trim to one or two sentences")
    elif len(t) > LONG_QUOTE and not flagged:
        warns.append(f"{len(t)} characters; a line over {LONG_QUOTE} has to be flagged on the card as a main point that needs the room")
    if t and t[0].isalpha() and t[0].islower():
        warns.append("starts with a lower-case letter; capitalise it unless it truly starts mid-sentence")
    if t and t[-1] not in ".?!…\"'”’)":
        warns.append("does not end with a full stop, question mark or exclamation mark")
    ws = words(t)
    if ws and ws[-1] in DANGLING_END:
        fails.append(f"ends on {ws[-1]!r}: the quote stops in the middle of a phrase; end it where the thought ends")
    if ws and ws[0] in DANGLING_START:
        fails.append(f"starts on {ws[0]!r}: the quote begins in the middle of a phrase; start it where the thought starts")
    if _LEAD.match(t):
        warns.append("starts with a connective (and, so, but, well): drop it if nothing is lost")
    if "…" in t or "..." in t:
        warns.append("contains an ellipsis; a quote is one stretch of speech, never two joined")
    return fails, warns


# --------------------------------------------------------------------------- the whole check


def _lead_in(idx: SourceIndex, start: int, limit: int = 25) -> List[int]:
    """Words before the span in the same sentence. A caption annotation ([music]) is not a word."""
    i = start - 1
    while i >= 0 and idx.in_brackets(i):
        i -= 1
    if i < 0 or ends_sentence(idx.toks, i):
        return []
    out: List[int] = []
    while i >= 0 and len(out) < limit:
        if ends_sentence(idx.toks, i):
            break
        if not idx.in_brackets(i):
            out.append(i)
        i -= 1
    out.reverse()
    return out


def _trail(idx: SourceIndex, end: int, limit: int = 25) -> List[int]:
    """Words after the span up to the end of the sentence."""
    last = end - 1
    while last >= 0 and idx.in_brackets(last):
        last -= 1
    if end >= len(idx.toks) or ends_sentence(idx.toks, last):
        return []
    out: List[int] = []
    i = end
    while i < len(idx.toks) and len(out) < limit:
        if not idx.in_brackets(i):
            out.append(i)
        if ends_sentence(idx.toks, i):
            break
        i += 1
    return out


def _differs_in_style(an: Analysis, idx: SourceIndex) -> bool:
    """Do the words the quote kept differ from the transcript's in case, quote marks or the punctuation between them?"""
    ops = an.alignment.ops if an.alignment else []
    for k, (op, ci, si) in enumerate(ops):
        if op != "M":
            continue
        if norm(an.ctoks[ci].raw) != norm(idx.toks[si].raw):
            return True
        if k + 1 < len(ops):
            op2, ci2, si2 = ops[k + 1]
            if op2 == "M" and ci2 == ci + 1 and si2 == si + 1:
                if norm(an.ctoks[ci].after) != norm(idx.toks[si].after):
                    return True
    return False


FILLER_WORDS = DISFLUENCY | DISCOURSE | frozenset({"you", "know", "i", "mean", "see", "like"})


def _only_fillers(ws: Sequence[str], first_words: Sequence[str] = ()) -> bool:
    """Words that lose nothing when a quote starts or stops after or before them: fillers, and a stutter
    that only repeats the quote's own first words ("the the bottleneck")."""
    if not ws or len(ws) > 6:
        return False
    rest = [w for w in ws if w not in FILLER_WORDS]
    if not rest:
        return len(ws) <= 4
    return len(rest) <= 3 and all(i < len(first_words) and first_words[i].startswith(r) for i, r in enumerate(rest))


_CLAUSE_BREAK = re.compile(r"[,;:—–]|\s-\s|[.?!…]")


def _clauses(idx: SourceIndex, part: Sequence[int]) -> List[List[int]]:
    """The words of part, split where the speaker paused: at commas, dashes and the like."""
    out: List[List[int]] = [[]]
    for i in part:
        out[-1].append(i)
        if _CLAUSE_BREAK.search(idx.toks[i].after):
            out.append([])
    return [c for c in out if c]


def _near_clause(idx: SourceIndex, part: Sequence[int], leading: bool) -> List[int]:
    """The words of the lead-in (or trail) that belong with the quote: the clause next to it, and the
    one beyond when that is a mere aside of three words or fewer ("..., you know, ...")."""
    cl = _clauses(idx, part)
    if not cl:
        return []
    order = list(reversed(cl)) if leading else cl
    picked = list(order[0])
    if len(picked) <= 3 and len(order) > 1:
        picked = (order[1] + picked) if leading else (picked + order[1])
    return picked[-12:] if leading else picked[:12]


def _edge_qualifiers(idx: SourceIndex, part: Sequence[int], leading: bool, at_break: bool, first_word: str = "") -> List[str]:
    """The qualifiers right beside a quote's edge: words and phrases that set how much, how often or how sure
    the claim is. `part` is the words of the sentence before the quote (leading) or after it. A qualifier counts when
    it sits in the clause beside the quote, close to the edge: at_break says the quote starts or stops at a pause
    (a comma, a dash), where a whole clause on the other side has qualifiers of its own and only a short opener
    ("Sometimes,") or a tag ("..., but only for now") still reaches the quote."""
    cl = _clauses(idx, part)
    if not cl:
        return []
    clause = [idx.w[i] for i in (cl[-1] if leading else cl[0])]
    if leading:
        if at_break and len(clause) > 4:
            return []
        pool, near, adjacent = EDGE_QUALIFIERS, clause[-6:], clause[-3:]
    else:
        if at_break:
            while clause and clause[0] in CONJUNCTIONS:
                clause = clause[1:]
            pool = TRAIL_QUALIFIERS
        else:
            pool = EDGE_QUALIFIERS
        near, adjacent = clause[:6], clause[:3]
    found = [w for w in adjacent if w in pool and w not in FRAME_WORDS]
    phrases = []
    for ph in QUALIFIER_PHRASES:
        n = len(ph)
        if any(tuple(near[i:i + n]) == ph for i in range(len(near) - n + 1)):
            phrases.append(" ".join(ph))
    inside = {w for ph in phrases for w in ph.split()}
    found = [w for w in found if w not in inside] + phrases
    if leading and adjacent and adjacent[-1] in ("about", "around") and _NUMBERISH.match(first_word):
        found.append(adjacent[-1])  # "about 5 years" is not "5 years"
    return sorted(set(found))


def _plain_lead(idx: SourceIndex, start: int, n: int = 8) -> List[int]:
    """The words just before the quote in a track without punctuation, back to where the speaker's turn began."""
    out: List[int] = []
    i = start - 1
    while i >= 0 and len(out) < n and not idx.toks[i].turn:
        out.append(i)
        i -= 1
    out.reverse()
    return out


def _plain_trail(idx: SourceIndex, end: int, n: int = 8) -> List[int]:
    """The words just after the quote in a track without punctuation, up to where the speaker's turn ends."""
    if end - 1 >= 0 and idx.toks[end - 1].turn:
        return []
    out: List[int] = []
    i = end
    while i < len(idx.toks) and len(out) < n:
        out.append(i)
        if idx.toks[i].turn:
            break
        i += 1
    return out


def _quote_words(ws: Sequence[str], limit: int = 12) -> str:
    return " ".join(ws[:limit]) + (" ..." if len(ws) > limit else "")


def analyze(
    text: str,
    idx: SourceIndex,
    edits: object = None,
    *,
    meta_text: str = "",
    derive: bool = False,
    author: str = "",
    ack: str = "",
    flagged: bool = False,
    clock=None,
) -> Analysis:
    """Everything the check says about one quote. `edits` are the declared edits (a list of dicts);
    with derive=True the edits are worked out from the alignment instead, which is how to ask
    "what would these edits be, and would they pass?". `ack` is a reason for starting or stopping
    where the sentence does not, or for a line that runs across a change of speaker: it turns those boundary
    failures into warnings and goes in the note. `clock` is a function from a transcript word to the second it is
    said (Work.seconds_at); with it the check can name the times when the same words are said twice."""
    an = Analysis(text=text, ack=ack.strip().rstrip("."))
    an.ctoks = tokenize(text)
    cw = [t.w for t in an.ctoks]
    s_fails, s_warns = shape_issues(text, author, flagged)
    an.fails += s_fails
    an.warns += s_warns
    if not cw:
        an.fails.append("the text has no words")
        return an

    errors: List[str] = []
    declared_only = parse_edits(edits, errors) if not (derive and edits is None) else []
    an.fails += [f"declared edits: {e}" for e in errors]

    al = align(cw, idx)
    an.alignment = al
    if al is None or al.coverage < MIN_COVERAGE:
        an.state = "MISSING"
        got = f"{al.matched} of {len(cw)} words" if al else "none of it"
        an.fails.append(f"MISSING from the source: {got} found together in order; do not file this wording")
        if al:
            an.nearest = idx.span_text(al.start, al.end)
        return an

    an.runs = runs_from_ops(al.ops)
    an.span_text = idx.span_text(al.start, al.end, closing=True)
    an.suggested = suggest_edits(idx, an.ctoks, an.runs, text)

    # An em dash the transcript does not have is the cleaner's own punctuation. The collection is public and its
    # words carry none: a comma or a full stop says the same.
    if len(_EM_DASH.findall(text)) > len(_EM_DASH.findall(an.span_text)):
        an.fails.append("the text has an em dash that the transcript does not have: use a comma or a full stop instead (the collection's words carry no em dashes)")

    # The same words said twice (a teaser in the opening and the real moment later): say so, and which one the link uses.
    if al.repeats and clock is not None:
        shown = []
        for i in [al.start] + list(al.repeats):
            sec = clock(i)
            if sec is not None:
                shown.append((sec, fmt_time(sec)))
        used = clock(al.start)
        if used is not None and len(shown) > 1:
            others = ", ".join(s for sec, s in sorted(shown) if s != fmt_time(used))
            an.warns.append(
                f"these words are said more than once: at {fmt_time(used)} (used for the link and the locator) and at {others}. "
                f"Check that the link goes to the one you mean."
            )

    if derive and edits is None:
        declared = parse_edits(an.suggested, [])
    else:
        declared = declared_only
    an.declared = declared

    runs_ft = [([idx.w[i] for i in r.f], [cw[i] for i in r.t]) for r in an.runs]
    results = _solve(runs_ft, declared)
    if results is None:
        results = _greedy(runs_ft, declared)

    spent = [0] * len(declared)
    for run, got in zip(an.runs, results):
        if got is None:
            an.unexplained.append(run)
            continue
        for k, fi, ti in got:
            e = declared[k]
            spent[k] += 1
            an.used.append(
                Used(e, [run.f[p] for p in range(fi, fi + len(e.f))], [run.t[p] for p in range(ti, ti + len(e.t))])
            )
    an.unused = []
    just_outside = []
    for k, e in enumerate(declared):
        if e.cosmetic or spent[k] >= e.count:
            continue
        if e.kind == "cut" and spent[k] == 0:
            n = len(e.f)
            before = idx.w[max(0, al.start - 6):al.start]
            after = idx.w[al.end:al.end + 6]
            if any(tuple(win[i:i + n]) == e.f for win in (before, after) for i in range(len(win) - n + 1)):
                just_outside.append(e)
                continue
        an.unused.append(e)
    for e in just_outside:
        an.warns.append(f"cut {e.frm!r} sits just outside the quote (the quote starts or stops beside it), so it is not an edit; you can leave it out of the edits")

    # Every difference not explained by a declared edit is a failure, said plainly.
    for run in an.unexplained:
        F = [idx.words_text([i]) for i in run.f]
        T = [an.ctoks[i].raw for i in run.t]
        fs, ts = idx.words_text(run.f), surface(text, an.ctoks, run.t)
        same = [e for e in declared if not e.cosmetic and e.f == tuple(idx.w[i] for i in run.f) and e.t == tuple(cw[i] for i in run.t)]
        if same:
            an.fails.append(
                f'edit declared fewer times than it happens: {fs!r}' + (f' to {ts!r}' if ts else '')
                + f' is declared {same[0].count} time(s) but appears again; add "count": {same[0].count + 1}'
            )
        elif F and not T and len(F) > MAX_CUT_RUN:
            an.fails.append(
                f"the quote joins two stretches of speech that are {len(F)} words apart; between them the speaker says {_quote_words(F, 14)!r}. "
                f"A quote is one stretch: choose one of the two, or take the passage whole."
            )
        elif F and not T:
            an.fails.append(
                f'undeclared cut: the transcript has {fs!r} here and the quote leaves it out. '
                f'If it is a filler, a repetition or a false start declare {{"kind":"cut","from":{fs!r}}}; otherwise put the words back.'
            )
        elif T and not F:
            an.fails.append(
                f'undeclared addition: the quote has {ts!r} where the transcript has nothing. '
                f'Words the speaker did not say cannot go in; only a small word (to, a, of) the caption demonstrably dropped may, '
                f'declared as {{"kind":"insert","to":{ts!r},"why":"..."}}.'
            )
        else:
            an.fails.append(
                f'undeclared change: the transcript says {fs!r} and the quote says {ts!r}. '
                f'A name or product the caption misheard may be respelled when the description or the transcript proves it; '
                f'anything else is a different word: put the speaker\'s back.'
            )
    for e in an.unused:
        shown = e.frm + (f" -> {e.to}" if e.to else "")
        an.fails.append(f"declared {e.kind} {shown!r} is not a difference between the transcript and the quote; take it out of the edits")
    for e in declared:
        if e.cosmetic and e.kind in ("cut", "respell", "insert"):
            an.warns.append(f"{e.kind} {e.frm!r} to {e.to!r} changes only case or punctuation; no need to declare it")

    # Judge each declared edit that was used.
    s_start, s_end = al.start, al.end
    outside = idx.text[: idx.toks[s_start].start] + " " + idx.text[idx.toks[s_end - 1].end:]
    cut_total = 0
    inserted = 0
    grammar = 0
    for u in an.used:
        e = u.edit
        u.from_surface = idx.words_text(u.f_idx)
        u.to_surface = surface(text, an.ctoks, u.t_idx)
        if e.kind == "cut":
            cut_total += len(u.f_idx)
            u.category = cut_category(idx, u.f_idx)
            F = [idx.w[i] for i in u.f_idx]
            hedge = [w for w in F if w in HEDGES]
            quant = [w for w in F if w in QUANTIFIERS]
            kept_anyway = u.category in ("repetition", "annotation")  # the words stay in the quote, or were never speech
            first_i, last_i = u.f_idx[0], u.f_idx[-1]
            whole_sentence = ends_sentence(idx.toks, first_i - 1) and ends_sentence(idx.toks, last_i)  # a whole sentence taken out
            spans_a_sentence = len(F) >= 4 and (whole_sentence or any(ends_sentence(idx.toks, i) for i in u.f_idx[:-1]))
            if len(F) > MAX_CUT_RUN:
                an.fails.append(f"cut of {len(F)} words ({_quote_words(F, 8)}): that joins distant material; quote the passage whole or choose a cleaner stretch")
            elif spans_a_sentence:
                an.fails.append(f"cut {u.from_surface!r} runs across the end of a sentence: that joins two sentences, which a quote never does")
            elif quant and not kept_anyway:
                an.fails.append(f"cut {u.from_surface!r} takes out a quantifier ({', '.join(quant)}); that changes how much the claim claims, so the words stay")
            elif hedge and not kept_anyway:
                if not e.why:
                    an.fails.append(
                        f"cut {u.from_surface!r} takes out a hedge ({', '.join(hedge)}); a hedge that changes the claim stays. "
                        f'If the claim is the same without it, say why on the edit: '
                        + json.dumps({"kind": "cut", "from": u.from_surface, "why": "the claim is the same without it"}, ensure_ascii=False)
                        + "."
                    )
                else:
                    an.warns.append(f"cut {u.from_surface!r} takes out a hedge; your reason: {e.why}")
                    u.label = e.why
            elif u.category == "other":
                if not e.why:
                    an.fails.append(
                        f'cut {u.from_surface!r} is not a filler, a repetition, an annotation or an opening connective. '
                        f'If it is one anyway (a false start, a filler the caption left unpunctuated), say so on the edit: '
                        + json.dumps({"kind": "cut", "from": u.from_surface, "why": "filler"}, ensure_ascii=False)
                        + "; otherwise keep the words."
                    )
                else:
                    an.warns.append(f"cut {u.from_surface!r} judged by you: {e.why}")
                    u.label = e.why
            if len(F) > WARN_CUT_RUN and len(F) <= MAX_CUT_RUN:
                an.warns.append(f"long cut of {len(F)} words ({_quote_words(F, 8)}); check it is a repetition or a false start and not a skipped passage")
            if u.category == "annotation":
                u.label = "caption annotation"
            elif u.category == "repetition":
                u.label = "repeated"
            elif u.category == "discourse":
                u.label = "opening connective"
        elif e.kind == "respell":
            u.category = respell_class(e.f, e.t, u.to_surface, e.why, meta_text, outside)
            if u.category == "swap":
                an.fails.append(
                    f"{u.from_surface!r} replaced by {u.to_surface!r} is a different word, not a misheard spelling. "
                    f"Only a name or product the description or the transcript proves, a typo you can vouch for, or a plain grammar slip may be respelled; "
                    f"put the speaker's word back. (A name or acronym the caption misheard and nothing proves: "
                    f'say so in "why", starting "name:". A figure is never respelled.)'
                )
            elif u.category == "typo-unproven":
                an.fails.append(
                    f"{u.from_surface!r} replaced by {u.to_surface!r} is a letter or two off, which a typo is, but it may also be another word "
                    f"(causal and casual are one letter apart), and nothing in the text says which one the speaker said. "
                    f"If the caption misspelt it, say how you know on the edit: "
                    + json.dumps({"kind": "respell", "from": u.from_surface, "to": u.to_surface, "why": "typo: the audio at m:ss says it"}, ensure_ascii=False)
                    + "; otherwise put the speaker's word back."
                )
            elif u.category == "typo-claimed":
                an.warns.append(f"typo corrected on your word: {u.from_surface!r} to {u.to_surface!r} ({e.why}); confirm the speaker says it")
                u.label = e.why
            elif u.category == "grammar-slip":
                grammar += 1
                an.warns.append(f"grammar slip corrected: {u.from_surface!r} to {u.to_surface!r}; confirm the speaker did not say it")
                u.label = "grammar slip"
            elif u.category == "grammar-claimed":
                grammar += 1
                an.warns.append(f"grammar fix claimed: {u.from_surface!r} to {u.to_surface!r} ({e.why}); confirm it is a slip of transcription")
                u.label = e.why
            elif u.category == "name-claimed":
                an.warns.append(f"name respelled on your word: {u.from_surface!r} to {u.to_surface!r} ({e.why}); confirm the speaker says it")
                u.label = e.why
            elif u.category == "proven-description":
                u.label = "per the description"
            elif u.category == "proven-transcript":
                u.label = "spelled so elsewhere in the transcript"
            elif u.category == "spacing":
                # "open AI" and "OpenAI" differ in spacing; "Repl.it" and "Replit" in the full stop inside the word.
                u.label = "spacing" if len(e.f) != len(e.t) else "punctuation inside the word"
            else:
                u.label = "spelling"
        elif e.kind == "insert":
            inserted += len(u.t_idx)
            u.category = "insert"
            heavy = [cw[i] for i in u.t_idx if cw[i] not in SMALL_WORDS]
            if heavy:
                an.fails.append(
                    f"added word {', '.join(repr(w) for w in heavy)}: a caption drops small words (to, a, of), never a word that carries meaning, "
                    f"so this may be a word the speaker did not say. Put the speaker's words back as they were, or drop the line."
                )
            if not e.why:
                u.label = "no reason given"
                an.fails.append(
                    f'added word {u.to_surface!r} has no reason. Only a small word the caption demonstrably dropped may be added; '
                    f'say how you know in "why" (the other caption track has it, the audio at m:ss has it).'
                )
            else:
                an.warns.append(f"word added: {u.to_surface!r} ({e.why}); flag it on the card")
                u.label = f"dropped by the caption: {e.why}"
    if inserted > MAX_INSERTED:
        an.fails.append(f"{inserted} words added; at most {MAX_INSERTED} dropped words may be put back in one quote")
    if grammar > MAX_GRAMMAR:
        an.fails.append(f"{grammar} grammar fixes in one quote; at most {MAX_GRAMMAR}: choose a cleaner line")

    # Words moved are words reordered.
    cuts_seen = [tuple(idx.w[i] for i in u.f_idx) for u in an.used if u.edit.kind == "cut"]
    ins_seen = [tuple(cw[i] for i in u.t_idx) for u in an.used if u.edit.kind == "insert"]
    for c_ in cuts_seen:
        if c_ in ins_seen:
            an.fails.append(f"{' '.join(c_)!r} is cut in one place and added in another: reordering is not allowed")

    span_len = s_end - s_start
    if span_len and cut_total:
        share = cut_total / span_len
        if share > 0.5:
            an.fails.append(f"{cut_total} of the {span_len} words in the stretch are cut; choose a cleaner stretch")
        elif share > 0.3:
            an.warns.append(f"{cut_total} of the {span_len} words in the stretch are cut; check the quote still reads as one thing the speaker said")

    # Negations: the dangerous class. What the speaker negated, the quote negates.
    span_w = idx.w[s_start:s_end]
    sig_s, sig_q = neg_signature(span_w), neg_signature(cw)
    if sig_s != sig_q:
        lost = sig_s - sig_q
        gained = sig_q - sig_s
        if lost:
            an.fails.append(f"a negation was dropped ({', '.join(sorted(lost.elements()))}): the quote would say the opposite. Never file this")
        if gained:
            an.fails.append(f"a negation was added ({', '.join(sorted(gained.elements()))}): the quote would say the opposite. Never file this")

    # What the sentence said before and after the quote. A quote that starts after "I think", or
    # after "he writes, quote", or stops before "not", says more flatly, or says someone else's words.
    if idx.punctuated:
        lead = _lead_in(idx, s_start)
        trail = _trail(idx, s_end)
    else:
        lead = _plain_lead(idx, s_start)
        trail = _plain_trail(idx, s_end)
    boundary_fails: List[str] = []
    if any(w in ("quote", "unquote") for w in span_w):
        boundary_fails.append("the stretch has the speaker saying 'quote': these may be someone else's words, read out; do not file them under the speaker")

    # A change of speaker inside the quote: two people's words would go in under one name, the worst attribution
    # failure there is. Machine captions mark it with ">>" and nothing else, so it is the only sign there is.
    cut_words = {i for u in an.used if u.edit.kind == "cut" for i in u.f_idx}
    turn_at = [i for i in range(s_start, s_end - 1) if idx.toks[i].turn]
    k = 0
    while k < len(turn_at):
        a = turn_at[k]
        if k + 1 < len(turn_at):
            between = list(range(a + 1, turn_at[k + 1] + 1))
            # A word or two from the other speaker, cut out, with the same person carrying on: ">> Yeah. >>".
            if len(between) <= 3 and all(i in cut_words for i in between) and any(not idx.in_brackets(i) for i in between):
                an.interjections.append(idx.words_text(between))
                k += 2
                continue
        before = idx.words_text(range(max(s_start, a - 5), a + 1))
        after = idx.words_text(range(a + 1, min(s_end, a + 7)))
        boundary_fails.append(
            f'the quote runs across a change of speaker, between "…{before}" and "{after}…". The two halves are two people\'s words, '
            f"and a quote is one speaker's: take one speaker's turn. If the other speaker only puts in a word or two "
            f'(">> Yeah. >>") and the same person carries on, cut that remark and say why on the edit; '
            f'or say in "ack" why both halves are one speaker.'
        )
        k += 1

    for name, part in (("starts", lead), ("ends", trail)):
        if not part:
            continue
        pw = [idx.w[i] for i in part]
        if _only_fillers(pw, cw if name == "starts" else ()):
            # A dropped "and so", a stutter or a closing "you know" loses nothing, so it is no failure and no
            # warning; the note still says it was left out, because every difference from the transcript is listed.
            an.trimmed.append(("opening" if name == "starts" else "closing", idx.words_text(part)))
            continue
        shown = " ".join(idx.toks[i].raw for i in part)
        where = "before" if name == "starts" else "after"
        if name == "starts":
            an.edges.append(("starts after", "…" + idx.words_text(part[-8:])))
        else:
            an.edges.append(("stops before", idx.words_text(part[:8]) + "…"))
        # Frames and negations count when they sit in the clause beside the quote, not a sentence away.
        near = _near_clause(idx, part, leading=(name == "starts")) if idx.punctuated else list(part)
        nw = [idx.w[i] for i in near]
        near_shown = " ".join(idx.toks[i].raw for i in near)
        frame = sorted({w for w in nw if w in FRAME_WORDS and w not in ("quote", "unquote")})
        negated = any(neg_class(w) for w in nw)
        if name == "starts":
            at_break = bool(_CLAUSE_BREAK.search(idx.toks[part[-1]].after))
        else:
            q_last = s_end - 1
            while q_last > s_start and idx.in_brackets(q_last):
                q_last -= 1
            at_break = bool(_CLAUSE_BREAK.search(idx.toks[q_last].after))
        qual = _edge_qualifiers(idx, part, leading=(name == "starts"), at_break=at_break, first_word=cw[0])
        if "quote" in nw or "unquote" in nw:
            boundary_fails.append(f"the words {where} the quote are {near_shown!r}: the speaker is quoting someone else here; do not file it under the speaker")
        elif negated or frame or qual:
            bits = (["a negation"] if negated else []) + ([f"a frame ({', '.join(frame)})"] if frame else []) + (
                [f"a qualifier ({', '.join(qual)})"] if qual else []
            )
            if negated:
                effect = "Without them the quote says more flatly than the speaker did or the opposite"
            elif frame:
                effect = "Without them the quote says more flatly than the speaker did"
            else:
                effect = "Without it the quote claims more than the speaker did"
            how = "Start the quote where the speaker's claim starts" if name == "starts" else "End the quote where the speaker's claim ends"
            msg = (
                f"the quote {name} mid-sentence and the words {where} it carry {' and '.join(bits)}: {near_shown!r}. "
                f"{effect}. {how}, take those words into the quote, or say why it is the same claim in \"ack\"."
            )
            if idx.punctuated:
                boundary_fails.append(msg)
            else:
                an.warns.append(msg + " (this track has no punctuation, so this is only a warning: read the words around the quote)")
        elif idx.punctuated:
            an.warns.append(f"the quote {name} mid-sentence; the sentence {'begins' if name == 'starts' else 'goes on'} {shown!r}")
        else:
            an.warns.append(
                f"the words {where} the quote are {shown!r} (this track has no punctuation); "
                f"check the quote does not {'start' if name == 'starts' else 'stop'} in the middle of a thought"
            )
    if boundary_fails:
        if ack.strip():
            an.warns += [f"{m} (acknowledged: {ack.strip()})" for m in boundary_fails]
            an.ack_used = True
        else:
            an.fails += boundary_fails

    # How closely is the text the transcript's, apart from the declared edits?
    if not an.runs:
        if norm(text) in idx.norm_text:
            an.state = "EXACT"
        elif loose(text) in idx.loose_text:
            an.state = "NORMALISED"
        else:
            an.state = "PUNCTUATION"
        an.tidied = an.state != "EXACT"
    else:
        an.state = "EDITED" if not an.unexplained and not an.unused else "UNEXPLAINED"
        an.tidied = _differs_in_style(an, idx)
    return an


# --------------------------------------------------------------------------- the note and the picture of a span


def _count_phrase(items: Sequence[Tuple[str, str]]) -> str:
    c: Counter = Counter(items)
    out = []
    for (surface, label), n in c.items():
        s = f'"{surface}"' + (f" x{n}" if n > 1 else "")
        if label:
            s += f" ({label})"
        out.append(s)
    return ", ".join(out)


def edits_sentence(an: Analysis) -> str:
    """The edit list as the verification note carries it: every edit beyond case and punctuation."""
    parts: List[str] = []
    cuts = [(u.from_surface, u.label) for u in an.used if u.edit.kind == "cut"]
    if cuts:
        parts.append("removed " + _count_phrase(cuts))
    for u in an.used:
        if u.edit.kind == "respell":
            parts.append(f'"{u.from_surface}" respelled "{u.to_surface}"' + (f" ({u.label})" if u.label else ""))
    for u in an.used:
        if u.edit.kind == "insert":
            parts.append(f'added "{u.to_surface}" ({u.label})')
    if parts:
        s = "Edits to the transcript wording: " + "; ".join(parts) + "."
    else:
        s = "No words cut, changed or added."
    if an.tidied:
        s += " Capitalisation and punctuation tidied."
    for words_ in an.interjections:
        s += f' The speaker carries on after a short remark by the other speaker ("{words_}"), which is cut.'
    for what, words_ in an.trimmed:
        s += f' The quote starts after the opening "{words_}".' if what == "opening" else f' The quote stops before the closing "{words_}".'
    for what, words_ in an.edges:
        s += f' The quote {"starts" if what == "starts after" else "stops"} mid-sentence, {"after" if what == "starts after" else "before"} "{words_}".'
    if an.ack_used and an.ack:
        s += f" Boundary kept on purpose: {an.ack}."
    return s


_EDITS_OPENERS = ("Edits to the transcript wording:", "No words cut, changed or added.")


def strip_edits_sentence(note: str) -> str:
    """A verification note without the edit list this module wrote into it, so that writing it again never stacks them."""
    cut = len(note)
    for opener in _EDITS_OPENERS:
        i = note.find(opener)
        if i != -1:
            cut = min(cut, i)
    return note[:cut].rstrip()


def render_span(an: Analysis, idx: SourceIndex) -> str:
    """The stretch of transcript the quote came from, with what the quote left out or changed marked:
    {cut words}, {old words -> new words}, {+added words}."""
    al = an.alignment
    if not al:
        return ""
    out: List[str] = []
    f_buf: List[int] = []
    t_buf: List[int] = []

    def flush():
        f = idx.words_text(f_buf) if f_buf else ""
        t = surface(an.text, an.ctoks, t_buf) if t_buf else ""
        if f.startswith("[") and out and out[-1].rstrip().endswith("["):
            out[-1] = out[-1].rstrip()[:-1].rstrip() + " "  # the annotation's own bracket, shown once inside the braces
        if f and t:
            out.append("{" + f + " -> " + t + "} ")
        elif f:
            out.append("{" + f + "} ")
        elif t:
            out.append("{+" + t + "} ")
        f_buf.clear()
        t_buf.clear()

    for op, ci, si in al.ops:
        if op == "M":
            flush()
            out.append(idx.toks[si].raw + idx.toks[si].after)
            continue
        if op in ("S", "D"):
            f_buf.append(si)
        if op in ("S", "I"):
            t_buf.append(ci)
    flush()
    return re.sub(r"\s+", " ", "".join(out)).strip()


# --------------------------------------------------------------------------- times and links


def fmt_time(seconds: float) -> str:
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse_time(s: str) -> Optional[int]:
    """m:ss or h:mm:ss to seconds."""
    m = re.fullmatch(r"\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*", s or "")
    if not m:
        return None
    h, mi, se = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return h * 3600 + mi * 60 + se


_YT = re.compile(r"(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{6,})")


def youtube_id(url: str) -> Optional[str]:
    m = _YT.search(url or "")
    return m.group(1) if m else None


def link_with_time(url: str, seconds: float) -> str:
    """The video address with the second the line starts, so a click lands on it; any other host keeps its page URL."""
    vid = youtube_id(url)
    if vid:
        return f"https://youtu.be/{vid}?t={int(seconds)}"
    return url


def url_seconds(url: str) -> Optional[int]:
    """The second a link starts at: ?t=754, &t=754s, ?t=12m34s or #t=754."""
    m = re.search(r"[?&#]t=(?:(\d+)h)?(?:(\d+)m)?(\d+)?s?(?=$|[&#])", url or "")
    if not m or not any(m.groups()):
        return None
    h, mi, se = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mi * 60 + se


def locator_seconds(locator: str) -> Optional[int]:
    m = re.search(r"(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])", locator or "")
    if not m:
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))


# --------------------------------------------------------------------------- the collection


def near_duplicates(text: str, existing: Sequence[dict], threshold: float = 0.6, min_words: int = 5, top: int = 3):
    """Lines already held that say much the same: content words in common over content words in all."""
    def content(s: str) -> Set[str]:
        return {w for w in words(s) if w not in STOP and len(w) > 2}
    a = content(text)
    if len(a) < min_words:
        return []
    scored = []
    for q in existing:
        b = content(q.get("text", ""))
        if len(b) < min_words:
            continue
        sim = len(a & b) / len(a | b)
        if sim >= threshold:
            scored.append((sim, q))
    scored.sort(key=lambda x: -x[0])
    return scored[:top]


def percentile(values: Sequence[float], p: float) -> float:
    """Nearest-rank percentile, 0 to 100."""
    if not values:
        return 0.0
    v = sorted(values)
    k = max(0, min(len(v) - 1, int(round(p / 100.0 * (len(v) - 1)))))
    return v[k]
