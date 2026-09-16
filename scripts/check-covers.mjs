#!/usr/bin/env node
/**
 * Check the covers under assets/covers/ against the bar the shelf needs.
 *
 * A cover fails invisibly. Nobody notices that one book is a 300px thumbnail
 * among 89 sharp ones until the grid is on a retina screen, and nobody notices
 * a 400 KB cover until the page has ninety of them and takes four seconds on a
 * phone. So the four things that matter are measured rather than eyeballed:
 *
 *   - every shelved book has a cover file where its record says
 *   - at least 500px tall, which is 2x the size it is drawn at
 *   - between 0.55 and 0.80 wide over tall, the shape of a printed book;
 *     anything squarer is a CD, a logo, or a placeholder that slipped through
 *   - at most 120 KB, so ninety of them are about 10 MB rather than 40
 *
 * What it cannot check is whether the picture is the right book's front cover.
 * That is what `npm run covers:sheet` is for: it draws all of them on one page
 * for a person to look at.
 *
 * Dimensions are read straight out of the WebP header — no dependency, and
 * decoding ninety images to learn their size would be silly anyway.
 *
 * Usage: node scripts/check-covers.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { slug } from '../assets/quote-core.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVERS = path.join(REPO_ROOT, 'assets', 'covers');

const MIN_HEIGHT = 500;
const MIN_ASPECT = 0.55;
const MAX_ASPECT = 0.80;
const MAX_BYTES = 120 * 1024;

const ESC = String.fromCharCode(27);
const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (colour ? `${ESC}[${code}m${text}${ESC}[0m` : text);
const red = (text) => paint(31, text);
const green = (text) => paint(32, text);
const dim = (text) => paint(2, text);

/**
 * Width and height from a WebP file's header.
 *
 * Three encodings, because a WebP is a RIFF container and the chunk inside it
 * can be any of: `VP8 ` lossy, `VP8L` lossless, `VP8X` extended (which is what
 * an animated or alpha-carrying file uses, and which states the canvas size up
 * front). Anything else is not a WebP this script will vouch for.
 */
export function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  const fourCC = buffer.toString('ascii', 12, 16);
  const payload = 20; // RIFF header (12) + chunk fourCC (4) + chunk length (4)

  if (fourCC === 'VP8 ') {
    // Frame tag (3 bytes), sync code 9d 01 2a (3 bytes), then two 14-bit
    // dimensions; the top two bits of each are a scale factor, not size.
    if (buffer[payload + 3] !== 0x9d || buffer[payload + 4] !== 0x01 || buffer[payload + 5] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(payload + 6) & 0x3fff,
      height: buffer.readUInt16LE(payload + 8) & 0x3fff,
    };
  }

  if (fourCC === 'VP8L') {
    if (buffer[payload] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(payload + 1);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }

  if (fourCC === 'VP8X') {
    // Flags (4 bytes), then canvas width - 1 and height - 1 as 24-bit LE.
    const at = payload + 4;
    return {
      width: (buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16)) + 1,
      height: (buffer[at + 3] | (buffer[at + 4] << 8) | (buffer[at + 5] << 16)) + 1,
    };
  }

  return null;
}

async function main() {
  const registry = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'works.json'), 'utf8'));
  const books = (registry.works ?? []).filter((work) => work.kind === 'book');

  const problems = [];
  const measured = [];
  const referenced = new Set();

  for (const work of books) {
    const where = work.title;

    if (!work.cover) {
      // A book on a shelf has to have one. A non-book, or a book quoted long
      // before the library arrived, may have a typographic cover instead.
      if (work.shelf) problems.push(`${where}: on the "${work.shelf}" shelf with no cover`);
      continue;
    }
    if (work.cover !== `assets/covers/${slug(work.title)}.webp`) {
      problems.push(`${where}: cover is "${work.cover}", expected assets/covers/${slug(work.title)}.webp`);
    }
    referenced.add(path.basename(work.cover));

    let buffer;
    try {
      buffer = await readFile(path.join(REPO_ROOT, work.cover));
    } catch {
      problems.push(`${where}: ${work.cover} is in the registry but not on disk`);
      continue;
    }

    const size = webpSize(buffer);
    if (!size) {
      problems.push(`${where}: ${work.cover} is not a WebP this can read`);
      continue;
    }

    // The registry states the pixel size so the page can reserve the right box
    // before the image arrives. A stated size that disagrees with the file is
    // worse than none: the page would lay out to a shape the cover is not.
    const stated = work.coverSize;
    if (!Array.isArray(stated) || stated.length !== 2 || !stated.every(Number.isInteger)) {
      problems.push(`${where}: coverSize is ${JSON.stringify(stated)}, expected [${size.width}, ${size.height}]`);
    } else if (stated[0] !== size.width || stated[1] !== size.height) {
      problems.push(`${where}: coverSize says ${stated[0]}x${stated[1]}, the file is ${size.width}x${size.height}`);
    }

    const aspect = size.width / size.height;
    if (size.height < MIN_HEIGHT) {
      problems.push(`${where}: ${size.width}x${size.height}, under ${MIN_HEIGHT}px tall`);
    }
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
      problems.push(`${where}: ${size.width}x${size.height}, aspect ${aspect.toFixed(2)} outside ${MIN_ASPECT}-${MAX_ASPECT}`);
    }
    if (buffer.length > MAX_BYTES) {
      problems.push(`${where}: ${Math.round(buffer.length / 1024)} KB, over ${MAX_BYTES / 1024} KB`);
    }
    measured.push({ ...size, bytes: buffer.length, soft: /\+upscaled$/.test(work.coverSource ?? '') });
  }

  // A cover nobody points at is dead weight, and usually the sign of a title
  // that was renamed while its record was not. A note, not a failure: it
  // breaks nothing on the page.
  let orphans = [];
  try {
    const files = await readdir(COVERS);
    orphans = files.filter((file) => file.endsWith('.webp') && !referenced.has(file));
  } catch { /* no covers directory at all; the missing-cover errors say so */ }

  const total = measured.reduce((sum, cover) => sum + cover.bytes, 0);
  const shortest = measured.length ? Math.min(...measured.map((cover) => cover.height)) : 0;
  const heaviest = measured.length ? Math.max(...measured.map((cover) => cover.bytes)) : 0;
  const soft = measured.filter((cover) => cover.soft).length;

  const summary = `${measured.length} covers, ${Math.round(total / 1024)} KB in all, `
    + `shortest ${shortest}px, heaviest ${Math.round(heaviest / 1024)} KB`
    + (soft ? `, ${soft} upscaled to the floor` : '');

  if (problems.length) {
    process.stdout.write(`${red('bad')} covers ${dim(`(${summary})`)}\n`);
    for (const problem of problems) process.stdout.write(`      ${red('error')}   ${problem}\n`);
    for (const orphan of orphans) process.stdout.write(`      ${dim(`unused    assets/covers/${orphan}`)}\n`);
    process.stdout.write(`\n${red(`${problems.length} problem${problems.length === 1 ? '' : 's'}`)} with the covers.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${green('ok')}  covers ${dim(`(${summary})`)}\n`);
  for (const orphan of orphans) process.stdout.write(`      ${dim(`unused    assets/covers/${orphan}`)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`check-covers failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
