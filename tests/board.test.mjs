/**
 * Tests for the board — the door a weekly routine proposes through and the
 * owner accepts through.
 *
 * Nothing else in the repository depends on two files agreeing: the issue
 * carries only ids, and the words themselves come from data/proposals.json. So
 * the failures worth catching are the ones where that indirection goes wrong
 * quietly — a pick resolving to the wrong record, a selection being half
 * imported, or the scout's own bookkeeping leaking into the collection with the
 * quote. A board that silently files eight of nine ticks is worse than one that
 * refuses, because nobody re-counts.
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { quoteId } from '../assets/quote-core.js';
import { ingest } from '../scripts/ingest.mjs';

const KEPT = 'Basic research is performed without thought of practical ends.';
const OTHER = 'Economic problems arise always and only in consequence of change.';

function proposal(text, extra = {}) {
  return {
    id: quoteId(text),
    text,
    author: 'Someone',
    work: 'A Report',
    workKind: 'document',
    year: 1945,
    source: { kind: 'curated', url: 'https://example.org/report', locator: 'ch. 6' },
    themes: ['science'],
    tags: ['policy'],
    verification: { status: 'verified', note: 'Read in the report.' },
    lang: 'en',
    why: 'because it commits',
    shownOn: ['2026-07-30'],
    status: 'open',
    ...extra,
  };
}

/** A board and an empty collection, in a directory this test owns. */
async function fixture(proposals) {
  const dir = await mkdtemp(path.join(tmpdir(), 'board-'));
  const data = path.join(dir, 'quotes.json');
  const board = path.join(dir, 'proposals.json');
  const removed = path.join(dir, 'removed.json');
  await writeFile(data, JSON.stringify({ schemaVersion: 1, quotes: [] }));
  await writeFile(board, JSON.stringify({ schemaVersion: 1, proposals }));
  await writeFile(removed, JSON.stringify({ removed: [] }));
  return { data, proposals: board, removedFile: removed };
}

const body = (ids, context = 'whatever') =>
  `### Picks\n\n${ids.join('\n')}\n\n### What these are\n\n${context}\n`;

test('a ticked id becomes the quote the board was showing', async () => {
  const files = await fixture([proposal(KEPT), proposal(OTHER)]);
  const result = await ingest(body([quoteId(KEPT)]), { ...files, addedAt: '2026-07-30' });

  assert.equal(result.mode, 'board');
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].text, KEPT);
  assert.equal(result.added[0].verification.status, 'verified');
  assert.equal(result.added[0].source.locator, 'ch. 6');
});

test('the scout\'s bookkeeping does not travel into the collection', async () => {
  const files = await fixture([proposal(KEPT)]);
  const result = await ingest(body([quoteId(KEPT)]), { ...files, addedAt: '2026-07-30' });

  const [added] = result.added;
  for (const field of ['why', 'shownOn', 'status']) {
    assert.equal(field in added, false, `${field} leaked into the quote`);
  }
});

test('an id the board does not know fails the whole issue rather than part of it', async () => {
  const files = await fixture([proposal(KEPT), proposal(OTHER)]);
  await assert.rejects(
    () => ingest(body([quoteId(KEPT), 'q_000000000000']), { ...files, addedAt: '2026-07-30' }),
    /no line with the id q_000000000000/,
  );
});

test('ticking nothing says so instead of importing an empty selection', async () => {
  const files = await fixture([proposal(KEPT)]);
  await assert.rejects(
    () => ingest(body(['_No response_']), { ...files, addedAt: '2026-07-30' }),
    /No lines were ticked/,
  );
});

test('the prose section below the picks is not read as an id', async () => {
  const files = await fixture([proposal(KEPT)]);
  const result = await ingest(
    body([quoteId(KEPT)], 'Someone: Basic research is performed without thought of practical ends.'),
    { ...files, addedAt: '2026-07-30' },
  );
  assert.equal(result.added.length, 1);
});

test('a board issue is recognised without being told which form it came from', async () => {
  const files = await fixture([proposal(KEPT)]);
  const result = await ingest(body([quoteId(KEPT)]), { ...files, mode: 'auto', addedAt: '2026-07-30' });
  assert.equal(result.mode, 'board');
});
