/**
 * Every issue form must reach a workflow.
 *
 * This is the failure that motivated the file. GitHub applies a template's
 * declared label only if that label already exists on the repository, and
 * `quote`, `quote-remove` and `quote-edit` never did. So the forms opened
 * unlabelled issues, the workflows' label conditions never matched, and
 * nothing ran — no error, no comment, nothing to notice. Four removal issues
 * covering 30 quotes sat unprocessed for two days, and the single-quote add
 * form had never worked at all.
 *
 * A label lives in repository settings, which no test can see. A heading lives
 * in the form and travels in the issue body, which is checkable here. So the
 * rule this file enforces is: every form is routable by something that is in
 * the repository, not only by something someone has to have remembered to
 * create.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMS = path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE');
const WORKFLOWS = path.join(REPO_ROOT, '.github', 'workflows');

async function issueForms() {
  const names = (await readdir(FORMS)).filter((n) => n.endsWith('.yml') && n !== 'config.yml');
  return Promise.all(names.map(async (name) => {
    const text = await readFile(path.join(FORMS, name), 'utf8');
    return {
      name,
      labels: (/^labels:\s*\[(.+)\]/m.exec(text)?.[1] ?? '')
        .split(',').map((l) => l.trim().replace(/^["']|["']$/g, '')).filter(Boolean),
      // The first `label:` in a form is the heading GitHub writes as `### …`
      // at the top of the body, which is what a workflow can match on.
      headings: [...text.matchAll(/^\s*label:\s*(.+)$/gm)]
        .map((m) => m[1].trim().replace(/^["']|["']$/g, '')),
    };
  }));
}

async function routingConditions() {
  const names = (await readdir(WORKFLOWS)).filter((n) => n.endsWith('.yml'));
  const out = new Map();
  for (const name of names) out.set(name, await readFile(path.join(WORKFLOWS, name), 'utf8'));
  return out;
}

test('every issue form is routable by a heading, not only by a label', async () => {
  const forms = await issueForms();
  const workflows = [...(await routingConditions()).values()].join('\n');

  const unroutable = [];
  for (const form of forms) {
    const byHeading = form.headings.some((h) => workflows.includes(`### ${h}`));
    if (!byHeading) unroutable.push(`${form.name} (labels: ${form.labels.join(', ') || 'none'})`);
  }

  assert.deepEqual(unroutable, [],
    'these forms only reach a workflow if their label happens to exist on the repository, '
    + 'which is not something this repository controls — add a `### Heading` fallback to the workflow condition');
});

test('a form that declares a label still has that label checked somewhere', async () => {
  const forms = await issueForms();
  const workflows = [...(await routingConditions()).values()].join('\n');

  for (const form of forms) {
    for (const label of form.labels) {
      assert.ok(
        workflows.includes(`'${label}'`),
        `${form.name} declares the label "${label}" but no workflow looks for it`,
      );
    }
  }
});

test('the longer heading is tested first, or the shorter one swallows it', async () => {
  const workflows = await routingConditions();

  // `### Quote id` is a prefix of `### Quote ids`, and `### Quote` of
  // `### Quotes`. A MODE expression that tests the shorter one first routes
  // every removal as an edit and every bulk import as a single quote.
  const pairs = [
    ['curate-quote.yml', '### Quote ids', '### Quote id'],
    ['ingest-quote.yml', '### Quotes', '### Quote'],
  ];

  for (const [file, longer, shorter] of pairs) {
    const text = workflows.get(file);
    assert.ok(text, `${file} is missing`);
    for (const line of text.split('\n').filter((l) => l.includes('MODE:'))) {
      const a = line.indexOf(longer);
      const b = line.indexOf(shorter);
      if (a === -1 && b === -1) continue;
      assert.ok(a !== -1, `${file}: MODE tests "${shorter}" but never "${longer}"`);
      assert.ok(a <= b || b === -1,
        `${file}: MODE tests "${shorter}" before "${longer}", so the longer form never matches`);
    }
  }
});
