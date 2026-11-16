/**
 * What the front page is, written down as things that can be checked without a
 * browser.
 *
 * The behaviour itself, what a reader sees and what a press does, is
 * `npm run check:ui` (cases 14 to 19 and 29 to 35 of docs/ACCEPTANCE.md). These
 * tests are the other half: the facts that live in the files, and that a later
 * edit could undo without anything visibly breaking until somebody looked. The
 * name, above all. It is in a heading, a tab title, a share card, a header and
 * a README, and one of those is always the one that gets missed.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(REPO_ROOT, name), 'utf8');

const NAME = 'My quote collection';

/** The text between two markers, or a failure that says which marker was missing. */
function between(text, from, to) {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, `missing: ${to}`);
  return text.slice(start + from.length, end);
}

test('the heading, the tab title and the share card all say My quote collection', async () => {
  const html = await read('index.html');
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)?.[1], NAME);
  assert.equal(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1], NAME);
  assert.equal(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1], NAME);
});

test('the heading is the masthead: no kicker above it and no subtitle under it', async () => {
  const html = await read('index.html');
  const masthead = between(html, '<header class="masthead', '</header>');
  const inner = masthead.slice(masthead.indexOf('>') + 1);
  assert.deepEqual(
    [...inner.matchAll(/<(\w+)/g)].map((match) => match[1]),
    ['h1'],
    'the masthead holds the heading and nothing else',
  );
});

test('the old name, the kicker and the subtitle are gone from every file that carried them', async () => {
  const retired = [/Lines Worth Keeping/i, /A personal collection/i, /Everything I have wanted to remember/i, /lines worth keeping/i];
  for (const name of [
    'index.html', 'scout.html', 'suggest.html', 'import.html',
    'README.md', 'assets/nav.js', 'assets/i18n.js', 'assets/app.js', 'assets/nav.css', 'assets/app.css',
  ]) {
    const text = await read(name);
    for (const pattern of retired) {
      assert.ok(!pattern.test(text), `${name} still says ${pattern}`);
    }
  }
});

test('the other pages are called My quote collection in their tab titles too', async () => {
  for (const [name, page] of [
    ['works.html', 'The shelf'], ['scout.html', 'The board'], ['suggest.html', 'What to read next'], ['import.html', 'Import from Goodreads'],
  ]) {
    assert.equal(/<title>([^<]*)<\/title>/.exec(await read(name))?.[1], `${page} – ${NAME}`, name);
  }
});

test('the README begins with the name', async () => {
  assert.equal((await read('README.md')).split('\n')[0], `# ${NAME}`);
});

test('the controls row holds the search, the subject filter, favourites and the three-control group, and no more', async () => {
  const html = await read('index.html');
  const row = between(html, '<div class="controls-row">', '<div class="active-filters"');
  const ids = [...row.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['search', 'filter-subject', 'toggle-favorites', 'favorites-count', 'nav-actions']);
});

test('author, work, era, sort, Focus and Curate are in the panel, and only there', async () => {
  const html = await read('index.html');
  const row = between(html, '<div class="controls-row">', '<div class="active-filters"');
  const extras = between(html, '<div id="more-extras" hidden>', '<main class="shell">');
  const tucked = ['filter-author', 'filter-work', 'filter-era', 'sort', 'open-focus', 'toggle-curate'];
  for (const id of tucked) {
    assert.ok(!row.includes(`id="${id}"`), `${id} is on the controls row`);
    assert.ok(extras.includes(`id="${id}"`), `${id} is not in the panel's block`);
  }
  assert.ok(!html.includes('id="edition"'), 'the edition select belongs to nav.js, and is built there');
});

test('Focus and Curate close the panel when pressed, and the curate bar can end the mode', async () => {
  const html = await read('index.html');
  for (const id of ['open-focus', 'toggle-curate']) {
    const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    assert.ok(/data-more-close/.test(tag), `${id} does not close the panel`);
  }
  assert.ok(between(html, 'id="curate-bar"', '</div>').includes('id="curate-done"'));
});

test('the shared header builds three controls and a panel, and says which pages are in it', async () => {
  const nav = await import('../assets/nav.js');
  assert.equal(typeof nav.mountNav, 'function');
  assert.equal(typeof nav.closeMore, 'function');
  assert.equal(nav.default, nav.mountNav);

  const source = await read('assets/nav.js');
  for (const href of ["'scout.html'", "'suggest.html'", "'import.html'"]) {
    assert.ok(source.includes(href), `${href} is not in the panel's pages`);
  }
  assert.ok(!/nav\.toNight|nav\.toPaper|nav-toggle/.test(source), 'the moon button is meant to be gone');
});

test('a quote card is built with a star and a copy button, and none of the old labels', async () => {
  const source = await read('assets/app.js');
  const card = between(source, 'function buildQuote(', 'function buildCurateRow(');
  assert.ok(card.includes("dataset.action = 'favorite'"));
  assert.ok(card.includes("dataset.action = 'copy'"));
  for (const gone of ['permalink', "className = 'tag'", "className = 'verify'", 'VERIFICATION_LABELS', 'quote.themes']) {
    assert.ok(!card.includes(gone), `buildQuote still mentions ${gone}`);
  }
  assert.ok(!source.includes('VERIFICATION_LABELS'), 'app.js no longer needs the verification labels');
});

test('the card has no hover-only star: only copy waits for a pointer', async () => {
  const css = await read('assets/app.css');
  const hover = between(css, '@media (hover: hover) and (pointer: fine) {\n  .quote-actions [data-action="copy"]', '}\n}');
  assert.ok(!/favorite/.test(hover), 'the star must be visible at rest');
  assert.ok(!/\.quote-actions \{[^}]*opacity: 0/.test(css), 'the whole action row must not be hidden at rest');
});

test('every shortcut the footer names is still wired', async () => {
  const source = await read('assets/app.js');
  for (const key of ["'/'", "'j'", "'k'", "'f'", "'r'", "'c'", "'s'", "'Escape'"]) {
    assert.ok(source.includes(`event.key === ${key}`), `no handler for ${key}`);
  }
  assert.ok(source.includes('index.footer.keys'), 'the footer line that lists them is gone');
});

test('the front page keeps the quotes:add handshake that the Add control and the dialog share', async () => {
  const nav = await read('assets/nav.js');
  const add = await read('assets/add-quote.js');
  assert.ok(nav.includes("new CustomEvent('quotes:add'"), 'the Add control no longer announces quotes:add');
  assert.ok(add.includes("document.addEventListener('quotes:add'"), 'nothing answers quotes:add');
});

/* -------------------------------------------------------------------------
 * The second pass: what the first one left standing
 * ----------------------------------------------------------------------- */

test('the board, read next and the importer carry no pill of their own that leads to another page', async () => {
  // The name in the bar goes to the quotes and More lists the other pages, so a
  // pill beside the heading that does the same is a second copy of the header.
  const leads = /<a[^>]*class="[^"]*\bpill\b[^"]*"[^>]*href="(?:\.\/|index\.html|scout\.html|suggest\.html|import\.html|works\.html)"/;
  for (const name of ['scout.html', 'suggest.html', 'import.html']) {
    const html = (await read(name)).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!leads.test(html), `${name} still has a pill that leads to another page`);
  }
  // What stays is what the page does: read next keeps its own filters and its button.
  const suggest = await read('suggest.html');
  for (const id of ['filter-theme', 'difficulty', 'reroll']) {
    assert.ok(suggest.includes(`id="${id}"`), `suggest.html lost its own control ${id}`);
  }
});

test('a byline is not held to a measure counted in ems of its own small type', async () => {
  const css = await read('assets/app.css');
  const block = between(css, '\n.attribution {', '}');
  assert.ok(/max-width:\s*none;/.test(block), 'the byline has a max-width again, and a long title will push its year onto a line alone');
  assert.ok(!/max-width:\s*var\(--measure\)/.test(block));
});

test('the names of keys are not shown where there is no keyboard', async () => {
  const css = await read('assets/app.css');
  const rule = between(css, '@media (hover: none) {', '}');
  for (const selector of ['.search-hint', '.pill-key', '.focus-fav-key', '.focus-esc', '#footer-keys']) {
    assert.ok(rule.includes(selector), `${selector} is still shown on touch`);
  }
  assert.ok(/display:\s*none/.test(rule));
  const html = await read('index.html');
  assert.ok(/<span class="focus-esc" aria-hidden="true">esc<\/span>/.test(html), 'the esc hint in the Focus bar is not the one the stylesheet hides');
});

test('"Clear all" only turns up when more than one filter is on', async () => {
  const source = await read('assets/app.js');
  const chips = between(source, 'function renderActiveFilters() {', '\nfunction render()');
  const guard = chips.indexOf('if (chips.length < 2) return;');
  const built = chips.indexOf("clearAll.dataset.clear = 'all'");
  assert.ok(guard > 0 && built > guard, 'the Clear all button is built before the check that there is more than one chip');
});

test('opening the page at a quote\'s address puts the reading cursor on it, so F opens Focus there', async () => {
  const source = await read('assets/app.js');
  assert.ok(source.includes('function pointCursorAtAddress()'));
  assert.ok(/hashchange',\s*\(\) => \{ highlightTarget\(\); pointCursorAtAddress\(\); \}/.test(source), 'a changed address does not move the cursor');
  const init = between(source, 'async function init() {', '\ninit();');
  assert.ok(init.includes('pointCursorAtAddress();'), 'the first load at an address does not move the cursor');
});

test('curate mode\'s Edit link is a thumb-sized target on a phone', async () => {
  const css = await read('assets/app.css');
  const touch = between(css, '@media (max-width: 700px), (pointer: coarse) {\n  .icon-button {', '\n}');
  assert.ok(/\.curate-link\s*\{[^}]*min-height:\s*var\(--tap-min\)/.test(touch), 'the Edit link is 18px high on a phone again');
});

/* -------------------------------------------------------------------------
 * The third pass: what the second review found
 * ----------------------------------------------------------------------- */

test('the Add dialog is thumb-sized on a phone, in rules that outweigh the ones add-quote.js injects', async () => {
  const css = await read('assets/app.css');
  const start = css.indexOf('The dialog on a phone');
  assert.ok(start >= 0, 'the phone rules for the Add dialog are gone');
  const block = css.slice(start);
  assert.ok(block.includes('@media (max-width: 700px), (pointer: coarse) {'), 'the dialog rules are not limited to a phone or a touch screen');
  // Each selector starts at .add-dialog: add-quote.js appends its own <style> after
  // this sheet, with `.add-field select { min-height: 40px }` among its rules, and
  // a selector of the same weight written without the prefix would lose to it.
  for (const selector of [
    '.add-dialog .pill', '.add-dialog .add-field input', '.add-dialog .add-field select',
    '.add-dialog .add-unlock-row input', '.add-dialog .add-github', '.add-dialog .add-more-summary',
  ]) {
    assert.ok(block.includes(selector), `${selector} is not made thumb-sized`);
  }
  assert.ok(/min-height:\s*var\(--tap-min\)/.test(block));
  assert.ok(/\.add-github\s*\{[^}]*display:\s*inline-flex/.test(block), 'the link to the GitHub form is an inline link, 17px high');
});

test('read next hangs its filter row from the bar, and only where the bar sticks', async () => {
  const html = await read('suggest.html');
  assert.ok(
    /@media \(min-width: 701px\) \{\s*\.controls \{ top: var\(--nav-h, 0px\); \}\s*\}/.test(html),
    'the filter row sticks at the top of the window, behind the bar',
  );
});

test('the headings of the README and of the acceptance cases carry no em dash', async () => {
  // A heading is words a visitor reads, published under his name. The character is
  // spelled by its code, so that this file does not carry what it forbids.
  const emDash = String.fromCharCode(0x2014);
  for (const name of ['README.md', 'docs/ACCEPTANCE.md']) {
    const headings = (await read(name)).split('\n').filter((line) => /^(#|<summary)/.test(line));
    assert.ok(headings.length > 3, `${name}: no headings found`);
    for (const line of headings) assert.ok(!line.includes(emDash), `${name}: ${line}`);
  }
});

test('More hands focus back when a button was the choice, and listens for Escape on the whole page while open', async () => {
  const source = await read('assets/nav.js');
  assert.ok(/document\.addEventListener\('keydown', onEscape, true\)/.test(source), 'Escape is not heard on the document while the panel is open');
  assert.ok(/document\.removeEventListener\('keydown', onEscape, true\)/.test(source), 'the Escape listener is never taken off again');
  assert.ok(/close\(\{ restoreFocus: !choice\.matches\('a'\) \}\)/.test(source), 'a choice made with a button leaves focus on nothing');
});
