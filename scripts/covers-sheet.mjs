#!/usr/bin/env node
/**
 * Draw every cover on one contact sheet and screenshot it, so a person can
 * check the one thing no script can: that the picture is the front cover of
 * the book the record names.
 *
 * `check-covers.mjs` measures size, shape and weight. None of that catches the
 * failure that actually happens — Open Library handing back the cover of a
 * different edition, a different translation, or a different book with the
 * same title. Ninety covers is two minutes of looking if they are side by side
 * with their titles, and an afternoon if they are not, so this puts them side
 * by side with their titles.
 *
 * Output goes outside the repository: it is a thing to look at once, not an
 * artefact to keep. Pages are capped at about 2000px tall so each screenshot
 * opens at a readable size.
 *
 * Usage:
 *   node scripts/covers-sheet.mjs                 # every book
 *   node scripts/covers-sheet.mjs --out ~/sheets  # somewhere else
 *   node scripts/covers-sheet.mjs --shelf to-read
 *   node scripts/covers-sheet.mjs --no-shots      # just the HTML
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { slug } from '../assets/quote-core.js';
import { webpSize } from './check-covers.mjs';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* The sheet's geometry is fixed in pixels rather than left to the layout,
   because the page height has to be known before Chrome is asked for a
   screenshot of it. Eight across, six down, 48 to a page. */
const COLUMNS = 8;
const ROWS = 6;
const TILE = 140;
const COVER_BOX = 210;
const CAPTION = 78;
const GAP = 20;
const PAD = 24;
const HEADER = 76;

const PAGE_WIDTH = COLUMNS * TILE + (COLUMNS - 1) * GAP + PAD * 2;
const PAGE_HEIGHT = HEADER + ROWS * (COVER_BOX + CAPTION + GAP) - GAP + PAD * 2;
const PER_PAGE = COLUMNS * ROWS;

const escape = (text) => String(text ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseArgs(argv) {
  const options = { out: '', shelf: '', shots: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') options.out = argv[++index];
    else if (arg === '--shelf') options.shelf = argv[++index];
    else if (arg === '--no-shots') options.shots = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function sheetHtml(page, pages, items) {
  const tiles = items.map((item) => {
    const missing = !item.file;
    const badge = item.soft ? '<span class="soft">upscaled</span>' : '';
    const picture = missing
      ? `<div class="none">no cover</div>`
      : `<img src="${escape(item.file)}" alt="">`;
    return `<figure class="tile${missing ? ' is-missing' : ''}">
      <div class="art">${picture}${badge}</div>
      <figcaption>
        <b title="${escape(item.title)}">${escape(item.title)}</b>
        <i title="${escape(item.author)}">${escape(item.author)}</i>
        <u>${escape(item.shelf ?? 'no shelf')} &middot; ${escape(item.size)}</u>
        <s title="${escape(item.source)}">${escape(item.source)}</s>
      </figcaption>
    </figure>`;
  }).join('\n');

  return `<!doctype html>
<meta charset="utf-8">
<title>Covers ${page} of ${pages}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; padding: ${PAD}px;
    background: #fbf9f5; color: #1c1a17;
    font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header { height: ${HEADER}px; display: flex; align-items: baseline; gap: 14px; }
  h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
  header span { color: #6d675e; font-size: 13px; }
  .grid {
    display: grid; gap: ${GAP}px;
    grid-template-columns: repeat(${COLUMNS}, ${TILE}px);
    grid-auto-rows: ${COVER_BOX + CAPTION}px;
  }
  .tile { margin: 0; }
  .art {
    position: relative; height: ${COVER_BOX}px; display: flex;
    align-items: flex-end; justify-content: center;
  }
  .art img {
    max-width: ${TILE}px; max-height: ${COVER_BOX}px; display: block;
    box-shadow: 0 1px 2px rgba(28,26,23,.18), 0 8px 18px rgba(28,26,23,.14);
    border-radius: 2px;
  }
  .none {
    width: ${TILE}px; height: ${Math.round(TILE / 0.66)}px; display: grid; place-items: center;
    border: 1px dashed #c9312b; color: #c9312b; border-radius: 2px; font-size: 11px;
  }
  .soft {
    position: absolute; top: 4px; right: 4px; background: #b4802a; color: #fff;
    padding: 1px 5px; border-radius: 99px; font-size: 9px; letter-spacing: .02em;
  }
  figcaption { height: ${CAPTION}px; padding-top: 7px; overflow: hidden; }
  figcaption > * { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  figcaption b { font-weight: 600; font-size: 11.5px; }
  figcaption i { font-style: normal; color: #55504a; font-size: 11px; }
  figcaption u { text-decoration: none; color: #7a746b; font-size: 10.5px; }
  figcaption s { text-decoration: none; color: #9a948a; font-size: 10px; font-variant-numeric: tabular-nums; }
  .is-missing figcaption b { color: #c9312b; }
</style>
<header>
  <h1>Covers</h1>
  <span>page ${page} of ${pages} &middot; ${items.length} books &middot; is each one the front cover of the book named under it?</span>
</header>
<div class="grid">
${tiles}
</div>
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${/\/\*\*[\s\S]*?\*\//.exec(await readFile(fileURLToPath(import.meta.url), 'utf8'))[0]}\n`);
    return;
  }

  const outDir = path.resolve(
    options.out || process.env.COVERS_SHEET_DIR || path.join(os.tmpdir(), 'quote-collection-covers'),
  );
  await mkdir(outDir, { recursive: true });

  const registry = JSON.parse(await readFile(path.join(REPO_ROOT, 'data', 'works.json'), 'utf8'));
  let books = (registry.works ?? []).filter((work) => work.kind === 'book');
  if (options.shelf) books = books.filter((work) => work.shelf === options.shelf);

  // Shelf first, then title, so the same book is in the same place every run
  // and two sheets can be compared after a re-fetch.
  const order = ['read', 'reading', 'to-read', 'abandoned'];
  books.sort((a, b) => {
    const shelf = (order.indexOf(a.shelf) + 1 || 99) - (order.indexOf(b.shelf) + 1 || 99);
    return shelf || a.title.toLowerCase().localeCompare(b.title.toLowerCase(), 'en');
  });

  const items = [];
  for (const work of books) {
    const relative = work.cover ?? `assets/covers/${slug(work.title)}.webp`;
    let file = '';
    let size = 'missing';
    try {
      const buffer = await readFile(path.join(REPO_ROOT, relative));
      const measured = webpSize(buffer);
      size = `${measured ? `${measured.width}x${measured.height}` : 'unreadable'} · ${Math.round(buffer.length / 1024)} KB`;
      // Chrome is given a file:// page in a temporary directory, so the cover
      // has to be addressed absolutely rather than relative to the sheet.
      file = `file://${path.join(REPO_ROOT, relative)}`;
    } catch { /* left as missing, and drawn as a red outline */ }
    items.push({
      title: work.title,
      author: work.author,
      shelf: work.shelf,
      size,
      source: work.coverSource ?? '—',
      soft: /\+upscaled$/.test(work.coverSource ?? ''),
      file,
    });
  }

  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const written = [];
  for (let page = 1; page <= pages; page += 1) {
    const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const html = path.join(outDir, `covers-sheet-${page}.html`);
    await writeFile(html, sheetHtml(page, pages, slice), 'utf8');
    written.push({ page, html, png: path.join(outDir, `covers-sheet-${page}.png`) });
  }

  // Old screenshots from a longer run would otherwise sit there looking current.
  for (const file of await readdir(outDir)) {
    const stale = /^covers-sheet-(\d+)\.(png|html)$/.exec(file);
    if (stale && Number(stale[1]) > pages) await writeFile(path.join(outDir, file), '', 'utf8');
  }

  if (!options.shots) {
    process.stdout.write(`${pages} page${pages === 1 ? '' : 's'} of HTML in ${outDir}\n`);
    return;
  }

  for (const sheet of written) {
    await run(CHROME, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${PAGE_WIDTH},${PAGE_HEIGHT}`,
      '--virtual-time-budget=8000',
      '--allow-file-access-from-files',
      `--screenshot=${sheet.png}`,
      `file://${sheet.html}`,
    ], { timeout: 120_000 });
  }

  const missing = items.filter((item) => !item.file).length;
  const soft = items.filter((item) => item.soft).length;
  process.stdout.write(
    `${items.length} covers on ${pages} sheet${pages === 1 ? '' : 's'}`
    + `${missing ? `, ${missing} missing` : ''}${soft ? `, ${soft} upscaled` : ''}\n`,
  );
  for (const sheet of written) process.stdout.write(`  ${sheet.png}\n`);
}

main().catch((error) => {
  process.stderr.write(`covers-sheet failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
