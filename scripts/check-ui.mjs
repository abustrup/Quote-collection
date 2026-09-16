#!/usr/bin/env node
/**
 * What the pages actually do in a browser — the executable half of
 * docs/ACCEPTANCE.md.
 *
 * It drives real headless Chrome over the DevTools Protocol. No npm
 * dependencies, by design: the collection is a static site with no build step,
 * and a test harness that needed a toolchain would be the first thing to rot.
 *
 * This file owns the plumbing and the checks that are true of every page —
 * nothing overflows, nothing throws, nothing 404s, pictures actually arrive,
 * controls are big enough for a thumb. The checks that know what a shelf or a
 * collection is live in ./checks/, one file each, so that the people building
 * those pages can write their own acceptance without ever touching this file.
 *
 * Usage:
 *   node scripts/check-ui.mjs                 # against a local server it starts
 *   node scripts/check-ui.mjs --url https://abustrup.github.io/Quote-collection
 *
 * Screenshots land in data/shots/ (gitignored). Exit code 0 only if every
 * check passed.
 */

import { execSync, spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'data', 'shots');

// Derived from the pid so two builders running this at the same time in the
// same checkout do not fight over a port.
const SERVE_PORT = 8600 + (process.pid % 200);
const CDP_PORT = 9200 + (process.pid % 500);
const PROFILE = `/tmp/quotes-ui-${process.pid}`;

function parseArgs(argv) {
  const options = { url: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') options.url = String(argv[i += 1] || '').replace(/\/+$/, '');
    else if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\nUsage: node scripts/check-ui.mjs [--url https://…]\n`);
  process.exit(2);
}
if (options.help) {
  process.stdout.write('node scripts/check-ui.mjs [--url https://…]\n');
  process.exit(0);
}

const BASE = options.url || `http://localhost:${SERVE_PORT}`;

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

// ---------------------------------------------------------------- results

const results = [];
const skipped = [];
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

function rec(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(`${ok ? `${GREEN}PASS${OFF}` : `${RED}FAIL${OFF}`}  ${name}\n`);
  if (detail) process.stdout.write(`        ${String(detail).split('\n').join('\n        ')}\n`);
}

function skip(name, why) {
  skipped.push({ name, why });
  process.stdout.write(`${DIM}SKIP${OFF}  ${name}${why ? `  ${DIM}(${why})${OFF}` : ''}\n`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- processes

let server = null;
if (!options.url) {
  server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), '--port', String(SERVE_PORT)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--mute-audio',
  '--force-device-scale-factor=1',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { ws?.close(); } catch { /* already gone */ }
  try { chrome.kill(); } catch { /* already gone */ }
  try { server?.kill(); } catch { /* already gone */ }
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });

// ---------------------------------------------------------------- protocol

let ws = null;
let messageId = 0;
const pending = new Map();
const loadWaiters = [];
const requestUrls = new Map();

/** Reset per goto, so a failure names the page it happened on. */
const consoleErrors = [];
const failedRequests = [];
let bootstrapUrl = '';
const resetCollectors = () => { consoleErrors.length = 0; failedRequests.length = 0; requestUrls.clear(); };

const sameOrigin = (url) => typeof url === 'string' && url.startsWith(BASE);

/**
 * Whose fault is this request?
 *
 * Only requests that both started after the reset and were made by the page
 * under test count against it. Without this, the harness blames the page for
 * its own setup: landing on /assets/favicon.svg to pre-set the edition gives
 * Chrome a document with no icon link, so it probes /favicon.ico, and that 404
 * arrives after the next navigation has already begun. The site itself never
 * asks for /favicon.ico — every page declares its own icon.
 */
function blamesThisPage(requestId) {
  const started = requestUrls.get(requestId);
  if (!started) return false;
  if (bootstrapUrl && started.documentURL === bootstrapUrl) return false;
  return sameOrigin(started.url);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); }
    }, 60000);
  });
}

let lastExpression = '';
async function ev(expression) {
  lastExpression = expression.replace(/\s+/g, ' ').slice(0, 120);
  const reply = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (reply.exceptionDetails) {
    throw new Error(`${reply.exceptionDetails.text} ${(reply.exceptionDetails.exception?.description || '').slice(0, 300)}`);
  }
  return reply.result?.value;
}

function onMessage(raw) {
  const message = JSON.parse(raw);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  const { method, params } = message;
  if (method === 'Page.loadEventFired') {
    while (loadWaiters.length) loadWaiters.pop()();
  } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
    consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ').slice(0, 300));
  } else if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails;
    consoleErrors.push(`${details?.text ?? 'exception'} ${(details?.exception?.description || '').split('\n')[0]}`.slice(0, 300));
  } else if (method === 'Network.requestWillBeSent') {
    requestUrls.set(params.requestId, { url: params.request?.url, documentURL: params.documentURL });
  } else if (method === 'Network.responseReceived') {
    const url = params.response?.url;
    if (blamesThisPage(params.requestId) && params.response.status >= 400) {
      failedRequests.push(`${params.response.status} ${url.slice(BASE.length) || '/'}`);
    }
  } else if (method === 'Network.loadingFailed') {
    const url = requestUrls.get(params.requestId)?.url;
    // A cancelled request is the browser changing its mind, not the site failing.
    if (blamesThisPage(params.requestId) && !params.canceled) {
      failedRequests.push(`${params.errorText} ${url.slice(BASE.length) || '/'}`);
    }
  }
}

// ---------------------------------------------------------------- driving

let viewport = { width: 1440, height: 1000 };

async function navigate(url) {
  const loaded = new Promise((resolve) => loadWaiters.push(resolve));
  await send('Page.navigate', { url });
  await Promise.race([loaded, wait(20000)]);
}

async function settle(waitFor) {
  for (let i = 0; i < 120; i += 1) {
    const state = await ev('document.readyState').catch(() => null);
    if (state === 'complete') break;
    await wait(100);
  }
  if (!waitFor) return true;
  for (let i = 0; i < 150; i += 1) {
    const found = await ev(`!!document.querySelector(${JSON.stringify(waitFor)})`).catch(() => false);
    if (found) return true;
    await wait(100);
  }
  return false;
}

/**
 * Open a page in a known state.
 *
 * The edition and the language are decided by localStorage before a single
 * line of page script runs, which is why this lands on a blank same-origin
 * document first: setting them after the page has booted tests the switch, not
 * the state, and the pages apply their edition in a blocking script in <head>.
 */
async function goto(pathname, opts = {}) {
  const {
    width = 1440, height = 1000, edition = 'paper', lang = 'en', waitFor = null, quiet = 200,
  } = opts;
  viewport = { width, height };
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 700,
  });
  bootstrapUrl = `${BASE}/assets/favicon.svg`;
  await navigate(bootstrapUrl);
  const stored = await ev(`(() => {
    try {
      localStorage.setItem('quotes-edition', ${JSON.stringify(edition)});
      localStorage.setItem('quotes-lang', ${JSON.stringify(lang)});
      return localStorage.getItem('quotes-edition') + '/' + localStorage.getItem('quotes-lang');
    } catch (error) { return 'ERR ' + error.message; }
  })()`);
  if (stored !== `${edition}/${lang}`) {
    throw new Error(`could not pre-set edition and language (got ${stored})`);
  }
  resetCollectors();
  await navigate(`${BASE}${pathname}`);
  const arrived = await settle(waitFor);
  if (quiet) await wait(quiet);
  return arrived;
}

async function shot(name) {
  await mkdir(SHOTS, { recursive: true });
  const reply = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: 0, y: 0, width: viewport.width, height: Math.min(viewport.height * 2, 2400), scale: 1,
    },
  });
  const file = path.join(SHOTS, `${name}.png`);
  await writeFile(file, Buffer.from(reply.data, 'base64'));
  return file;
}

async function centreOf(selector) {
  const box = await ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`nothing to point at: ${selector}`);
  return box;
}

async function hover(selector) {
  const { x, y } = await centreOf(selector);
  // Come from somewhere else first: a pointer that was already there never
  // crosses the element's boundary, so :hover and mouseenter never fire.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.max(0, x - 60), y: Math.max(0, y - 60) });
  await wait(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await wait(60);
  return { x, y };
}

async function click(selector) {
  const { x, y } = await hover(selector);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  return { x, y };
}

const NAMED_KEYS = {
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

/** pressKey('Escape'), pressKey('ArrowRight'), pressKey('f'). */
async function pressKey(name) {
  const named = NAMED_KEYS[name];
  const spec = named || {
    key: name,
    code: /^[a-zA-Z]$/.test(name) ? `Key${name.toUpperCase()}` : `Key${name}`,
    keyCode: name.toUpperCase().charCodeAt(0),
    text: name,
  };
  await send('Input.dispatchKeyEvent', {
    type: spec.text ? 'keyDown' : 'rawKeyDown',
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
    text: spec.text,
    unmodifiedText: spec.text,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
  });
  await wait(60);
}

// ---------------------------------------------------------------- checks

/** True of every page, at every width, in every edition. */
async function hygiene(label) {
  const measured = await ev(`(() => {
    const doc = document.documentElement;
    const images = [...document.images].map((img) => ({
      src: (img.currentSrc || img.src || '').slice(-60),
      complete: img.complete,
      natural: img.naturalWidth,
    }));
    const pills = [...document.querySelectorAll('.pill')]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ label: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 22), h: el.offsetHeight }));
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, images, pills };
  })()`);

  rec(`${label} · no horizontal overflow`,
    measured.scrollWidth <= measured.clientWidth + 1,
    `scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth}`);

  rec(`${label} · no console errors`,
    consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.join('\n') : 'nothing thrown, nothing logged as an error');

  rec(`${label} · no failed same-origin requests`,
    failedRequests.length === 0,
    failedRequests.length ? failedRequests.join('\n') : 'every request under this origin answered');

  if (measured.images.length === 0) {
    skip(`${label} · every image arrived`, 'no <img> on this page');
  } else {
    const bad = measured.images.filter((img) => !img.complete || img.natural < 300);
    rec(`${label} · every image arrived at 300px or wider`,
      bad.length === 0,
      bad.length
        ? bad.map((img) => `${img.src} complete=${img.complete} naturalWidth=${img.natural}`).join('\n')
        : `${measured.images.length} images, smallest ${Math.min(...measured.images.map((i) => i.natural))}px wide`);
  }

  if (measured.pills.length === 0) {
    skip(`${label} · controls are thumb-sized`, 'no visible .pill');
  } else {
    const small = measured.pills.filter((pill) => pill.h < 34);
    rec(`${label} · every visible control is at least 34px tall`,
      small.length === 0,
      small.length
        ? small.map((pill) => `"${pill.label}" is ${pill.h}px`).join('\n')
        : `${measured.pills.length} controls, shortest ${Math.min(...measured.pills.map((p) => p.h))}px`);
  }
}

// A comma list, so a page that is being redesigned right now does not go red
// for renaming its container: any one of these means the page has rendered.
const PAGES = [
  { name: 'index', path: '/index.html', waitFor: '.collection li, .quote, li.quote' },
  { name: 'works', path: '/works.html', waitFor: '.shelf, .book, .shelf-grid' },
];
const WIDTHS = [[1440, 1000], [390, 844]];
const EDITIONS = ['paper', 'night'];

async function main() {
  // Wait for whatever we are pointing at to answer.
  let up = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${BASE}/index.html`, { cache: 'no-store' });
      if (response.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await wait(250);
  }
  if (!up) throw new Error(`nothing answering at ${BASE}`);

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* Chrome still starting */ }
    await wait(250);
  }
  if (!target) throw new Error(`Chrome never opened a debugging port on ${CDP_PORT}`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => onMessage(event.data);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  process.stdout.write(`\n  Checking ${BASE} with ${path.basename(CHROME)}\n\n`);

  const ctx = {
    base: BASE,
    root: ROOT,
    shotsDir: SHOTS,
    ev,
    send,
    goto,
    shot,
    rec,
    skip,
    hover,
    click,
    pressKey,
    wait,
    consoleErrors,
    failedRequests,
  };

  for (const page of PAGES) {
    for (const [width, height] of WIDTHS) {
      for (const edition of EDITIONS) {
        const label = `${page.name} ${width}px ${edition}`;
        const arrived = await goto(page.path, {
          width, height, edition, lang: 'en', waitFor: page.waitFor,
        });
        rec(`${label} · renders`, arrived, arrived ? `${page.waitFor} is on the page` : `${page.waitFor} never appeared`);
        await hygiene(label);
        const file = await shot(`${page.name}-${width}-${edition}`);
        process.stdout.write(`${DIM}        shot ${path.relative(ROOT, file)}${OFF}\n`);
      }
    }
  }

  // The page-specific acceptance lives with the people building those pages.
  for (const module of ['./checks/shelf.mjs', './checks/collection.mjs']) {
    const loaded = await import(module);
    if (typeof loaded.run !== 'function') {
      rec(`${module} exports run(ctx)`, false, 'no run() export');
      continue;
    }
    await loaded.run(ctx);
  }
}

main()
  .catch((error) => rec('the harness itself', false, `${error.message}\n  last expression: ${lastExpression}`))
  .finally(async () => {
    await cleanup();
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    process.stdout.write(`\n\x1b[1m${passed}/${results.length} checks passed\x1b[0m`);
    if (skipped.length) process.stdout.write(`, ${skipped.length} skipped`);
    process.stdout.write('\n');
    if (failed.length) {
      process.stdout.write(`${RED}Failed:${OFF}\n`);
      for (const f of failed) process.stdout.write(`  · ${f.name}\n`);
    }
    process.stdout.write(`Screenshots in ${path.relative(ROOT, SHOTS)}/\n\n`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
