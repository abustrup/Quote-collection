/**
 * Tests for scripts/validate.mjs.
 *
 * These exist because of a real failure: the validator demanded an `id` on
 * every quote, while the seed format under `data/seed/` deliberately omits it
 * — the id is a hash of the quote's own text and is derived on the way in. The
 * two halves of the project disagreed about what a valid file looked like, and
 * nothing caught it until CI went red.
 *
 * The script is run as a subprocess rather than imported, because its exit code
 * is the thing CI actually depends on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'validate.mjs');
const SEED_DIR = path.join(REPO_ROOT, 'data', 'seed');

/** A seed entry as a curator actually writes one: no id, no derived fields. */
const DRAFT = {
  text: 'A line that a person typed out by hand.',
  author: 'Someone Real',
  work: 'A Book',
  year: 1958,
  themes: ['knowledge'],
  verification: { status: 'reported' },
};

async function validate(file) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, file], { cwd: REPO_ROOT });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** Write a throwaway seed file, run the validator over it, then clean up. */
async function withSeedFile(name, contents, body) {
  const file = path.join(SEED_DIR, name);
  await mkdir(SEED_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(contents, null, 2));
  try {
    return await body(file);
  } finally {
    await rm(file, { force: true });
  }
}

test('a seed draft without ids is accepted', async () => {
  const result = await withSeedFile('zz-test-valid.json', [DRAFT], validate);
  assert.equal(result.code, 0, `expected a clean run, got:\n${result.stdout}`);
});

test('a seed draft is still checked for everything other than its id', async () => {
  const broken = [
    { ...DRAFT, themes: ['not-a-real-theme'] },
    { ...DRAFT, text: 'Another line entirely.', year: 9999 },
    { ...DRAFT, text: 'A third line.', author: '' },
  ];

  const result = await withSeedFile('zz-test-broken.json', broken, validate);
  assert.equal(result.code, 1, 'a draft with real problems must fail');
  assert.match(result.stdout, /unknown theme "not-a-real-theme"/);
  assert.match(result.stdout, /implausible year 9999/);
  assert.match(result.stdout, /author is missing/);
});

test('the published collection is still held to its ids', async () => {
  // The relaxation must not leak out of data/seed: a quote whose id does not
  // match its own text would break that quote's permalink for good.
  const file = path.join(REPO_ROOT, 'data', 'quotes.json');
  const result = await validate(file);
  assert.equal(result.code, 0, `data/quotes.json should be valid, got:\n${result.stdout}`);
});

test('the repository as it stands validates end to end', async () => {
  // No arguments: the collection plus every seed file, exactly as CI runs it.
  const { stdout } = await run(process.execPath, [SCRIPT], { cwd: REPO_ROOT });
  assert.match(stdout, /good order/);
});
