/**
 * The shelf.
 *
 * A quote collection is really a collection of books that were worth reading,
 * and this page says so: one card per work, arranged by whichever objective
 * property the reader asks for. Nothing here is a taste judgement — subject
 * comes from the registry, era from arithmetic on a date, count from the data.
 */

import { ERAS, SUBJECTS, eraFor, slug, typographic } from './quote-core.js';

const QUOTES_URL = 'data/quotes.json';
const WORKS_URL = 'data/works.json';

/** The year a work stops being reliably reachable on Project Gutenberg. */
const PUBLIC_DOMAIN_BEFORE = 1930;

const ERA_LABELS = new Map(ERAS.map((era) => [era.id, era.label]));
const sentenceCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);

const el = (id) => document.getElementById(id);
const dom = {
  arrange: el('arrange'),
  shelf: el('shelf'),
  summary: el('shelf-summary'),
  stats: el('shelf-stats'),
};

let books = [];

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Where to go and read the thing.
 *
 * A registry `url` always wins. Failing that, the year decides: anything first
 * published before 1930 is out of copyright in the US and almost certainly on
 * Project Gutenberg, and everything else gets a Google Books search. Both are
 * searches rather than guessed identifiers, because a link that lands on the
 * wrong book is worse than a link that lands on a result list.
 */
function findUrl(work) {
  if (work.url) return { href: work.url, label: 'Read it' };
  const query = encodeURIComponent(`${work.title} ${work.author}`);
  if (Number.isInteger(work.year) && work.year < PUBLIC_DOMAIN_BEFORE) {
    return {
      href: `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(work.title)}`,
      label: 'Gutenberg',
    };
  }
  return { href: `https://www.google.com/search?tbm=bks&q=${query}`, label: 'Find it' };
}

function formatYear(year) {
  if (!Number.isInteger(year)) return '';
  return year < 0 ? `${Math.abs(year)} BC` : String(year);
}

/** The shortest quote from a work, which is the one that reads best on a card. */
function shortestFrom(quotes) {
  return quotes.reduce((best, quote) => (best && best.text.length <= quote.text.length ? best : quote), null);
}

function buildBook(book) {
  const item = document.createElement('li');
  item.className = 'book';

  const title = document.createElement('a');
  title.className = 'book-title';
  title.href = `./?work=${encodeURIComponent(slug(book.title))}`;
  title.textContent = book.title;
  title.title = `Show the ${book.count === 1 ? 'quote' : 'quotes'} from ${book.title}`;

  const author = document.createElement('p');
  author.className = 'book-author';
  author.style.margin = '0';
  author.textContent = [book.author, formatYear(book.year)].filter(Boolean).join(' · ');

  item.append(title, author);

  if (book.sample) {
    const line = document.createElement('p');
    line.className = 'book-line-quote';
    const text = typographic(book.sample.text);
    line.textContent = text.length > 128 ? `${text.slice(0, 125).trimEnd()}…` : text;
    item.append(line);
  }

  const foot = document.createElement('p');
  foot.className = 'book-line';
  foot.style.margin = '0';

  const count = document.createElement('span');
  count.className = 'book-count';
  count.textContent = `${book.count} ${book.count === 1 ? 'quote' : 'quotes'}`;

  const subject = document.createElement(book.subject ? 'a' : 'span');
  subject.className = 'tag';
  if (book.subject) {
    subject.href = `./?subject=${encodeURIComponent(book.subject)}`;
    subject.textContent = sentenceCase(book.subject);
  } else {
    subject.textContent = 'unclassified';
    subject.title = 'Not in data/works.json yet, so it has no subject or era.';
  }

  const find = findUrl(book);
  const link = document.createElement('a');
  link.className = 'book-find';
  link.href = find.href;
  link.rel = 'noopener';
  link.target = '_blank';
  link.textContent = find.label;

  foot.append(count, subject, link);
  item.append(foot);
  return item;
}

/** How each arrangement groups the shelf, and in what order the groups run. */
const ARRANGEMENTS = {
  subject: {
    key: (book) => book.subject || 'unclassified',
    label: (key) => (key === 'unclassified' ? 'Not classified yet' : sentenceCase(key)),
    // Unclassified goes last, and only exists when something is genuinely
    // waiting for a subject.
    order: (a, b) => (SUBJECTS.indexOf(a) + 1 || 99) - (SUBJECTS.indexOf(b) + 1 || 99),
  },
  era: {
    key: (book) => eraFor(book.year) ?? 'undated',
    label: (key) => ERA_LABELS.get(key) ?? 'Undated',
    order: (a, b) => {
      const ids = ERAS.map((era) => era.id);
      // Undated works go last rather than sorting to the beginning of time.
      return (ids.indexOf(a) + 1 || 99) - (ids.indexOf(b) + 1 || 99);
    },
  },
  author: {
    key: (book) => book.author,
    label: (key) => key,
    order: (a, b) => a.localeCompare(b, 'en'),
  },
  count: {
    key: () => 'all',
    label: () => 'Most quoted first',
    order: () => 0,
  },
};

function render() {
  const mode = ARRANGEMENTS[dom.arrange.value] ?? ARRANGEMENTS.subject;
  const groups = new Map();
  for (const book of books) {
    const key = mode.key(book);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  }

  const fragment = document.createDocumentFragment();
  for (const key of [...groups.keys()].sort(mode.order)) {
    const entries = groups.get(key).sort((a, b) => b.count - a.count
      || a.title.localeCompare(b.title, 'en'));

    const section = document.createElement('section');
    section.className = 'shelf-section';

    const heading = document.createElement('h2');
    heading.className = 'shelf-heading';
    heading.append(mode.label(key));
    const tally = document.createElement('span');
    const quotes = entries.reduce((sum, book) => sum + book.count, 0);
    tally.textContent = `${entries.length} ${entries.length === 1 ? 'work' : 'works'} · ${quotes} quotes`;
    heading.append(tally);

    const list = document.createElement('ol');
    list.className = 'shelf';
    for (const book of entries) list.append(buildBook(book));

    section.append(heading, list);
    fragment.append(section);
  }

  dom.shelf.replaceChildren(fragment);
}

async function init() {
  const [collection, registry] = await Promise.all([
    loadJson(QUOTES_URL, { quotes: [] }),
    loadJson(WORKS_URL, { works: [] }),
  ]);

  const byWork = new Map();
  for (const quote of collection.quotes ?? []) {
    if (!quote.work) continue;
    if (!byWork.has(quote.work)) byWork.set(quote.work, []);
    byWork.get(quote.work).push(quote);
  }

  // A registry entry with no quotes is not a book on this shelf; the shelf is
  // what the collection actually draws on, not what it could.
  const known = new Map((registry.works ?? []).map((work) => [work.title, work]));
  books = [...byWork.entries()].map(([title, quotes]) => {
    const record = known.get(title);
    return {
      // A quote added from a phone arrives before anyone has classified its
      // book. Showing it as unclassified is the honest outcome: leaving it off
      // would make the shelf quietly disagree with the collection.
      ...(record ?? { title, author: quotes[0].author, year: quotes[0].year ?? null, subject: '' }),
      registered: Boolean(record),
      count: quotes.length,
      sample: shortestFrom(quotes),
    };
  });

  const quoted = books.reduce((sum, book) => sum + book.count, 0);
  const authors = new Set(books.map((book) => book.author)).size;
  dom.summary.textContent = `${books.length} works · ${authors} authors · ${quoted} quotes`;
  dom.stats.textContent = `${books.length} works on the shelf.`;

  dom.arrange.addEventListener('change', render);
  render();
}

init();
