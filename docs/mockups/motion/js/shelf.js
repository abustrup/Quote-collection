/* ==========================================================================
   The shelf — "motion" direction. Mockup, 2026-09-16.

   The argument of this direction: a library is a physical thing, and the only
   honest way to say so on a screen is with weight and inertia. So nothing here
   cuts. Books tilt toward you, lift toward you, glide to their new places, and
   a cover grows out of the shelf into its own page rather than being replaced
   by one. Every duration is between 200 and 550 ms and every curve is from one
   family, so the whole page moves like one material.

   Data is real: 87 Goodreads books + the works registry + quote counts,
   merged into js/data.js. Covers are hot-linked from Goodreads for the mockup;
   the real build downloads them to assets/covers/.
   ========================================================================== */

import { WORKS } from './data.js';

const EMPH = 'cubic-bezier(0.2, 0, 0, 1)';
const EXIT = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --- language -------------------------------------------------------------
   Two small dictionaries, keyed the way assets/i18n.js will be. Titles and
   author names are never in here: they are never translated. */

const DICT = {
  en: {
    'nav.quotes': 'Quotes', 'nav.shelf': 'Shelf', 'nav.board': 'Board', 'nav.next': 'Read next',
    'nav.add': '+ Add', 'nav.addFull': 'Add a quote',
    'head.kicker': 'A personal library', 'head.title': 'Everything on the shelf',
    'head.dek': 'Eighty-seven books, the talks worth keeping, and the lines they gave me.',
    'stage.now': 'Now reading', 'stage.open': 'Open',
    'ctl.search': 'Search a title or an author…', 'ctl.arrange': 'Arrange by',
    'arr.shelf': 'Shelf', 'arr.subject': 'Subject', 'arr.author': 'Author',
    'arr.year': 'Year written', 'arr.added': 'Date added', 'arr.rating': 'Rating',
    'chip.all': 'All', 'chip.read': 'Read', 'chip.reading': 'Reading',
    'chip.toread': 'Want to read', 'chip.abandoned': 'Did not finish',
    'sec.read': 'Read', 'sec.reading': 'Reading', 'sec.toread': 'Want to read',
    'sec.abandoned': 'Did not finish', 'sec.quoted': 'Quoted, never shelved',
    'sec.talks': 'Talks & essays', 'sec.all': 'All works',
    'count.line': '{works} works · {shelved} on the shelf · {quotes} quotes kept',
    'count.books': '{n} books', 'count.works': '{n} works',
    'empty': 'Nothing on the shelf matches that.',
    'det.back': 'The shelf', 'det.close': 'Close',
    'det.rateRead': 'How good was it', 'det.rateWant': 'How much do I want to read it',
    'det.shelf': 'Shelf', 'det.quotesBtn': 'Read the quotes', 'det.quotesBtnN': 'Read the {n} quotes',
    'det.goodreads': 'On Goodreads', 'det.find': 'Find it',
    'det.pages': '{n} pages', 'det.added': 'Added {d}', 'det.finished': 'Finished {d}',
    'det.quotes': '{n} quotes', 'det.quote1': '1 quote', 'det.noquotes': 'No quotes yet',
    'det.unrated': 'Not rated', 'det.clear': 'Clear',
    'det.more': 'Next to it on the shelf', 'det.source': 'The source',
    'lang.other': 'DA', 'theme.light': 'Light', 'theme.dark': 'Dark',
    'note': 'Mockup — “motion” direction. Real data, hot-linked covers, no write path. Hover a book, re-arrange the shelf, open one, rate it.',
    'kind.book': 'Book', 'kind.essay': 'Essay', 'kind.interview': 'Interview',
    'kind.speech': 'Speech', 'kind.letter': 'Letter', 'kind.document': 'Document', 'kind.other': 'Work',
  },
  da: {
    'nav.quotes': 'Citater', 'nav.shelf': 'Reolen', 'nav.board': 'Tavlen', 'nav.next': 'Læs næst',
    'nav.add': '+ Tilføj', 'nav.addFull': 'Tilføj et citat',
    'head.kicker': 'Et personligt bibliotek', 'head.title': 'Alt på reolen',
    'head.dek': 'Syvogfirs bøger, de taler der er værd at gemme, og de linjer de gav mig.',
    'stage.now': 'Læser nu', 'stage.open': 'Åbn',
    'ctl.search': 'Søg en titel eller en forfatter…', 'ctl.arrange': 'Ordn efter',
    'arr.shelf': 'Hylde', 'arr.subject': 'Emne', 'arr.author': 'Forfatter',
    'arr.year': 'Skrevet år', 'arr.added': 'Tilføjet', 'arr.rating': 'Karakter',
    'chip.all': 'Alle', 'chip.read': 'Læst', 'chip.reading': 'Læser',
    'chip.toread': 'Vil læse', 'chip.abandoned': 'Opgivet',
    'sec.read': 'Læst', 'sec.reading': 'Læser', 'sec.toread': 'Vil læse',
    'sec.abandoned': 'Opgivet', 'sec.quoted': 'Citeret, aldrig sat på hylden',
    'sec.talks': 'Taler & essays', 'sec.all': 'Alle værker',
    'count.line': '{works} værker · {shelved} på reolen · {quotes} gemte citater',
    'count.books': '{n} bøger', 'count.works': '{n} værker',
    'empty': 'Intet på reolen passer på det.',
    'det.back': 'Reolen', 'det.close': 'Luk',
    'det.rateRead': 'Hvor god var den', 'det.rateWant': 'Hvor meget vil jeg læse den',
    'det.shelf': 'Hylde', 'det.quotesBtn': 'Læs citaterne', 'det.quotesBtnN': 'Læs de {n} citater',
    'det.goodreads': 'På Goodreads', 'det.find': 'Find den',
    'det.pages': '{n} sider', 'det.added': 'Tilføjet {d}', 'det.finished': 'Læst færdig {d}',
    'det.quotes': '{n} citater', 'det.quote1': '1 citat', 'det.noquotes': 'Ingen citater endnu',
    'det.unrated': 'Ingen karakter', 'det.clear': 'Ryd',
    'det.more': 'Ved siden af på reolen', 'det.source': 'Kilden',
    'lang.other': 'EN', 'theme.light': 'Lys', 'theme.dark': 'Mørk',
    'note': 'Mockup — retningen “motion”. Rigtige data, covers hentet fra Goodreads, ingen skrivesti. Hold musen over en bog, ordn reolen om, åbn en, giv karakter.',
    'kind.book': 'Bog', 'kind.essay': 'Essay', 'kind.interview': 'Interview',
    'kind.speech': 'Tale', 'kind.letter': 'Brev', 'kind.document': 'Dokument', 'kind.other': 'Værk',
  },
};

const params = new URLSearchParams(location.search);
const state = {
  lang: params.get('lang') === 'da' ? 'da' : 'en',
  filter: params.get('filter') || 'all',
  arrange: params.get('sort') || 'shelf',
  q: '',
};

function t(key, vars) {
  let s = DICT[state.lang][key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

/* --- small helpers --------------------------------------------------------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const HUES = [30, 45, 8, 92, 205, 344, 262, 132];
const hue = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return HUES[h % HUES.length];
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(state.lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtYear = (y) => (y == null ? '' : y < 0 ? `${Math.abs(y)} BC` : String(y));

/* Local, in-memory edits. The real page puts these through the Worker; here
   they only have to prove the control works and the number sticks. */
const edits = new Map();
const scoreOf = (w) => {
  const e = edits.get(w.slug);
  if (e && e.score !== undefined) return e.score;
  return w.shelf === 'read' || w.shelf === 'abandoned' ? w.rating : w.want;
};
const shelfOf = (w) => (edits.get(w.slug)?.shelf ?? w.shelf);
const isWant = (w) => { const s = shelfOf(w); return s === 'to-read' || s === 'reading'; };

const nQuotes = (n) => (n === 1 ? t('det.quote1') : t('det.quotes', { n }));

const SHELF_LABEL = { read: 'chip.read', reading: 'chip.reading', 'to-read': 'chip.toread', abandoned: 'chip.abandoned' };

/* --- filtering and arranging ------------------------------------------------ */

function visible() {
  const q = state.q.trim().toLowerCase();
  return WORKS.filter((w) => {
    if (state.filter !== 'all' && shelfOf(w) !== state.filter) return false;
    if (!q) return true;
    return (w.title + ' ' + w.author).toLowerCase().includes(q);
  });
}

const byTitle = (a, b) => a.title.localeCompare(b.title);
const byAdded = (a, b) => String(b.added || '').localeCompare(String(a.added || '')) || byTitle(a, b);

function sections(list) {
  const stageSlugs = state.arrange === 'shelf' && state.filter !== 'reading'
    ? new Set(nowReading().map((w) => w.slug)) : new Set();

  if (state.arrange === 'shelf') {
    const order = [
      ['reading', 'sec.reading'], ['read', 'sec.read'], ['to-read', 'sec.toread'],
      ['abandoned', 'sec.abandoned'],
    ];
    const out = [];
    for (const [key, label] of order) {
      const items = list.filter((w) => shelfOf(w) === key && !stageSlugs.has(w.slug)).sort(byAdded);
      if (items.length) out.push({ id: key, label: t(label), items, kind: 'row' });
    }
    const quoted = list.filter((w) => !shelfOf(w) && w.kind === 'book').sort(byTitle);
    if (quoted.length) out.push({ id: 'quoted', label: t('sec.quoted'), items: quoted, kind: 'row' });
    const talks = list.filter((w) => w.kind !== 'book').sort(byAdded);
    if (talks.length) out.push({ id: 'talks', label: t('sec.talks'), items: talks, kind: 'row' });
    return out;
  }

  if (state.arrange === 'subject') {
    const map = new Map();
    for (const w of list) {
      if (!map.has(w.subject)) map.set(w.subject, []);
      map.get(w.subject).push(w);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([id, items]) => ({ id, label: id, items: items.sort(byTitle), kind: 'row' }));
  }

  const cmp = {
    author: (a, b) => a.author.localeCompare(b.author) || (a.year || 0) - (b.year || 0),
    year: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b),
    added: byAdded,
    rating: (a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || byTitle(a, b),
  }[state.arrange] || byTitle;

  return [{ id: 'all', label: t('sec.all'), items: [...list].sort(cmp), kind: 'grid' }];
}

const nowReading = () => WORKS.filter((w) => shelfOf(w) === 'reading').slice(0, 3);

/* --- covers ---------------------------------------------------------------- */

function kindLabel(w) {
  return DICT[state.lang]['kind.' + w.kind] || DICT.en['kind.' + w.kind] || w.kind;
}

/* One cover renderer for the grid, the stage and the detail. A book with a
   photograph gets the photograph; everything else — the talks, the essays,
   and the one novel Goodreads has no picture for — gets a cover set in the
   same type as the page, which is a deliberate look rather than a hole. */
function coverHTML(w, cls = 'cover', extra = '') {
  if (w.cover) {
    return `<div class="${cls}"><img src="${esc(w.cover)}" alt="" loading="lazy" decoding="async" width="330" height="495">${extra}</div>`;
  }
  return `<div class="${cls} is-type" style="--h:${hue(w.title)}">`
    + `<div class="t-kind">${esc(kindLabel(w))}</div>`
    + `<div class="t-title">${esc(w.short || w.title)}</div>`
    + `<div class="t-author">${esc(w.author)}</div>${extra}</div>`;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 16.8 6.4 19.7l1.2-6.2L3 9.2l6.3-.8z"/></svg>';
const STAR_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3.6l2.4 5.2 5.6.7-4.1 3.9 1.1 5.5L12 16.2 6.9 18.9 8 13.4 3.9 9.5l5.6-.7z"/></svg>';

/* --- rendering --------------------------------------------------------------- */

function bookHTML(w) {
  const s = shelfOf(w);
  const score = scoreOf(w);
  const sub = [fmtYear(w.year), s ? t(SHELF_LABEL[s]) : kindLabel(w)].filter(Boolean).join(' · ');
  /* the five things a hover has to answer, and the fifth is always the score,
     never the quote count standing in for it — the caption already carries
     that, and a card that sometimes shows a number and sometimes does not is
     a card you have to read twice */
  const scoreLine = score != null
    ? `<p class="o-score">${STAR}<span>${score}/10</span></p>`
    : `<p class="o-score" style="color:rgba(253,247,238,.62)">${esc(t('det.unrated'))}</p>`;
  const over = `<div class="over">`
    + `<p class="o-title">${esc(w.short || w.title)}</p>`
    + `<p class="o-sub">${esc(w.author)}</p>`
    + `<p class="o-sub">${esc(sub)}</p>${scoreLine}</div>`;
  return `<li class="book" data-slug="${esc(w.slug)}">
    <button class="book-btn" type="button">
      ${coverHTML(w, 'cover', over)}
      <div class="caption">
        <p class="c-title">${esc(w.short || w.title)}</p>
        <p class="c-author">${esc(w.author)}</p>
        ${w.quotes ? `<p class="c-quotes">${esc(nQuotes(w.quotes))}</p>` : ''}
      </div>
    </button>
  </li>`;
}

function sectionHTML(sec) {
  const n = sec.items.length;
  const allBooks = sec.items.every((w) => w.kind === 'book');
  return `<section class="section" data-sec="${esc(sec.id)}">
    <h2 class="section-head"><b>${esc(sec.label)}</b> <span>${esc(t(allBooks ? 'count.books' : 'count.works', { n }))}</span></h2>
    <ul class="${sec.kind === 'grid' ? 'grid' : 'row'}">${sec.items.map(bookHTML).join('')}</ul>
  </section>`;
}

const shelfEl = () => $('#shelf');

function renderShelf({ animate = true } = {}) {
  const host = shelfEl();
  const before = new Map();
  if (animate && !reduced) {
    $$('.book', host).forEach((el) => before.set(el.dataset.slug, el.getBoundingClientRect()));
  }

  const list = visible();
  const secs = sections(list);
  host.innerHTML = secs.length
    ? secs.map(sectionHTML).join('')
    : `<p class="empty">${esc(t('empty'))}</p>`;

  $('#count').textContent = t('count.line', {
    works: WORKS.length,
    shelved: WORKS.filter((w) => shelfOf(w)).length,
    quotes: WORKS.reduce((a, w) => a + w.quotes, 0),
  });

  if (!before.size) return;

  /* FLIP. Measured across every section at once, so a book that moves from
     "Want to read" into a subject row still glides instead of teleporting.
     The stagger is what makes the shelf read as re-shuffling rather than
     re-drawing — 14 ms apart, capped so the last book is never left behind. */
  let k = 0;
  $$('.book', host).forEach((el) => {
    const b = before.get(el.dataset.slug);
    const a = el.getBoundingClientRect();
    if (!b) {
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
        { duration: 360, easing: EMPH, delay: Math.min(k * 12, 220), fill: 'both' });
      k += 1;
      return;
    }
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    const ds = a.width ? b.width / a.width : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(ds - 1) < 0.01) { k += 1; return; }
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${ds})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 520, easing: EMPH, delay: Math.min(k * 14, 240), fill: 'both' });
    k += 1;
  });
}

/* --- the stage -------------------------------------------------------------- */

function renderStage() {
  const books = nowReading();
  const host = $('#stage');
  host.innerHTML = books.map((w) => `
    <button class="stage-book" type="button" data-slug="${esc(w.slug)}">
      ${coverHTML(w, 'stage-cover cover')}
      <div class="stage-meta">
        <p class="s-title">${esc(w.short || w.title)}</p>
        <p class="s-author">${esc(w.author)}</p>
        <span class="s-open">${esc(t('stage.open'))} <span class="arr">→</span></span>
      </div>
    </button>`).join('');
  $('#stage-head').innerHTML = `<b>${esc(t('stage.now'))}</b> <span>${books.length}</span>`;
  wireTilt();
}

/* A spring per book, the same law as the Video Library's rating bead — it
   arrives fast from far, barely moves from near, and overshoots a little.
   A CSS transition cannot do that, and a book that eases on a fixed curve
   feels like a picture of a book. */
function spring2d(onFrame) {
  const K = 170;
  const D = 19;
  let px = 0; let py = 0; let vx = 0; let vy = 0; let tx = 0; let ty = 0;
  let raf = null; let last = 0;
  const step = (now) => {
    if (!last) last = now;
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    vx += (K * (tx - px) - D * vx) * dt;
    vy += (K * (ty - py) - D * vy) * dt;
    px += vx * dt;
    py += vy * dt;
    onFrame(px, py);
    if (Math.abs(tx - px) < 0.01 && Math.abs(ty - py) < 0.01 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
      px = tx; py = ty; vx = 0; vy = 0; onFrame(px, py); raf = null; last = 0; return;
    }
    raf = requestAnimationFrame(step);
  };
  return {
    to(x, y) { tx = x; ty = y; if (!raf) { last = 0; raf = requestAnimationFrame(step); } },
  };
}

let tilts = [];
function wireTilt() {
  const stage = $('#stage');
  if (reduced) return;
  tilts = $$('.stage-book', stage).map((card) => {
    const cover = card.querySelector('.stage-cover');
    /* the vars live on the card, not the cover, so the contact shadow on the
       ledge leans with the same numbers the cover rotates by */
    const sp = spring2d((rx, ry) => {
      card.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      card.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      card.style.setProperty('--sx', (-ry * 1.6).toFixed(2));
      card.style.setProperty('--sy', (rx * 1.1).toFixed(2));
    });
    return { card, cover, sp };
  });

  const aim = (x, y) => {
    for (const tl of tilts) {
      const r = tl.cover.getBoundingClientRect();
      const nx = (x - (r.left + r.width / 2)) / (r.width * 1.5);
      const ny = (y - (r.top + r.height / 2)) / (r.height * 1.5);
      tl.sp.to(clamp(-ny * 16, -8, 8), clamp(nx * 16, -8, 8));
    }
  };
  stage.addEventListener('pointermove', (e) => aim(e.clientX, e.clientY));
  stage.addEventListener('pointerleave', () => tilts.forEach((tl) => tl.sp.to(0, 0)));
  stage.__aim = aim;
}

/* --- detail ----------------------------------------------------------------- */

let openSlug = null;

function detailHTML(w) {
  const s = shelfOf(w);
  const score = scoreOf(w);
  const facts = [
    fmtYear(w.year) && `<li>${esc(fmtYear(w.year))}</li>`,
    w.pages && `<li>${esc(t('det.pages', { n: w.pages }))}</li>`,
    w.subject && `<li>${esc(w.subject)}</li>`,
    w.added && `<li>${esc(t('det.added', { d: fmtDate(w.added) }))}</li>`,
    w.read && `<li>${esc(t('det.finished', { d: fmtDate(w.read) }))}</li>`,
    `<li><b>${esc(w.quotes ? nQuotes(w.quotes) : t('det.noquotes'))}</b></li>`,
  ].filter(Boolean).join('');

  const stars = Array.from({ length: 10 }, (_, i) => {
    const on = score != null && i < score;
    return `<button class="star${on ? ' on' : ''}" type="button" data-v="${i + 1}" aria-label="${i + 1}/10">${on ? STAR : STAR_O}</button>`;
  }).join('');

  const shelfBtns = ['read', 'reading', 'to-read', 'abandoned'].map((k) => `
    <button type="button" data-shelf="${k}" aria-pressed="${s === k}">${esc(t(SHELF_LABEL[k]))}</button>`).join('');

  const links = [
    w.goodreads && `<a class="btn-ghost" href="${esc(w.goodreads)}" target="_blank" rel="noopener">${esc(t('det.goodreads'))}</a>`,
    w.url && `<a class="btn-ghost" href="${esc(w.url)}" target="_blank" rel="noopener">${esc(t('det.source'))}</a>`,
    `<a class="btn-ghost" href="https://openlibrary.org/search?q=${encodeURIComponent(w.title + ' ' + w.author)}" target="_blank" rel="noopener">${esc(t('det.find'))}</a>`,
  ].filter(Boolean).join('');

  /* The shelf's answer to "what now": the same author first, then the same
     subject. It is the one thing a physical shelf does that a list does not —
     it puts a book next to its neighbours. */
  const near = [
    ...WORKS.filter((x) => x.slug !== w.slug && x.author === w.author),
    ...WORKS.filter((x) => x.slug !== w.slug && x.author !== w.author && x.subject === w.subject),
  ].slice(0, 7);

  const more = near.length ? `<div class="d-more d-item" style="--i:9">
      <p class="d-label">${esc(t('det.more'))}</p>
      <ul class="more-row">${near.map((x) => `<li class="book" data-slug="${esc(x.slug)}">
        <button class="book-btn" type="button">${coverHTML(x)}
          <div class="caption"><p class="c-title">${esc(x.short || x.title)}</p>
          <p class="c-author">${esc(x.author)}</p></div></button></li>`).join('')}</ul>
    </div>` : '';

  return `<div class="detail-inner">
    <div class="detail-bar d-item" style="--i:0">
      <span class="detail-kicker">${esc(t('det.back'))}</span>
      <button class="btn-ghost" id="detail-close" type="button">${esc(t('det.close'))} <span aria-hidden="true" style="opacity:.55;margin-left:.4rem">esc</span></button>
    </div>
    <div class="detail-grid">
      <div class="d-item" style="--i:1">${coverHTML(w, 'detail-cover cover')}</div>
      <div class="d-col">
        <h1 class="d-title d-item" style="--i:2">${esc(w.title)}</h1>
        <p class="d-author d-item" style="--i:3">${esc(w.author)}</p>
        <ul class="d-facts d-item" style="--i:4">${facts}</ul>
        ${w.quote ? `<p class="d-quote d-item" style="--i:5">\u201c${esc(w.quote)}\u201d</p>` : ''}

        <div class="d-block d-item" style="--i:6">
          <p class="d-label"><span id="rate-label">${esc(isWant(w) ? t('det.rateWant') : t('det.rateRead'))}</span>
            <span class="val" id="score-val">${score != null ? `${score}<span style="opacity:.45">/10</span>` : esc(t('det.unrated'))}</span></p>
          <div class="stars" id="stars">${stars}</div>
        </div>

        <div class="d-block d-item" style="--i:7">
          <p class="d-label">${esc(t('det.shelf'))}</p>
          <div class="seg" id="shelf-seg">${shelfBtns}</div>
        </div>

        <div class="d-actions d-item" style="--i:8">
          <a class="btn-primary" href="/?work=${encodeURIComponent(w.slug)}">
            ${esc(w.quotes > 1 ? t('det.quotesBtnN', { n: w.quotes }) : t('det.quotesBtn'))} <span aria-hidden="true">→</span>
          </a>
          ${links}
        </div>
      </div>
    </div>
    ${more}
  </div>`;
}

function paintDetail(w) {
  const d = $('#detail');
  d.innerHTML = detailHTML(w);
  d.hidden = false;
  document.body.style.overflow = 'hidden';
  d.scrollTop = 0;
  $('#detail-close').addEventListener('click', () => closeBook());
  wireRating(w);
  wireShelfSeg(w);
}

function openBook(slug, sourceCover, { animate = true } = {}) {
  const w = WORKS.find((x) => x.slug === slug);
  if (!w) return;
  openSlug = slug;
  const d = $('#detail');

  const finish = () => {
    d.classList.add('is-entering');
    setTimeout(() => d.classList.remove('is-entering'), 900);
  };

  if (!animate || reduced) { paintDetail(w); finish(); return; }

  /* Shared element: the cover does not disappear and reappear larger, it is
     the same object moving. View Transitions where the browser has them; a
     measured transform where it does not. */
  if (document.startViewTransition && sourceCover) {
    /* Exactly one element may carry the name at any instant. The card wears it
       while the old frame is captured, then hands it to the detail's cover
       inside the callback — the handover is the transition. */
    sourceCover.style.viewTransitionName = 'book-cover';
    const vt = document.startViewTransition(() => {
      sourceCover.style.viewTransitionName = '';
      paintDetail(w);
      const dc = $('.detail-cover', d);
      if (dc) dc.style.viewTransitionName = 'book-cover';
    });
    vt.ready.catch(() => {});
    vt.updateCallbackDone.catch(() => {});
    vt.finished.then(() => {}, () => {}).finally(() => {
      sourceCover.style.viewTransitionName = '';
      const dc = $('.detail-cover', d);
      if (dc) dc.style.viewTransitionName = '';
      finish();
    });
    return;
  }

  const from = sourceCover ? sourceCover.getBoundingClientRect() : null;
  paintDetail(w);
  const dc = $('.detail-cover', d);
  if (from && dc) {
    const to = dc.getBoundingClientRect();
    dc.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`, transformOrigin: 'top left' },
      { transform: 'none', transformOrigin: 'top left' },
    ], { duration: 460, easing: EMPH, fill: 'both' });
  }
  d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EMPH });
  finish();
}

function closeBook() {
  const d = $('#detail');
  if (d.hidden) return;
  const slug = openSlug;
  openSlug = null;
  const back = () => {
    d.hidden = true;
    d.innerHTML = '';
    document.body.style.overflow = '';
  };
  const card = $(`.book[data-slug="${CSS.escape(slug || '')}"] .cover`);
  if (reduced || !document.startViewTransition || !card) {
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EXIT }).finished.then(back, back);
    return;
  }
  const dc = $('.detail-cover', d);
  if (dc) dc.style.viewTransitionName = 'book-cover';
  /* the card only takes the name once the detail is gone, or two elements
     would hold it at the same instant and the browser refuses the pair */
  const vt = document.startViewTransition(() => {
    back();
    card.style.viewTransitionName = 'book-cover';
  });
  vt.ready.catch(() => {});
  vt.updateCallbackDone.catch(() => {});
  vt.finished.then(() => {}, () => {}).finally(() => { card.style.viewTransitionName = ''; });
}

/* --- rating ----------------------------------------------------------------- */

function wireRating(w) {
  const stars = $('#stars');
  stars.addEventListener('click', (e) => {
    const btn = e.target.closest('.star');
    if (!btn) return;
    const v = Number(btn.dataset.v);
    const prev = scoreOf(w) ?? 0;
    const next = v === scoreOf(w) ? 0 : v;
    const e0 = edits.get(w.slug) || {};
    e0.score = next === 0 ? null : next;
    edits.set(w.slug, e0);

    $$('.star', stars).forEach((s, i) => {
      const on = i < next;
      s.classList.toggle('on', on);
      s.innerHTML = on ? STAR : STAR_O;
      s.classList.remove('fill-in', 'pop');
      /* stars before the pressed one fill in sequence, the pressed one pops */
      if (on && !reduced) {
        if (i + 1 === next) {
          s.classList.add('pop');
          const ring = document.createElement('span');
          ring.className = 'ring';
          s.appendChild(ring);
          setTimeout(() => ring.remove(), 560);
        } else if (i >= prev) {
          s.style.setProperty('--k', String(i));
          s.classList.add('fill-in');
        }
      }
    });

    $('#score-val').innerHTML = next ? `${next}<span style="opacity:.45">/10</span>` : esc(t('det.unrated'));
    renderShelf({ animate: state.arrange === 'rating' });
  });
}

function wireShelfSeg(w) {
  const seg = $('#shelf-seg');
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-shelf]');
    if (!btn) return;
    const k = btn.dataset.shelf;
    const e0 = edits.get(w.slug) || {};
    e0.shelf = shelfOf(w) === k ? null : k;
    edits.set(w.slug, e0);
    $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shelf === e0.shelf)));
    btn.classList.remove('just');
    void btn.offsetWidth;
    btn.classList.add('just');
    const lbl = $('#rate-label');
    if (lbl) lbl.textContent = isWant(w) ? t('det.rateWant') : t('det.rateRead');
    renderStage();
    renderShelf();
    paintChips();
  });
}

/* --- chrome ----------------------------------------------------------------- */

function paintChips() {
  const counts = { all: WORKS.length };
  for (const k of ['read', 'reading', 'to-read', 'abandoned']) counts[k] = WORKS.filter((w) => shelfOf(w) === k).length;
  $('#chips').innerHTML = [['all', 'chip.all'], ['reading', 'chip.reading'], ['read', 'chip.read'],
    ['to-read', 'chip.toread'], ['abandoned', 'chip.abandoned']]
    .map(([k, key]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${state.filter === k}">${esc(t(key))} <span class="n">${counts[k]}</span></button>`)
    .join('');
}

function paintChrome() {
  document.documentElement.lang = state.lang;
  $('#nav-quotes').textContent = t('nav.quotes');
  $('#nav-shelf-label').textContent = t('nav.shelf');
  $('#nav-board').textContent = t('nav.board');
  $('#nav-next').textContent = t('nav.next');
  $('#nav-add').textContent = t('nav.add');
  $('#nav-add').title = t('nav.addFull');
  $('#kicker').textContent = t('head.kicker');
  $('#title').textContent = t('head.title');
  $('#dek').textContent = t('head.dek');
  $('#search').placeholder = t('ctl.search');
  $('#search').setAttribute('aria-label', t('ctl.search'));
  $('#arrange').innerHTML = [['shelf', 'arr.shelf'], ['subject', 'arr.subject'], ['author', 'arr.author'],
    ['year', 'arr.year'], ['added', 'arr.added'], ['rating', 'arr.rating']]
    .map(([k, key]) => `<option value="${k}"${state.arrange === k ? ' selected' : ''}>${esc(t('ctl.arrange'))}: ${esc(t(key))}</option>`).join('');
  $('#lang').innerHTML = `<b>${state.lang.toUpperCase()}</b><span>/</span>${t('lang.other')}`;
  const dark = document.documentElement.dataset.edition === 'night';
  $('#theme').innerHTML = `${dark ? '◐' : '◑'} ${esc(dark ? t('theme.dark') : t('theme.light'))}`;
  $('#note').textContent = t('note');
  paintChips();
}

function wire() {
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.filter = b.dataset.f;
    paintChips();
    renderShelf();
  });

  $('#arrange').addEventListener('change', (e) => {
    state.arrange = e.target.value;
    renderShelf();
  });

  let timer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const v = e.target.value;
    timer = setTimeout(() => { state.q = v; renderShelf(); }, 110);
  });

  $('#lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'da' : 'en';
    paintChrome();
    renderStage();
    renderShelf({ animate: false });
    if (openSlug) { const w = WORKS.find((x) => x.slug === openSlug); paintDetail(w); }
  });

  $('#theme').addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.edition = root.dataset.edition === 'night' ? 'paper' : 'night';
    paintChrome();
  });

  document.addEventListener('click', (e) => {
    const card = e.target.closest('.book-btn, .stage-book');
    if (!card) return;
    const li = card.closest('[data-slug]');
    openBook(li.dataset.slug, card.querySelector('.cover'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBook();
  });
}

/* --- boot -------------------------------------------------------------------- */

document.documentElement.dataset.edition = params.get('edition') === 'night' ? 'night' : 'paper';
paintChrome();
renderStage();
renderShelf({ animate: false });
wire();

/* Screenshot hooks. ?hover=1 freezes the hover + tilt state on the third book
   so a still can show what only a pointer normally reveals; ?open=1 opens a
   detail without the transition. */
if (params.get('hover') === '1') {
  requestAnimationFrame(() => {
    const cards = $$('.book');
    const target = cards[2] || cards[0];
    target?.classList.add('is-hover');
    const stage = $('#stage');
    const r = stage.getBoundingClientRect();
    stage.__aim?.(r.left + r.width * 0.78, r.top + r.height * 0.18);
    /* park the page so one still can hold both ideas at once: the stage
       tilting at the top and the lifted book below it */
    if (target) {
      const y = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, y - window.innerHeight * 0.52));
    }
  });
}

/* ?probe=1 prints what a person cannot see in a still: whether anything
   overflows sideways, and which element is the widest offender. It is how
   this mockup was checked at 390 px. */
if (params.get('probe') === '1') {
  setTimeout(() => {
    const de = document.documentElement;
    const bad = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.right > de.clientWidth + 1 || r.left < -1) {
        const style = getComputedStyle(el.parentElement || el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return;
        bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} L${Math.round(r.left)} R${Math.round(r.right)}`);
      }
    });
    const pre = document.createElement('pre');
    pre.id = 'probe';
    pre.textContent = JSON.stringify({
      scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
      overflow: de.scrollWidth - de.clientWidth,
      offenders: bad.slice(0, 12),
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight).slice(0, 8),
    }, null, 1);
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99;font:11px monospace;background:#fff;color:#000;max-width:100%;white-space:pre-wrap';
    document.body.appendChild(pre);
  }, 1200);
}

if (params.get('open') === '1') {
  const slug = params.get('slug')
    || [...WORKS].filter((w) => w.cover && w.rating != null && w.quotes > 0)
      .sort((a, b) => b.quotes - a.quotes)[0]?.slug;
  requestAnimationFrame(() => openBook(slug, null, { animate: false }));
}
