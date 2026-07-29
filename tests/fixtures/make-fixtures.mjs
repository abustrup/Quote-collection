/**
 * Builds the fixture PDFs the importer is tested against.
 *
 * The real inputs are six "print this web page to PDF" files sitting in a
 * Downloads folder, and they cannot be committed: they are one person's library
 * and they are not reproducible by anyone else. So the fixtures are grown here
 * instead — an HTML replica of the Goodreads quote-list markup, printed through
 * the same path a browser takes, so the resulting text layer has the same shape
 * as the real thing: browser header and footer furniture in the page margins,
 * quotes that straddle page breaks, and a floated cover image forcing the quote
 * body to wrap.
 *
 * The entries below are test data, not library data. The well-known quotations
 * are there so the fixture reads like a real page; the "Fixture Author" ones are
 * obvious filler, kept obvious so nothing here can ever be mistaken for a real
 * attribution if it escapes into the collection.
 *
 * Run:  npm i -D playwright && node tests/fixtures/make-fixtures.mjs
 * (Chromium only; no network access is needed at any point.)
 */

import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------------------
 * The hard cases
 *
 * Every entry here exists to break the parser in a specific way. Ordinary
 * quotes are generated further down; these are the ones worth reading.
 * ------------------------------------------------------------------------- */

const HARD_CASES_PAGE_1 = [
  {
    // Baseline: several lines of wrapped text, a work, tags.
    text: 'It is not that we have a short time to live, but that we waste a lot of it. Life is long enough, and a sufficiently generous amount has been given to us for the highest achievements if it were all well invested.',
    author: 'Seneca',
    work: 'On the Shortness of Life',
    tags: ['time', 'philosophy', 'stoicism'],
    likes: 1204,
  },
  {
    // No work title: the attribution line is just the author.
    text: 'The unexamined life is not worth living.',
    author: 'Socrates',
    work: null,
    tags: ['philosophy'],
    likes: 3311,
  },
  {
    // No tags: the quote footer carries only the like count.
    text: 'Man is condemned to be free; because once thrown into the world, he is responsible for everything he does.',
    author: 'Jean-Paul Sartre',
    work: 'Existentialism Is a Humanism',
    tags: [],
    likes: 872,
  },
  {
    // Inner double quotation marks inside the outer curly pair, plus an em dash.
    // Naive unwrapping either refuses to strip the outer marks or eats half the
    // sentence; both are wrong.
    text: 'Never say about anything, "I have lost it," but say, "I have given it back" — and then go on living as though nothing had been taken from you.',
    author: 'Epictetus',
    work: 'The Enchiridion',
    tags: ['loss', 'acceptance'],
    likes: 96,
  },
  {
    // Danish. Also the shortest route to a wrong `lang` field.
    text: 'Livet skal forstås baglæns, men det må leves forlæns.',
    author: 'Søren Kierkegaard',
    work: 'Journalen JJ',
    tags: ['livet', 'filosofi'],
    likes: 431,
  },
  {
    // Long enough to straddle a PDF page break on any page size. The parser has
    // to stitch it back together across the footer of one page and the header
    // of the next.
    text: 'A student who has read only summaries knows the shape of an argument and none of its weight, because the weight is in the sentences that the summary leaves out; and when such a student is asked to defend the argument, he defends the shape, which cannot be defended, since a shape has no reasons in it. The remedy is not to read more summaries but to read one book slowly, with a pencil, and to write in the margin every time a sentence does something the summary had not prepared you for. After a hundred pages of this the book stops being a position to agree or disagree with and becomes a mind you are arguing with, which is the only condition under which reading changes anybody.',
    author: 'Fixture Author 101',
    work: 'On Reading Slowly',
    tags: ['reading', 'attention', 'study'],
    likes: 58,
  },
  {
    // A work title containing a comma, which the attribution parser must keep
    // whole rather than treating as a second field.
    text: 'The story so far: In the beginning the Universe was created. This has made a lot of people very angry and been widely regarded as a bad move.',
    author: 'Douglas Adams',
    work: 'The Restaurant at the End of the Universe, Volume 2',
    tags: ['humour', 'science-fiction'],
    likes: 2210,
  },
  {
    // Long attribution, long tag list: both wrap onto a second printed line.
    text: 'We are not troubled by things, but by the opinions which we have of things.',
    author: 'Marcus Aurelius Antoninus Augustus',
    work: 'Meditations: A New Translation with an Introduction',
    tags: ['stoicism', 'mind', 'perception', 'philosophy', 'self-control', 'ancient-rome', 'meditation', 'classics'],
    likes: 1770,
  },
  {
    // German, with an em dash inside the quotation.
    text: 'Hat man sein Warum des Lebens, so verträgt man sich fast mit jedem Wie — der Mensch strebt nicht nach Glück.',
    author: 'Friedrich Nietzsche',
    work: 'Götzen-Dämmerung',
    tags: ['sinn', 'philosophie'],
    likes: 655,
  },
  {
    // Very short. Short enough that a parser keying on line length gives up.
    text: 'Amor fati.',
    author: 'Friedrich Nietzsche',
    work: 'Ecce Homo',
    tags: ['fate'],
    likes: 12,
  },
  {
    // French, with an apostrophe that the print path renders as a curly one.
    text: "Au milieu de l'hiver, j'apprenais enfin qu'il y avait en moi un été invincible.",
    author: 'Albert Camus',
    work: 'Retour à Tipasa',
    tags: ['espoir'],
    likes: 289,
  },
  {
    // A quote whose own text ends in a question mark and contains a colon, so
    // the "attribution starts after the punctuation" shortcut fails.
    text: 'What is the use of a house if you have not got a tolerable planet to put it on?',
    author: 'Henry David Thoreau',
    work: null,
    tags: ['nature', 'home'],
    likes: 344,
  },
];

const HARD_CASES_PAGE_2 = [
  {
    // Second straddling case, this time with tags, so the tag line is the part
    // that lands on the far side of the break.
    text: 'Economics is not a science of wealth, whatever its textbooks say on their first page; it is a science of choices made under scarcity, and the moment a student grasps that the subject stops being about money at all and becomes about what a person is willing to give up. Every price is a sentence about somebody\'s preferences, written in the only language large groups of strangers have ever agreed on. Read enough of them and a market begins to look less like a machine and more like a conversation nobody is chairing.',
    author: 'Fixture Author 102',
    work: 'Notes on Scarcity',
    tags: ['economics', 'choice', 'value'],
    likes: 41,
  },
  {
    text: 'It is not from the benevolence of the butcher, the brewer, or the baker that we expect our dinner, but from their regard to their own interest.',
    author: 'Adam Smith',
    work: 'The Wealth of Nations',
    tags: ['economics', 'self-interest'],
    likes: 918,
  },
  {
    text: 'The whole problem with the world is that fools and fanatics are always so certain of themselves, and wiser people so full of doubts.',
    author: 'Bertrand Russell',
    work: null,
    tags: [],
    likes: 5120,
  },
  {
    // Ellipsis and an internal line of dialogue.
    text: 'He asked me, "And what do you plan to do with a philosophy degree?" ... I said that I planned to notice things.',
    author: 'Fixture Author 103',
    work: 'Small Conversations',
    tags: ['study'],
    likes: 7,
  },
  {
    text: 'Two things fill the mind with ever new and increasing admiration and awe: the starry heavens above me and the moral law within me.',
    author: 'Immanuel Kant',
    work: 'Critique of Practical Reason',
    tags: ['ethics', 'wonder'],
    likes: 1402,
  },
  {
    text: 'Freedom is not worth having if it does not include the freedom to make mistakes.',
    author: 'Mahatma Gandhi',
    work: null,
    tags: ['freedom'],
    likes: 2088,
  },
];

const HARD_CASES_PAGE_6 = [
  {
    text: 'The greatest hazard of all, losing one\'s self, can occur very quietly in the world, as if it were nothing at all.',
    author: 'Søren Kierkegaard',
    work: 'The Sickness Unto Death',
    tags: ['self', 'anxiety'],
    likes: 1633,
  },
  {
    // Zero tags and no work: the barest possible block.
    text: 'I have no special talent. I am only passionately curious.',
    author: 'Albert Einstein',
    work: null,
    tags: [],
    likes: 4402,
  },
  {
    text: 'A room without books is like a body without a soul.',
    author: 'Marcus Tullius Cicero',
    work: null,
    tags: ['books', 'reading'],
    likes: 3899,
  },
  {
    // Ends on the last line of the last page, immediately above the pagination
    // furniture, which is where an off-by-one in block closing shows up.
    text: 'Whereof one cannot speak, thereof one must be silent.',
    author: 'Ludwig Wittgenstein',
    work: 'Tractatus Logico-Philosophicus',
    tags: ['language', 'silence'],
    likes: 2741,
  },
];

/* ---------------------------------------------------------------------------
 * Filler
 *
 * Bulk that behaves like the real thing: varying lengths so line wrapping and
 * page breaks fall in different places, some entries missing a work or tags.
 * Deterministic, so a regenerated fixture is byte-comparable.
 * ------------------------------------------------------------------------- */

const FILLER_BODIES = [
  'An argument you cannot state in your opponent\'s own words is an argument you have not yet understood.',
  'The ledger is honest about everything except what was worth doing, and that is the only entry anyone remembers.',
  'Patience is a technique before it is a virtue: it is the practice of leaving a question open long enough for it to answer itself.',
  'Every institution begins as a solution to a problem and ends as a description of the people who work in it, which is why reform is so much harder than founding, and why the founders are so much better remembered than the reformers who kept the thing alive.',
  'Attention is the rarest form of generosity, and it cannot be faked for very long.',
  'Nothing is so practical as a good theory, and nothing is so useless as a theory that has never once been embarrassed by a fact.',
  'To study something is to agree in advance to be corrected by it.',
  'A market clears; it does not thereby become just. The two words describe different questions, and a great deal of bad argument comes from answering the first while appearing to answer the second.',
  'The first duty of a student is to find out what he actually believes, which usually takes longer than finding out what is true.',
  'Boredom is the raw material of thought, and we have industrialised its removal.',
];

function fillerEntry(n) {
  return {
    text: `${FILLER_BODIES[n % FILLER_BODIES.length]} (Fixture entry ${n}.)`,
    author: `Fixture Author ${n}`,
    work: n % 5 === 0 ? null : `A Sample Work, Number ${n}`,
    tags: n % 4 === 0 ? [] : ['fixture', `set-${n % 7}`],
    likes: (n * 37) % 900,
  };
}

/**
 * Interleave the hard cases through the filler rather than grouping them, so
 * each one meets a different page-break offset.
 */
function buildPage(hardCases, count, firstFillerIndex) {
  const entries = [];
  let filler = firstFillerIndex;
  let placed = 0;
  const gap = Math.max(1, Math.floor(count / (hardCases.length + 1)));

  for (let i = 0; i < count; i += 1) {
    if (i % gap === 0 && placed < hardCases.length) {
      entries.push({ ...hardCases[placed] });
      placed += 1;
    } else {
      entries.push(fillerEntry(filler));
      filler += 1;
    }
  }
  return entries;
}

const PAGES = [
  {
    file: 'goodreads-quotes-page-1.pdf',
    goodreadsPage: 1,
    entries: buildPage(HARD_CASES_PAGE_1, 30, 1),
    showing: [1, 30, 174],
    paper: 'A4',
    // A Danish browser prints a Danish date. The furniture filter must not be
    // quietly locked to the American one.
    printedAt: '29.07.2026, 18.24',
    title: 'Alexander Bustrups citater',
  },
  {
    file: 'goodreads-quotes-page-2.pdf',
    goodreadsPage: 2,
    entries: buildPage(HARD_CASES_PAGE_2, 30, 200),
    showing: [31, 60, 174],
    paper: 'Letter',
    printedAt: '7/29/26, 6:24 PM',
    title: 'Alexander Bustrup’s quotes',
  },
  {
    file: 'goodreads-quotes-page-6.pdf',
    goodreadsPage: 6,
    entries: buildPage(HARD_CASES_PAGE_6, 24, 400),
    showing: [151, 174, 174],
    paper: 'A4',
    printedAt: '29.07.2026, 18.31',
    title: 'Alexander Bustrups citater',
  },
];

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------- */

const COVER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="75">'
    + '<rect width="50" height="75" fill="#e7e2d8" stroke="#c9c2b4"/>'
    + '<rect x="6" y="10" width="38" height="4" fill="#b9b1a1"/>'
    + '<rect x="6" y="18" width="30" height="4" fill="#b9b1a1"/></svg>',
)}`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Goodreads renders a quote body with typographic quotation marks and an
 * apostrophe, because the page passes user text through a smart-quote filter.
 * The fixture has to do the same or it never exercises the marks the parser
 * actually meets.
 */
function typeset(text) {
  return escapeHtml(text)
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/"([^"]*)"/g, '“$1”');
}

function quoteBlock(entry, isStraddler) {
  const attribution = entry.work
    ? `<a class="authorOrTitle" href="/author/show/1">${escapeHtml(entry.author)}</a>,\n`
      + `      <a class="authorOrTitle" href="/work/quotes/1">${escapeHtml(entry.work)}</a>`
    : `<a class="authorOrTitle" href="/author/show/1">${escapeHtml(entry.author)}</a>`;

  const tags = entry.tags.length
    ? `<div class="greyText smallText left">tags: ${entry.tags
      .map((tag) => `<a href="/quotes/tag/${encodeURIComponent(tag)}">${escapeHtml(tag)}</a>`)
      .join(', ')}</div>`
    : '';

  return `${isStraddler ? '\n  <div id="print-spacer"></div>' : ''}
  <div class="quote mediumText">
    <div class="quoteDetails">
      <div class="leftAlignedImage bookAuthorProfileImage">
        <a href="/book/show/1"><img alt="" src="${COVER}"></a>
      </div>
      <div class="quoteText"${isStraddler ? ' id="straddle-target"' : ''}>
        &ldquo;${typeset(entry.text)}&rdquo;
        <br>
        &#8213;
        ${attribution}
      </div>
      <div class="quoteFooter">
        ${tags}
        <div class="right">
          <a class="smallText" href="/quotes/1">${entry.likes} likes</a>
          <a class="actionLinkLite" href="#">Like</a>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Which quote gets pushed across a page break.
 *
 * The longest one on the page: it has the most lines, so cutting it in half
 * leaves enough on each side of the break that the browser's widow and orphan
 * rules do not simply move the whole block to the next page instead.
 */
function straddlerIndex(entries) {
  let best = 0;
  entries.forEach((entry, index) => {
    if (entry.text.length > entries[best].text.length) best = index;
  });
  return best;
}

function pageHtml(page) {
  const [from, to, total] = page.showing;
  const pageLinks = [1, 2, 3, 4, 5, 6]
    .map((n) => (n === page.goodreadsPage ? `<em class="current">${n}</em>` : `<a href="/quotes/list?page=${n}">${n}</a>`))
    .join('\n        ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(page.title)}</title>
<style>
  body { font-family: Georgia, "DejaVu Serif", serif; font-size: 13px; color: #181818;
         margin: 0; padding: 12px 18px; background: #fff; }
  a { color: #00635d; text-decoration: none; }
  .siteHeader { border-bottom: 1px solid #d8d8d8; padding-bottom: 6px; margin-bottom: 10px;
                display: flex; gap: 14px; align-items: baseline; font-family: "Liberation Sans", sans-serif; }
  .siteHeader .brand { font-size: 20px; color: #382110; font-weight: 700; }
  .siteHeader nav a { font-size: 12px; color: #382110; }
  .siteHeader input { font-size: 12px; padding: 2px 4px; border: 1px solid #ccc; width: 150px; }
  h1 { font-size: 20px; font-weight: normal; margin: 0 0 2px; }
  .showing { color: #767676; font-size: 12px; margin-bottom: 14px; }
  .quote { border-bottom: 1px solid #ebe8e2; padding: 12px 0; }
  .quoteDetails { overflow: hidden; }
  .leftAlignedImage { float: left; margin: 2px 12px 8px 0; }
  .quoteText { font-size: 14px; line-height: 1.45; }
  .authorOrTitle { color: #382110; font-style: italic; }
  .quoteFooter { margin-top: 8px; overflow: hidden; }
  .greyText { color: #767676; }
  .smallText { font-size: 11px; }
  .left { float: left; }
  .right { float: right; }
  .right a { margin-left: 10px; font-size: 11px; }
  .pagination { margin: 18px 0; text-align: center; font-size: 12px; }
  .pagination a, .pagination em { margin: 0 4px; }
  .siteFooter { border-top: 1px solid #d8d8d8; margin-top: 20px; padding-top: 8px;
                color: #767676; font-size: 11px; font-family: "Liberation Sans", sans-serif; }
  .siteFooter a { margin-right: 10px; color: #767676; }
</style>
</head>
<body>
  <div class="siteHeader">
    <span class="brand">goodreads</span>
    <input type="text" placeholder="Search books">
    <nav><a href="/">Home</a> <a href="/review/list">My Books</a> <a href="/browse">Browse &#9662;</a>
      <a href="/group">Community &#9662;</a> <a href="/user/sign_out">Sign out</a></nav>
  </div>
  <h1>${escapeHtml(page.title)}</h1>
  <div class="showing">Showing ${from}-${to} of ${total}</div>
${page.entries.map((entry, index) => quoteBlock(entry, index === straddlerIndex(page.entries))).join('\n')}
  <div class="pagination">
    <a href="/quotes/list?page=${Math.max(1, page.goodreadsPage - 1)}">&laquo; previous</a>
        ${pageLinks}
    <a href="/quotes/list?page=${Math.min(6, page.goodreadsPage + 1)}">next &raquo;</a>
  </div>
  <div class="siteFooter">
    <a href="/about/us">Company</a><a href="/about/careers">Careers</a><a href="/api">API</a>
    <a href="/about/terms">Terms</a><a href="/about/privacy">Privacy</a><a href="/help">Help</a>
    <div>&copy; 2026 Goodreads, Inc.</div>
  </div>
</body>
</html>`;
}

/* ---------------------------------------------------------------------------
 * Printing
 * ------------------------------------------------------------------------- */

/**
 * Chrome puts the date and document title in the top margin and the URL and
 * "3/7" page counter in the bottom margin. Reproducing that exactly is the
 * point of the whole fixture: it is the furniture that lands in the middle of a
 * quote when the quote straddles a page break.
 */
function furniture(page) {
  const style = 'font-family: sans-serif; font-size: 9px; color: #6b6b6b; width: 100%;'
    + ' padding: 0 12mm; display: flex; justify-content: space-between;';
  const url = `https://www.goodreads.com/quotes/list?page=${page.goodreadsPage}`;
  return {
    header: `<div style="${style}"><span>${page.printedAt}</span><span>${escapeHtml(page.title)}</span></div>`,
    footer: `<div style="${style}"><span>${url}</span>`
      + '<span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>',
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const expected = [];

  for (const page of PAGES) {
    const tab = await context.newPage();
    await tab.setContent(pageHtml(page), { waitUntil: 'load' });
    const { header, footer } = furniture(page);

    await tab.pdf({
      path: join(HERE, page.file),
      format: page.paper,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: header,
      footerTemplate: footer,
      margin: { top: '14mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });
    await tab.close();

    expected.push({
      file: page.file,
      goodreadsPage: page.goodreadsPage,
      sourceUrl: `https://www.goodreads.com/quotes/list?page=${page.goodreadsPage}`,
      showing: { from: page.showing[0], to: page.showing[1], total: page.showing[2] },
      quotes: page.entries.map((entry) => ({
        // The expectation is the text as it appears on screen, after the smart
        // quote filter — that is what a reader would copy, so that is what the
        // parser owes us.
        text: typeset(entry.text).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        author: entry.author,
        work: entry.work,
        tags: entry.tags,
      })),
    });
  }

  // A file that is emphatically not a quote list, so the importer can be held
  // to saying so plainly when somebody drags in the wrong PDF.
  const stray = await context.newPage();
  await stray.setContent(
    '<!doctype html><html><head><title>Reading list</title></head><body>'
      + '<h1>Autumn reading list</h1><p>Three books, in the order I mean to read them, '
      + 'with a note on why each one is on the list at all.</p>'
      + '<ol><li>The Human Condition</li><li>Seeing Like a State</li><li>The Order of Time</li></ol>'
      + '</body></html>',
    { waitUntil: 'load' },
  );
  await stray.pdf({ path: join(HERE, 'not-a-quote-list.pdf'), format: 'A4', printBackground: true });
  await stray.close();

  await browser.close();

  await writeFile(
    join(HERE, 'expected.json'),
    `${JSON.stringify({ generatedBy: 'tests/fixtures/make-fixtures.mjs', pages: expected }, null, 2)}\n`,
    'utf8',
  );

  console.log(`wrote ${PAGES.length} quote-list fixtures, one stray PDF, and expected.json`);
}

await main();
