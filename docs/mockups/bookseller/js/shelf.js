/* The shelf — direction "bookseller".
   Real data, baked into js/data.js from data/works.json, data/quotes.json and
   docs/goodreads-export-2026-09-16.json. */

const DATA = window.SHELF_DATA;
const params = new URLSearchParams(location.search);

const state = {
  lang: params.get('lang') === 'da' ? 'da' : 'en',
  edition: params.get('edition') === 'night' ? 'night' : 'paper',
  sort: params.get('sort') || 'shelf',
  filter: params.get('filter') || 'all',
  query: '',
  open: null,
};

/* ---------------------------------------------------------------- language */

function t(key, vars) {
  let s = (window.DICT[state.lang] && window.DICT[state.lang][key]) || window.DICT.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, vars[k]);
  return s;
}
const nf = () => new Intl.NumberFormat(state.lang === 'da' ? 'da-DK' : 'en-GB');
const monthOf = (iso) => {
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const dateOf = (iso) => iso
  ? new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
  : '—';

/* ------------------------------------------------------------------- model */

const books = DATA.books.map(prep);
const talks = DATA.talks.map(prep);
let ratings = {};   // local overrides, so the controls actually do something

function prep(item) {
  const hash = [...item.slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7);
  const pages = item.pages || 240 + (hash % 260);
  const h = 150 + Math.round(Math.min(Math.max(pages - 120, 0) / 780, 1) * 46);
  return {
    ...item,
    hash,
    h,
    w: Math.round(h * 0.655),
    hue: [26, 38, 50, 16, 96, 205, 320][hash % 7],
    tint: hash % 7,
    surname: (item.author || '').trim().split(/\s+/).slice(-1)[0] || item.author || '',
  };
}

const scoreOf = (b) => {
  if (ratings[b.slug] !== undefined) return ratings[b.slug];
  return b.rating != null ? b.rating : (b.want != null ? b.want : null);
};
const isWantKind = (b) => b.shelf === 'to-read' || b.shelf === 'reading' || !b.shelf;
const eraOf = (y) => {
  if (!Number.isInteger(y)) return 'unknown';
  if (y <= 500) return 'antiquity';
  if (y <= 1500) return 'medieval';
  if (y <= 1800) return 'early-modern';
  if (y <= 1900) return 'c19';
  if (y <= 2000) return 'c20';
  return 'contemporary';
};

const totalQuotes = [...books, ...talks].reduce((a, b) => a + (b.quotes || 0), 0);
const SHELVES = ['reading', 'read', 'to-read', 'abandoned'];
const shelfCounts = {};
for (const s of SHELVES) shelfCounts[s] = books.filter((b) => b.shelf === s).length;

/* ------------------------------------------------------------------ pieces */

const STAR = 'M12 2.6l2.7 5.9 6.3.7-4.7 4.3 1.3 6.3L12 16.6 6.4 19.8l1.3-6.3L3 9.2l6.3-.7z';
function starSvg(cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'star' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', STAR);
  s.appendChild(p);
  return s;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function coverInner(item) {
  if (item.cover) {
    const img = new Image();
    img.src = item.cover;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    return img;
  }
  const box = el('span', 'cover-type');
  box.appendChild(el('span', 'tc-kind', item.kind && item.kind !== 'book' ? t('kind.' + item.kind) : (item.year ? String(item.year) : '')));
  const mid = el('span');
  mid.appendChild(el('span', 'tc-title', item.title));
  mid.appendChild(el('span', 'tc-rule'));
  box.appendChild(mid);
  box.appendChild(el('span', 'tc-author', item.author || ''));
  return box;
}

function inlineStars(score) {
  const wrap = el('span', 'stars stars-inline');
  const n = Math.round((score || 0) / 2);
  for (let i = 0; i < 5; i++) {
    const s = starSvg();
    if (i >= n) s.style.opacity = '0.28';
    wrap.appendChild(s);
  }
  return wrap;
}

/* The books themselves are reused across sorts so FLIP has something to move. */
const nodes = new Map();

function bookNode(item) {
  if (nodes.has(item.slug)) return nodes.get(item.slug);
  const btn = el('button', 'book');
  btn.type = 'button';
  btn.dataset.slug = item.slug;
  btn.style.setProperty('--bw', item.w + 'px');
  btn.style.setProperty('--bh', item.h + 'px');
  btn.setAttribute('aria-label', `${item.title} — ${item.author}`);

  const tilt = el('span', 'tilt');
  const box = el('span', 'cover-box');
  if (!item.cover) {
    box.style.setProperty('--tc-h', item.hue);
    box.style.setProperty('--tc-d', item.tint);
  }
  box.appendChild(coverInner(item));
  tilt.appendChild(box);
  btn.appendChild(tilt);
  btn.addEventListener('click', () => openSheet(item.slug));
  nodes.set(item.slug, btn);
  return btn;
}

function plateNode(item) {
  const p = el('span', 'plate');
  p.appendChild(el('span', 'p-title', item.title));
  p.appendChild(el('span', 'p-author', item.author));
  const foot = el('span', 'p-foot');
  foot.appendChild(el('span', 'p-year', item.year ? String(item.year) : '—'));
  const shelfTag = el('span', 'p-shelf', t(item.shelf ? 'shelf.' + item.shelf : 'kind.' + (item.kind || 'book')));
  foot.appendChild(shelfTag);
  const score = scoreOf(item);
  const sc = el('span', 'p-score');
  if (score != null) {
    sc.appendChild(starSvg());
    sc.appendChild(el('span', null, String(score)));
  } else {
    sc.textContent = item.quotes ? `${item.quotes} ${t('fact.quotes').toLowerCase()}` : '';
    sc.style.fontWeight = '500';
    sc.style.color = 'var(--muted)';
  }
  foot.appendChild(sc);
  p.appendChild(foot);
  return p;
}

/* The plate exists only while a book is hovered: 117 hidden cards would widen
   the document at 390 px, and a hidden card still counts as layout overflow. */
let livePlate = null;

function showPlate(node, item) {
  hidePlate();
  const p = plateNode(item);
  node.appendChild(p);
  livePlate = p;
  requestAnimationFrame(() => {
    p.classList.add('show');
    const r = p.getBoundingClientRect();
    const pad = 10;
    let dx = 0;
    if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    if (dx) p.style.marginLeft = Math.round(dx) + 'px';
  });
}

function hidePlate() {
  if (livePlate && livePlate.parentNode) livePlate.remove();
  livePlate = null;
}

function refreshPlate(item) {
  const node = nodes.get(item.slug);
  if (!node || !livePlate || !node.contains(livePlate)) return;
  showPlate(node, item);
}

/* ---------------------------------------------------------------- grouping */

const LETTER_BANDS = [
  { id: 'A–C', test: (c) => c >= 'A' && c <= 'C' },
  { id: 'D–F', test: (c) => c >= 'D' && c <= 'F' },
  { id: 'G–I', test: (c) => c >= 'G' && c <= 'I' },
  { id: 'J–L', test: (c) => c >= 'J' && c <= 'L' },
  { id: 'M–O', test: (c) => c >= 'M' && c <= 'O' },
  { id: 'P–S', test: (c) => c >= 'P' && c <= 'S' },
  { id: 'T–Z', test: () => true },
];

function byTitle(a, b) { return a.title.localeCompare(b.title, state.lang === 'da' ? 'da' : 'en'); }
function byScoreDesc(a, b) {
  const x = scoreOf(a), y = scoreOf(b);
  if (x === y) return byTitle(a, b);
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x;
}

function groupsFor(items) {
  const bucket = new Map();
  const push = (key, label, order, item) => {
    if (!bucket.has(key)) bucket.set(key, { key, label, order, items: [] });
    bucket.get(key).items.push(item);
  };

  for (const item of items) {
    if (state.sort === 'shelf') {
      const s = item.shelf || 'none';
      push(s, t('shelf.' + s), SHELVES.indexOf(s) < 0 ? 9 : SHELVES.indexOf(s), item);
    } else if (state.sort === 'subject') {
      push(item.subject, t('subject.' + item.subject), 0, item);
    } else if (state.sort === 'author') {
      const band = LETTER_BANDS.find((b) => b.test((item.surname[0] || 'Z').toUpperCase())) || LETTER_BANDS[LETTER_BANDS.length - 1];
      push(band.id, band.id, LETTER_BANDS.indexOf(band), item);
    } else if (state.sort === 'year') {
      const e = eraOf(item.year);
      push(e, t('era.' + e), ['antiquity', 'medieval', 'early-modern', 'c19', 'c20', 'contemporary', 'unknown'].indexOf(e), item);
    } else if (state.sort === 'added') {
      const key = item.added ? item.added.slice(0, 4) : 'x';
      push(key, item.added ? key : '—', item.added ? -Number(key) : 1e9, item);
    } else if (state.sort === 'rating') {
      const s = scoreOf(item);
      const k = s == null ? 'none' : s >= 9 ? '9' : s >= 7 ? '7' : s >= 5 ? '5' : '0';
      push(k, t('band.' + k), { '9': 0, '7': 1, '5': 2, '0': 3, none: 4 }[k], item);
    }
  }

  const out = [...bucket.values()];
  if (state.sort === 'subject') out.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  else out.sort((a, b) => a.order - b.order);

  for (const g of out) {
    if (state.sort === 'rating' || state.sort === 'shelf') g.items.sort(byScoreDesc);
    else if (state.sort === 'author') g.items.sort((a, b) => a.surname.localeCompare(b.surname) || (a.year || 0) - (b.year || 0));
    else if (state.sort === 'year') g.items.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    else if (state.sort === 'added') g.items.sort((a, b) => String(b.added).localeCompare(String(a.added)) || byTitle(a, b));
    else g.items.sort(byTitle);
  }
  return out;
}

function visible(list) {
  const q = state.query.trim().toLowerCase();
  return list.filter((b) => {
    if (state.filter !== 'all' && b.shelf !== state.filter) return false;
    if (!q) return true;
    return (b.title + ' ' + b.author).toLowerCase().includes(q);
  });
}

/* ------------------------------------------------------------------ render */

const shelfEl = document.getElementById('shelf');
const talksEl = document.getElementById('talks-shelf');
const talksSection = document.getElementById('talks');
const emptyEl = document.getElementById('empty');

function paintGroups() {
  const items = visible(books);
  shelfEl.replaceChildren();

  for (const g of groupsFor(items)) {
    const section = el('section', 'group');
    const head = el('div', 'group-head');
    head.appendChild(el('h2', null, g.label));
    head.appendChild(el('span', 'n', String(g.items.length)));
    head.appendChild(el('span', 'fill'));
    section.appendChild(head);
    const ledge = el('div', 'ledge');
    ledge.style.setProperty('--bmax', Math.max(...g.items.map((i) => i.h)) + 'px');
    for (const item of g.items) ledge.appendChild(bookNode(item));
    section.appendChild(ledge);
    shelfEl.appendChild(section);
  }

  emptyEl.hidden = items.length > 0;
  const showTalks = state.filter === 'all';
  talksSection.hidden = !showTalks;
  if (showTalks) {
    const q = state.query.trim().toLowerCase();
    const list = talks.filter((b) => !q || (b.title + ' ' + b.author).toLowerCase().includes(q));
    talksEl.replaceChildren();
    const ordered = groupsFor(list).flatMap((g) => g.items);
    if (ordered.length) talksEl.style.setProperty('--bmax', Math.max(...ordered.map((i) => i.h)) + 'px');
    for (const item of ordered) talksEl.appendChild(bookNode(item));
    talksSection.hidden = list.length === 0;
  }

  document.getElementById('summary-text').textContent = items.length === books.length
    ? t('summary.all', { n: nf().format(books.length) })
    : t('summary.some', { n: items.length, total: books.length });
}

/* ------------------------------------------------------------- FLIP motion */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function relayout() {
  const before = new Map();
  document.querySelectorAll('.book').forEach((n) => {
    n.classList.remove('lean');
    n.style.zIndex = '';
    before.set(n.dataset.slug, n.getBoundingClientRect());
  });

  paintGroups();

  if (REDUCED) { applyLean(); return; }

  const moved = [];
  document.querySelectorAll('.book').forEach((n) => {
    const first = before.get(n.dataset.slug);
    const last = n.getBoundingClientRect();
    if (!first) { moved.push({ n, dx: 0, dy: 10, fade: true }); return; }
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.push({ n, dx, dy, fade: false });
  });

  moved.sort((a, b) => a.n.getBoundingClientRect().top - b.n.getBoundingClientRect().top);

  let last = null;
  moved.forEach((m, i) => {
    const anim = m.n.animate(
      m.fade
        ? [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }]
        : [{ transform: `translate(${m.dx}px, ${m.dy}px)` }, { transform: 'none' }],
      { duration: 500, easing: 'cubic-bezier(0.2, 0, 0, 1)', delay: Math.min(i * 6, 160), fill: 'both' },
    );
    last = anim;
  });

  if (last) last.finished.then(applyLean, () => {}); else applyLean();
}

/* One book at the end of a short row may lean — the row that does not fill. */
function applyLean() {
  document.querySelectorAll('.ledge').forEach((ledge) => {
    const kids = [...ledge.children];
    kids.forEach((k) => k.classList.remove('lean'));
    if (kids.length < 3) return;
    const rows = new Map();
    kids.forEach((k) => {
      const top = Math.round(k.offsetTop);
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push(k);
    });
    const all = [...rows.values()];
    if (all.length < 2) return;
    const lastRow = all[all.length - 1];
    if (lastRow.length < 2) return;
    const tail = lastRow[lastRow.length - 1];
    const filled = (tail.offsetLeft + tail.offsetWidth) / ledge.clientWidth;
    if (filled < 0.88) tail.classList.add('lean');
  });
}

/* ------------------------------------------------------- hover, with depth */

function tiltFor(node, clientX) {
  const box = node.querySelector('.cover-box').getBoundingClientRect();
  const dx = Math.max(-1, Math.min(1, ((clientX - box.left) / box.width - 0.5) * 2));
  const lean = node.classList.contains('lean') ? 3 : 0;
  node.querySelector('.tilt').style.transform =
    `translateY(-9px) rotate(${lean}deg) rotateY(${(dx * 4).toFixed(2)}deg) rotateX(2.2deg)`;
}

let hovered = null;

document.addEventListener('pointermove', (e) => {
  const node = e.target.closest && e.target.closest('.book');
  if (!node) return;
  if (node !== hovered) {
    if (hovered) { hovered.classList.remove('is-hover'); hovered.querySelector('.tilt').style.transform = ''; }
    hovered = node;
    node.classList.add('is-hover');
    const item = [...books, ...talks].find((b) => b.slug === node.dataset.slug);
    if (item) showPlate(node, item);
  }
  tiltFor(node, e.clientX);
});

document.addEventListener('pointerout', (e) => {
  const node = e.target.closest && e.target.closest('.book');
  if (node && !node.contains(e.relatedTarget)) {
    node.classList.remove('is-hover');
    node.querySelector('.tilt').style.transform = '';
    if (node === hovered) hovered = null;
    hidePlate();
  }
});

/* ------------------------------------------------------------------- hero */

function paintHero() {
  const reading = books.filter((b) => b.shelf === 'reading')
    .sort((a, b) => String(b.added || '').localeCompare(String(a.added || '')));
  const featured = reading[0] || books[0];
  const others = books.filter((b) => b !== featured);
  const lastAdded = others.filter((b) => b.added).sort((a, b) => b.added.localeCompare(a.added))[0];
  const best = others.filter((b) => scoreOf(b) != null && b.shelf === 'read')
    .sort((a, b) => scoreOf(b) - scoreOf(a) || (b.quotes || 0) - (a.quotes || 0))[0];

  const stage = document.getElementById('featured-stage');
  stage.replaceChildren(bigCover(featured, 252));
  document.getElementById('featured-kicker').textContent = t('hero.reading');
  document.getElementById('featured-title').textContent = featured.title;
  document.getElementById('featured-meta').textContent =
    [featured.author, featured.year, featured.pages ? `${featured.pages} ${t('fact.pages').toLowerCase()}` : null,
      featured.quotes ? `${featured.quotes} ${t('fact.quotes').toLowerCase()}` : null].filter(Boolean).join(' · ');

  const rate = document.getElementById('featured-rate');
  rate.replaceChildren(rateControl(featured));
  document.getElementById('featured-rate-label').textContent = isWantKind(featured) ? t('rate.want') : t('rate.read');

  document.getElementById('featured-quotes').textContent = t('action.quotes');
  document.getElementById('featured-quotes').href = `../../../index.html?work=${encodeURIComponent(featured.slug)}`;
  const det = document.getElementById('featured-details');
  det.textContent = t('action.details');
  det.onclick = () => openSheet(featured.slug);

  paintMini('mini-a', t('hero.lastAdded'), lastAdded);
  paintMini('mini-b', t('hero.bestRated'), best || books[0]);
}

function paintMini(id, label, item) {
  const root = document.getElementById(id);
  root.replaceChildren();
  const stage = el('div', 'mini-stage');
  stage.appendChild(bigCover(item, 96));
  const body = el('div', 'mini-body');
  body.appendChild(el('p', 'label', label));
  body.appendChild(el('h3', null, item.title));
  const meta = el('p', null, item.author);
  body.appendChild(meta);
  const s = scoreOf(item);
  if (s != null) {
    const row = el('p');
    row.style.marginTop = '.3rem';
    row.appendChild(inlineStars(s));
    const n = el('span', null, ` ${s}/10`);
    n.style.cssText = 'font-size:.74rem;color:var(--muted);margin-left:.3rem';
    row.appendChild(n);
    body.appendChild(row);
  } else if (item.quotes) {
    const row = el('p', null, `${item.quotes} ${t('fact.quotes').toLowerCase()}`);
    row.style.marginTop = '.3rem';
    body.appendChild(row);
  }
  root.appendChild(stage);
  root.appendChild(body);
  root.onclick = () => openSheet(item.slug);
  root.style.cursor = 'pointer';
}

function bigCover(item, h) {
  const box = el('span', 'cover-box');
  box.style.width = Math.round(h * 0.655) + 'px';
  box.style.height = h + 'px';
  if (!item.cover) {
    box.style.setProperty('--tc-h', item.hue);
    box.style.setProperty('--tc-d', item.tint);
  }
  box.appendChild(coverInner(item));
  return box;
}

/* ------------------------------------------------------------ rating stars */

function rateControl(item, onChange) {
  const wrap = el('div', 'rate');
  const score = scoreOf(item);
  for (let i = 1; i <= 10; i++) {
    const b = el('button', 'rate-btn' + (score != null && i <= score ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('aria-label', `${i} / 10`);
    b.appendChild(starSvg());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      ratings[item.slug] = (ratings[item.slug] === i) ? null : i;
      const fresh = rateControl(item, onChange);
      wrap.replaceWith(fresh);
      const target = fresh.children[i - 1];
      target.classList.add('pop');
      target.addEventListener('animationend', () => target.classList.remove('pop'), { once: true });
      refreshPlate(item);
      if (onChange) onChange();
    });
    wrap.appendChild(b);
  }
  const v = el('span', 'rate-value');
  if (score != null) { v.textContent = String(score); v.appendChild(el('em', null, ' ' + t('rate.of'))); }
  else { v.appendChild(el('em', null, t('rate.none'))); }
  wrap.appendChild(v);
  return wrap;
}

/* ------------------------------------------------------------ detail sheet */

const sheet = document.getElementById('sheet');

function openSheet(slug) {
  const item = [...books, ...talks].find((b) => b.slug === slug);
  if (!item) return;
  state.open = slug;
  const card = document.getElementById('sheet-card');
  card.replaceChildren();

  const close = el('button', 'sheet-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', t('action.close'));
  close.onclick = closeSheet;
  card.appendChild(close);

  const grid = el('div', 'sheet-grid');
  const stage = el('div', 'sheet-stage');
  stage.appendChild(bigCover(item, 270));
  grid.appendChild(stage);

  const body = el('div');
  body.appendChild(el('p', 'label', [t('subject.' + item.subject), t('kind.' + (item.kind || 'book'))].join(' · ')));
  body.appendChild(el('h2', null, item.title));
  body.appendChild(el('p', 'sheet-author', item.author));

  const facts = el('dl', 'facts');
  const fact = (k, v) => {
    const d = el('div', 'fact');
    d.appendChild(el('dt', null, t(k)));
    d.appendChild(el('dd', null, v));
    facts.appendChild(d);
  };
  fact('fact.year', item.year ? String(item.year) : '—');
  if (item.pages) fact('fact.pages', String(item.pages));
  fact('fact.quotes', String(item.quotes || 0));
  fact('fact.added', dateOf(item.added));
  if (item.read) fact('fact.read', dateOf(item.read));
  if (item.avg) fact('fact.avg', item.avg.toFixed(2));
  body.appendChild(facts);

  const rateBlock = el('div', 'control-block');
  rateBlock.appendChild(el('span', 'label', isWantKind(item) ? t('rate.want') : t('rate.read')));
  rateBlock.appendChild(rateControl(item, () => { paintHero(); }));
  body.appendChild(rateBlock);

  const shelfBlock = el('div', 'control-block');
  shelfBlock.appendChild(el('span', 'label', t('ctl.shelf')));
  const choice = el('div', 'shelf-choice');
  for (const s of SHELVES) {
    const c = el('button', 'chip', t('shelf.' + s));
    c.type = 'button';
    c.setAttribute('aria-pressed', String(item.shelf === s));
    c.onclick = () => {
      item.shelf = item.shelf === s ? null : s;
      [...choice.children].forEach((k, i) => k.setAttribute('aria-pressed', String(item.shelf === SHELVES[i])));
      refreshPlate(item);
      paintChips();
    };
    choice.appendChild(c);
  }
  shelfBlock.appendChild(choice);
  body.appendChild(shelfBlock);

  const actions = el('div', 'sheet-actions');
  const quotes = el('a', 'pill pill-primary', t('action.quotes'));
  quotes.href = `../../../index.html?work=${encodeURIComponent(item.slug)}`;
  actions.appendChild(quotes);
  if (item.goodreads) {
    const gr = el('a', 'pill', t('action.goodreads'));
    gr.href = item.goodreads;
    gr.rel = 'noreferrer';
    actions.appendChild(gr);
  }
  const find = el('a', 'pill pill-quiet', t('action.find'));
  find.href = item.url || `https://openlibrary.org/search?q=${encodeURIComponent(item.title + ' ' + item.author)}`;
  find.rel = 'noreferrer';
  actions.appendChild(find);
  body.appendChild(actions);

  grid.appendChild(body);
  card.appendChild(grid);
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  sheet.hidden = true;
  state.open = null;
  document.body.style.overflow = '';
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

/* --------------------------------------------------------------- controls */

const chipsEl = document.getElementById('chips');

function paintChips() {
  for (const s of SHELVES) shelfCounts[s] = books.filter((b) => b.shelf === s).length;
  chipsEl.replaceChildren();
  const mk = (id, label, n) => {
    const c = el('button', 'chip');
    c.type = 'button';
    c.dataset.filter = id;
    c.setAttribute('aria-pressed', String(state.filter === id));
    c.appendChild(el('span', null, label));
    if (n != null) c.appendChild(el('span', 'n', String(n)));
    c.onclick = () => { state.filter = state.filter === id ? 'all' : id; paintChips(); relayout(); };
    chipsEl.appendChild(c);
  };
  mk('all', t('chip.all'), books.length);
  for (const s of SHELVES) mk(s, t('shelf.' + s), shelfCounts[s]);
}

function paintStatic() {
  document.documentElement.lang = state.lang === 'da' ? 'da' : 'en';
  document.documentElement.dataset.edition = state.edition;
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t(n.dataset.t); });
  document.getElementById('hero-kicker').textContent = t('hero.kicker', {
    books: books.length, talks: talks.length, quotes: totalQuotes,
  });
  const search = document.getElementById('search');
  search.placeholder = t('ctl.search');
  const sel = document.getElementById('arrange');
  sel.replaceChildren();
  for (const k of ['shelf', 'subject', 'author', 'year', 'added', 'rating']) {
    const o = el('option', null, t('arrange.' + k));
    o.value = k;
    if (k === state.sort) o.selected = true;
    sel.appendChild(o);
  }
  document.getElementById('lang-toggle').textContent = state.lang === 'en' ? 'DA' : 'EN';
  document.getElementById('edition-toggle').textContent = state.edition === 'paper' ? '☾' : '☀';
  document.getElementById('edition-toggle').setAttribute('aria-label', state.edition === 'paper' ? 'Night' : 'Paper');
}

document.getElementById('arrange').addEventListener('change', (e) => { state.sort = e.target.value; relayout(); });
document.getElementById('search').addEventListener('input', (e) => { state.query = e.target.value; relayout(); });
document.getElementById('lang-toggle').addEventListener('click', () => {
  state.lang = state.lang === 'en' ? 'da' : 'en';
  nodes.clear();
  paintStatic(); paintChips(); paintHero(); paintGroups(); applyLean();
  if (state.open) openSheet(state.open);
});
document.getElementById('edition-toggle').addEventListener('click', () => {
  state.edition = state.edition === 'paper' ? 'night' : 'paper';
  paintStatic();
});

/* ------------------------------------------------------------------- boot */

paintStatic();
paintChips();
paintHero();
paintGroups();
requestAnimationFrame(() => {
  applyLean();
  if (params.get('hover')) {
    const ledges = [...document.querySelectorAll('#shelf .ledge')];
    const fullest = ledges.sort((a, b) => b.children.length - a.children.length)[0];
    const third = (fullest || document.querySelector('#shelf .ledge')).children[2];
    if (third) {
      third.scrollIntoView({ block: 'center' });
      third.classList.add('is-hover');
      hovered = third;
      const item = books.find((b) => b.slug === third.dataset.slug);
      if (item) showPlate(third, item);
      const box = third.querySelector('.cover-box').getBoundingClientRect();
      tiltFor(third, box.left + box.width * 0.8);
    }
  }
  if (params.get('open')) {
    const pick = books.filter((b) => b.cover && b.quotes > 0).sort((a, b) => b.quotes - a.quotes)[0] || books[0];
    openSheet(params.get('open') === '1' ? pick.slug : params.get('open'));
  }
});
window.addEventListener('resize', () => applyLean());
