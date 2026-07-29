#!/usr/bin/env node
/**
 * Check the collection before it reaches anyone.
 *
 * This runs on every push and in every pull request, and it is the reason the
 * data file can be edited from a phone without fear: a broken id, a theme that
 * is not in the vocabulary, or a quote that lost its author cannot reach the
 * published site without turning CI red first.
 *
 * The rules live in `assets/quote-core.js` alongside the code that creates
 * quotes, so the checker and the maker can never drift apart. This file only
 * decides which files to check and how to say what it found.
 *
 * Usage:
 *   node scripts/validate.mjs [file...]
 *
 * With no arguments it checks `data/quotes.json` and every `data/seed/*.json`.
 * Exits non-zero when anything is wrong; warnings alone do not fail the build.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SCHEMA_VERSION, validateCollection } from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';
const COLOUR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = (code, text) => (COLOUR ? `\u001B[${code}m${text}\u001B[0m` : text);
const dim = (text) => paint('2', text);
const red = (text) => paint('31', text);
const yellow = (text) => paint('33', text);
const green = (text) => paint('32', text);

/**
 * Emit a GitHub Actions annotation so a failure appears on the file itself in
 * the run summary, rather than only inside the log.
 */
function annotate(level, file, message) {
  if (!IN_ACTIONS) return;
  const relative = path.relative(REPO_ROOT, file);
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  process.stdout.write(`::${level} file=${relative}::${escaped}\n`);
}

/**
 * Seed files may be stored as a bare array of quotes rather than a whole
 * collection — they are fragments, not the collection itself. Wrap those so the
 * one set of rules applies to both.
 */
function asCollection(parsed) {
  if (Array.isArray(parsed)) return { schemaVersion: SCHEMA_VERSION, quotes: parsed };
  return parsed;
}

async function checkFile(file, { required }) {
  const relative = path.relative(REPO_ROOT, file);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && !required) return { errors: [], warnings: [], skipped: true };
    const message = error.code === 'ENOENT'
      ? `${relative} is missing — the collection file has to exist.`
      : `${relative} could not be read: ${error.message}`;
    annotate('error', file, message);
    return { errors: [message], warnings: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = `${relative} is not valid JSON: ${error.message}`;
    annotate('error', file, message);
    return { errors: [message], warnings: [] };
  }

  const { errors, warnings } = validateCollection(asCollection(parsed));
  for (const error of errors) annotate('error', file, error);
  for (const warning of warnings) annotate('warning', file, warning);

  const count = Array.isArray(asCollection(parsed).quotes) ? asCollection(parsed).quotes.length : 0;
  return { errors, warnings, count };
}

async function seedFiles() {
  const directory = path.join(REPO_ROOT, 'data', 'seed');
  try {
    const entries = await readdir(directory);
    return entries
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(directory, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function report(relative, result) {
  const { errors, warnings, count } = result;
  const tally = count === undefined ? '' : dim(` (${count} ${count === 1 ? 'quote' : 'quotes'})`);

  if (errors.length === 0 && warnings.length === 0) {
    process.stdout.write(`${green('ok')}  ${relative}${tally}\n`);
    return;
  }

  const badge = errors.length > 0 ? red('bad') : yellow('hm ');
  process.stdout.write(`${badge} ${relative}${tally}\n`);
  for (const error of errors) process.stdout.write(`      ${red('error')}   ${error}\n`);
  for (const warning of warnings) process.stdout.write(`      ${yellow('warning')} ${warning}\n`);
}

async function main() {
  const explicit = process.argv.slice(2).map((file) => path.resolve(file));
  const targets = explicit.length > 0
    ? explicit.map((file) => ({ file, required: true }))
    : [
      { file: path.join(REPO_ROOT, 'data', 'quotes.json'), required: true },
      ...(await seedFiles()).map((file) => ({ file, required: false })),
    ];

  let errorCount = 0;
  let warningCount = 0;

  for (const { file, required } of targets) {
    const result = await checkFile(file, { required });
    if (result.skipped) continue;
    errorCount += result.errors.length;
    warningCount += result.warnings.length;
    report(path.relative(REPO_ROOT, file), result);
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (errorCount > 0) {
    process.stdout.write(`\n${red(plural(errorCount, 'error'))}, ${plural(warningCount, 'warning')}.\n`);
    process.exitCode = 1;
    return;
  }
  if (warningCount > 0) {
    process.stdout.write(`\nNo errors, ${yellow(plural(warningCount, 'warning'))}.\n`);
    return;
  }
  process.stdout.write('\nThe collection is in good order.\n');
}

main().catch((error) => {
  process.stderr.write(`validate failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
