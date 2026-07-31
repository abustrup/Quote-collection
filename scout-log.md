# Scout log

What the weekly scout tried, what it learned, and how often it was right.
Newest first. Written by the routine at
`~/.claude/scheduled-tasks/quote-scout/SKILL.md`; the collection's owner does
not have to read it, and it should still be worth reading if he does.

The one number that matters is the hit rate: proposals kept, over proposals
made. Everything else is an explanation of it.

---

## 2026-07-31 · no new board · first acceptance, 1 kept of 1 resolved

**The routine has its first hit.** He kept Vannevar Bush on basic research
ceasing to be basic when short-term results are expected — filed 2026-07-31
through the issue workflow, one day after the board went up.

**Stated honestly, the number is 1 kept, 0 let go, 8 still undecided.** Calling
it "1 of 9" would flatter the denominator in the wrong direction and flatter the
seams in the right one; eight lines have had exactly one showing and have not
been answered. Only one proposal is resolved, and it was kept. That is a real
signal about *which door* worked and no signal at all about the other three.

The door that worked is the one his reading cannot supply on its own: research
policy and the argument for patient capital. Of the four doors tried, it was the
one furthest from anything in the collection and the one aimed most squarely at
what he does rather than what he reads. Worth noting and not yet worth acting
on — n=1.

**No board was posted this run, deliberately.** The standing board is one day
old. The prompt's guard is written as "younger than a few days *and* nothing
ticked", and something was ticked, so the letter of it did not bind — but the
purpose did. Replacing or extending a board he engaged with 24 hours ago either
burns the second showing of eight lines that have barely had their first, or
pads a board he has not cleared. Both are the failure mode the prompt names:
being measured by what is proposed rather than what is kept. Silence was the
stronger run.

**Two pieces of maintenance, one of which was invisible and load-bearing.**

The kept Bush quote had no entry in `data/works.json`, so its work had no
subject and no era and dropped out of the shelf's filters while reading
perfectly well — exactly the failure the prompt warns is never noticed because
the collection treats it as a warning, not an error. Registered as
science / document / 1945. That single line took the test suite from three
failures to one: `the shipped registry and collection agree` and `every work the
collection quotes has a subject and an era` both went green with it.

The remaining failure is not the scout's to fix and is flagged rather than
touched. `every curated quote left in the collection is one the owner asked to
keep` (in `tests/curate.test.mjs`) hard-codes the three works that survived the
30 Jul purge, and now trips on his own accepted quote, because the importer
files scout picks with `source.kind: "curated"` — the same kind the purge was
guarding against. The guard cannot tell a machine-supplied bulk quote from one
he ticked himself. It will fail on every future acceptance. Editing that file is
outside what this routine is granted, so it is reported, not repaired.

**One more thing, also reported rather than changed: the cadence is not what
anything here says it is.** The scheduler's cron is `0 9 * * 0,2,4,6` — Sunday,
Tuesday, Thursday and Saturday, four runs a week — while the task description
says "Weekly (Sun 09:05)", this log's own header says "weekly scout", and the
two-showing rule was designed around weekly spacing. At four runs a week a
candidate can take both its showings and expire inside four days, which is not a
fair hearing and is not what the rule is for. The schedule is his and not the
routine's to change, so it is named here and in his report. Until it is settled,
the correct behaviour is the one taken today: post a board when there is one
worth posting, not because a run fired.

## 2026-07-30 · first board · 9 proposed, hit rate not yet measurable

Nothing to grade yet. This is a baseline, not a result.

**The collection changed underneath this board while it was being built, and
that is the finding.** The taste analysis started against 249 quotes across 62
works, with a large philosophy seam — Kant, Mill, Rawls, Popper, Weber, Arendt,
Adorno, Habermas, Wittgenstein, Foucault, MacIntyre, plus Keynes, Knight,
Mallaby and Thiel, mostly one line each. Halfway through, PR #8 merged: 44
curated quotes removed on the owner's own request, leaving 205 quotes across 27
works — his Goodreads shelf (173) plus exactly three works he had chosen to mine
himself, Claude's Constitution and the two Amodei essays (32).

Two of this board's stated reasons referred to authors that no longer exist here
and were rewritten. More importantly, the strategy was rebuilt: the collection
now has **no economics, no Danish writing, and nothing on capital allocation or
research policy at all**, so the four doors below are wider open than they were
an hour earlier, not narrower.

**The uncomfortable reading, recorded so it is not discovered twice.** What
survived the purge was his own reading, or a work he decided to go into. What
did not survive was material a machine supplied in bulk. This routine is a
machine supplying material. The two are not the same thing — nothing here enters
without him ticking it, one line at a time, which is precisely the mechanism the
removed 44 never went through — but the bar it sets is high and specific: a
candidate has to be strong enough that he would plausibly have gone looking for
that work himself. If acceptances stay at zero through 2026-09-27, the honest
conclusion is not that the seams were wrong. It is that he wants this collection
to be his reading only, and the right answer is to stop.

**What was chosen, and why.** Not a fourth Dostoevsky — adjacency is the cheap
move. Four doors none of the remaining seams use: Hayek on why no single mind
holds the facts; Kierkegaard, because the collection of a Dane contained no
Danish writing; Buffett writing to his own shareholders; and Vannevar Bush's
1945 report arguing for research nobody can yet justify.

**Method note, worth keeping.** Nine of nine were read in a primary source and
string-matched against the loaded text before reaching the board, so all nine
are `verified` rather than `reported`. That was possible because the sources
chosen publish themselves: Econlib for Hayek, Gutenberg for Hollander's 1923
Kierkegaard translation, Berkshire's own PDF for the letter, NSF's hosted copy
of the Bush report. Where a work is in copyright and unfetchable — Mazzucato,
Taleb, Marks, Kahneman, Hirschman, all of them apt — there was no honest route
to a quote this week and none was proposed. That constraint will shape every
board: **what is fetchable in full skews public-domain and self-published, and
what is most apt often does not.** Naming what had to be dropped is more useful
than implying the field was searched evenly.

Two smaller things found on the way. `nsf.gov` no longer serves the Bush report
at its old address; the Internet Archive's capture of NSF's own page does, and
that is what the source URL points at. And nobelprize.org renders nothing to a
plain fetch, so Ostrom's lecture was set aside rather than guessed at — a
candidate for a later board, from the PDF.

**A latent bug the first tick would have hit.** The `quote-board` label did not
exist on the repository, and GitHub applies a template's declared label only if
it is already there — so the first real selection would have opened an
unlabelled issue, the importer's author-and-label guard would not have fired,
and nothing would have happened, silently. Found by opening a deliberately
invalid pick (issue #9) and watching the workflow rather than trusting it: the
guard fired, the importer resolved board mode, refused the unknown id with the
right message, and wrote nothing. The success path with a real id was verified
against a copy of the collection locally, not live — filing a real quote would
have meant adding one he had not chosen, which is the one thing this routine
exists not to do.

**What would falsify the approach.** If the four-doors idea is wrong, it shows
fast: acceptances concentrating in one seam while the other three go 0 for 2
across both showings. If nothing at all is kept from this board, see the
uncomfortable reading above.
