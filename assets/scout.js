/**
 * The board.
 *
 * A weekly routine reads the collection, goes looking for lines from works that
 * are not in it, and writes what it found to `data/proposals.json`. This page
 * is the only place those proposals are seen, and the only way one becomes a
 * quote: tick the ones worth keeping, press the button, submit the issue it
 * opens. The same importer that handles everything else files them.
 *
 * Nothing here writes to the collection. The routine cannot either — it may
 * only propose. That separation is the whole point: a recommender that could
 * add its own recommendations would stop being a recommender.
 *
 * A proposal gets at most two showings. If it is still untaken after the
 * second, the routine retires it and never offers it again, so the board is
 * always mostly new. Which of the two showings a line is on is written on it,
 * because "last chance" is information you want before you skim past.
 *
 * Two showings was always a workaround for a missing signal: with only a
 * "keep" button, a page never opened and a page read-and-passed looked
 * identical, so the routine had to infer a no by waiting. The retire buttons
 * remove the guess — see `retireUrl` for why they take a slower route than
 * picks do.
 */

import { quoteId, VERIFICATION_LABELS } from './quote-core.js';

const QUOTES_URL = 'data/quotes.json';
const PROPOSALS_URL = 'data/proposals.json';
const REPO = 'https://github.com/abustrup/Quote-collection';

/**
 * Picks travel as ids, not as records.
 *
 * Carrying whole quote records in the link was measured at 6.2 KB for five
 * picks and 11 KB for nine — past what a prefilled issue URL reliably holds,
 * with a clipboard paste as the only fallback. Ids are fourteen characters, so
 * the link works the same whether one line is ticked or forty, and
 * `scripts/ingest.mjs` reads the records back out of data/proposals.json.
 */

const el = (id) => document.getElementById(id);

const dom = {
  board: el('board'),
  boardNote: el('board-note'),
  stats: el('stats'),
  empty: el('empty'),
  emptyDetail: el('empty-detail'),
  bar: el('action-bar'),
  count: el('selected-count'),
  add: el('add-selected'),
  retire: el('retire-selected'),
  clear: el('clear-selection'),
  retireAllRow: el('retire-all-row'),
  retireAll: el('retire-all'),
  kept: el('kept'),
  keptList: el('kept-list'),
  toast: el('toast'),
};

const state = {
  quotes: [],
  proposals: [],
  note: '',
  runId: null,
  held: new Set(),
  selected: new Set(),
};

/* ---------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------- */

let toastTimer;
function toast(message) {
  dom.toast.textContent = message;
  dom.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.dataset.visible = 'false'; }, 3600);
}

function pluralise(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString('en')} ${count === 1 ? singular : plural}`;
}

/** The identity the collection itself uses, so a proposal and a quote match. */
function identityOf(proposal) {
  return proposal.id || quoteId(proposal.text);
}

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

/* ---------------------------------------------------------------------------
 * What a proposal has become
 * ------------------------------------------------------------------------- */

/**
 * Truth about a proposal comes from the collection, not from the file that
 * proposed it. The moment the importer files a pick, its id is in quotes.json,
 * and this page says "kept" without waiting a week for the routine to notice.
 */
function stateOf(proposal) {
  if (state.held.has(identityOf(proposal))) return 'kept';
  if (proposal.status === 'expired') return 'expired';
  return 'open';
}

function showings(proposal) {
  return Array.isArray(proposal.shownOn) ? proposal.shownOn.length : 0;
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------- */

function render() {
  const open = state.proposals.filter((p) => stateOf(p) === 'open');
  const kept = state.proposals.filter((p) => stateOf(p) === 'kept');
  const expired = state.proposals.filter((p) => stateOf(p) === 'expired');

  dom.board.replaceChildren(...open.map(renderProposal));

  const showing = open.length > 0;
  dom.empty.hidden = showing;
  dom.retireAllRow.hidden = !showing;
  dom.boardNote.hidden = !state.note;
  dom.boardNote.textContent = state.note || '';

  if (!showing) {
    dom.emptyDetail.textContent = state.proposals.length === 0
      ? 'The scout has not posted a board yet. It runs weekly.'
      : 'Everything on the last board has been dealt with. The next one arrives on the scout’s next run.';
  }

  const parts = [];
  if (showing) parts.push(`${pluralise(open.length, 'line')} waiting`);
  if (kept.length) parts.push(`${pluralise(kept.length, 'kept')}`);
  if (expired.length) parts.push(`${expired.length} let go`);
  dom.stats.textContent = parts.join(' · ');

  renderKept(kept);
  renderSelection();
}

function renderProposal(proposal) {
  const item = document.createElement('li');
  item.className = 'proposal';
  item.dataset.id = identityOf(proposal);
  if (showings(proposal) >= 2) item.dataset.last = 'true';

  const label = document.createElement('label');
  label.className = 'proposal-pick';

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.action = 'select';
  box.checked = state.selected.has(identityOf(proposal));
  box.setAttribute('aria-label', `Keep this line by ${proposal.author}`);

  const figure = document.createElement('figure');
  figure.className = 'proposal-body';

  const blockquote = document.createElement('blockquote');
  blockquote.textContent = proposal.text;

  const caption = document.createElement('figcaption');
  const author = document.createElement('span');
  author.className = 'proposal-author';
  author.textContent = proposal.author;
  caption.append(author);

  if (proposal.work) {
    const work = document.createElement('cite');
    work.className = 'proposal-work';
    work.textContent = proposal.work;
    caption.append(document.createTextNode(', '), work);
  }
  if (proposal.year) {
    const year = document.createElement('span');
    year.className = 'proposal-year';
    year.textContent = ` (${proposal.year})`;
    caption.append(year);
  }
  if (proposal.source?.locator) {
    const locator = document.createElement('span');
    locator.className = 'proposal-locator';
    locator.textContent = ` · ${proposal.source.locator}`;
    caption.append(locator);
  }

  figure.append(blockquote, caption);

  if (proposal.why) {
    const why = document.createElement('p');
    why.className = 'proposal-why';
    why.textContent = proposal.why;
    figure.append(why);
  }

  const meta = document.createElement('p');
  meta.className = 'proposal-meta';

  const status = proposal.verification?.status;
  if (status && status !== 'verified') {
    const badge = document.createElement('span');
    badge.className = 'proposal-badge';
    badge.textContent = VERIFICATION_LABELS[status]?.short ?? status;
    badge.title = proposal.verification?.note || VERIFICATION_LABELS[status]?.long || '';
    meta.append(badge);
  }

  if (showings(proposal) >= 2) {
    const last = document.createElement('span');
    last.className = 'proposal-badge proposal-badge-last';
    last.textContent = 'Second showing — retired after this';
    meta.append(last);
  }

  if (proposal.source?.url) {
    const link = document.createElement('a');
    link.className = 'proposal-link';
    link.href = proposal.source.url;
    link.rel = 'noopener';
    link.target = '_blank';
    link.textContent = 'Source';
    meta.append(link);
  }

  if (meta.childNodes.length) figure.append(meta);

  label.append(box);
  item.append(label, figure);
  return item;
}

function renderKept(kept) {
  dom.kept.hidden = kept.length === 0;
  if (!kept.length) return;

  dom.keptList.replaceChildren(...kept.slice().reverse().map((proposal) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `index.html#${identityOf(proposal)}`;
    link.textContent = proposal.text.length > 96
      ? `${proposal.text.slice(0, 96).trimEnd()}…`
      : proposal.text;
    const who = document.createElement('span');
    who.className = 'kept-who';
    who.textContent = ` — ${proposal.author}`;
    item.append(link, who);
    return item;
  }));
}

function renderSelection() {
  const count = state.selected.size;
  dom.bar.hidden = count === 0;
  dom.count.textContent = count === 1 ? '1 line selected' : `${count} lines selected`;
}

/* ---------------------------------------------------------------------------
 * Handing picks to the importer
 * ------------------------------------------------------------------------- */

/** The ticked lines, in the order they appear on the board rather than in the
 *  order they happened to be clicked. */
function picked() {
  return state.proposals.filter((proposal) => state.selected.has(identityOf(proposal)));
}

/**
 * The issue the board opens. `context` is never read by the importer; it is
 * there so the issue is legible a year later instead of being a list of
 * hashes.
 */
function pickUrl(chosen) {
  const params = new URLSearchParams({
    template: 'board-pick.yml',
    title: `Keep: ${pluralise(chosen.length, 'line')} from the board`,
    ids: chosen.map((proposal) => identityOf(proposal)).join('\n'),
    context: chosen
      .map((proposal) => `${proposal.author}: ${proposal.text.slice(0, 80)}${proposal.text.length > 80 ? '…' : ''}`)
      .join('\n'),
  });
  return `${REPO}/issues/new?${params}`;
}

function handOver() {
  const chosen = picked();
  if (chosen.length === 0) return;
  window.open(pickUrl(chosen), '_blank', 'noopener');
  toast('Submit the issue that just opened and the robot files them.');
}

/**
 * Saying no.
 *
 * Until this existed, accepting was the only signal the board could carry, so
 * "never opened the page" and "read it all and passed" were the same event in
 * the data. The scout had to tell them apart by showing a line twice and
 * waiting. This hands it the answer directly.
 *
 * It opens its own form rather than reusing the pick one, and that form is
 * handled by its own workflow rather than by `ingest-quote.yml`. Keeping the
 * two apart is the point: the keep path can write the collection, this one can
 * only flip a `status` field in data/proposals.json, so a bug here costs a
 * suggestion rather than a quote.
 */
function retireUrl(chosen) {
  const params = new URLSearchParams({
    template: 'board-retire.yml',
    title: `Retire: ${pluralise(chosen.length, 'line')} from the board`,
    ids: chosen.map((proposal) => identityOf(proposal)).join('\n'),
    context: chosen
      .map((proposal) => `${proposal.author}: ${proposal.text.slice(0, 80)}${proposal.text.length > 80 ? '…' : ''}`)
      .join('\n'),
  });
  return `${REPO}/issues/new?${params}`;
}

function retire(chosen, { confirmFirst = false } = {}) {
  if (chosen.length === 0) return;
  if (confirmFirst) {
    const question = `Retire ${pluralise(chosen.length, 'line')}? They are never proposed again, in any wording.`;
    if (!window.confirm(question)) return;
  }
  window.open(retireUrl(chosen), '_blank', 'noopener');
  toast('Submit the issue that just opened and they come off the board.');
}

function retireSelected() {
  retire(picked());
}

/** Everything currently on the board — the lines the page is showing, not the
 *  whole proposal history, which is mostly already answered. */
function retireWholeBoard() {
  retire(state.proposals.filter((proposal) => stateOf(proposal) === 'open'), { confirmFirst: true });
}

/* ---------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------- */

function onBoardChange(event) {
  const box = event.target.closest('[data-action="select"]');
  if (!box) return;
  const id = box.closest('.proposal')?.dataset.id;
  if (!id) return;
  if (box.checked) state.selected.add(id);
  else state.selected.delete(id);
  renderSelection();
}

function clearSelection() {
  state.selected.clear();
  dom.board.querySelectorAll('[data-action="select"]').forEach((box) => { box.checked = false; });
  renderSelection();
}

async function start() {
  let quotes;
  let proposals;
  try {
    [quotes, proposals] = await Promise.all([loadJson(QUOTES_URL), loadJson(PROPOSALS_URL)]);
  } catch (error) {
    dom.empty.hidden = false;
    dom.emptyDetail.textContent = `Could not read the board (${error.message}).`;
    return;
  }

  state.quotes = quotes.quotes ?? quotes ?? [];
  state.held = new Set(state.quotes.map((quote) => quote.id ?? quoteId(quote.text)));
  state.proposals = proposals.proposals ?? [];
  state.note = proposals.board?.note ?? '';
  state.runId = proposals.board?.runId ?? null;

  render();
}

dom.board.addEventListener('change', onBoardChange);
dom.add.addEventListener('click', handOver);
dom.retire.addEventListener('click', retireSelected);
dom.retireAll.addEventListener('click', retireWholeBoard);
dom.clear.addEventListener('click', clearSelection);

start();
