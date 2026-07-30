#!/usr/bin/env node
/**
 * Check data/works.json, the registry every objective facet is built from.
 *
 * Worth its own check because of how this file fails. A broken quote is
 * visibly a broken quote. A work missing from the registry is invisible: its
 * quotes simply have no subject and no era, so they vanish from both filters
 * and the shelf while still reading perfectly on the page. "No quotes from
 * that book" and "that book is not in the registry" look identical from the
 * outside, and only one of them is true.
 *
 * So the cross-check runs both ways — every quoted work must be registered,
 * and a registered work with no quotes is worth a warning — and it runs on
 * every push rather than being something anyone has to remember.
 *
 * Usage: node scripts/validate-works.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ERAS, SUBJECTS, eraFor, validateWorks } from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `[${code}m${text}[0m` : text);
const red = (text) => paint(31, text);
const green = (text) => paint(32, text);
const yellow = (text) => paint(33, text);
const dim = (text) => paint(2, text);

async function main() {
  let registry;
  let collection;
  try {
    registry = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'works.json'), 'utf8'));
    collection = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'quotes.json'), 'utf8'));
  } catch (error) {
    process.stderr.write(`could not read the data files: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const { errors, warnings } = validateWorks(registry, collection);
  const works = registry.works ?? [];

  const undated = works.filter((work) => eraFor(work.year) === null);
  if (undated.length) {
    warnings.push(`no era, because no year: ${undated.map((work) => work.title).join(', ')}`);
  }

  const label = `data/works.json ${dim(`(${works.length} works)`)}`;
  if (!errors.length && !warnings.length) {
    process.stdout.write(`${green('ok')}  ${label}\n`);
    return;
  }

  process.stdout.write(`${errors.length ? red('bad') : yellow('hm ')} ${label}\n`);
  for (const error of errors) process.stdout.write(`      ${red('error')}   ${error}\n`);
  for (const warning of warnings) process.stdout.write(`      ${yellow('warning')} ${warning}\n`);

  if (errors.length) {
    process.stdout.write(`\n${red(`${errors.length} error${errors.length === 1 ? '' : 's'}`)} in the work registry.\n`);
    process.exitCode = 1;
    return;
  }

  const spread = ERAS.filter((era) => works.some((work) => eraFor(work.year) === era.id));
  process.stdout.write(`\nThe registry is in good order, spanning ${spread.length} eras.\n`);
}

main().catch((error) => {
  process.stderr.write(`validate-works failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
