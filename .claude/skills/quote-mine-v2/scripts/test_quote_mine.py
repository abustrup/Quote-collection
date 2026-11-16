"""Tests for quote-mine-v2: the word alignment, the edits check, the negation guard, links and times,
and the scripts built on them. Plain unittest; nothing to install; no network.

Run from the repository root:
  python3 -m unittest discover -s .claude/skills/quote-mine-v2/scripts -p "test_*.py"
or from this folder:
  python3 -m unittest test_quote_mine

The repo's own tests are Node (tests/*.test.mjs, run by `npm test`) and test no Python, so these sit
beside the scripts they test. They build a tiny collection and a tiny fetched video in a temporary
folder; they never read or write the real data/.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import captions  # noqa: E402
import _text as T  # noqa: E402
import _timing as TM  # noqa: E402


def script(name: str) -> str:
    return str(HERE / name)


def _load_script(filename: str, modname: str):
    """A hyphen-named script imported as a module, so that its pure functions can be tested directly."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(modname, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(*args, cwd=None, input=None):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, cwd=cwd, input=input)


# --------------------------------------------------------------------------- fixtures

TALK_VTT = """WEBVTT
Kind: captions
Language: en-US

00:00:01.000 --> 00:00:04.000
So, um, I think that, you know, the
bottleneck is, uh, not the models.

00:00:04.000 --> 00:00:08.000
The bottleneck is diffusion through
the rest of the world.

00:00:08.000 --> 00:00:12.000
Whimo is expanding fast, and it's
crazy [laughter] how fast it grew.

00:00:12.000 --> 00:00:16.000
I think maybe the answer is no, but
the model can't do that yet.

00:00:16.000 --> 00:00:20.000
And um, the the bottleneck is is
verification, and that is the point.

00:00:20.000 --> 00:00:24.000
We spent $7,000 a day on agents, which
is, like, a lot of money.

00:00:24.000 --> 00:00:28.000
Toby writes, quote, "AI will not solve
everything." End quote. We disagree.

00:00:28.000 --> 00:00:32.000
We need figure out how to scale it up
and keep the lights on.
"""

ASR_VTT = """WEBVTT
Kind: captions
Language: en

00:00:00.160 --> 00:00:02.950 align:start position:0%

GBT3.5<00:00:01.280><c> was</c><00:00:01.520><c> able</c><00:00:01.760><c> to</c><00:00:02.240><c> write</c><00:00:02.399><c> a</c><00:00:02.560><c> passable</c>

00:00:02.950 --> 00:00:02.960 align:start position:0%
GBT3.5 was able to write a passable


00:00:02.960 --> 00:00:04.789 align:start position:0%
GBT3.5 was able to write a passable
limmerick<00:00:03.600><c> and</c><00:00:03.760><c> autocomplete</c><00:00:04.319><c> a</c><00:00:04.480><c> trivial</c>

00:00:04.789 --> 00:00:04.799 align:start position:0%
limmerick and autocomplete a trivial


00:00:04.799 --> 00:00:06.390 align:start position:0%
limmerick and autocomplete a trivial
Python<00:00:05.120><c> function.</c><00:00:05.600><c> But</c><00:00:05.680><c> otherwise,</c><00:00:06.080><c> it</c><00:00:06.240><c> was</c>

00:00:06.390 --> 00:00:06.400 align:start position:0%
Python function. But otherwise, it was


00:00:06.400 --> 00:00:07.749 align:start position:0%
Python function. But otherwise, it was
mostly<00:00:06.640><c> a</c><00:00:06.799><c> useless</c><00:00:07.200><c> toy.</c><00:00:07.220><c> [music]</c><00:00:07.520><c> Whereas</c>

00:00:07.749 --> 00:00:07.759 align:start position:0%
mostly a useless toy. [music] Whereas


00:00:07.759 --> 00:00:09.910 align:start position:0%
mostly a useless toy. [music] Whereas
Aster<00:00:08.240><c> can</c><00:00:08.559><c> build</c><00:00:08.880><c> whole</c><00:00:09.120><c> video</c><00:00:09.360><c> games</c><00:00:09.679><c> from</c>
"""

DESCRIPTION = "A talk on the bottleneck. Waymo is the example. Thanks to OpenAI."


def make_work(root: Path, vtt: str = TALK_VTT, kind: str = "uploader", key: str = "en-US", description: str = DESCRIPTION) -> Path:
    """A folder as captions.py leaves it, written without the network."""
    root.mkdir(parents=True, exist_ok=True)
    (root / f"source.{key}.vtt").write_text(vtt, encoding="utf-8")
    entries = captions.entries_from(captions.parse_vtt(vtt), kind, captions.Cleaner())
    captions.write_transcript(entries, [], root / "transcript.txt")
    meta = {
        "title": "Test Talk",
        "channel": "Test Channel",
        "upload_date": "2026-11-01",
        "duration": "0:32",
        "url": "https://www.youtube.com/watch?v=abcDEF12345",
        "video_id": "abcDEF12345",
        "fetched": "2026-11-15",
        "track": {"kind": kind, "key": key, "name": "English", "file": f"source.{key}.vtt"},
        "chapters": [],
        "description": description,
    }
    (root / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return root


def make_repo(root: Path) -> Path:
    (root / "assets").mkdir(parents=True)
    (root / "data").mkdir()
    (root / "assets" / "quote-core.js").write_text(
        "export const THEMES = ['technology', 'progress', 'science', 'work', 'mind'];\n"
        "export const WORK_KINDS = ['book', 'essay', 'speech', 'interview', 'document', 'other'];\n"
        "export const SUBJECTS = ['technology', 'science', 'philosophy'];\n",
        encoding="utf-8",
    )
    (root / "data" / "schema.json").write_text(
        json.dumps({"$defs": {"verification": {"properties": {"status": {"enum": ["verified", "reported", "unverified", "disputed"]}}}}}),
        encoding="utf-8",
    )
    (root / "data" / "quotes.json").write_text(
        json.dumps({"quotes": [{"id": "q_000000000001", "text": "An old line the collection already holds about nothing in particular.", "author": "Someone", "work": "Old", "source": {"kind": "curated"}}]}),
        encoding="utf-8",
    )
    (root / "data" / "works.json").write_text(
        json.dumps({"works": [{"title": "Test Talk", "author": "Test Speaker", "year": 2026, "kind": "speech", "subject": "technology"}]}), encoding="utf-8"
    )
    (root / "data" / "removed.json").write_text("[]", encoding="utf-8")
    return root


def record(text: str, **over) -> dict:
    r = {
        "text": text,
        "author": "Test Speaker",
        "work": "Test Talk",
        "workKind": "speech",
        "year": 2026,
        "source": {"kind": "curated", "url": "https://youtu.be/abcDEF12345", "locator": "Test Speaker, solo talk"},
        "themes": ["technology"],
        "tags": ["test"],
        "lang": "en",
        "verification": {"status": "reported", "note": "Read in the uploader's caption track; not checked against the audio."},
    }
    r.update(over)
    return r


SRC = T.SourceIndex.from_raw("""
So, um, I think that, you know, the bottleneck is, uh, not the models. The bottleneck is diffusion through the rest of the world.

Whimo is expanding fast, and it's crazy [laughter] how fast it grew. I think maybe the answer is no, but the model can't do that yet.
And um, the the bottleneck is is verification, and that is the point. We spent $7,000 a day on agents, which is, like, a lot of money.
Toby writes, quote, "AI will not solve everything." End quote. We disagree. We need figure out how to scale it up and keep the lights on.
""")
META = DESCRIPTION


def an(text, edits=None, **kw):
    kw.setdefault("meta_text", META)
    return T.analyze(text, SRC, edits, **kw)


# --------------------------------------------------------------------------- words, links, times


class Basics(unittest.TestCase):
    def test_words_keep_inner_apostrophes_and_drop_quoting_ones(self):
        self.assertEqual(T.words("It’s 'quoted' and don't"), ["it's", "quoted", "and", "don't"])

    def test_tokenize_positions_and_what_lies_between(self):
        text = "Hello, world. Next!"
        toks = T.tokenize(text)
        self.assertEqual([t.w for t in toks], ["hello", "world", "next"])
        self.assertEqual(text[toks[1].start:toks[1].end], "world")
        self.assertEqual(toks[0].after, ", ")
        self.assertTrue(T.ends_sentence(toks, 1))
        self.assertFalse(T.ends_sentence(toks, 0))
        self.assertTrue(T.ends_sentence(toks, 2))

    def test_a_full_stop_inside_a_number_is_not_the_end_of_a_sentence(self):
        toks = T.tokenize("GPT 3.5 is here")
        self.assertFalse(T.ends_sentence(toks, 1))

    def test_strip_transcript_removes_markers_and_chapter_headings(self):
        raw = "## Intro  (0:00)\n\n[0:00] Hello there.\n\n[0:30] More words.\n"
        out = T.strip_transcript(raw)
        self.assertNotIn("[0:00]", out)
        self.assertNotIn("Intro", out)
        self.assertIn("Hello there.", out)

    def test_identity_matches_what_the_importer_compares(self):
        self.assertEqual(T.identity("“It’s Fine!”"), T.identity("it's fine"))
        self.assertEqual(T.identity("Don't."), "don t")

    def test_fmt_time_and_parse_time(self):
        self.assertEqual(T.fmt_time(0), "0:00")
        self.assertEqual(T.fmt_time(754.9), "12:34")
        self.assertEqual(T.fmt_time(3723), "1:02:03")
        self.assertEqual(T.parse_time("12:34"), 754)
        self.assertEqual(T.parse_time("1:02:03"), 3723)
        self.assertIsNone(T.parse_time("soon"))

    def test_link_with_time_for_youtube_hosts(self):
        for url in ("https://www.youtube.com/watch?v=abcDEF12345", "https://youtu.be/abcDEF12345", "https://www.youtube.com/watch?v=abcDEF12345&t=5s&list=x", "https://youtube.com/live/abcDEF12345"):
            self.assertEqual(T.link_with_time(url, 754.6), "https://youtu.be/abcDEF12345?t=754")

    def test_other_hosts_keep_their_page_address(self):
        url = "https://www.ycombinator.com/library/VS-some-talk"
        self.assertEqual(T.link_with_time(url, 90), url)

    def test_url_and_locator_seconds(self):
        self.assertEqual(T.url_seconds("https://youtu.be/abcDEF12345?t=754"), 754)
        self.assertEqual(T.url_seconds("https://www.youtube.com/watch?v=x&t=3325s"), 3325)
        self.assertEqual(T.url_seconds("https://www.youtube.com/watch?v=x&t=1h2m3s"), 3723)
        self.assertIsNone(T.url_seconds("https://youtu.be/abcDEF12345"))
        self.assertEqual(T.locator_seconds("Gates to Klein · 31:43, on jobs"), 31 * 60 + 43)
        self.assertEqual(T.locator_seconds("Talk · 1:02:03, on x"), 3723)
        self.assertIsNone(T.locator_seconds("Light and Thread"))

    def test_percentile(self):
        self.assertEqual(T.percentile([1, 2, 3, 4, 5], 50), 3)
        self.assertEqual(T.percentile([10], 90), 10)
        self.assertEqual(T.percentile([], 50), 0.0)

    def test_neg_signature_treats_cannot_and_can_not_alike(self):
        self.assertEqual(T.neg_signature(["it", "cannot"]), T.neg_signature(["it", "can", "not"]))
        self.assertEqual(T.neg_signature(["don't"]), T.neg_signature(["do", "not"]))
        self.assertNotEqual(T.neg_signature(["never"]), T.neg_signature(["not"]))


# --------------------------------------------------------------------------- finding the words


class Alignment(unittest.TestCase):
    def test_verbatim_quote_is_found_exactly(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [])
        self.assertEqual(a.state, "EXACT")
        self.assertEqual(a.alignment.coverage, 1.0)
        self.assertEqual(SRC.span_text(a.start, a.end), "The bottleneck is diffusion through the rest of the world")
        self.assertEqual(a.fails, [])

    def test_a_cleaned_quote_is_found_wherever_it_was_said(self):
        a = an("I think maybe the answer is no, but the model can't do that yet.", [])
        self.assertEqual(a.state, "EXACT")
        self.assertEqual(a.fails, [])

    def test_case_and_punctuation_alone_change_nothing(self):
        a = an("the bottleneck is diffusion through the rest of the world", [])
        self.assertIn(a.state, ("NORMALISED", "PUNCTUATION", "EXACT"))
        self.assertEqual(a.runs, [])

    def test_a_filler_left_out_is_one_cut(self):
        a = an("We spent $7000 a day on agents, which is a lot of money.", derive=True)
        kinds = sorted((e["kind"], e.get("from"), e.get("to")) for e in a.suggested)
        self.assertEqual(kinds, [("cut", "like", None), ("respell", "7,000", "7000")])

    def test_a_missing_quote_is_missing(self):
        a = an("There is no such sentence anywhere in this video at all, really.", [])
        self.assertEqual(a.state, "MISSING")
        self.assertTrue(a.fails)

    def test_a_cut_beside_a_match_keeps_the_match(self):
        # "totally [music] desensitized": one cut and a match, not a respelling and a loss
        src = T.SourceIndex("It is true that we become totally [music] desensitized. Then more words follow here.")
        a = T.analyze("We become totally desensitized.", src, None, derive=True)
        self.assertEqual(a.suggested, [{"kind": "cut", "from": "[music]"}])
        self.assertEqual(a.alignment.coverage, 1.0)

    def test_two_distant_stretches_are_seen_as_a_join(self):
        src = T.SourceIndex(
            "The first claim is that models scale. "
            + " ".join(f"filler{i}" for i in range(40))
            + " The second claim is that data runs out."
        )
        a = T.analyze("The first claim is that models scale, the second claim is that data runs out.", src, None, derive=True)
        self.assertTrue(any("joins distant material" in f or "joins two stretches" in f for f in a.fails), a.fails)

    def test_windowed_search_agrees_with_the_full_search(self):
        rng = random.Random(7)
        vocab = [f"w{i}" for i in range(400)]
        text = " ".join(rng.choice(vocab) for _ in range(3000))
        idx = T.SourceIndex(text)
        for _ in range(12):
            a = rng.randrange(0, len(idx.w) - 40)
            span = idx.w[a:a + 25]
            cand = [w for k, w in enumerate(span) if k % 9 != 4]  # a few words left out
            fast = T.align(cand, idx)
            full = T._dp(cand, idx.w, 0, len(idx.w))
            self.assertEqual(fast.cost, full.cost)
            self.assertLessEqual(abs(fast.start - a), 1)

    def test_the_quote_alone_in_the_source(self):
        src = T.SourceIndex("Short.")
        a = T.analyze("Short.", src, [])
        self.assertEqual(a.state, "EXACT")

    def test_a_respelled_first_or_last_word_is_a_respell_and_not_an_insert(self):
        src = T.SourceIndex("Whimo is expanding and the cars are everywhere in this city, said Whimo.")
        a = T.analyze("Waymo is expanding and the cars are everywhere in this city, said Waymo.", src, None, derive=True, meta_text="Waymo")
        self.assertEqual([(e["kind"], e.get("count")) for e in a.suggested], [("respell", 2)])
        self.assertEqual(a.fails, [], a.fails)

    def test_a_long_run_of_fillers_is_cut_and_not_absorbed_by_the_quotes_first_words(self):
        src = T.SourceIndex("Well, we think, um, you know, I mean, uh, er, ah, that this is true today and tomorrow.")
        a = T.analyze("We think that this is true today and tomorrow.", src, None, derive=True)
        self.assertEqual({e["kind"] for e in a.suggested}, {"cut"})
        self.assertEqual(a.fails, [], a.fails)

    def test_a_reordered_quote_is_not_found_in_the_source(self):
        src = T.SourceIndex("Models improve every month, and costs fall every year, so this continues for a long time.")
        a = T.analyze("Costs fall every year, and models improve every month.", src, None, derive=True)
        self.assertEqual(a.state, "MISSING")

    def test_a_word_added_at_the_start_is_an_insert_that_needs_a_reason(self):
        src = T.SourceIndex("Models improve every month, and costs fall every year, so this continues.")
        a = T.analyze("Large models improve every month, and costs fall every year.", src, None, derive=True)
        self.assertEqual([e["kind"] for e in a.suggested], ["insert"])
        self.assertTrue(any("no reason" in f for f in a.fails))


# --------------------------------------------------------------------------- the edits


class Edits(unittest.TestCase):
    def test_a_declared_filler_cut_passes(self):
        a = an("We spent $7000 a day on agents, which is a lot of money.", [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}])
        self.assertEqual(a.fails, [], a.fails)
        self.assertEqual(a.state, "EDITED")
        self.assertIn('removed "like"', T.edits_sentence(a))
        self.assertIn('"7,000" respelled "7000" (spacing)', T.edits_sentence(a))

    def test_an_undeclared_cut_fails_and_names_the_words(self):
        a = an("We spent $7,000 a day on agents, which is a lot of money.", [])
        self.assertTrue(any("undeclared cut" in f and "like" in f for f in a.fails), a.fails)

    def test_a_declared_edit_that_did_not_happen_fails(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [{"kind": "cut", "from": "zzz"}])
        self.assertTrue(any("not a difference" in f for f in a.fails), a.fails)

    def test_an_edit_that_happens_twice_has_to_be_declared_twice(self):
        src = T.SourceIndex("We need, you know, the data, you know, and more of it today.")
        text = "We need the data and more of it today."
        one = T.analyze(text, src, [{"kind": "cut", "from": "you know"}])
        self.assertTrue(one.fails)
        two = T.analyze(text, src, [{"kind": "cut", "from": "you know", "count": 2}])
        self.assertEqual(two.fails, [], two.fails)
        listed = T.analyze(text, src, [{"kind": "cut", "from": "you know"}, {"kind": "cut", "from": "you know"}])
        self.assertEqual(listed.fails, [], listed.fails)
        self.assertIn('"you know" x2', T.edits_sentence(two))

    def test_a_run_of_cuts_can_be_declared_one_by_one(self):
        src = T.SourceIndex("We think, um, you know, that this is true today and tomorrow.")
        a = T.analyze("We think that this is true today and tomorrow.", src, [{"kind": "cut", "from": "um"}, {"kind": "cut", "from": "you know"}])
        self.assertEqual(a.fails, [], a.fails)

    def test_case_and_punct_edits_are_cosmetic_and_need_not_be_declared(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [{"kind": "case", "from": "the", "to": "The"}, {"kind": "punct", "from": ",", "to": "."}])
        self.assertEqual(a.fails, [], a.fails)

    def test_a_case_edit_that_changes_a_word_is_refused(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [{"kind": "case", "from": "bottleneck", "to": "chokepoint"}])
        self.assertTrue(any("that is a respell" in f for f in a.fails), a.fails)

    def test_a_cut_with_a_replacement_is_a_respell(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [{"kind": "cut", "from": "a", "to": "b"}])
        self.assertTrue(any("respell" in f for f in a.fails), a.fails)

    def test_a_cut_and_an_insert_side_by_side_must_be_a_respell(self):
        src = T.SourceIndex("This is a big claim about the future of work. It matters.")
        a = T.analyze("This is a huge claim about the future of work.", src, [{"kind": "cut", "from": "big"}, {"kind": "insert", "to": "huge", "why": "x"}])
        self.assertTrue(a.fails)

    def test_reordering_is_refused(self):
        src = T.SourceIndex("First we build the models and then we test them carefully every day.")
        a = T.analyze("First we build the models and we then test them carefully every day.", src, None, derive=True)
        self.assertTrue(a.fails, a.suggested)

    def test_a_cut_that_is_no_filler_needs_a_reason(self):
        src = T.SourceIndex("This is the real point, which is quite important, and it matters a great deal.")
        text = "This is the real point and it matters a great deal."
        bare = T.analyze(text, src, [{"kind": "cut", "from": "which is quite important"}])
        self.assertTrue(any("not a filler" in f for f in bare.fails), bare.fails)
        said = T.analyze(text, src, [{"kind": "cut", "from": "which is quite important", "why": "an aside"}])
        self.assertEqual(said.fails, [], said.fails)
        self.assertTrue(any("judged by you" in w for w in said.warns))

    def test_a_quantifier_may_never_be_cut_even_with_a_reason(self):
        src = T.SourceIndex("The models only improve when labs spend more on compute every single year.")
        a = T.analyze("The models improve when labs spend more on compute every single year.", src, [{"kind": "cut", "from": "only", "why": "filler"}])
        self.assertTrue(any("quantifier" in f for f in a.fails), a.fails)

    def test_a_cut_may_not_run_across_the_end_of_a_sentence(self):
        src = T.SourceIndex("We build the models today. Then we test them with care. The results come in slowly over time.")
        a = T.analyze("We build the models today. The results come in slowly over time.", src, [{"kind": "cut", "from": "Then we test them with care.", "why": "filler"}])
        self.assertTrue(any("end of a sentence" in f or "joins" in f for f in a.fails), a.fails)

    def test_a_figure_is_never_a_typo(self):
        src = T.SourceIndex("We expect about 1000000 users by the end of next year, said the team.")
        a = T.analyze("We expect about 100000 users by the end of next year, said the team.", src, None, derive=True)
        self.assertTrue(any("different word" in f for f in a.fails), a.fails)

    def test_a_grammar_claim_needs_a_word_that_looks_like_the_original(self):
        src = T.SourceIndex("It is a big step for the field and for the labs that build these models.")
        a = T.analyze("It is a large step for the field and for the labs that build these models.", src, [{"kind": "respell", "from": "big", "to": "large", "why": "grammar"}])
        self.assertTrue(any("different word" in f for f in a.fails), a.fails)

    def test_a_hedge_may_not_be_cut_without_saying_why(self):
        src = T.SourceIndex("It is probably the most important thing that people get wrong.")
        a = T.analyze("It is the most important thing that people get wrong.", src, [{"kind": "cut", "from": "probably"}])
        self.assertTrue(any("hedge" in f for f in a.fails), a.fails)

    def test_a_long_cut_is_a_join(self):
        words = " ".join(f"mid{i}" for i in range(20))
        src = T.SourceIndex(f"The opening claim stands, {words}, and the closing claim stands too.")
        a = T.analyze("The opening claim stands and the closing claim stands too.", src, [{"kind": "cut", "from": words.replace(" ", ", ", 0)}])
        self.assertTrue(any("joins" in f for f in a.fails), a.fails)

    def test_a_repetition_is_a_cut_that_needs_no_reason(self):
        src = T.SourceIndex("It is, the the bottleneck is is verification and that is the whole point.")
        a = T.analyze("The bottleneck is verification and that is the whole point.", src, None, derive=True)
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(all(e["kind"] == "cut" for e in a.suggested), a.suggested)

    def test_a_word_with_a_comma_on_one_side_only_is_not_a_filler(self):
        # Found by cutting words out of real sentences: "well" is on the filler list, but in "done well, you get"
        # it is the adverb that ends its clause, so removing it changes what was said.
        src = T.SourceIndex("It turns out that if this is done well, you get very sophisticated behavior. We move on.")
        a = T.analyze("It turns out that if this is done you get very sophisticated behavior.", src, None, derive=True)
        self.assertTrue(any("not a filler" in f for f in a.fails), a.fails)
        # "like" is a verb in "if you like, you can"
        src = T.SourceIndex("If you like, you can go and read the whole report tonight. We move on.")
        b = T.analyze("If you, you can go and read the whole report tonight.", src, None, derive=True)
        self.assertTrue(any("not a filler" in f for f in b.fails), b.fails)
        # "as you know, ..." is not a filler either
        src = T.SourceIndex("As you know, the models are the bottleneck for this. We move on.")
        c = T.analyze("As, the models are the bottleneck for this.", src, None, derive=True)
        self.assertTrue(any("not a filler" in f for f in c.fails), c.fails)

    def test_a_filler_set_off_on_both_sides_or_opening_a_sentence_is_still_cut_freely(self):
        src = T.SourceIndex("The models are, you know, the bottleneck for this. Well, we move on. It is, like, a lot of money.")
        self.assertEqual(T.analyze("The models are the bottleneck for this.", src, None, derive=True).fails, [])
        self.assertEqual(T.analyze("It is a lot of money.", src, None, derive=True).fails, [])
        inside = T.SourceIndex('You could even go as far as to say, "Well, we should air gap the computers." We move on.')
        self.assertEqual(T.analyze('You could even go as far as to say, we should air gap the computers."', inside, None, derive=True).fails, [])

    def test_a_stutter_before_the_quote_is_not_an_error(self):
        a = an("The bottleneck is verification, and that is the point.", [{"kind": "cut", "from": "um"}, {"kind": "cut", "from": "the"}, {"kind": "cut", "from": "is"}])
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(any("just outside" in w for w in a.warns))

    # respelling

    def test_a_name_proven_by_the_description_may_be_respelled(self):
        a = an("Waymo is expanding fast, and it's crazy how fast it grew.", derive=True)
        self.assertEqual(a.fails, [], a.fails)
        self.assertIn('"Whimo" respelled "Waymo" (per the description)', T.edits_sentence(a))

    def test_the_same_respelling_without_proof_fails(self):
        a = an("Waymo is expanding fast, and it's crazy how fast it grew.", derive=True, meta_text="")
        self.assertTrue(any("different word" in f for f in a.fails), a.fails)

    def test_a_name_proven_elsewhere_in_the_transcript_may_be_respelled(self):
        src = T.SourceIndex("Whimo is great. Later we ride in a Waymo again. Then we leave for home.")
        a = T.analyze("Waymo is great.", src, None, derive=True, meta_text="")
        self.assertEqual(a.fails, [], a.fails)
        self.assertIn("elsewhere in the transcript", T.edits_sentence(a))

    def test_the_caption_splitting_a_name_is_only_spacing(self):
        src = T.SourceIndex("Everyone knows that open AI is a company that builds models.")
        a = T.analyze("Everyone knows that OpenAI is a company that builds models.", src, None, derive=True, meta_text="")
        self.assertEqual(a.fails, [], a.fails)
        self.assertIn("(spacing)", T.edits_sentence(a))

    def test_a_typo_in_a_long_word_may_be_corrected_when_the_editor_says_how_it_knows(self):
        # A letter or two off is a typo, but it is also how causal and casual differ: so it takes a reason.
        src = T.SourceIndex("GPT can write a passable limmerick on request, and it does so well.")
        bare = T.analyze("GPT can write a passable limerick on request, and it does so well.", src, None, derive=True, meta_text="")
        self.assertTrue(any("letter or two off" in f for f in bare.fails), bare.fails)
        said = T.analyze(
            "GPT can write a passable limerick on request, and it does so well.", src,
            [{"kind": "respell", "from": "limmerick", "to": "limerick", "why": "typo: not a word, the audio at 0:04 says limerick"}], meta_text="",
        )
        self.assertEqual(said.fails, [], said.fails)
        self.assertTrue(any("typo corrected on your word" in w for w in said.warns))
        self.assertIn('"limmerick" respelled "limerick" (typo: not a word, the audio at 0:04 says limerick)', T.edits_sentence(said))

    def test_swapping_a_word_for_a_better_one_is_refused(self):
        src = T.SourceIndex("This is an important result about progress in the field today.")
        a = T.analyze("This is a crucial result about progress in the field today.", src, None, derive=True, meta_text="")
        self.assertTrue(any("different word" in f for f in a.fails), a.fails)

    def test_changing_an_ending_is_a_different_word_not_a_typo(self):
        src = T.SourceIndex("These results show that the models improve every single month.")
        a = T.analyze("This result shows that the models improve every single month.", src, None, derive=True, meta_text="")
        self.assertTrue(any("different word" in f for f in a.fails), a.fails)

    def test_a_name_the_caption_misheard_can_be_respelled_on_the_editors_word(self):
        src = T.SourceIndex("GBT3 was able to write a passable poem for anyone who asked.")
        bare = T.analyze("GPT-3 was able to write a passable poem for anyone who asked.", src, None, derive=True, meta_text="")
        self.assertTrue(bare.fails)
        said = T.analyze("GPT-3 was able to write a passable poem for anyone who asked.", src, [{"kind": "respell", "from": "GBT3", "to": "GPT-3", "why": "name: the speaker says GPT three"}], meta_text="")
        self.assertEqual(said.fails, [], said.fails)
        self.assertTrue(any("name respelled on your word" in w for w in said.warns))

    def test_a_plain_grammar_slip_may_be_corrected_and_is_flagged(self):
        src = T.SourceIndex("It was a AI that wrote this entire essay in under a minute today.")
        a = T.analyze("It was an AI that wrote this entire essay in under a minute today.", src, None, derive=True, meta_text="")
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(any("grammar slip" in w for w in a.warns))

    # insertions

    def test_a_word_the_caption_dropped_may_be_put_back_with_a_reason(self):
        a = an("We need to figure out how to scale it up and keep the lights on.", [{"kind": "insert", "to": "to"}])
        self.assertTrue(any("no reason" in f for f in a.fails), a.fails)
        b = an("We need to figure out how to scale it up and keep the lights on.", [{"kind": "insert", "to": "to", "why": "the audio at 0:28 has it"}])
        self.assertEqual(b.fails, [], b.fails)
        self.assertIn('added "to"', T.edits_sentence(b))

    def test_a_word_that_carries_meaning_is_never_put_back_even_with_a_reason(self):
        # A caption drops "to" and "of"; it does not drop "really". A stated reason cannot make a content word one the speaker said.
        src = T.SourceIndex("I think that AI research is verifiable enough that AIs will soon be as good at it as the best humans.")
        text = "I think that AI research is really verifiable enough that AIs will soon be as good at it as the best humans."
        a = T.analyze(text, src, [{"kind": "insert", "to": "really", "why": "the caption dropped it"}])
        self.assertTrue(any("carries meaning" in f for f in a.fails), a.fails)
        # the same word undeclared is refused for the other reason, as before
        b = T.analyze(text, src, [])
        self.assertTrue(any("undeclared addition" in f for f in b.fails), b.fails)

    def test_small_words_are_the_only_ones_a_caption_may_be_said_to_drop(self):
        for word in ("to", "of", "a", "the", "that", "is", "would"):
            self.assertIn(word, T.SMALL_WORDS)
        for word in ("really", "very", "huge", "never", "billion", "AI".lower()):
            self.assertNotIn(word, T.SMALL_WORDS)

    def test_more_than_two_words_cannot_be_added(self):
        src = T.SourceIndex("We need figure out scale it up and keep the lights on tonight.")
        a = T.analyze(
            "We need to figure out how to scale it up and keep the lights on tonight.",
            src,
            [{"kind": "insert", "to": "to", "why": "w", "count": 2}, {"kind": "insert", "to": "how", "why": "w"}],
        )
        self.assertTrue(any("dropped words" in f for f in a.fails), a.fails)


# --------------------------------------------------------------------------- negation, and the words around a quote


class Negation(unittest.TestCase):
    def test_a_cut_that_drops_a_negation_is_refused(self):
        a = an("The model can do that yet.", [{"kind": "respell", "from": "can't", "to": "can"}])
        self.assertTrue(any("negation was dropped" in f for f in a.fails), a.fails)

    def test_a_negation_dropped_by_undeclared_change_is_refused(self):
        a = an("The model can do that yet.", derive=True)
        self.assertTrue(any("negation was dropped" in f for f in a.fails), a.fails)

    def test_a_negation_cannot_be_declared_away(self):
        src = T.SourceIndex("This is not the real reason for the delay we saw in the spring.")
        a = T.analyze("This is the real reason for the delay we saw in the spring.", src, [{"kind": "cut", "from": "not"}])
        self.assertTrue(any("negation was dropped" in f for f in a.fails), a.fails)

    def test_a_negation_added_is_refused(self):
        src = T.SourceIndex("This is the real reason for the delay we saw in the spring.")
        a = T.analyze("This is not the real reason for the delay we saw in the spring.", src, [{"kind": "insert", "to": "not", "why": "audio"}])
        self.assertTrue(any("negation was added" in f for f in a.fails), a.fails)

    def test_do_not_and_dont_are_the_same_negation(self):
        src = T.SourceIndex("We do not think this will happen in the next two years at all.")
        a = T.analyze("We don't think this will happen in the next two years at all.", src, None, derive=True)
        self.assertFalse(any("negation" in f for f in a.fails), a.fails)

    def test_starting_after_a_negation_in_the_same_sentence_is_refused(self):
        src = T.SourceIndex("I don't think the models are the bottleneck for this. We move on.")
        a = T.analyze("The models are the bottleneck for this.", src, [])
        self.assertTrue(any("negation" in f and "mid-sentence" in f for f in a.fails), a.fails)

    def test_stopping_before_a_negation_in_the_same_sentence_is_refused(self):
        src = T.SourceIndex("The models are the bottleneck here, I would not say otherwise. We move on.")
        a = T.analyze("The models are the bottleneck here.", src, [])
        self.assertTrue(any("negation" in f for f in a.fails), a.fails)

    def test_starting_after_a_belief_frame_is_refused(self):
        a = an("The answer is no, but the model can't do that yet.", [])
        self.assertTrue(any("frame" in f for f in a.fails), a.fails)

    def test_a_reason_for_the_edge_turns_the_failure_into_a_warning_and_goes_in_the_note(self):
        a = an("The answer is no, but the model can't do that yet.", [], ack="the clause stands alone")
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(a.ack_used)
        self.assertIn("Boundary kept on purpose: the clause stands alone.", T.edits_sentence(a))

    def test_someone_elses_quoted_words_are_not_the_speakers(self):
        a = an("AI will not solve everything.", [])
        self.assertTrue(any("quoting someone else" in f for f in a.fails), a.fails)

    def test_dropping_a_leading_and_so_loses_nothing(self):
        src = T.SourceIndex("It matters. And so the bottleneck is verification for all of us here.")
        a = T.analyze("The bottleneck is verification for all of us here.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertFalse(any("mid-sentence" in w for w in a.warns), a.warns)
        # It costs nothing, but it is still a difference from the transcript, so the note names it.
        self.assertIn('The quote starts after the opening "And so".', T.edits_sentence(a))

    def test_dropping_a_closing_you_know_is_named_in_the_note_too(self):
        src = T.SourceIndex("It matters. The bottleneck is verification for all of us here, you know. We move on.")
        a = T.analyze("The bottleneck is verification for all of us here.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertFalse(any("mid-sentence" in w for w in a.warns), a.warns)
        self.assertIn('The quote stops before the closing "you know".', T.edits_sentence(a))

    def test_a_quote_that_starts_its_sentence_has_nothing_to_name(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [])
        self.assertEqual(a.trimmed, [])
        self.assertNotIn("opening", T.edits_sentence(a))

    def test_a_quote_that_starts_a_clause_after_a_comma_is_only_a_warning(self):
        src = T.SourceIndex("As to which one will actually happen, the real answer is that it depends on the labs.")
        a = T.analyze("The real answer is that it depends on the labs.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(any("mid-sentence" in w for w in a.warns))

    def test_without_punctuation_edges_only_warn(self):
        src = T.SourceIndex("i do not think the models are the bottleneck here he said and moved on to the next topic")
        a = T.analyze("The models are the bottleneck here.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(any("no punctuation" in w for w in a.warns), a.warns)


# --------------------------------------------------------------------------- the shape of a quote, the note


class Shape(unittest.TestCase):
    def test_a_timestamp_or_annotation_in_the_text_is_refused(self):
        self.assertTrue(T.shape_issues("[0:12] The bottleneck is diffusion.")[0])
        self.assertTrue(T.shape_issues("It is [laughter] big.")[0])
        self.assertTrue(T.shape_issues(">> The bottleneck is diffusion.")[0])
        self.assertTrue(T.shape_issues("Test: the bottleneck is diffusion.", "Test Speaker")[0])

    def test_length_rules(self):
        short = "A short line that is fine."
        long_ = "Word " + ("word " * 49).strip() + "."
        too_long = ("word " * 80).strip() + "."
        self.assertEqual(T.shape_issues(short), ([], []))
        fails, warns = T.shape_issues(long_)
        self.assertEqual(fails, [])
        self.assertTrue(any("characters" in w for w in warns))
        self.assertEqual(T.shape_issues(long_, flagged=True)[1], [])
        self.assertTrue(T.shape_issues(too_long)[0])

    def test_style_warnings(self):
        fails, warns = T.shape_issues("and so the point stands")
        self.assertEqual(fails, [])
        joined = " ".join(warns)
        self.assertIn("lower-case", joined)
        self.assertIn("full stop", joined)
        self.assertIn("connective", joined)

    def test_edits_sentence_is_stable_and_can_be_stripped(self):
        a = an("We spent $7000 a day on agents, which is a lot of money.", [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}])
        sentence = T.edits_sentence(a)
        note = "Read in the caption track. " + sentence
        self.assertEqual(T.strip_edits_sentence(note), "Read in the caption track.")
        self.assertEqual(T.strip_edits_sentence(T.strip_edits_sentence(note) + " " + sentence), "Read in the caption track.")
        exact = an("The bottleneck is diffusion through the rest of the world.", [])
        self.assertTrue(T.edits_sentence(exact).startswith("No words cut, changed or added."))

    def test_the_note_says_where_a_quote_starts_or_stops_inside_its_sentence(self):
        src = T.SourceIndex("As to which one will actually happen, the real answer is that it depends on the labs, which is why it is hard to say.")
        a = T.analyze("The real answer is that it depends on the labs.", src, [])
        sentence = T.edits_sentence(a)
        self.assertIn('The quote starts mid-sentence, after "…As to which one will actually happen".', sentence)
        self.assertIn('The quote stops mid-sentence, before "which is why it is hard to say…".', sentence)

    def test_an_acknowledgement_that_nothing_needed_is_not_written_into_the_note(self):
        a = an("The bottleneck is diffusion through the rest of the world.", [], ack="not needed")
        self.assertFalse(a.ack_used)
        self.assertNotIn("Boundary kept on purpose", T.edits_sentence(a))

    def test_a_flagged_long_line_is_not_warned_about_its_length(self):
        long_text = "Word " + ("word " * 49).strip() + "."
        src = T.SourceIndex(long_text + " Next sentence here.")
        self.assertTrue(any("characters" in w for w in T.analyze(long_text, src, []).warns))
        self.assertFalse(any("characters" in w for w in T.analyze(long_text, src, [], flagged=True).warns))

    def test_near_duplicates_are_found_by_their_content_words(self):
        held = [{"id": "q_1", "text": "The bottleneck is not the progress of the AI models; it is diffusing that through the world."}]
        close = T.near_duplicates("The bottleneck is not the progress of AI models, it is diffusing that through the rest of the world.", held)
        self.assertEqual(close[0][1]["id"], "q_1")
        self.assertEqual(T.near_duplicates("Something else entirely about gardens and weather patterns today.", held), [])


# --------------------------------------------------------------------------- times from the raw track


class Timing(unittest.TestCase):
    def test_refactored_entries_equal_the_old_ones(self):
        for vtt, kind in ((TALK_VTT, "uploader"), (ASR_VTT, "asr")):
            cues = captions.parse_vtt(vtt)
            a = captions.entries_from(cues, kind, captions.Cleaner())
            b = [(s, t) for s, _e, t, _w in captions.entries_timed(cues, kind, captions.Cleaner())]
            self.assertEqual(a, b)
            self.assertTrue(a)

    def test_machine_captions_time_every_word(self):
        cues = captions.parse_vtt(ASR_VTT)
        entries = captions.entries_timed(cues, "asr", captions.Cleaner())
        words = {}
        for _s, _e, _t, wt in entries:
            for w, t in wt or []:
                words.setdefault(w, t)
        self.assertAlmostEqual(words["GBT3.5"], 0.16, places=2)
        self.assertAlmostEqual(words["was"], 1.28, places=2)
        self.assertAlmostEqual(words["Whereas"], 7.52, places=2)

    def test_work_gives_the_second_a_line_starts_and_the_link(self):
        with tempfile.TemporaryDirectory() as d:
            work = TM.load_work(str(make_work(Path(d) / "w")))
            self.assertIsNotNone(work.timed)
            self.assertEqual(work.timed.words, work.idx.w)
            a = T.analyze("The bottleneck is diffusion through the rest of the world.", work.idx, [])
            sec = work.seconds_at(a.start)
            self.assertAlmostEqual(sec, 4.0, delta=0.5)
            self.assertEqual(work.url_at(sec), "https://youtu.be/abcDEF12345?t=4")
            lines = work.lines_around(a.start, a.end, 1, 1)
            self.assertTrue(any(l["inside"] for l in lines))
            self.assertIn("raw caption track", work.timing)

    def test_word_by_word_times_for_machine_captions(self):
        with tempfile.TemporaryDirectory() as d:
            work = TM.load_work(str(make_work(Path(d) / "w", ASR_VTT, "asr", "en-orig", "A clip.")))
            a = T.analyze("Whereas Aster can build whole video games from", work.idx, None, derive=True)
            self.assertAlmostEqual(work.seconds_at(a.start), 7.52, places=2)
            self.assertIn("word by word", work.timing)

    def test_without_the_raw_track_the_block_markers_give_the_time(self):
        with tempfile.TemporaryDirectory() as d:
            root = make_work(Path(d) / "w")
            (root / "source.en-US.vtt").unlink()
            work = TM.load_work(str(root))
            self.assertEqual(work.timed.source, "markers")
            self.assertIn("30 seconds", work.timing)

    def test_an_essay_without_markers_has_no_times(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "essay.txt"
            p.write_text("Plain paragraphs of an essay.\n\nAnother paragraph here.\n", encoding="utf-8")
            work = TM.load_work(str(p))
            self.assertIsNone(work.timed)
            self.assertIsNone(work.seconds_at(0))


# --------------------------------------------------------------------------- the scripts


class Scripts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.repo = make_repo(base / "repo")
        cls.work = make_work(base / "work")
        cls.out = base / "out"
        cls.out.mkdir()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def check(self, items, source=None, *extra):
        p = self.out / "picks.json"
        p.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        return run(script("check-quotes.py"), p, source or (self.work / "transcript.txt"), "--repo", self.repo, *extra)

    # version 1, unchanged

    def test_v1_states_and_exit_codes(self):
        cases = [
            ("The bottleneck is diffusion through the rest of the world.", "EXACT", 0),
            ("the bottleneck is diffusion through the rest of the world", "NORMALISED", 0),
            ("The bottleneck is diffusion. Through the rest of the world.", "PUNCTUATION", 0),
            ("There is no such sentence anywhere in this video at all, really.", "MISSING", 1),
        ]
        for text, state, code in cases:
            r = self.check([record(text)])
            self.assertEqual(r.returncode, code, r.stdout)
            self.assertIn(state, r.stdout, r.stdout)

    def test_v1_trimmed_needs_a_note_that_says_what_was_cut(self):
        text = "The model can't do that yet."
        text = "I think maybe the answer is no, the model can't do that yet."
        bare = self.check([record(text)])
        self.assertIn("TRIMMED", bare.stdout)
        self.assertEqual(bare.returncode, 1)
        said = self.check([record(text, verification={"status": "reported", "note": "Cut: 'but'. Read in the caption track."})])
        self.assertEqual(said.returncode, 0, said.stdout)

    def test_v1_field_checks_still_fail(self):
        r = self.check([record("The bottleneck is diffusion through the rest of the world.", workKind="podcast", themes=["nonsense"], id="q_x")])
        self.assertEqual(r.returncode, 1)
        for s in ("workKind", "themes not in the controlled list", "carries an id"):
            self.assertIn(s, r.stdout)

    def test_v1_duplicate_of_a_held_line_fails(self):
        r = self.check([record("An old line the collection already holds about nothing in particular.")], source=self.out / "dup.txt") if (self.out / "dup.txt").write_text("An old line the collection already holds about nothing in particular.") else None
        self.assertIn("already in the collection", r.stdout)
        self.assertEqual(r.returncode, 1)

    def test_v1_respell_flag_still_works(self):
        (self.out / "caps.txt").write_text("We should open AI to everyone who asks for it today.", encoding="utf-8")
        r = self.check([record("We should OpenAI to everyone who asks for it today.")], self.out / "caps.txt", "--respell", "open AI=OpenAI")
        self.assertEqual(r.returncode, 0, r.stdout)

    # version 2

    def v2(self, text, edits, note_extra=True, **over):
        work = TM.load_work(str(self.work))
        a = T.analyze(text, work.idx, edits, meta_text=work.meta_text)
        rec = record(text, **over)
        if note_extra:
            rec["verification"]["note"] += " " + T.edits_sentence(a)
        return {"record": rec, "edits": edits}

    def test_v2_clean_quote_passes(self):
        r = self.check([self.v2("The bottleneck is diffusion through the rest of the world.", [])])
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("EXACT", r.stdout)

    def test_v2_edited_quote_passes_and_shows_its_edits(self):
        edits = [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}]
        r = self.check([self.v2("We spent $7000 a day on agents, which is a lot of money.", edits)])
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("EDITED", r.stdout)
        self.assertIn("respelled", r.stdout)

    def test_v2_refuses_an_undeclared_cut_a_negation_and_a_note_without_the_edits(self):
        r = self.check([self.v2("We spent $7,000 a day on agents, which is a lot of money.", [], note_extra=False)])
        self.assertEqual(r.returncode, 1)
        self.assertIn("undeclared cut", r.stdout)
        r = self.check([self.v2("The model can do that yet.", [{"kind": "respell", "from": "can't", "to": "can"}])])
        self.assertEqual(r.returncode, 1)
        self.assertIn("negation was dropped", r.stdout)
        r = self.check([self.v2("We spent $7000 a day on agents, which is a lot of money.", [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}], note_extra=False)])
        self.assertEqual(r.returncode, 1)
        self.assertIn("does not carry the edit list", r.stdout)

    def test_v2_link_and_locator_must_land_where_the_line_is_said(self):
        text = "The bottleneck is diffusion through the rest of the world."
        good = self.v2(text, [], source={"kind": "curated", "url": "https://youtu.be/abcDEF12345?t=4", "locator": "Test Speaker, solo talk · 0:04, on diffusion"})
        self.assertEqual(self.check([good]).returncode, 0, self.check([good]).stdout)
        bad_link = self.v2(text, [], source={"kind": "curated", "url": "https://youtu.be/abcDEF12345?t=64", "locator": "Test Speaker · 0:04, on diffusion"})
        r = self.check([bad_link])
        self.assertEqual(r.returncode, 1)
        self.assertIn("the link starts at", r.stdout)
        bad_loc = self.v2(text, [], source={"kind": "curated", "url": "https://youtu.be/abcDEF12345?t=4", "locator": "Test Speaker · 3:04, on diffusion"})
        self.assertIn("the locator says", self.check([bad_loc]).stdout)

    def test_v2_close_to_a_held_line_is_a_warning_not_a_failure(self):
        (self.out / "held.txt").write_text("An old line the collection already holds about nothing particular today. Next sentence here.", encoding="utf-8")
        item = self.v2("An old line the collection holds about nothing particular today.", [])
        # same source file for the held line; the check reads this file as the source
        p = self.out / "held.txt"
        item["record"]["verification"]["note"] = "Read in the caption track."
        r = self.check([item], source=p)
        self.assertIn("close to a line he holds", r.stdout)

    # select-picks

    def candidates(self, items):
        p = self.out / "cands.json"
        p.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        return p

    def cand(self, text, edits, **kw):
        c = {
            "record": record(text),
            "source": str(self.work / "transcript.txt"),
            "edits": edits,
            "main_point": "The bottleneck is verification",
            "start": 4,
            "show": {"by": "Test Speaker", "work_short": "Test Talk", "where": "0:04", "about": "on diffusion", "why": "the point", "flag": ""},
        }
        c.update(kw)
        c["record"]["verification"]["note"] = "{auto}"
        return c

    def test_select_picks_writes_the_edit_list_into_the_note(self):
        cands = self.candidates([
            self.cand("The bottleneck is diffusion through the rest of the world.", []),
            self.cand("We spent $7000 a day on agents, which is a lot of money.", [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}]),
        ])
        out = self.out / "sel"
        r = run(script("select-picks.py"), cands, "all", "--out", out, "--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        picks = json.loads((out / "picks.json").read_text(encoding="utf-8"))
        self.assertEqual(len(picks), 2)
        note = picks[1]["verification"]["note"]
        self.assertIn("Edits to the transcript wording", note)
        self.assertIn('removed "like"', note)
        self.assertIn("uploader's own caption track (en-US)", note)
        self.assertIn("fetched with yt-dlp on 2026-11-15", note)
        self.assertNotIn("{auto}", note)
        self.assertTrue(picks[0]["verification"]["note"].endswith("No words cut, changed or added."))
        self.assertNotIn("edits", picks[1])
        self.assertIn("### Quotes", (out / "issue-body.md").read_text(encoding="utf-8"))
        self.assertIn("Main points covered", r.stdout)

    def test_select_picks_reads_his_reply_as_he_types_it(self):
        sp = _load_script("select-picks.py", "select_picks_for_test")
        self.assertEqual(sp.parse_numbers("top 5", 15), [1, 2, 3, 4, 5])
        self.assertEqual(sp.parse_numbers("Top 5", 15), [1, 2, 3, 4, 5])
        self.assertEqual(sp.parse_numbers("top5", 15), [1, 2, 3, 4, 5])
        self.assertEqual(sp.parse_numbers("top 3 and 8", 15), [1, 2, 3, 8])
        self.assertEqual(sp.parse_numbers("1-5, 8", 15), [1, 2, 3, 4, 5, 8])
        self.assertEqual(sp.parse_numbers("3 7 11-13", 15), [3, 7, 11, 12, 13])
        self.assertEqual(sp.parse_numbers("2-4, 9, 9", 15), [2, 3, 4, 9])
        self.assertEqual(sp.parse_numbers("ALL", 4), [1, 2, 3, 4])
        with self.assertRaises(SystemExit):
            sp.parse_numbers("16", 15)          # not on the list
        with self.assertRaises(SystemExit):
            sp.parse_numbers("the best ones", 15)
        # and through the script itself, as the filing step runs it
        cands = self.candidates([self.cand("The bottleneck is diffusion through the rest of the world.", [])] * 3)
        r = run(script("select-picks.py"), cands, "top 2", "--out", self.out / "sel_top", "--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(len(json.loads((self.out / "sel_top" / "picks.json").read_text(encoding="utf-8"))), 2)

    def test_select_picks_fails_on_red_and_names_it(self):
        cands = self.candidates([self.cand("The model can do that yet.", [{"kind": "respell", "from": "can't", "to": "can"}])])
        r = run(script("select-picks.py"), cands, "1", "--out", self.out / "sel2", "--repo", self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("negation was dropped", r.stdout)
        self.assertEqual(json.loads((self.out / "sel2" / "picks.json").read_text(encoding="utf-8")), [])

    def test_select_picks_wants_a_flag_on_a_long_line_and_stops_at_twenty(self):
        long_text = "I think maybe the answer is no, but the model can't do that yet. " + "And um, the the bottleneck is is verification, and that is the point."
        cands = self.candidates([self.cand("The bottleneck is diffusion through the rest of the world.", [])] * 21)
        r = run(script("select-picks.py"), cands, "1", "--out", self.out / "sel3", "--repo", self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("the ceiling is 20", r.stdout)
        item = self.cand("We spent $7000 a day on agents, which is a lot of money.", [{"kind": "respell", "from": "7,000", "to": "7000"}, {"kind": "cut", "from": "like"}])
        item["record"]["text"] = item["record"]["text"] + " " + ("filler " * 30)
        r = run(script("select-picks.py"), self.candidates([item]), "1", "--out", self.out / "sel4", "--repo", self.repo)
        self.assertEqual(r.returncode, 1)

    def test_select_picks_keeps_version_1_candidates_working(self):
        old = {
            "record": record("The bottleneck is diffusion through the rest of the world."),
            "source": str(self.work / "transcript.txt"),
            "show": {"by": "Test Speaker", "work_short": "Test Talk", "where": "0:04", "about": "on diffusion", "why": "the point"},
        }
        out = self.out / "sel5"
        r = run(script("select-picks.py"), self.candidates([old]), "1", "--out", out, "--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("EXACT", r.stdout)
        self.assertEqual(len(json.loads((out / "picks.json").read_text(encoding="utf-8"))), 1)

    # picker

    def test_picker_shows_time_and_main_point_and_still_takes_version_1(self):
        v2 = self.cand("The bottleneck is diffusion through the rest of the world.", [])
        v2["record"]["source"]["url"] = "https://youtu.be/abcDEF12345?t=4"
        old = {"record": record("An older kind of line, without edits."), "source": "x", "show": {"where": "03:19", "about": "on x", "why": "y"}}
        cands = self.candidates([v2, old])
        page = self.out / "picker.html"
        r = run(script("picker.py"), cands, page)
        self.assertEqual(r.returncode, 0, r.stderr)
        html = page.read_text(encoding="utf-8")
        self.assertIn("Main point:</b> The bottleneck is verification", html)
        self.assertIn('href="https://youtu.be/abcDEF12345?t=4"', html)
        self.assertIn(">0:04</a>", html)
        self.assertIn("03:19", html)
        self.assertEqual(html.count("Main point:</b>"), 1)

    def test_picker_chat_list(self):
        cands = self.candidates([self.cand("The bottleneck is diffusion through the rest of the world.", [])])
        r = run(script("picker.py"), cands, "--chat")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("1. The bottleneck is diffusion through the rest of the world.  \n"))
        self.assertIn("   0:04 · Test Speaker · Main point: The bottleneck is verification", r.stdout)

    def test_picker_chat_list_can_stop_at_the_top_few(self):
        items = [self.cand("The bottleneck is diffusion through the rest of the world.", []) for _ in range(3)]
        r = run(script("picker.py"), self.candidates(items), "--chat", "--top", "2")
        self.assertIn("2. The bottleneck", r.stdout)
        self.assertNotIn("3. The bottleneck", r.stdout)

    def test_an_essay_goes_through_the_same_builder(self):
        essay = Path(self.tmp.name) / "essay.txt"
        essay.write_text(
            "A short essay.\n\nThe first section argues that trust is built slowly. Trust is built slowly, one honest act at a time.\n\n"
            "The second section says that speed matters more than people admit, and that delay is a cost.\n",
            encoding="utf-8",
        )
        drafts = {
            "transcript": str(essay),
            "work": {"title": "On Trust", "author": "An Author", "workKind": "essay", "year": 2025, "url": "https://example.com/on-trust",
                     "status": "verified", "note": "Read in the essay on its author's site on 2026-11-15.", "themes": ["work"]},
            "points": ["Trust is built slowly"],
            "items": [{"text": "Trust is built slowly, one honest act at a time.", "point": 1, "prefix": "§1", "why": "the thesis"}],
        }
        p = self.out / "drafts3.json"
        p.write_text(json.dumps(drafts), encoding="utf-8")
        r = run(script("build-candidates.py"), p, "--out", self.out / "built3.json", "--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        built = json.loads((self.out / "built3.json").read_text(encoding="utf-8"))
        rec = built[0]["record"]
        self.assertEqual(rec["source"], {"kind": "curated", "url": "https://example.com/on-trust", "locator": "§1"})
        self.assertEqual(rec["verification"]["status"], "verified")
        self.assertIsNone(built[0]["start"])
        sel = run(script("select-picks.py"), self.out / "built3.json", "all", "--out", self.out / "sel8", "--repo", self.repo)
        self.assertEqual(sel.returncode, 0, sel.stdout)
        note = json.loads((self.out / "sel8" / "picks.json").read_text(encoding="utf-8"))[0]["verification"]["note"]
        self.assertTrue(note.startswith("Read in the essay on its author's site on 2026-11-15."))
        self.assertIn("No words cut, changed or added.", note)

    # locate-quote

    def test_locate_quote_gives_time_link_and_edits(self):
        r = run(script("locate-quote.py"), self.work, "--json", "--text", "We spent $7000 a day on agents, which is a lot of money.")
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)[0]
        self.assertTrue(got["found"])
        self.assertEqual(got["m_ss"], "0:20")
        self.assertEqual(got["url"], "https://youtu.be/abcDEF12345?t=20")
        self.assertEqual(sorted(e["kind"] for e in got["edits"]), ["cut", "respell"])
        self.assertGreaterEqual(got["coverage"], 0.9)

    def test_locate_quote_says_when_it_is_not_there(self):
        r = run(script("locate-quote.py"), self.work, "--text", "Nothing like this was ever said in the whole talk, not once.")
        self.assertEqual(r.returncode, 1)
        self.assertIn("NOT FOUND", r.stdout)

    # build-candidates, end to end

    def test_build_candidates_end_to_end(self):
        drafts = {
            "transcript": str(self.work),
            "work": {"title": "Test Talk", "author": "Test Speaker", "workKind": "speech", "year": 2026, "prefix": "Test Speaker, solo talk", "themes": ["technology"]},
            "points": ["The bottleneck is verification", "Money goes to agents"],
            "items": [
                {"text": "The bottleneck is diffusion through the rest of the world.", "point": 1, "about": "on diffusion", "why": "states it", "tags": ["ai"]},
                {"text": "We spent $7000 a day on agents, which is a lot of money.", "point": 2, "about": "on spend", "why": "a magnitude", "themes": ["technology", "money"]},
            ],
        }
        p = self.out / "drafts.json"
        p.write_text(json.dumps(drafts), encoding="utf-8")
        r = run(script("build-candidates.py"), p, "--out", self.out / "built.json", "--repo", self.repo)
        # "money" is not in the fixture's themes: that must be reported, and the file still written
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("themes not in the controlled list: money", r.stdout)
        built = json.loads((self.out / "built.json").read_text(encoding="utf-8"))
        self.assertEqual(built[0]["start"], 4)
        self.assertEqual(built[0]["record"]["source"]["url"], "https://youtu.be/abcDEF12345?t=4")
        self.assertEqual(built[0]["record"]["source"]["locator"], "Test Speaker, solo talk · 0:04, on diffusion")
        self.assertEqual(built[0]["main_point"], "The bottleneck is verification")
        self.assertEqual(built[1]["edits"][0]["kind"], "respell")
        drafts["items"][1]["themes"] = ["technology"]
        p.write_text(json.dumps(drafts), encoding="utf-8")
        r = run(script("build-candidates.py"), p, "--out", self.out / "built.json", "--repo", self.repo)
        self.assertEqual(r.returncode, 0, r.stdout)
        r2 = run(script("select-picks.py"), self.out / "built.json", "all", "--out", self.out / "sel6", "--repo", self.repo)
        self.assertEqual(r2.returncode, 0, r2.stdout)

    def test_a_draft_only_adds_the_reason_to_an_edit_the_builder_found(self):
        vtt = (
            "WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nModels improve I mean every single month and costs fall every year.\n\n"
            "00:00:05.000 --> 00:00:09.000\nThat is the whole story of the last decade in this field today.\n"
        )
        work = make_work(Path(self.tmp.name) / "w2", vtt)
        drafts = {
            "transcript": str(work),
            "work": {"title": "Test Talk", "author": "Test Speaker", "workKind": "speech", "year": 2026, "prefix": "Test Speaker, solo talk", "themes": ["technology"]},
            "points": ["Models improve"],
            "items": [{"text": "Models improve every single month and costs fall every year.", "point": 1, "about": "on pace", "why": "x"}],
        }
        p = self.out / "drafts2.json"
        p.write_text(json.dumps(drafts), encoding="utf-8")
        bare = run(script("build-candidates.py"), p, "--out", self.out / "built2.json", "--repo", self.repo)
        self.assertEqual(bare.returncode, 1, bare.stdout)
        self.assertIn('"why": "filler"', bare.stdout)
        drafts["items"][0]["edits"] = [{"kind": "cut", "from": "I mean", "why": "filler"}]
        p.write_text(json.dumps(drafts), encoding="utf-8")
        said = run(script("build-candidates.py"), p, "--out", self.out / "built2.json", "--repo", self.repo)
        self.assertEqual(said.returncode, 0, said.stdout)
        built = json.loads((self.out / "built2.json").read_text(encoding="utf-8"))
        self.assertEqual(built[0]["edits"], [{"kind": "cut", "from": "I mean", "why": "filler"}])
        sel = run(script("select-picks.py"), self.out / "built2.json", "all", "--out", self.out / "sel7", "--repo", self.repo)
        self.assertEqual(sel.returncode, 0, sel.stdout)
        note = json.loads((self.out / "sel7" / "picks.json").read_text(encoding="utf-8"))[0]["verification"]["note"]
        self.assertIn('removed "I mean" (filler)', note)

    # find-in-library

    def test_find_in_library(self):
        items = [
            {"kind": "video", "title": "Andrej Karpathy: AGI is still a decade away", "author": "Dwarkesh Patel", "source": {"title": "Dwarkesh Patel"}, "publishedAt": "2026-10-17T00:00:00Z", "durationSec": 8700, "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "summary": ""},
            {"kind": "podcast", "title": "Andrej Karpathy: AGI is still a decade away", "author": "Dwarkesh Patel", "source": {"title": "Dwarkesh Podcast"}, "publishedAt": "2026-10-17T00:00:00Z", "durationSec": 8700, "url": "https://www.dwarkesh.com/p/andrej-karpathy", "summary": ""},
            {"kind": "video", "title": "Cats being cats", "author": "Cat Channel", "source": {"title": "Cat Channel"}, "publishedAt": "2026-11-01T00:00:00Z", "durationSec": 60, "url": "https://www.youtube.com/watch?v=bbbbbbbbbbb", "summary": ""},
            {"kind": "video", "title": "Karpathy short", "author": "Someone", "source": {"title": "Someone"}, "publishedAt": "2026-11-02T00:00:00Z", "durationSec": 30, "isShort": True, "url": "https://www.youtube.com/shorts/ccccccccccc", "summary": ""},
            {"kind": "article", "title": "Karpathy writes a blog post", "author": "karpathy", "source": {"title": "Blog"}, "publishedAt": "2026-11-03T00:00:00Z", "url": "https://example.com/post", "summary": ""},
        ]
        lib = self.out / "items.json"
        lib.write_text(json.dumps(items), encoding="utf-8")
        r = run(script("find-in-library.py"), "the", "Dwarkesh", "Karpathy", "one", "--items", lib)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.splitlines()
        self.assertIn("watch?v=aaaaaaaaaaa", r.stdout)
        self.assertNotIn("dwarkesh.com/p/", r.stdout)  # the podcast page of the same episode is left out when the video is there
        self.assertNotIn("shorts/ccccccccccc", r.stdout)
        self.assertNotIn("example.com", r.stdout)
        self.assertNotIn("No item has all the words", r.stdout)
        none = run(script("find-in-library.py"), "xyzzyplugh", "--items", lib)
        self.assertEqual(none.returncode, 0)
        self.assertIn("No match", none.stdout)
        missing = run(script("find-in-library.py"), "karpathy", "--items", self.out / "nope.json")
        self.assertEqual(missing.returncode, 2)
        js = run(script("find-in-library.py"), "karpathy", "--items", lib, "--json")
        self.assertTrue(json.loads(js.stdout)["matched_all_words"])

    def test_find_in_library_needs_the_title_or_channel_unless_asked(self):
        items = [{"kind": "video", "title": "Interesting talk about models", "author": "Some Channel", "source": {"title": "Some Channel"},
                  "publishedAt": "2026-10-01T00:00:00Z", "durationSec": 3000, "url": "https://www.youtube.com/watch?v=ddddddddddd",
                  "summary": "A long conversation. The guest, Xavier Quibblesworth, explains scaling."}]
        lib = self.out / "items2.json"
        lib.write_text(json.dumps(items), encoding="utf-8")
        plain = run(script("find-in-library.py"), "quibblesworth", "--items", lib)
        self.assertIn("No match", plain.stdout)
        wide = run(script("find-in-library.py"), "quibblesworth", "--items", lib, "--search-descriptions")
        self.assertIn("ddddddddddd", wide.stdout)
        self.assertIn("only in the description", wide.stdout)

    # collection-profile

    def test_collection_profile_derives_its_numbers(self):
        r = run(script("collection-profile.py"), "--repo", self.repo, "--author", "Someone")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("1 quotes", r.stdout)
        self.assertIn("An old line the collection already holds", r.stdout)
        self.assertIn("themes:", r.stdout)
        # A copy of the data without stars says so, instead of leaving the session to guess what he keeps.
        self.assertIn("Starred: none in this copy", r.stdout)

    def test_collection_profile_lists_the_stars_when_there_are_some(self):
        repo = make_repo(Path(self.tmp.name) / "repo_with_stars")
        data = json.loads((repo / "data" / "quotes.json").read_text(encoding="utf-8"))
        data["quotes"][0]["favorite"] = True
        data["quotes"][0]["source"] = {"kind": "curated"}
        (repo / "data" / "quotes.json").write_text(json.dumps(data), encoding="utf-8")
        r = run(script("collection-profile.py"), "--repo", repo)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Starred: 1 of 1", r.stdout)
        self.assertIn("Starred curated lines", r.stdout)
        self.assertNotIn("none in this copy", r.stdout)


# --------------------------------------------------------------------------- second review, 2026-11-16
# Each class below pins one finding of the independent review of the first build: a quote across a change of
# speaker, a qualifier trimmed at the edge, a typo or a figure respelled, a playlist link, and the smaller ones.


class SpeakerTurns(unittest.TestCase):
    CHAT = "I remember that, yes. I didn't mean make it this easy. >> It's like it went too far. >> I know. You just talk in English."

    def test_a_chevron_ends_a_turn_and_so_a_sentence(self):
        src = T.SourceIndex("We went on and on >> Yes it did. >> Then we stopped.")
        self.assertEqual([t.w for t in src.toks][4], "on")
        self.assertEqual([t.turn for t in src.toks], [False, False, False, False, True, False, False, True, False, False, False])
        self.assertTrue(T.ends_sentence(src.toks, 4))   # the second "on" is the last word of the first speaker's turn
        self.assertFalse(T.ends_sentence(src.toks, 3))

    def test_turn_marks_do_not_make_an_unpunctuated_track_punctuated(self):
        src = T.SourceIndex(" ".join(["we said this and that >>"] * 30))
        self.assertFalse(src.punctuated)

    def test_a_quote_that_runs_across_a_change_of_speaker_is_refused(self):
        src = T.SourceIndex(self.CHAT)
        a = T.analyze("I didn't mean make it this easy. It's like it went too far.", src, [])
        self.assertTrue(any("change of speaker" in f for f in a.fails), a.fails)
        # one speaker's words are fine
        one = T.analyze("I didn't mean make it this easy.", src, [])
        self.assertEqual(one.fails, [], one.fails)
        two = T.analyze("It's like it went too far.", src, [])
        self.assertEqual(two.fails, [], two.fails)

    def test_a_reason_lets_it_through_and_goes_in_the_note(self):
        src = T.SourceIndex(self.CHAT)
        a = T.analyze("I didn't mean make it this easy. It's like it went too far.", src, [], ack="one person finishing his own thought, checked in the audio")
        self.assertEqual(a.fails, [], a.fails)
        self.assertIn("Boundary kept on purpose: one person finishing his own thought", T.edits_sentence(a))

    def test_a_remark_by_the_other_speaker_may_be_cut_out_when_the_same_person_carries_on(self):
        src = T.SourceIndex("We built the first version in a weekend and then >> Yeah. >> we spent a year on the second one. >> Great.")
        text = "We built the first version in a weekend and then we spent a year on the second one."
        bare = T.analyze(text, src, [{"kind": "cut", "from": "Yeah"}])
        self.assertTrue(any("not a filler" in f for f in bare.fails), bare.fails)
        said = T.analyze(text, src, [{"kind": "cut", "from": "Yeah", "why": "the other speaker's one word"}])
        self.assertEqual(said.fails, [], said.fails)
        self.assertIn('The speaker carries on after a short remark by the other speaker ("Yeah"), which is cut.', T.edits_sentence(said))

    def test_a_longer_reply_between_the_marks_is_two_speakers(self):
        src = T.SourceIndex("We built the first version in a weekend and then >> I do not believe you at all. >> we spent a year on the second one.")
        text = "We built the first version in a weekend and then we spent a year on the second one."
        a = T.analyze(text, src, [{"kind": "cut", "from": "I do not believe you at all", "why": "interjection"}])
        self.assertTrue(any("change of speaker" in f for f in a.fails), a.fails)

    def test_a_quote_that_starts_a_turn_is_not_judged_by_the_other_speakers_words(self):
        # The words before the mark are the other person's: their "not" says nothing about this quote.
        src = T.SourceIndex("No, I don't think that's right, because the models are not ready yet >> The models are good enough now, and so we shipped it. >> But did you test it?")
        a = T.analyze("The models are good enough now, and so we shipped it.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertFalse(any("mid-sentence" in w for w in a.warns), a.warns)
        self.assertNotIn("mid-sentence", T.edits_sentence(a))

    def test_without_punctuation_the_words_before_a_turn_are_still_not_the_speakers(self):
        src = T.SourceIndex("i do not think so >> the models are the bottleneck here and then more words follow after that")
        a = T.analyze("The models are the bottleneck here.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertFalse(any("not think" in w for w in a.warns), a.warns)

    def test_a_hyphen_starting_a_caption_line_is_a_change_of_speaker_in_an_uploader_track(self):
        raw = "Did you test it? - Yes, we tested it for months. - And the results?\n\n- They were strong, and we shipped in March."
        up = T.SourceIndex(raw, hyphen_turns=True)
        a = T.analyze("Yes, we tested it for months. And the results?", up, [])
        self.assertTrue(any("change of speaker" in f for f in a.fails), a.fails)
        self.assertEqual(T.analyze("Yes, we tested it for months.", up, []).fails, [])
        self.assertEqual(T.analyze("They were strong, and we shipped in March.", up, []).fails, [])  # a block that starts with the mark
        # In anything else a hyphen is a hyphen: an essay's bullet list is no change of speaker.
        plain = T.SourceIndex(raw)
        self.assertEqual([t.turn for t in plain.toks], [False] * len(plain.toks))

    def test_load_work_reads_the_hyphen_only_in_an_uploader_track(self):
        with tempfile.TemporaryDirectory() as d:
            up = TM.load_work(str(make_work(Path(d) / "up")))
            asr = TM.load_work(str(make_work(Path(d) / "asr", ASR_VTT, "asr", "en-orig", "A clip.")))
            self.assertTrue(up.idx.hyphen_turns)
            self.assertFalse(asr.idx.hyphen_turns)

    def test_a_turn_mark_inside_the_text_is_refused_by_the_shape_check(self):
        self.assertTrue(any("speaker-change" in f for f in T.shape_issues("It was easy. >> It went too far.")[0]))
        self.assertTrue(any("speaker-change" in f for f in T.shape_issues("It was easy. - It went too far.")[0]))
        self.assertEqual(T.shape_issues("A well-known, state-of-the-art idea - and a good one.")[0], [])


class EdgeQualifiers(unittest.TestCase):
    SRC = T.SourceIndex(
        "Only the best startups are already big. Sometimes the models fail in surprising ways. Most people do not understand this. "
        "It works in the lab, but only for now. Nearly every company will adopt agents within two years. The cost fell by half, at least for now. "
        "It is the same for all, and the models are no different. Honestly, it might be the best thing we ever built. "
        "The thing is mandatory almost. We expect about 500 users by then. In most cases, the labs fail. So far, the models improve. "
        "The model is good, unless the data shifts."
    )

    def check(self, text, **kw):
        return T.analyze(text, self.SRC, [], **kw)

    def test_a_quote_that_starts_right_after_a_quantifier_or_hedge_is_refused(self):
        for text, word in (
            ("The best startups are already big.", "only"),
            ("The models fail in surprising ways.", "sometimes"),
            ("People do not understand this.", "most"),
            ("Every company will adopt agents within two years.", "nearly"),
        ):
            a = self.check(text)
            self.assertTrue(any("qualifier" in f and word in f for f in a.fails), (text, a.fails))

    def test_a_quote_that_stops_right_before_a_trailing_qualifier_is_refused(self):
        for text, what in (
            ("It works in the lab.", "only"),
            ("The cost fell by half.", "at least"),
            ("The thing is mandatory.", "almost"),
            ("The model is good.", "unless"),
        ):
            a = self.check(text)
            self.assertTrue(any("qualifier" in f and what in f for f in a.fails), (text, a.fails))

    def test_a_sentence_opener_that_qualifies_is_refused_and_a_filler_opener_is_not(self):
        self.assertTrue(any("qualifier" in f for f in self.check("The labs fail.").fails))
        self.assertTrue(any("qualifier" in f for f in self.check("The models improve.").fails))      # "So far,"
        self.assertEqual(self.check("It might be the best thing we ever built.").fails, [])           # "Honestly,"

    def test_about_before_a_figure_is_a_hedge_but_about_before_a_noun_is_not(self):
        a = self.check("500 users by then.")
        self.assertTrue(any("qualifier" in f and "about" in f for f in a.fails), a.fails)

    def test_a_qualifier_in_a_clause_of_its_own_is_no_trim(self):
        a = self.check("The models are no different.")   # "...for all, and the models are no different": "all" belongs to the first clause
        self.assertEqual(a.fails, [], a.fails)

    def test_a_reason_resolves_it_and_goes_in_the_note(self):
        a = self.check("The best startups are already big.", ack="the sentence is about startups of every size")
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(a.ack_used)
        self.assertIn("Boundary kept on purpose: the sentence is about startups of every size.", T.edits_sentence(a))

    def test_the_whole_sentence_is_never_a_trim(self):
        a = self.check("Only the best startups are already big.")
        self.assertEqual(a.fails, [], a.fails)
        self.assertEqual(self.check("It works in the lab, but only for now.").fails, [])

    def test_in_a_track_without_punctuation_a_qualifier_is_only_a_warning(self):
        src = T.SourceIndex("some models fail in surprising ways when they are pushed hard and then more words follow here after")
        a = T.analyze("Models fail in surprising ways.", src, [])
        self.assertEqual(a.fails, [], a.fails)
        self.assertTrue(any("qualifier" in w and "no punctuation" in w for w in a.warns), a.warns)


class RespellRules(unittest.TestCase):
    def test_two_real_words_a_letter_apart_are_not_a_typo_without_a_reason(self):
        for src_text, text in (
            ("The causal link is clear in the data, said the team.", "The casual link is clear in the data, said the team."),
            ("The market is stable and the bubble is a problem here.", "The market is stale and the bubble is a problem here."),
            ("The room was quiet and the talk went on for hours.", "The room was quite and the talk went on for hours."),
        ):
            a = T.analyze(text, T.SourceIndex(src_text), None, derive=True, meta_text="")
            self.assertTrue(any("letter or two off" in f for f in a.fails), a.fails)

    def test_a_typo_taken_on_the_editors_word_is_listed_in_the_note_with_the_reason(self):
        src = T.SourceIndex("The causal link is clear in the data, said the team.")
        edit = [{"kind": "respell", "from": "causal", "to": "casual", "why": "typo: the audio at 3:10 says casual"}]
        a = T.analyze("The casual link is clear in the data, said the team.", src, edit, meta_text="")
        self.assertEqual(a.fails, [], a.fails)
        self.assertIn('"causal" respelled "casual" (typo: the audio at 3:10 says casual)', T.edits_sentence(a))
        self.assertTrue(any("typo corrected on your word" in w for w in a.warns))

    def test_a_name_the_description_proves_still_needs_no_reason(self):
        a = an("Waymo is expanding fast, and it's crazy how fast it grew.", derive=True)
        self.assertEqual(a.fails, [], a.fails)

    def test_a_figure_is_never_respelled_not_even_on_a_name_claim(self):
        src = T.SourceIndex("One person could drive 100 X the next person, we see in the data.")
        for to in ("10 X", "1000 X"):
            edit = [{"kind": "respell", "from": "100", "to": to.split()[0], "why": f"name: {to}"}]
            text = f"One person could drive {to} the next person, we see in the data."
            a = T.analyze(text, src, edit, meta_text="")
            self.assertTrue(any("different word" in f for f in a.fails), (to, a.fails))

    def test_a_name_with_the_same_digits_may_still_be_respelled_on_a_name_claim(self):
        src = T.SourceIndex("GBT3 was able to write a passable poem for anyone who asked.")
        edit = [{"kind": "respell", "from": "GBT3", "to": "GPT-3", "why": "name: the speaker says GPT three"}]
        a = T.analyze("GPT-3 was able to write a passable poem for anyone who asked.", src, edit, meta_text="")
        self.assertEqual(a.fails, [], a.fails)

    def test_a_name_a_caption_splits_with_a_full_stop_is_one_word(self):
        src = T.SourceIndex("Like in my career I've started over many times and so I remember you were always rewriting things within Repl.it. Yeah, rewriting things.")
        a = T.analyze("I remember you were always rewriting things within Replit.", src, None, derive=True, meta_text="Replit is the company.")
        self.assertEqual(a.fails, [], a.fails)
        sentence = T.edits_sentence(a)
        self.assertIn('"Repl.it" respelled "Replit" (punctuation inside the word)', sentence)
        self.assertNotIn('before "it', sentence)   # the first build said the quote stopped before "it" here
        self.assertEqual([t.w for t in T.tokenize("We use Repl.it. Then 3.5 more.")], ["we", "use", "repl.it", "then", "3.5", "more"])
        self.assertEqual(T.words("Repl.it and U.S.A"), ["repl.it", "and", "u.s.a"])


class ShapeRules(unittest.TestCase):
    def test_an_em_dash_the_cleaner_added_is_refused_and_one_the_transcript_has_is_not(self):
        src = T.SourceIndex("Imagine who would be perfect for this world where everything is changing under our feet every six months, the person who assumes change.")
        a = T.analyze("Imagine who would be perfect for this world — where everything is changing under our feet every six months, the person who assumes change.", src, [])
        self.assertTrue(any("em dash" in f for f in a.fails), a.fails)
        with_dash = T.SourceIndex("Imagine who would be perfect for this world — where everything is changing under our feet every six months, the person who assumes change.")
        b = T.analyze("Imagine who would be perfect for this world — where everything is changing under our feet every six months, the person who assumes change.", with_dash, [])
        self.assertFalse(any("em dash" in f for f in b.fails), b.fails)

    def test_a_quote_wrapped_in_quotation_marks_fails_in_the_analysis_too(self):
        src = T.SourceIndex("The bottleneck is diffusion through the rest of the world, and that is the point.")
        a = T.analyze("“The bottleneck is diffusion through the rest of the world.”", src, [])
        self.assertTrue(any("wrapped in quotation marks" in f for f in a.fails), a.fails)
        self.assertFalse(any("wrapped" in f for f in T.shape_issues("")[0]))   # an empty text is not "wrapped"


class Repeats(unittest.TestCase):
    OPENING = "The bottleneck is not the models but the diffusion through the rest of the world today."

    def source(self, teaser_end=0):
        filler = " ".join(f"word{i}" for i in range(200))
        return T.SourceIndex(f"{self.OPENING} Now the show begins. {filler} Welcome back. {self.OPENING} We go on.", teaser_end=teaser_end)

    def test_when_a_line_is_said_twice_the_one_after_the_opening_is_used(self):
        src = self.source(teaser_end=30)
        a = T.analyze(self.OPENING, src, [])
        self.assertGreater(a.start, 200)
        self.assertEqual(len(a.alignment.repeats), 1)
        self.assertLess(a.alignment.repeats[0], 30)

    def test_without_an_opening_the_first_is_used_and_the_other_is_still_named(self):
        src = self.source()
        a = T.analyze(self.OPENING, src, [])
        self.assertLess(a.start, 30)
        self.assertEqual(len(a.alignment.repeats), 1)

    def test_the_warning_names_both_times(self):
        src = self.source(teaser_end=30)
        a = T.analyze(self.OPENING, src, [], clock=lambda i: i * 1.0)
        said = [w for w in a.warns if "said more than once" in w]
        self.assertEqual(len(said), 1, a.warns)
        self.assertIn("at 3:42 (used for the link and the locator) and at 0:00", said[0])   # word 222 of the source, one word a second

    def test_a_line_said_once_has_no_such_warning(self):
        src = self.source()
        a = T.analyze("Welcome back.", src, [], clock=lambda i: i * 1.0)
        self.assertFalse(any("said more than once" in w for w in a.warns))

    def test_a_long_video_marks_its_opening_and_a_short_one_does_not(self):
        def vtt(minutes):
            cues = ["WEBVTT\n"]
            for k in range(minutes * 2):
                a, b = k * 30, k * 30 + 29
                text = "The bottleneck is not the models but the diffusion through the rest of the world today." if k in (0, 11) else f"This is the filler line number {k} of the talk."
                cues.append(f"\n00:{a // 60:02d}:{a % 60:02d}.000 --> 00:{b // 60:02d}:{b % 60:02d}.000\n{text}\n")
            return "".join(cues)

        with tempfile.TemporaryDirectory() as d:
            long_ = TM.load_work(str(make_work(Path(d) / "long", vtt(14))))
            self.assertGreater(long_.idx.teaser_end, 0)
            a = T.analyze("The bottleneck is not the models but the diffusion through the rest of the world today.", long_.idx, [], clock=long_.seconds_at)
            self.assertAlmostEqual(long_.seconds_at(a.start), 330, delta=1)   # 5:30, not the opening
            self.assertTrue(any("said more than once" in w for w in a.warns), a.warns)
            short = TM.load_work(str(make_work(Path(d) / "short", vtt(8))))
            self.assertEqual(short.idx.teaser_end, 0)


class Joins(unittest.TestCase):
    PARA = " ".join(f"other{i}" for i in range(80))

    def test_two_sentences_a_paragraph_apart_are_a_join(self):
        src = T.SourceIndex(
            f"For all of the deep flaws of society, it is unbelievably robust. {self.PARA} "
            "I would much rather have a trillion small minds join society than one huge one."
        )
        a = T.analyze(
            "For all of the deep flaws of society, it is unbelievably robust. I would much rather have a trillion small minds join society than one huge one.",
            src, None, derive=True,
        )
        self.assertTrue(any("joins distant material" in f or "joins two stretches" in f for f in a.fails), a.fails)
        self.assertEqual(a.start, 0)   # said at the first stretch, not somewhere in between

    def test_a_name_spelt_right_elsewhere_is_no_join(self):
        # The quote respells Whimo twice; "Waymo" is said correctly a few dozen words before and after. Those two far-off
        # single words must not be read as a second stretch of speech.
        filler = " ".join(f"other{i}" for i in range(25))
        src = T.SourceIndex(
            f"Waymo is great and we like the cars. {filler} Whimo is expanding fast and the cars are everywhere in this city, said Whimo. {filler} "
            "Later the Waymo team came by and talked for a while."
        )
        a = T.analyze("Waymo is expanding fast and the cars are everywhere in this city, said Waymo.", src, None, derive=True, meta_text="Waymo is the company.")
        self.assertEqual(a.fails, [], a.fails)
        self.assertFalse(any("joins" in f for f in a.fails))

    def test_stretch_sizes(self):
        src = T.SourceIndex("one two three four five " + " ".join(f"x{i}" for i in range(30)) + " six seven eight nine ten")
        a = T.align(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"], src)
        joined = T._dp(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"], src.w, 0, len(src.w), c_del=T.C_DEL_CHEAP)
        self.assertEqual(T.stretch_sizes(joined), [5, 5])
        self.assertTrue(T.is_join(joined))
        self.assertIsNotNone(a)


class FetchingCaptions(unittest.TestCase):
    def test_both_yt_dlp_calls_ask_for_one_video_only(self):
        info = captions.info_args("https://www.youtube.com/watch?v=abc&list=PLx&index=3", Path("/tmp/x/source"))
        track = captions.track_args("https://www.youtube.com/watch?v=abc&list=PLx&index=3", Path("/tmp/x"), "uploader", "en")
        for args in (info, track):
            self.assertIn("--no-playlist", args)
            self.assertEqual(args[args.index("--playlist-items") + 1], "1")
            self.assertEqual(args[-1], "https://www.youtube.com/watch?v=abc&list=PLx&index=3")
        self.assertIn("--write-subs", track)
        self.assertIn("--write-auto-subs", captions.track_args("u", Path("/tmp/x"), "asr", "en-orig"))

    def test_a_playlist_channel_or_search_address_is_refused_and_a_video_in_a_list_is_not(self):
        for url in (
            "https://www.youtube.com/playlist?list=PLd7",
            "https://youtube.com/playlist?list=PLd7",
            "https://www.youtube.com/watch?list=PLd7",
            "https://www.youtube.com/@dwarkeshpatel",
            "https://www.youtube.com/@dwarkeshpatel/videos",
            "https://www.youtube.com/channel/UC123",
            "https://www.youtube.com/results?search_query=karpathy",
        ):
            self.assertIsNotNone(captions.not_one_video(url), url)
        for url in (
            "https://www.youtube.com/watch?v=abcDEF12345&list=PLd7&index=3",
            "https://youtu.be/abcDEF12345?list=PLd7",
            "https://www.youtube.com/watch?v=abcDEF12345",
            "https://www.dwarkesh.com/p/some-episode",
            "podcasts.apple.com/dk/podcast/x/id1",
        ):
            self.assertIsNone(captions.not_one_video(url), url)

    def test_the_advice_depends_on_why_yt_dlp_failed(self):
        gone = captions.explain_failure("ERROR: [youtube] AAAAAAAAAAA: This video is unavailable")
        self.assertIn("another link", gone)
        self.assertIn("will not help", gone)
        limited = captions.explain_failure("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests")
        self.assertIn("Wait", limited)
        self.assertIn("will not help", limited)
        private = captions.explain_failure("ERROR: [youtube] x: Private video. Sign in if you've been granted access to this video")
        self.assertIn("another link", private)
        notvideo = captions.explain_failure("ERROR: [generic] some-article: Unable to download webpage: HTTP Error 404: Not Found")
        self.assertIn("fetch-text.py", notvideo)
        unknown = captions.explain_failure("ERROR: something new broke in the extractor")
        self.assertIn("brew upgrade yt-dlp", unknown)

    def test_the_script_stops_at_a_playlist_before_it_asks_yt_dlp_anything(self):
        with tempfile.TemporaryDirectory() as d:
            r = run(script("captions.py"), "https://www.youtube.com/playlist?list=PLd7", "--out", Path(d) / "x")
            self.assertEqual(r.returncode, 2)
            self.assertIn("playlist", r.stderr)
            self.assertFalse((Path(d) / "x").exists())


class ReplyAndPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.repo = make_repo(base / "repo")
        cls.out = base / "out"
        cls.out.mkdir()
        cls.up = make_work(base / "up")
        cls.asr = make_work(base / "asr", ASR_VTT, "asr", "en-orig", "A clip.")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def cands(self, work):
        item = {
            "record": record("Whereas Aster can build whole video games from nothing."),
            "source": str(work / "transcript.txt"),
            "meta": str(work / "meta.json"),
            "edits": [],
            "main_point": "Agents build games",
            "start": 7,
            "show": {"by": "Test Speaker", "work_short": "Test Talk", "where": "0:07", "about": "on games", "why": "x", "flag": ""},
        }
        p = self.out / "c.json"
        p.write_text(json.dumps([item]), encoding="utf-8")
        return p

    def test_his_reply_is_read_in_english_and_danish(self):
        sp = _load_script("select-picks.py", "select_picks_for_reply")
        n = 15
        self.assertEqual(sp.parse_numbers("1, 3 og 5", n), [1, 3, 5])
        self.assertEqual(sp.parse_numbers("alle", n), list(range(1, 16)))
        self.assertEqual(sp.parse_numbers("all of them", n), list(range(1, 16)))
        self.assertEqual(sp.parse_numbers("#3, #5", n), [3, 5])
        self.assertEqual(sp.parse_numbers("1 – 4", n), [1, 2, 3, 4])
        self.assertEqual(sp.parse_numbers("1 - 4, 9", n), [1, 2, 3, 4, 9])
        self.assertEqual(sp.parse_numbers("1 to 3 and 7", n), [1, 2, 3, 7])
        self.assertEqual(sp.parse_numbers("3 til 5", n), [3, 4, 5])
        self.assertEqual(sp.parse_numbers("top 20", 16), list(range(1, 17)))   # a top longer than the list is the list
        self.assertEqual(sp.parse_numbers("top 5, 8", n), [1, 2, 3, 4, 5, 8])
        self.assertEqual(sp.parse_numbers("Top5", n), [1, 2, 3, 4, 5])
        for bad in ("", "top 0", "the best", "99"):
            with self.assertRaises(SystemExit):
                sp.parse_numbers(bad, n)

    def test_the_chat_list_says_so_when_only_machine_captions_exist(self):
        r = run(script("picker.py"), self.cands(self.asr), "--chat")
        self.assertEqual(r.returncode, 0, r.stderr)
        first = r.stdout.splitlines()[0]
        self.assertIn("machine captions", first)
        self.assertIn("1. Whereas Aster", r.stdout)
        plain = run(script("picker.py"), self.cands(self.up), "--chat")
        self.assertTrue(plain.stdout.startswith("1. Whereas Aster"), plain.stdout)

    def test_the_page_opens_with_its_charset_and_the_standalone_page_is_a_whole_document(self):
        c = self.cands(self.asr)
        frag, whole = self.out / "frag.html", self.out / "whole.html"
        self.assertEqual(run(script("picker.py"), c, frag).returncode, 0)
        self.assertEqual(run(script("picker.py"), c, whole, "--standalone").returncode, 0)
        f = frag.read_text(encoding="utf-8")
        w = whole.read_text(encoding="utf-8")
        self.assertTrue(f.startswith('<meta charset="utf-8">'), f[:80])
        self.assertNotIn("<!doctype", f.lower())      # the Artifact tool adds the document around a fragment
        self.assertTrue(w.startswith("<!doctype html>"), w[:80])
        self.assertIn('<meta charset="utf-8">', w)
        self.assertIn('name="viewport"', w)
        self.assertIn("</html>", w)
        for page in (f, w):
            self.assertIn("machine captions", page)
            self.assertNotIn("—", page)           # no em dash anywhere on the page

    def test_a_typo_goes_through_the_draft_only_with_the_reason_and_the_note_keeps_it(self):
        vtt = (
            "WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nGPT could write a passable limmerick on request, and it did so well.\n\n"
            "00:00:05.000 --> 00:00:09.000\nThat is the whole story of the last decade in this field today.\n"
        )
        work = make_work(Path(self.tmp.name) / "w4", vtt)
        drafts = {
            "transcript": str(work),
            "work": {"title": "Test Talk", "author": "Test Speaker", "workKind": "speech", "year": 2026, "prefix": "Test Speaker, solo talk", "themes": ["technology"]},
            "points": ["p"],
            "items": [{"text": "GPT could write a passable limerick on request, and it did so well.", "point": 1, "about": "on poems", "why": "y"}],
        }
        p = self.out / "typo.json"
        p.write_text(json.dumps(drafts), encoding="utf-8")
        bare = run(script("build-candidates.py"), p, "--out", self.out / "typo-built.json", "--repo", self.repo)
        self.assertEqual(bare.returncode, 1, bare.stdout)
        self.assertIn('"why": "typo: the audio at m:ss says it"', bare.stdout)
        drafts["items"][0]["edits"] = [{"kind": "respell", "from": "limmerick", "to": "limerick", "why": "typo: not a word, the audio at 0:02 says limerick"}]
        p.write_text(json.dumps(drafts), encoding="utf-8")
        said = run(script("build-candidates.py"), p, "--out", self.out / "typo-built.json", "--repo", self.repo)
        self.assertEqual(said.returncode, 0, said.stdout)
        sel = run(script("select-picks.py"), self.out / "typo-built.json", "all", "--out", self.out / "typo-sel", "--repo", self.repo)
        self.assertEqual(sel.returncode, 0, sel.stdout)
        note = json.loads((self.out / "typo-sel" / "picks.json").read_text(encoding="utf-8"))[0]["verification"]["note"]
        self.assertIn('"limmerick" respelled "limerick" (typo: not a word, the audio at 0:02 says limerick)', note)

    def test_a_quote_wrapped_in_quotation_marks_fails_the_build_as_well_as_the_dry_run(self):
        work = make_work(Path(self.tmp.name) / "w3")
        drafts = {
            "transcript": str(work),
            "work": {"title": "Test Talk", "author": "Test Speaker", "workKind": "speech", "year": 2026, "prefix": "Test Speaker, solo talk", "themes": ["technology"]},
            "points": ["p"],
            "items": [{"text": "“The bottleneck is diffusion through the rest of the world.”", "point": 1, "about": "x", "why": "y"}],
        }
        p = self.out / "wrapped.json"
        p.write_text(json.dumps(drafts), encoding="utf-8")
        r = run(script("build-candidates.py"), p, "--out", self.out / "wrapped-built.json", "--repo", self.repo)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("wrapped in quotation marks", r.stdout)
        sel = run(script("select-picks.py"), self.out / "wrapped-built.json", "1", "--out", self.out / "wrapped-sel", "--repo", self.repo)
        self.assertEqual(sel.returncode, 1)
        self.assertEqual(sel.stdout.count("wrapped in quotation marks"), 1, sel.stdout)   # said once, not twice


if __name__ == "__main__":
    unittest.main()
