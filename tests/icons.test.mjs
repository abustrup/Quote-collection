/**
 * The site's icon, written down as things that can be checked without a
 * browser [2026-11-24].
 *
 * Every page links the same three files in the same order: the 32 px PNG with
 * its size first (without `sizes`, Chrome can take it over the SVG), then the
 * SVG master, then the Home Screen icon. The PNGs are drawn from SVG masters by
 * scripts/draw-icons.mjs, and each carries the SHA-256 of the master it came
 * from, so a master edited without `npm run icons` fails here instead of
 * leaving Safari and the iPhone on the old picture.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(REPO_ROOT, name));

const LINKS = [
  '<link rel="icon" href="assets/favicon-32.png" type="image/png" sizes="32x32">',
  '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">',
];

const COPIES = [
  { png: 'assets/favicon-32.png', master: 'assets/favicon.svg', size: 32 },
  { png: 'assets/apple-touch-icon.png', master: 'assets/apple-touch-icon.svg', size: 180 },
];

const pages = async () => (await readdir(REPO_ROOT)).filter((name) => name.endsWith('.html')).sort();

/** IHDR, the joined IDAT and the tEXt chunks of a PNG. */
function parsePng(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'not a PNG');
  const png = { text: {}, idat: [] };
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      Object.assign(png, {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9], interlace: body[12],
      });
    } else if (type === 'IDAT') {
      png.idat.push(body);
    } else if (type === 'tEXt') {
      const split = body.indexOf(0);
      png.text[body.toString('latin1', 0, split)] = body.toString('latin1', split + 1);
    }
    offset += 12 + length;
  }
  return png;
}

/** The alpha of every pixel, row by row: 255 throughout for a PNG with no alpha channel. */
function alphaOf(png) {
  const channels = { 2: 3, 6: 4 }[png.colorType];
  assert.ok(channels && png.depth === 8 && png.interlace === 0,
    `unexpected PNG format: colour type ${png.colorType}, depth ${png.depth}, interlace ${png.interlace}`);
  if (channels === 3) return new Uint8Array(png.width * png.height).fill(255);
  const raw = inflateSync(Buffer.concat(png.idat));
  const stride = png.width * channels;
  const pixels = new Uint8Array(png.height * stride);
  for (let y = 0; y < png.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  return Uint8Array.from({ length: png.width * png.height }, (_, i) => pixels[i * 4 + 3]);
}

test('every page links the 32 px PNG, then the SVG, then the Home Screen icon', async () => {
  const names = await pages();
  assert.ok(names.length >= 5, `expected the five pages, found ${names.join(', ')}`);
  for (const name of names) {
    const html = (await read(name)).toString('utf8');
    let previous = -1;
    for (const link of LINKS) {
      const at = html.indexOf(link);
      assert.ok(at > previous, `${name}: missing or out of order: ${link}`);
      previous = at;
    }
    assert.equal(html.match(/rel="icon"/g)?.length, 2, `${name}: exactly two rel="icon" links`);
    assert.equal(html.match(/rel="apple-touch-icon"/g)?.length, 1, `${name}: exactly one apple-touch-icon`);
  }
});

test('the PNG copies are the sizes their links promise', async () => {
  for (const { png, size } of COPIES) {
    const { width, height } = parsePng(await read(png));
    assert.deepEqual([width, height], [size, size], png);
  }
});

test('each PNG was drawn from its master as it is now (run npm run icons if not)', async () => {
  for (const { png, master } of COPIES) {
    const hash = createHash('sha256').update(await read(master)).digest('hex');
    assert.equal(parsePng(await read(png)).text.Source, `${master} sha256:${hash}`, png);
  }
});

test('the Home Screen icon has no transparent pixel, because iOS paints them black', async () => {
  const alpha = alphaOf(parsePng(await read('assets/apple-touch-icon.png')));
  assert.equal(alpha.filter((value) => value < 255).length, 0);
});

test('the tab icon keeps its rounded corners see-through, like the SVG it copies', async () => {
  const png = parsePng(await read('assets/favicon-32.png'));
  const alpha = alphaOf(png);
  const at = (x, y) => alpha[y * png.width + x];
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) assert.equal(at(x, y), 0, `corner ${x},${y}`);
  assert.equal(at(16, 2), 255, 'the tile itself is opaque');
});

test('the masters are outlines only: no text, no font, nothing fetched', async () => {
  for (const { master } of COPIES) {
    const svg = (await read(master)).toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1">/, `${master}: square viewBox`);
    for (const banned of ['<text', 'font', '<image', 'href', '@import', 'url(']) {
      assert.ok(!svg.includes(banned), `${master} contains ${banned}`);
    }
  }
});
