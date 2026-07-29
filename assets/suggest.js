/**
 * The taste engine.
 *
 * Two modes, deliberately in this order:
 *
 *   1. An offline recommender that runs on this device against a hand-curated
 *      library. It is free, works with no network, and cannot hallucinate a
 *      book, because every candidate was checked by a human before it shipped.
 *   2. An optional call to the Claude API using the reader's own key. Off by
 *      default, because it spends their money.
 *
 * Mode 1 is the product. Mode 2 is a nicety.
 */

import { slug } from './quote-core.js';

const QUOTES_URL = 'data/quotes.json';
const LIBRARY_URL = 'data/library.json';
const KEY_STORAGE = 'quotes-anthropic-key';

/** How many suggestions to show, and how many may share one author. */
const SUGGESTION_COUNT = 8;
const MAX_PER_AUTHOR = 2;

const el = (id) => document.getElementById(id);

const dom = {
  theme: el('filter-theme'),
  difficulty: el('difficulty'),
  reroll: el('reroll'),
  taste: el('taste'),
  tasteText: el('taste-text'),
  suggestions: el('suggestions'),
  empty: el('empty'),
  emptyDetail: el('empty-detail'),
  libraryStats: el('library-stats'),
  apiKey: el('api-key'),
  askClaude: el('ask-claude'),
  forgetKey: el('forget-key'),
  claudeStatus: el('claude-status'),
  claudeOutput: el('claude-output'),
  toast: el('toast'),
};

let quotes = [];
let library = [];
let profile = null;
let rerollSeed = 0;

/* ---------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------- */

let toastTimer;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.dataset.visible = 'false'; }, 2600);
}

/** Words too common to say anything about a person's taste. */
const STOPWORDS = new Set(`a an and are as at be been but by can do does for from had has have he
her him his how i if in into is it its me my no not of on one only or our out over she should so
such than that the their them then there these they this those to too under up upon us was we
were what when where which who whom why will with would you your yours it's don't i'm we're`
  .split(/\s+/));

function topEntries(map, count) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
}

function listPhrase(items, conjunction = 'and') {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/* ---------------------------------------------------------------------------
 * The taste profile
 * ------------------------------------------------------------------------- */

/**
 * Reduce the collection to a handful of numbers describing what this reader
 * keeps coming back to.
 *
 * Favourites count double. A quote someone deliberately starred says more about
 * their taste than one they saved in passing, and weighting it that way is the
 * cheapest signal available without asking them anything.
 */
function buildProfile(collection) {
  const favorites = new Set(readFavorites());
  const themes = new Map();
  const authors = new Map();
  const works = new Set();
  const keywords = new Map();
  const years = [];

  for (const quote of collection) {
    const weight = favorites.has(quote.id) || quote.favorite ? 2 : 1;

    for (const theme of quote.themes ?? []) {
      themes.set(theme, (themes.get(theme) ?? 0) + weight);
    }
    authors.set(quote.author, (authors.get(quote.author) ?? 0) + weight);
    if (quote.work) works.add(slug(quote.work));
    if (Number.isInteger(quote.year)) years.push(quote.year);

    for (const raw of `${quote.text} ${(quote.tags ?? []).join(' ')}`.toLowerCase().match(/[\p{L}']{4,}/gu) ?? []) {
      if (STOPWORDS.has(raw)) continue;
      keywords.set(raw, (keywords.get(raw) ?? 0) + weight);
    }
  }

  const themeTotal = [...themes.values()].reduce((sum, n) => sum + n, 0) || 1;
  const themeShare = new Map([...themes].map(([theme, n]) => [theme, n / themeTotal]));

  return {
    size: collection.length,
    themes,
    themeShare,
    authors,
    authorSlugs: new Set([...authors.keys()].map(slug)),
    works,
    keywords: new Set(topEntries(keywords, 60).map(([word]) => word)),
    medianYear: years.length
      ? [...years].sort((a, b) => a - b)[Math.floor(years.length / 2)]
      : null,
  };
}

function readFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem('quotes-favorites') ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------
 * Scoring
 * ------------------------------------------------------------------------- */

/**
 * Score one work against the profile, and record *why* it scored.
 *
 * The reasons are not decoration. A recommender that cannot say why it
 * recommended something is indistinguishable from a random shelf, and the
 * reader has no way to tell it that it guessed wrong.
 */
function scoreWork(work, taste, options) {
  let score = 0;
  const reasons = [];

  const workThemes = work.themes ?? [];
  const themeOverlap = workThemes.reduce((sum, theme) => sum + (taste.themeShare.get(theme) ?? 0), 0);
  if (themeOverlap > 0) {
    score += themeOverlap * 5;
    const shared = workThemes
      .filter((theme) => taste.themes.has(theme))
      .sort((a, b) => (taste.themes.get(b) ?? 0) - (taste.themes.get(a) ?? 0))
      .slice(0, 2);
    if (shared.length) {
      const counts = shared.map((theme) => `${taste.themes.get(theme)} on ${theme}`);
      reasons.push(`you keep ${listPhrase(counts)}`);
    }
  }

  const keywordHits = (work.keywords ?? []).filter((word) => taste.keywords.has(word.toLowerCase()));
  if (keywordHits.length) {
    score += Math.min(keywordHits.length, 4) * 0.5;
    reasons.push(`your quotes keep using the language of ${listPhrase(keywordHits.slice(0, 3))}`);
  }

  // Already quoting this author is the single strongest signal in the data.
  if (taste.authorSlugs.has(slug(work.author))) {
    score += 3.5;
    reasons.push(`you already quote ${work.author}`);
  }

  for (const neighbour of work.adjacentTo ?? []) {
    if (taste.authorSlugs.has(slug(neighbour))) {
      score += 1.6;
      reasons.push(`it follows naturally from ${neighbour}`);
      break;
    }
  }

  // Nothing is gained by recommending a book they are already quoting from.
  if (taste.works.has(slug(work.title))) score -= 6;

  if (options.theme) {
    if (!workThemes.includes(options.theme)) return null;
    score += 2;
  }

  if (options.difficulty && work.difficulty !== options.difficulty) return null;

  if (work.lengthHours && work.lengthHours <= 3) score += 0.35;

  // A deterministic per-work jitter, re-seeded by "Suggest again", so the list
  // can be refreshed without becoming random noise between page loads.
  score += ((hashString(`${work.id}:${rerollSeed}`) % 1000) / 1000) * 0.9;

  return { work, score, reasons };
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Pick the final list, capping how many can share an author.
 *
 * Without the cap, a reader with nine Wittgenstein quotes gets nine
 * Wittgenstein recommendations — technically the best matches, and useless.
 */
function selectSuggestions(scored) {
  const perAuthor = new Map();
  const picked = [];

  for (const candidate of scored.sort((a, b) => b.score - a.score)) {
    const key = slug(candidate.work.author);
    const used = perAuthor.get(key) ?? 0;
    if (used >= MAX_PER_AUTHOR) continue;
    perAuthor.set(key, used + 1);
    picked.push(candidate);
    if (picked.length >= SUGGESTION_COUNT) break;
  }

  return picked;
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------- */

function renderTaste() {
  if (!profile || profile.size === 0) {
    dom.taste.hidden = true;
    return;
  }

  const topThemes = topEntries(profile.themes, 3).map(([theme]) => theme);
  const topAuthors = topEntries(profile.authors, 3).map(([author]) => author);

  const parts = [];
  parts.push(`${profile.size} quote${profile.size === 1 ? '' : 's'} from ${profile.authors.size} author${profile.authors.size === 1 ? '' : 's'}.`);
  if (topThemes.length) parts.push(`You circle back to ${listPhrase(topThemes)}.`);
  if (topAuthors.length) parts.push(`You return most often to ${listPhrase(topAuthors)}.`);
  if (profile.medianYear) {
    parts.push(profile.medianYear < 1900
      ? `Your centre of gravity sits well before the twentieth century.`
      : `Most of what you keep was written around ${profile.medianYear}.`);
  }

  dom.tasteText.textContent = parts.join(' ');
  dom.taste.hidden = false;
}

function renderSuggestions() {
  const options = {
    theme: dom.theme.value,
    difficulty: dom.difficulty.value,
  };

  const scored = library
    .map((work) => scoreWork(work, profile, options))
    .filter(Boolean);

  const picked = selectSuggestions(scored);

  dom.suggestions.replaceChildren();
  dom.empty.hidden = picked.length > 0;

  if (!picked.length) {
    dom.emptyDetail.textContent = profile.size === 0
      ? 'Import your quotes first — the suggestions are built from what you have kept.'
      : 'Nothing in the library matches those filters. Try loosening one.';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const { work, reasons } of picked) {
    const item = document.createElement('li');
    item.className = 'work';

    const head = document.createElement('div');
    head.className = 'work-head';

    const title = document.createElement('h3');
    title.className = 'work-title';
    title.textContent = work.title;

    const byline = document.createElement('span');
    byline.className = 'work-byline';
    byline.textContent = [work.author, work.year].filter(Boolean).join(' · ');

    head.append(title, byline);
    item.append(head);

    if (work.why) {
      const why = document.createElement('p');
      why.className = 'work-why';
      why.textContent = work.why;
      item.append(why);
    }

    if (reasons.length) {
      const because = document.createElement('p');
      because.className = 'work-because';
      // Joined with a semicolon rather than "and", because a single reason
      // often contains one already ("you keep 6 on technology and 4 on risk")
      // and a second "and" on top of it reads as a run-on.
      because.append(`Suggested because ${[...new Set(reasons)].slice(0, 2).join('; ')}.`);
      item.append(because);
    }

    const meta = document.createElement('div');
    meta.className = 'work-meta';

    for (const theme of (work.themes ?? []).slice(0, 3)) {
      const tag = document.createElement('a');
      tag.className = 'tag';
      tag.href = `index.html?theme=${encodeURIComponent(theme)}`;
      tag.textContent = theme;
      meta.append(tag);
    }

    if (work.difficulty) {
      const difficulty = document.createElement('span');
      difficulty.className = 'tag';
      difficulty.textContent = work.difficulty;
      meta.append(difficulty);
    }

    if (work.url) {
      const link = document.createElement('a');
      link.className = 'work-link';
      link.href = work.url;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.textContent = 'Read it →';
      meta.append(link);
    }

    item.append(meta);
    fragment.append(item);
  }

  dom.suggestions.append(fragment);
}

function populateThemes() {
  const themes = new Set();
  for (const work of library) for (const theme of work.themes ?? []) themes.add(theme);
  for (const theme of [...themes].sort()) dom.theme.append(new Option(theme, theme));
}

/* ---------------------------------------------------------------------------
 * Optional: ask Claude
 * ------------------------------------------------------------------------- */

const CLAUDE_SCHEMA = {
  type: 'object',
  required: ['recommendations'],
  additionalProperties: false,
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'author', 'why', 'inLibrary'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          why: { type: 'string', description: 'Two sentences, written to Alexander, about what this work does and why it follows from his collection.' },
          inLibrary: { type: 'boolean', description: 'True only if this work was in the supplied candidate library.' },
        },
      },
    },
  },
};

function buildClaudePrompt() {
  const topThemes = topEntries(profile.themes, 8).map(([theme, n]) => `${theme} (${n})`);
  const topAuthors = topEntries(profile.authors, 12).map(([author, n]) => `${author} (${n})`);
  const sample = quotes.slice(0, 25).map((quote) => `- "${quote.text}" — ${quote.author}${quote.work ? `, ${quote.work}` : ''}`);
  const candidates = library.map((work) => `${work.title} — ${work.author} (${work.year ?? 'n.d.'})`);

  return `Here is a reader's personal quote collection, summarised.

Themes he saves most, with counts: ${topThemes.join(', ') || 'none recorded'}
Authors he returns to: ${topAuthors.join(', ') || 'none recorded'}

A sample of the quotes themselves:
${sample.join('\n')}

A vetted candidate library (every one of these is confirmed to exist):
${candidates.join('\n')}

Recommend 6 works to read next.

Rules, in order of importance:
1. Never invent a book. Prefer the candidate library. You may name at most 2
   works from outside it, and only if you are certain they exist with that
   author — mark those with inLibrary false.
2. Do not recommend anything he is already quoting from.
3. Spread the recommendations. No more than two by the same author, and include
   at least one that is a genuine stretch rather than more of the same.
4. Write each "why" to him directly, in two sentences: what the work actually
   does, and what in his collection it follows from. Be concrete. Never write
   blurb language and never tell him he will love it.`;
}

async function askClaude() {
  const key = dom.apiKey.value.trim();
  if (!key) {
    dom.claudeStatus.textContent = 'Paste your Anthropic API key first. Nothing is sent until you do.';
    return;
  }

  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch { /* private browsing; the key simply will not persist */ }

  dom.askClaude.disabled = true;
  dom.claudeStatus.textContent = 'Asking Claude…';
  dom.claudeOutput.replaceChildren();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Required for a browser to call the API directly rather than through
        // a server. It is what makes this page work with no backend at all.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 8000,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: CLAUDE_SCHEMA },
        },
        messages: [{ role: 'user', content: buildClaudePrompt() }],
      }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error?.message ?? `${response.status} ${response.statusText}`);
    }

    const message = await response.json();

    // Claude can decline a request outright; the HTTP call still succeeds, so
    // reading content[0] without checking this would show an empty list.
    if (message.stop_reason === 'refusal') {
      dom.claudeStatus.textContent = 'Claude declined this request. The suggestions above still stand.';
      return;
    }

    const text = message.content?.find((block) => block.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text);
    renderClaude(parsed.recommendations ?? []);
    dom.claudeStatus.textContent = `Claude suggested ${parsed.recommendations?.length ?? 0} works.`;
  } catch (error) {
    dom.claudeStatus.textContent = `That did not work: ${error.message}`;
  } finally {
    dom.askClaude.disabled = false;
  }
}

function renderClaude(recommendations) {
  const list = document.createElement('ol');
  list.className = 'suggestions';

  for (const item of recommendations) {
    const entry = document.createElement('li');
    entry.className = 'work';

    const head = document.createElement('div');
    head.className = 'work-head';

    const title = document.createElement('h3');
    title.className = 'work-title';
    title.textContent = item.title;

    const byline = document.createElement('span');
    byline.className = 'work-byline';
    byline.textContent = item.author;

    head.append(title, byline);
    entry.append(head);

    const why = document.createElement('p');
    why.className = 'work-why';
    why.textContent = item.why;
    entry.append(why);

    if (!item.inLibrary) {
      const warning = document.createElement('p');
      warning.className = 'work-because';
      warning.append('Not from the vetted library — worth confirming this one exists before you buy it.');
      entry.append(warning);
    }

    list.append(entry);
  }

  dom.claudeOutput.replaceChildren(list);
}

/* ---------------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------------- */

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

async function init() {
  const [collection, libraryFile] = await Promise.all([
    loadJson(QUOTES_URL, { quotes: [] }),
    loadJson(LIBRARY_URL, { works: [] }),
  ]);

  quotes = collection.quotes ?? [];
  library = libraryFile.works ?? [];
  profile = buildProfile(quotes);

  populateThemes();
  renderTaste();
  renderSuggestions();

  dom.libraryStats.textContent = library.length
    ? `${library.length} works in the library.`
    : 'The library has not been filled in yet.';

  dom.theme.addEventListener('change', renderSuggestions);
  dom.difficulty.addEventListener('change', renderSuggestions);
  dom.reroll.addEventListener('click', () => {
    rerollSeed += 1;
    renderSuggestions();
    toast('Fresh suggestions');
  });

  try {
    dom.apiKey.value = localStorage.getItem(KEY_STORAGE) ?? '';
  } catch { /* not fatal */ }

  dom.askClaude.addEventListener('click', askClaude);
  dom.forgetKey.addEventListener('click', () => {
    try { localStorage.removeItem(KEY_STORAGE); } catch { /* not fatal */ }
    dom.apiKey.value = '';
    dom.claudeStatus.textContent = 'Key removed from this browser.';
    toast('Key forgotten');
  });
}

init();
