#!/usr/bin/env node
/**
 * Draws the PNG copies of the site's icon from its SVG masters [2026-11-24].
 *
 *   assets/favicon.svg          -> assets/favicon-32.png        32 x 32, for browsers
 *                                  that take no SVG tab icon
 *   assets/apple-touch-icon.svg -> assets/apple-touch-icon.png  180 x 180, the iPhone
 *                                  and iPad Home Screen icon
 *
 * Every page links both PNGs and the SVG itself (tests/icons.test.mjs holds the
 * links, the sizes and the opaque Home Screen icon). Run `npm run icons` after
 * changing a master and commit the two PNGs with it; nothing else writes them.
 * Each PNG carries the SHA-256 of the master it was drawn from, in a text chunk
 * browsers ignore, so the tests can tell when a copy has fallen behind.
 *
 * Headless Chrome draws them over the DevTools Protocol, as in check-ui.mjs, so
 * the copies come from the same engine that draws the SVG in a Chrome tab and
 * the site keeps its rule of no npm dependencies.
 */

import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ICONS = [
  { master: 'assets/favicon.svg', out: 'assets/favicon-32.png', size: 32 },
  { master: 'assets/apple-touch-icon.svg', out: 'assets/apple-touch-icon.png', size: 180 },
];

/** The PNG with a tEXt chunk `Source: <master> sha256:<hex>` just before IEND. */
function stamp(png, master, source) {
  if (png.toString('latin1', png.length - 8, png.length - 4) !== 'IEND') throw new Error('PNG does not end in IEND');
  const text = `${master} sha256:${createHash('sha256').update(source).digest('hex')}`;
  const body = Buffer.concat([Buffer.from('Source\0', 'latin1'), Buffer.from(text, 'latin1')]);
  const chunk = Buffer.alloc(12 + body.length);
  chunk.writeUInt32BE(body.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
].find((candidate) => {
  try { execSync(`test -x "${candidate}"`); return true; } catch { return false; }
});
if (!CHROME) {
  process.stderr.write('No Chrome or Chromium found in /Applications.\n');
  process.exit(2);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(os.tmpdir(), 'quote-icons-'));
// Port 0 lets Chrome pick a free port and write it to DevToolsActivePort, so two
// runs, or a check-ui run alongside, can never meet on the same port.
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

let ws = null;
try {
  let port = '';
  for (let i = 0; i < 80 && !port; i += 1) {
    port = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
      .then((text) => text.split('\n')[0].trim()).catch(() => '');
    if (!port) await wait(250);
  }
  if (!port) throw new Error('Chrome never opened a debugging port');

  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === 'page');
    if (!target) await wait(250);
  }
  if (!target) throw new Error('Chrome opened no page to draw in');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map();
  let lastId = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++lastId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  // Transparent behind the image, so the tab icon's rounded corners stay see-through.
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  for (const { master, out, size } of ICONS) {
    const source = await readFile(path.join(ROOT, master));
    const svg = source.toString('utf8');
    await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const drawn = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        document.documentElement.style.background = 'transparent';
        document.body.style.margin = '0';
        document.body.replaceChildren();
        const img = new Image(${size}, ${size});
        img.style.display = 'block';
        img.src = 'data:image/svg+xml;charset=utf-8,' + ${JSON.stringify(encodeURIComponent(svg))};
        document.body.append(img);
        await img.decode();
        return img.naturalWidth > 0;
      })()`,
    });
    if (!drawn.result?.value) throw new Error(`Chrome could not draw ${master}`);
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
    });
    await writeFile(path.join(ROOT, out), stamp(Buffer.from(shot.data, 'base64'), master, source));
    process.stdout.write(`Wrote ${out} (${size} x ${size}) from ${master}\n`);
  }
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
