/**
 * Retire lines from the board.
 *
 * The counterpart to the "keep" path in scripts/ingest.mjs, and the reason it
 * exists: until now the board could only carry a yes. With no way to say no,
 * "he never opened the page" and "he read every line and passed" were the same
 * event in the data and opposite events in his head, so the scout inferred a
 * rejection by showing a line twice and waiting. This turns the guess into an
 * answer.
 *
 * What it may touch, and what it may not:
 *
 *   data/proposals.json   flips `status` from `open` to `expired`. That is all.
 *   data/quotes.json      never opened. Not for reading, not for writing.
 *
 * The asymmetry is deliberate. The keep path needs write access to the
 * collection and is therefore guarded hard; this path only ever marks the
 * scout's own suggestions as answered, so the blast radius of a bug here is a
 * proposal that stops being offered — recoverable by hand, and never a change
 * to a single quote the owner chose.
 *
 * One thing it refuses on purpose: a proposal whose id is already a quote in
 * the collection. That means it was kept, and "retire" would be a
 * contradiction — almost certainly a stale board page submitted after the line
 * was filed. It is reported rather than applied.
 *
 * Usage:
 *   node scripts/retire-proposals.mjs --body-env ISSUE_BODY
 *   node scripts/retire-proposals.mjs --body-file body.md --dry-run
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The heading the form writes, and the only section this script reads. */
const SECTION = 'Retire';

/** An id as `quoteId` produces them: `q_` and twelve lowercase hex digits. */
const ID = /^q_[0-9a-f]{12}$/;

function parseArgs(argv) {
  const options = {
    proposals: path.join(REPO_ROOT, 'data', 'proposals.json'),
    quotes: path.join(REPO_ROOT, 'data', 'quotes.json'),
    body: null,
    summaryFile: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${argv[i]} needs a value`);
      i += 1;
      return v;
    };
    switch (argv[i]) {
      case '--body-env': options.bodyEnv = next(); break;
      case '--body-file': options.bodyFile = next(); break;
      case '--proposals': options.proposals = path.resolve(next()); break;
      case '--quotes': options.quotes = path.resolve(next()); break;
      case '--summary-file': options.summaryFile = path.resolve(next()); break;
      case '--dry-run': options.dryRun = true; break;
      default: throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return options;
}

/**
 * The ids under `### Retire`.
 *
 * Scoped to that one section rather than scraped from the whole body, so that
 * an id quoted in the free-text "why" box — the likeliest place for someone to
 * mention a line they are *not* retiring — cannot be swept up by accident.
 */
function idsFrom(body) {
  const lines = String(body).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().replace(/^#+\s*/, '') === SECTION
    && /^#+\s/.test(line.trim()));
  if (start === -1) return [];

  const ids = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#+\s/.test(lines[i].trim())) break;
    const value = lines[i].trim();
    if (ID.test(value)) ids.push(value);
  }
  return [...new Set(ids)];
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const body = options.bodyEnv
    ? process.env[options.bodyEnv] ?? ''
    : options.bodyFile
      ? await readFile(options.bodyFile, 'utf8')
      : '';

  const ids = idsFrom(body);
  if (ids.length === 0) {
    throw new Error(
      'I could not find any board ids under a "### Retire" heading. '
      + 'This form is meant to be opened from the board, which fills it in.',
    );
  }

  const board = await readJson(options.proposals);
  const proposals = board.proposals ?? [];
  const byId = new Map(proposals.map((p) => [p.id, p]));

  // Read-only, and the only reason quotes.json is opened at all: to refuse to
  // retire something that was in fact kept.
  const kept = new Set((await readJson(options.quotes)).quotes.map((q) => q.id));

  const retired = [];
  const already = [];
  const wasKept = [];
  const unknown = [];

  for (const id of ids) {
    const proposal = byId.get(id);
    if (!proposal) { unknown.push(id); continue; }
    if (kept.has(id)) { wasKept.push(proposal); continue; }
    if (proposal.status === 'expired') { already.push(proposal); continue; }
    proposal.status = 'expired';
    retired.push(proposal);
  }

  if (retired.length > 0 && !options.dryRun) {
    board.updatedAt = board.updatedAt ?? null;
    await writeFile(options.proposals, `${JSON.stringify(board, null, 2)}\n`);
  }

  const short = (p) => `${p.author}: ${p.text.slice(0, 70)}${p.text.length > 70 ? '…' : ''}`;
  const lines = [];
  if (retired.length) {
    lines.push(`Retired ${retired.length} line${retired.length === 1 ? '' : 's'}. `
      + 'The scout will not propose them again, in any wording.');
    lines.push('', ...retired.map((p) => `- ${short(p)}`));
  }
  if (already.length) {
    lines.push('', already.length === 1 ? '1 was already retired.' : `${already.length} were already retired.`);
  }
  if (wasKept.length) {
    lines.push('', wasKept.length === 1
      ? '1 could not be retired because it is already in the collection:'
      : `${wasKept.length} could not be retired because they are already in the collection:`,
      ...wasKept.map((p) => `- ${short(p)}`));
  }
  if (unknown.length) {
    lines.push('', `These ids are not on the board — it was probably replaced while the page was open: ${unknown.join(', ')}.`);
  }
  if (retired.length === 0) lines.unshift('Nothing changed.');

  const summary = lines.join('\n');
  if (options.summaryFile) await writeFile(options.summaryFile, `${summary}\n`);
  process.stdout.write(`${summary}\n`);

  if (retired.length === 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
