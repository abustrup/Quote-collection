/**
 * An INDEPENDENT Goodreads replica, written without reference to the parser's
 * own fixture generator. Different DOM structure, different CSS, different
 * print settings, and quotes chosen to stress cases the built-in fixtures may
 * not cover. The point is to try to break the parser, not to confirm it.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-Quote-collection/9035684a-cab9-504e-8946-559630d06351/scratchpad/adv';
fs.mkdirSync(OUT, { recursive: true });

// [text, author, work|null, tags[]]
const QUOTES = [
  ['Man is condemned to be free; because once thrown into the world, he is responsible for everything he does.', 'Jean-Paul Sartre', 'Existentialism Is a Humanism', ['freedom','existentialism']],
  ['The limits of my language mean the limits of my world.', 'Ludwig Wittgenstein', 'Tractatus Logico-Philosophicus', ['language']],
  ['Whereof one cannot speak — and here I mean "speak" in the strictest sense — thereof one must be silent.', 'A Paraphraser', null, ['language','silence']],
  ['At vaere eller ikke at vaere, det er sporgsmaalet, og jeg tror ikke laengere paa noget svar.', 'Ukendt Forfatter', 'En Dansk Bog', ['dansk']],
  ['Es gibt keine Tatsachen, nur Interpretationen.', 'Friedrich Nietzsche', 'Nachgelassene Fragmente', ['wahrheit']],
  ['Short.', 'Anon', null, []],
  ['Power is not a thing that one holds or does not hold; it is exercised from innumerable points, in the interplay of nonegalitarian and mobile relations, and it is precisely because there is no single locus of great Refusal that one must think of resistance in the plural, as a multiplicity of points spread across the social body, each irreducible to the others and none of them reducible to a mere reaction or rebound, a reverse image of the power it opposes.', 'Michel Foucault', 'The History of Sexuality, Volume 1: An Introduction', ['power','politics','resistance']],
  ['I have no special talent. I am only passionately curious.', 'Albert Einstein', null, ['curiosity','science']],
  ['The unexamined life is not worth living for a human being.', 'Plato', 'Apology', ['philosophy','life','ethics','socrates','athens','virtue']],
  ['To be, or not to be, that is the question.', 'William Shakespeare', 'Hamlet', ['drama']],
];

// A structurally DIFFERENT markup shape from the built-in fixtures: table-based
// layout, cover images as real elements, tags rendered as links, a stats row.
const rows = QUOTES.map(([text, author, work, tags], i) => `
  <tr class="quoteItem">
    <td class="cover"><div class="bookCover">BOOK<br>COVER<br>${i + 1}</div></td>
    <td class="body">
      <div class="quoteText">
        &ldquo;${text}&rdquo;
        <br/>
        &#8213; <span class="authorOrTitle">${author}</span>${work ? `, <span class="authorOrTitle">${work}</span>` : ''}
      </div>
      ${tags.length ? `<div class="greyText smallText left">tags: ${tags.map(t => `<a href="/quotes/tag/${t}">${t}</a>`).join(', ')}</div>` : ''}
      <div class="right">
        <span class="likesCount">${(i * 37) % 900} likes</span>
        <a class="actionLink" href="#">Like</a>
      </div>
    </td>
  </tr>`).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 12mm; }
  body { font: 13px/1.5 Georgia, serif; color: #181818; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subNav { color: #767676; font-size: 12px; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; }
  td { vertical-align: top; padding: 14px 6px; border-bottom: 1px solid #ddd; }
  .cover { width: 70px; }
  .bookCover { width: 62px; height: 92px; background: #e8e4da; color: #999;
               font: 9px/1.4 sans-serif; text-align: center; padding-top: 26px; }
  .quoteText { font-size: 14px; }
  .authorOrTitle { font-style: italic; }
  .greyText { color: #767676; font-size: 11px; margin-top: 8px; }
  .right { color: #767676; font-size: 11px; margin-top: 6px; }
  a { color: #382110; text-decoration: none; }
</style></head><body>
  <h1>Quotes</h1>
  <div class="subNav">Alexander Bustrup (Herlev, 17, Denmark)&rsquo;s Quotes &mdash; Showing 1-10 of 10</div>
  <table>${rows}</table>
</body></html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext()).newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: `${OUT}/adversarial.pdf`,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:8px;width:100%;padding:0 10mm;color:#666">Quotes - Alexander Bustrup (Herlev, 17, Denmark) Showing 1-10 of 10 | Goodreads</div>',
  footerTemplate: '<div style="font-size:8px;width:100%;padding:0 10mm;color:#666;display:flex;justify-content:space-between"><span>https://www.goodreads.com/quotes/list?page=1</span><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  margin: { top: '18mm', bottom: '18mm', left: '12mm', right: '12mm' },
});
await browser.close();
fs.writeFileSync(`${OUT}/expected.json`, JSON.stringify(QUOTES, null, 2));
console.log(`wrote ${OUT}/adversarial.pdf with ${QUOTES.length} quotes`);
