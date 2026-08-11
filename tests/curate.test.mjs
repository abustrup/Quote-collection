/**
 * Tests for removing and correcting quotes.
 *
 * This is the only path in the repository that destroys data, and the owner
 * drives it from a web form without ever seeing the result until afterwards.
 * Two failure modes are worth more than the rest: a removal that does not stick
 * because the next sync re-files the quote, and an id that stops matching its
 * own text after an edit, which breaks every permalink at once.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { quoteId, validateCollection } from '../assets/quote-core.js';
import { EDIT_FIELDS, REMOVE_FIELDS, edit, readEdit, readIds, remove, summarize } from '../scripts/curate.mjs';
import { readTombstones, withoutRemoved } from '../scripts/tombstones.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ONE = 'The unexamined life is not worth living.';
const TWO = 'Man is condemned to be free.';

function quote(text, extra = {}) {
  return {
    id: quoteId(text),
    text,
    author: 'Someone',
    work: null,
    workKind: null,
    year: null,
    source: { kind: 'curated', url: null, locator: null },
    tags: [],
    themes: [],
    lang: 'en',
    verification: { status: 'unverified' },
    favorite: false,
    note: '',
    addedAt: '2026-01-01',
    ...extra,
  };
}

async function sandbox(quotes) {
  const dir = await mkdtemp(path.join(tmpdir(), 'curate-'));
  const data = path.join(dir, 'quotes.json');
  const removedFile = path.join(dir, 'removed.json');
  await writeFile(data, JSON.stringify({ schemaVersion: 1, quotes }, null, 2));
  await writeFile(removedFile, JSON.stringify({ schemaVersion: 1, removed: [] }, null, 2));
  return { data, removedFile };
}

const removalIssue = (ids, reason) => [
  '### Quote ids', '', ids.join('\n'), '',
  ...(reason ? ['### Reason', '', reason, ''] : []),
].join('\n');

/* --------------------------------------------------------------------------
 * The forms and the fields must stay in step
 * ------------------------------------------------------------------------ */

test('every remove and edit field has a heading in its issue form', async () => {
  const forms = {
    'remove-quote.yml': REMOVE_FIELDS,
    'edit-quote.yml': EDIT_FIELDS,
  };

  for (const [file, fields] of Object.entries(forms)) {
    const yaml = await readFile(path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', file), 'utf8');
    const labels = [...yaml.matchAll(/^\s*label:\s*(.+)$/gm)]
      .map((match) => match[1].trim().replace(/^["']|["']$/g, '').toLowerCase());

    for (const label of Object.keys(fields)) {
      assert.ok(
        labels.includes(label),
        `${file} has no "${label}" field, but curate.mjs reads one`,
      );
    }
  }
});

/* --------------------------------------------------------------------------
 * Reading the forms
 * ------------------------------------------------------------------------ */

test('ids are found however they are written', () => {
  const shapes = [
    'q_1a2b3c4d5e6f\nq_0f9e8d7c6b5a',
    'q_1a2b3c4d5e6f, q_0f9e8d7c6b5a',
    'https://abustrup.github.io/Quote-collection/#q_1a2b3c4d5e6f and #q_0f9e8d7c6b5a',
  ];
  for (const body of shapes) {
    const { ids } = readIds(`### Quote ids\n\n${body}\n`);
    assert.deepEqual(ids, ['q_1a2b3c4d5e6f', 'q_0f9e8d7c6b5a'], `failed on: ${body}`);
  }
});

test('the same id twice is one removal, not two', () => {
  const { ids } = readIds('### Quote ids\n\nq_1a2b3c4d5e6f\nq_1a2b3c4d5e6f\n');
  assert.deepEqual(ids, ['q_1a2b3c4d5e6f']);
});

test('a removal issue with no id says so instead of removing nothing quietly', () => {
  assert.throws(() => readIds('### Quote ids\n\nthe Socrates one\n'), /could not find a quote id/i);
});

test('an edit that changes nothing is refused', () => {
  assert.throws(() => readEdit('### Quote id\n\nq_1a2b3c4d5e6f\n'), /does not change anything/i);
});

test('an edit is refused rather than silently dropping an unknown theme', () => {
  const body = '### Quote id\n\nq_1a2b3c4d5e6f\n\n### Themes\n\nvibes, knowledge\n';
  assert.throws(() => readEdit(body), /not a theme/i);
});

test('a blank field means leave it alone, not clear it', () => {
  const body = [
    '### Quote id', '', 'q_1a2b3c4d5e6f', '',
    '### Quote', '', '_No response_', '',
    '### Author', '', 'Hannah Arendt', '',
  ].join('\n');
  const { changes } = readEdit(body);
  assert.deepEqual(Object.keys(changes), ['author']);
});

/* --------------------------------------------------------------------------
 * Removal
 * ------------------------------------------------------------------------ */

test('removing a quote takes it out and writes a tombstone that keeps the text', async () => {
  const { data, removedFile } = await sandbox([quote(ONE), quote(TWO)]);
  const result = await remove(removalIssue([quoteId(ONE)], 'Misattributed.'), {
    data, removedFile, removedAt: '2026-07-30',
  });

  for (const { file, contents } of result.files) await writeFile(file, contents);

  const after = JSON.parse(await readFile(data, 'utf8'));
  assert.equal(after.quotes.length, 1);
  assert.equal(after.quotes[0].text, TWO);
  assert.deepEqual(validateCollection(after).errors, []);

  const tombs = JSON.parse(await readFile(removedFile, 'utf8'));
  assert.equal(tombs.removed.length, 1);
  assert.equal(tombs.removed[0].id, quoteId(ONE));
  // The text is what makes the deletion reversible; without it the tombstone
  // is a hash nobody can turn back into a quote.
  assert.equal(tombs.removed[0].text, ONE);
  assert.equal(tombs.removed[0].reason, 'Misattributed.');
  assert.equal(tombs.removed[0].removedAt, '2026-07-30');
});

test('removing several at once is one operation', async () => {
  const { data, removedFile } = await sandbox([quote(ONE), quote(TWO)]);
  const result = await remove(removalIssue([quoteId(ONE), quoteId(TWO)]), { data, removedFile });
  assert.equal(result.removed.length, 2);
  assert.equal(result.totalCount, 0);
});

test('an id that is not in the collection is reported, not ignored', async () => {
  const { data, removedFile } = await sandbox([quote(ONE)]);
  const result = await remove(removalIssue([quoteId(ONE), 'q_000000000000']), { data, removedFile });
  assert.deepEqual(result.missing, ['q_000000000000']);
  assert.equal(result.removed.length, 1);
});

test('removing only unknown ids fails rather than reporting a successful no-op', async () => {
  const { data, removedFile } = await sandbox([quote(ONE)]);
  await assert.rejects(
    remove(removalIssue(['q_000000000000']), { data, removedFile }),
    /none of those ids are in the collection/i,
  );
});

/* --------------------------------------------------------------------------
 * The tombstone is the whole point
 * ------------------------------------------------------------------------ */

test('a removed quote is not re-imported, which is what makes deletion stick', async () => {
  const { data, removedFile } = await sandbox([quote(ONE), quote(TWO)]);
  const result = await remove(removalIssue([quoteId(ONE)]), { data, removedFile });
  for (const { file, contents } of result.files) await writeFile(file, contents);

  // Exactly what tomorrow's Goodreads sync would hand over: the same text,
  // and therefore the same id.
  const incoming = [quote(ONE), quote(TWO)];
  const { kept, skipped } = withoutRemoved(incoming, await readTombstones(removedFile));

  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].text, ONE);
  assert.equal(kept.length, 1);
});

test('an empty tombstone list bars nothing', async () => {
  const { removedFile } = await sandbox([]);
  const { kept, skipped } = withoutRemoved([quote(ONE)], await readTombstones(removedFile));
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 0);
});

test('a missing tombstone file is not an error', async () => {
  const barred = await readTombstones(path.join(tmpdir(), 'definitely-not-here-removed.json'));
  assert.equal(barred.size, 0);
});

/* --------------------------------------------------------------------------
 * Editing
 * ------------------------------------------------------------------------ */

test('editing metadata leaves the id, and therefore the permalink, alone', async () => {
  const { data } = await sandbox([quote(ONE, { author: 'Socrates' })]);
  const body = `### Quote id\n\n${quoteId(ONE)}\n\n### Author\n\nPlato\n\n### Year\n\n-399\n`;
  const result = await edit(body, { data });

  assert.equal(result.newId, null);
  assert.equal(result.after.id, quoteId(ONE));
  assert.equal(result.after.author, 'Plato');
  assert.equal(result.after.year, -399);
  assert.deepEqual(validateCollection(JSON.parse(result.files[0].contents)).errors, []);
});

test('editing the wording mints a new id and says the old link is gone', async () => {
  const { data } = await sandbox([quote(ONE)]);
  const fixed = 'The unexamined life is not worth living for a human being.';
  const result = await edit(`### Quote id\n\n${quoteId(ONE)}\n\n### Quote\n\n${fixed}\n`, { data });

  assert.equal(result.newId, quoteId(fixed));
  assert.notEqual(result.newId, quoteId(ONE));
  // The invariant that keeps every permalink honest: the id is the hash of the
  // text it is attached to, before and after any edit.
  const written = JSON.parse(result.files[0].contents);
  for (const record of written.quotes) assert.equal(record.id, quoteId(record.text));
  assert.deepEqual(validateCollection(written).errors, []);
});

test('a punctuation-only correction keeps the permalink', async () => {
  const clumsy = 'All men are enemies. All animals are comrades';
  const { data } = await sandbox([quote(clumsy)]);
  const fixed = `${clumsy}.`;
  const result = await edit(`### Quote id\n\n${quoteId(clumsy)}\n\n### Quote\n\n${fixed}\n`, { data });

  // The id normalises punctuation away, so this genuinely is the same quote.
  // Reporting a new link here would be a false alarm, and a false alarm on the
  // one warning that is sometimes real is worse than no warning.
  assert.equal(result.after.text, fixed);
  assert.equal(result.after.id, quoteId(clumsy));
  assert.equal(result.newId, null);
});

test('editing a quote that is not there says so', async () => {
  const { data } = await sandbox([quote(ONE)]);
  await assert.rejects(
    edit('### Quote id\n\nq_000000000000\n\n### Author\n\nPlato\n', { data }),
    /no quote with the id/i,
  );
});

test('an author alias is applied on the way in, so one person stays one person', async () => {
  const { data } = await sandbox([quote(ONE)]);
  const result = await edit(`### Quote id\n\n${quoteId(ONE)}\n\n### Author\n\nFyodor Dostoyevsky\n`, { data });
  assert.equal(result.after.author, 'Fyodor Dostoevsky');
});

/* --------------------------------------------------------------------------
 * Seeds add; they never take away
 * ------------------------------------------------------------------------ */

test('merge-seeds does not delete curated quotes that no seed file contains', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'scripts', 'merge-seeds.mjs'), 'utf8');

  // It used to sweep out any `curated` quote missing from a seed file, on the
  // assumption that curated meant seeded. The quote-mine skill files its picks
  // through the issue workflow with the same source kind, so on 30 Jul 2026 one
  // run of this script silently deleted sixteen hand-picked quotes: 205 in,
  // 189 out. Removal belongs to curate.mjs, which leaves a record and can be
  // undone.
  assert.doesNotMatch(source, /retired/,
    'merge-seeds is additive: removal goes through curate.mjs and data/removed.json');
  assert.doesNotMatch(source, /collection\.filter\(\(quote\) => !seededIds/,
    'the retire sweep is back, and it cannot tell a seeded quote from a hand-picked one');
});

test('nothing removed on 30 Jul 2026 has crept back in', async () => {
  const collection = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'quotes.json'), 'utf8'));
  const tombs = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'removed.json'), 'utf8'));
  const live = new Set(collection.quotes.map((q) => q.id));

  // Deliberately about the removal, not about a whitelist of works. An earlier
  // version of this test froze "only these three works may be curated", which
  // was true the day it was written and wrong two days later when a board pick
  // added a fourth. A test that has to be edited every time the collection
  // grows is a test that gets deleted.
  const back = tombs.removed.filter((entry) => live.has(entry.id)).map((entry) => entry.id);
  assert.deepEqual(back, [], 'these were removed and are in the collection again');
});

test('every removed quote is really gone, and every tombstone keeps its text', async () => {
  const collection = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'quotes.json'), 'utf8'));
  const tombs = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'removed.json'), 'utf8'));
  const live = new Set(collection.quotes.map((q) => q.id));

  for (const entry of tombs.removed) {
    assert.ok(!live.has(entry.id), `${entry.id} is tombstoned but still in the collection`);
    // Without the text a tombstone is a hash nobody can turn back into a quote,
    // which would make the deletion final rather than reversible.
    assert.ok(entry.text && entry.text.length > 1, `${entry.id} has no text to restore from`);
    assert.equal(quoteId(entry.text), entry.id, `${entry.id} does not match its own stored text`);
  }
});

test('every removal is traceable back to the quote it took', async () => {
  const tombs = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'removed.json'), 'utf8'));

  // The fourth of my tests here to demand more than the design promises. This
  // one required a reason on every tombstone — but the Reason field on the
  // removal form is explicitly optional, and pressing Remove without typing one
  // is the normal case. Twenty-seven perfectly good removals failed it.
  //
  // What the design does guarantee, and what actually matters, is that a
  // removal can be undone: a date, and text that still hashes to its own id.
  // Without the text a tombstone is a hash nobody can turn back into a quote.
  const broken = [];
  for (const entry of tombs.removed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.removedAt ?? '')) broken.push(`${entry.id}: no date`);
    if (!entry.text) broken.push(`${entry.id}: no text to restore from`);
    else if (quoteId(entry.text) !== entry.id) broken.push(`${entry.id}: text does not hash to its id`);
    if (!entry.author) broken.push(`${entry.id}: no author`);
  }
  assert.deepEqual(broken, [], 'these removals cannot be undone from what was recorded');

  // The one historical fact worth pinning: the 30 Jul 2026 clear-out, checked
  // against the live Goodreads list from a runner (174 there, 0 missing here),
  // took only quotes that had never come from Goodreads.
  //
  // It took 44. One — Kant's formula of humanity — was deliberately lifted on
  // 2026-08-02, leaving 43. Lifting is a deletion from this file by design, so
  // it leaves no trace here and the original 44 cannot be recomputed from the
  // data: this number has to be edited by hand on every lift. It was not, and
  // the build stayed red for the nine days to 2026-08-11 without anyone
  // noticing, because a permanently red build tells you nothing.
  //
  // So treat a failure here as the question "was a tombstone lifted, and was
  // that deliberate?" — if yes, update the number and say which one.
  assert.equal(
    tombs.removed.filter((e) => e.reason?.includes('Not from the Goodreads list')).length,
    43,
  );
});

test('removing something already removed is a no-op, not a failure', async () => {
  const { data, removedFile } = await sandbox([quote(ONE), quote(TWO)]);
  const first = await remove(removalIssue([quoteId(ONE)]), { data, removedFile });
  for (const { file, contents } of first.files) await writeFile(file, contents);

  // Reopening an issue is the obvious way to retry one that did nothing, and
  // it re-runs the removal. If that came back red with "I could not do that",
  // the only recovery gesture available would look like a fresh failure.
  const again = await remove(removalIssue([quoteId(ONE)]), { data, removedFile });
  assert.equal(again.changed, false);
  assert.deepEqual(again.removed, []);
  assert.deepEqual(again.already, [quoteId(ONE)]);
  assert.match(summarize(again), /already removed, so nothing changed/i);
});

test('a mix of already-removed and unknown ids still reports the unknown one', async () => {
  const { data, removedFile } = await sandbox([quote(ONE)]);
  const first = await remove(removalIssue([quoteId(ONE)]), { data, removedFile });
  for (const { file, contents } of first.files) await writeFile(file, contents);

  await assert.rejects(
    remove(removalIssue([quoteId(ONE), 'q_000000000000']), { data, removedFile }),
    /none of those ids are in the collection: q_000000000000/i,
  );
});
