/**
 * Acceptance for the front page (index.html) — cases 14 to 19 of
 * docs/ACCEPTANCE.md.
 *
 * Everything here is measured in a real browser and the measurement is printed,
 * not just the verdict: a green line nobody can check is worth less than no
 * line at all. Where a case says "visible" this asks the browser for rectangles
 * and computed styles rather than for the presence of a selector, because a
 * link can be in the DOM, in the right place, and under something else.
 *
 * Deliberately independent of how the shared header is built: the Shelf link is
 * found by where it goes (`works.html`), never by a class name that belongs to
 * somebody else's file.
 */

/* The page under test is the same one in every case. */
const PAGE = '/index.html';
const READY = '.collection li';

/* --------------------------------------------------------------- helpers */

/** Reload without going through goto(), which would reset localStorage. */
async function reload(ctx, waitFor = READY) {
  await ctx.send('Page.reload', {});
  await ctx.wait(250);
  for (let i = 0; i < 100; i += 1) {
    const ready = await ctx.ev(
      `document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(waitFor)})`,
    ).catch(() => false);
    if (ready) { await ctx.wait(200); return true; }
    await ctx.wait(100);
  }
  return false;
}

/** Every link that leads to the shelf, with the geometry that decides "visible". */
const SHELF_LINKS = `(() => {
  const fold = window.innerHeight;
  const page = getComputedStyle(document.body).backgroundColor;
  return [...document.querySelectorAll('a[href]')]
    .filter((a) => /(^|\\/)works\\.html$/.test(a.getAttribute('href') || ''))
    .filter((a) => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden')
    .map((a) => {
      const r = a.getBoundingClientRect();
      const s = getComputedStyle(a);
      return {
        where: a.closest('#site-nav') ? 'header' : a.closest('#controls') ? 'controls' : 'elsewhere',
        text: (a.textContent || '').trim().slice(0, 20),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        width: Math.round(r.width), height: Math.round(r.height),
        aboveFold: r.top >= 0 && r.bottom <= fold,
        filled: s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== page,
        background: s.backgroundColor,
        weight: s.fontWeight,
      };
    });
})()`;

/** The small "add" control, wherever it lives, so "beside it, smaller" is measurable. */
const ADD_CONTROLS = `(() => {
  return [...document.querySelectorAll('#site-nav .nav-add, #controls .pill-add')]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        where: el.closest('#site-nav') ? 'header' : 'controls',
        top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
        aboveFold: r.top >= 0 && r.bottom <= window.innerHeight,
      };
    });
})()`;

/* ----------------------------------------------------------------- cases */

/** 14 — the shelf is reachable from the top of the page, and reads as primary. */
async function shelfAboveFold(ctx, width, height) {
  await ctx.goto(PAGE, { width, height, edition: 'paper', lang: 'en', waitFor: READY });

  const links = await ctx.ev(SHELF_LINKS);
  const adds = await ctx.ev(ADD_CONTROLS);
  const scrolled = await ctx.ev('Math.round(window.scrollY)');

  const visible = links.filter((link) => link.aboveFold);
  const primary = visible.find((link) => link.filled);
  const add = adds.find((control) => control.aboveFold);

  ctx.rec(`14 · ${width}px · a Shelf link is above the fold without scrolling`,
    visible.length > 0 && scrolled === 0,
    visible.length
      ? `${visible.length} of ${links.length} shelf links inside ${height}px at scrollY ${scrolled}: `
        + visible.map((link) => `${link.where} "${link.text}" top ${link.top}px`).join('; ')
      : `none of ${links.length} shelf links is inside the first ${height}px`);

  ctx.rec(`14 · ${width}px · the Shelf link is visibly the primary destination`,
    Boolean(primary),
    primary
      ? `${primary.where} pill filled ${primary.background}, weight ${primary.weight}, ${primary.width}×${primary.height}px`
      : `no above-the-fold shelf link carries a fill: ${JSON.stringify(visible)}`);

  ctx.rec(`14 · ${width}px · an Add control sits beside it, smaller`,
    Boolean(add && primary && add.width < primary.width),
    add && primary
      ? `add ${add.where} ${add.width}×${add.height}px against shelf ${primary.width}×${primary.height}px`
      : `add control ${JSON.stringify(adds)}`);
}

/** 15 — and still reachable once the page has been scrolled. */
async function shelfWhileScrolled(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.ev('window.scrollTo(0, 2400)');
  await ctx.wait(350);

  const measured = await ctx.ev(`(() => {
    const controls = document.getElementById('controls');
    const style = getComputedStyle(controls);
    const link = controls.querySelector('a[href$="works.html"]');
    const r = link ? link.getBoundingClientRect() : null;
    return {
      scrollY: Math.round(window.scrollY),
      sticky: style.position,
      backdrop: style.backdropFilter || style.webkitBackdropFilter || 'none',
      background: style.backgroundColor,
      link: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) } : null,
      inView: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight),
    };
  })()`);

  ctx.rec('15 · the Shelf link is in the sticky controls once scrolled',
    measured.inView && measured.sticky === 'sticky',
    `scrolled to ${measured.scrollY}px, controls are position:${measured.sticky}, `
    + `shelf link ${measured.link ? `at top ${measured.link.top}px, ${measured.link.width}px wide` : 'missing'}`);

  ctx.rec('15 · the sticky bar is solid, with no backdrop blur',
    measured.backdrop === 'none',
    `backdrop-filter: ${measured.backdrop}; background ${measured.background}`);
}

/** 16 — one favourite, two places showing it, and a count that follows. */
async function focusFavourite(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  // Start from nothing starred, so the press is a press and not an un-press.
  await ctx.ev(`(() => {
    localStorage.removeItem('quotes-favorites');
    localStorage.removeItem('shelf-state');
    return true;
  })()`);
  await reload(ctx);

  const before = await ctx.ev(`(() => ({
    id: document.querySelector('.collection li')?.id ?? null,
    count: document.getElementById('favorites-count').textContent.trim(),
  }))()`);

  await ctx.pressKey('f');
  await ctx.wait(200);
  await ctx.click('#focus-favorite');
  await ctx.wait(320);

  const pressed = await ctx.ev(`(() => {
    const button = document.getElementById('focus-favorite');
    return {
      open: !document.getElementById('focus').hidden,
      aria: button.getAttribute('aria-pressed'),
      label: (button.querySelector('.focus-fav-label')?.textContent || '').trim(),
      count: document.getElementById('favorites-count').textContent.trim(),
      position: document.getElementById('focus-position').textContent.trim(),
    };
  })()`);

  const shot = await ctx.shot('index-focus-star');

  await ctx.pressKey('Escape');
  await ctx.wait(220);

  const inList = await ctx.ev(`(() => {
    const item = document.getElementById(${JSON.stringify(before.id)});
    const star = item?.querySelector('[data-action="favorite"]');
    return {
      aria: star ? star.getAttribute('aria-pressed') : null,
      count: document.getElementById('favorites-count').textContent.trim(),
    };
  })()`);

  ctx.rec('16 · the focus-mode star toggles the same favourite the list shows',
    pressed.aria === 'true' && inList.aria === 'true',
    `focus star aria-pressed=${pressed.aria} on ${before.id} (${pressed.position}), `
    + `the same quote in the list reads aria-pressed=${inList.aria}`);

  ctx.rec('16 · the favourites count updates',
    Number(inList.count || 0) === Number(before.count || 0) + 1,
    `count "${before.count || '(none)'}" → "${pressed.count}" in focus → "${inList.count}" in the list`);

  // Editing is locked in the harness (no edit code), so this is the legacy
  // local path: the star has to survive a reload on this device alone.
  const survived = await reload(ctx) && await ctx.ev(`(() => {
    const stored = JSON.parse(localStorage.getItem('quotes-favorites') || '[]');
    const star = document.getElementById(${JSON.stringify(before.id)})?.querySelector('[data-action="favorite"]');
    return stored.includes(${JSON.stringify(before.id)}) && star?.getAttribute('aria-pressed') === 'true';
  })()`);

  ctx.rec('16 · with editing locked the star falls back to this device and stays',
    survived === true,
    `quotes-favorites holds ${before.id} and the star is still pressed after a reload: ${survived}`);

  ctx.rec('16 · the focus star says what pressing it would do',
    pressed.label.length > 0 && pressed.label !== 'Favourite',
    `label after pressing: "${pressed.label}"  ·  shot ${shot.split('/').slice(-2).join('/')}`);
}

/** 17 — next and previous move, and animate while they do it. */
async function focusMotion(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.pressKey('f');
  await ctx.wait(220);

  const position = () => ctx.ev("document.getElementById('focus-position').textContent.trim()");

  /**
   * Wait for the outcome instead of sleeping a fixed time.
   *
   * Headless Chrome runs an opacity/transform animation on the compositor and
   * stops giving the main thread frames between screenshots, so the animation
   * reads `running@0ms` for as long as it likes and the page's own timers are
   * the only thing moving. A fixed sleep here measures Chrome's mood; this
   * measures the page, and prints how long it actually took.
   */
  async function until(read, changed, budget = 3000) {
    const started = Date.now();
    for (;;) {
      const value = await read();
      if (changed(value)) return { value, ms: Date.now() - started };
      if (Date.now() - started > budget) return { value, ms: Date.now() - started, timedOut: true };
      await ctx.wait(60);
    }
  }

  const first = await position();
  await ctx.pressKey('ArrowRight');
  const during = await ctx.ev(`(() => {
    const figure = document.getElementById('focus-quote');
    return {
      animations: figure.getAnimations().length,
      stepping: figure.dataset.stepping ?? null,
      states: figure.getAnimations().map((a) => a.playState).join(','),
    };
  })()`);
  const forward = await until(position, (value) => value !== first);

  await ctx.pressKey('ArrowLeft');
  const backward = await until(position, (value) => value !== forward.value);

  const quiet = await until(
    () => ctx.ev("document.getElementById('focus-quote').getAnimations().length"),
    (n) => n === 0,
    2500,
  );
  await ctx.pressKey('Escape');

  ctx.rec('17 · focus next runs an animation on the quote figure',
    during.animations > 0,
    `${during.animations} animation(s) on #focus-quote right after the keypress `
    + `(${during.states || 'none'}), data-stepping="${during.stepping}"`);

  ctx.rec('17 · the arrow keys still move through the collection',
    !forward.timedOut && !backward.timedOut && backward.value === first,
    `"${first}" → ArrowRight → "${forward.value}" after ${forward.ms}ms → `
    + `ArrowLeft → "${backward.value}" after ${backward.ms}ms`
    + (ctx.consoleErrors.length ? `\nconsole: ${ctx.consoleErrors.join(' | ')}` : ''));

  ctx.rec('17 · nothing stays animating afterwards',
    !quiet.timedOut,
    quiet.timedOut
      ? `${quiet.value} animations still on #focus-quote after ${quiet.ms}ms`
      : `#focus-quote was back to zero animations ${quiet.ms}ms after the last press`);
}

/** 18 — the whole interface speaks Danish, and remembers that it does. */
async function language(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });

  const read = `(() => {
    const text = (selector) => (document.querySelector(selector)?.textContent || '').trim().replace(/\\s+/g, ' ');
    const sort = document.getElementById('sort');
    return {
      lang: document.documentElement.lang,
      favourites: text('#toggle-favorites'),
      sortOption: sort.options[sort.selectedIndex].textContent.trim(),
      allAuthors: document.getElementById('filter-author').options[0].textContent.trim(),
      summary: text('#result-summary'),
      footerKeys: text('#footer-keys'),
      footerLink: text('.page-footer a[href="import.html"]'),
      empty: text('#empty strong'),
      focusClose: text('#close-focus'),
      focusFav: text('#focus-favorite .focus-fav-label'),
      focusNext: text('#focus-next'),
      stored: localStorage.getItem('quotes-lang'),
      toggle: text('.lang-toggle'),
    };
  })()`;

  const english = await ctx.ev(read);
  await ctx.click('.lang-toggle');
  await ctx.wait(300);
  const danish = await ctx.ev(read);

  const reloaded = await reload(ctx);
  const after = await ctx.ev(read);
  const shot = await ctx.shot('index-1440-danish');

  const switched = [
    ['the favourites control', english.favourites, danish.favourites],
    ['the sort menu', english.sortOption, danish.sortOption],
    ['the author filter', english.allAuthors, danish.allAuthors],
    ['the result summary', english.summary, danish.summary],
    ['the footer keys line', english.footerKeys, danish.footerKeys],
    ['the footer links', english.footerLink, danish.footerLink],
    ['the focus close button', english.focusClose, danish.focusClose],
    ['the focus favourite label', english.focusFav, danish.focusFav],
  ];
  const stuck = switched.filter(([, en, da]) => en === da || !da);

  ctx.rec('18 · DA switches the controls, the footer and the focus labels',
    stuck.length === 0 && danish.lang === 'da',
    stuck.length
      ? `still English: ${stuck.map(([what, en]) => `${what} ("${en}")`).join(', ')}`
      : switched.map(([what, en, da]) => `${what}: "${en}" → "${da}"`).join('\n'));

  ctx.rec('18 · the choice survives a reload',
    reloaded && after.lang === 'da' && after.favourites === danish.favourites && after.stored === 'da',
    `after reload: <html lang="${after.lang}">, quotes-lang=${after.stored}, `
    + `favourites reads "${after.favourites}", footer "${after.footerKeys.slice(0, 48)}…"  ·  `
    + `shot ${shot.split('/').slice(-2).join('/')}`);

  // Leave the browser in English so a later check reads what it expects.
  await ctx.click('.lang-toggle');
  await ctx.wait(200);
}

/** 19 — adding a quote while editing is locked. */
async function addQuote(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.ev("localStorage.removeItem('shelf-edit-code')");
  await reload(ctx);

  const locked = await ctx.ev("localStorage.getItem('shelf-edit-code') === null");
  await ctx.click('#controls-add');
  await ctx.wait(400);

  const dialog = await ctx.ev(`(() => {
    const node = document.getElementById('add-dialog');
    if (!node) return { present: false };
    const github = node.querySelector('#add-github');
    const lockedBox = node.querySelector('#add-locked');
    const title = node.getAttribute('aria-labelledby');
    return {
      present: true,
      open: node.open === true || node.hasAttribute('open'),
      modal: node.matches(':modal'),
      labelled: Boolean(title && document.getElementById(title)?.textContent.trim()),
      focusInside: node.contains(document.activeElement),
      lockedVisible: Boolean(lockedBox && !lockedBox.hidden && lockedBox.getClientRects().length),
      unlockField: Boolean(node.querySelector('#add-code')),
      github: github ? github.getAttribute('href') : null,
      fields: [...node.querySelectorAll('input, textarea')].map((f) => f.name || f.id).join(','),
    };
  })()`);

  const shot = await ctx.shot('index-add-quote-dialog');

  await ctx.pressKey('Escape');
  await ctx.wait(260);
  const closed = await ctx.ev(`(() => {
    const node = document.getElementById('add-dialog');
    return {
      open: node ? (node.open === true) : null,
      focus: document.activeElement?.id ?? document.activeElement?.tagName ?? null,
    };
  })()`);

  ctx.rec('19 · with editing locked, the add control opens the in-page dialog',
    locked && dialog.present && dialog.open && dialog.modal && dialog.labelled && dialog.focusInside,
    `edit code absent: ${locked}; dialog open=${dialog.open} modal=${dialog.modal} `
    + `labelled=${dialog.labelled} focus inside=${dialog.focusInside}; fields ${dialog.fields}`);

  ctx.rec('19 · the locked dialog offers the unlock field and the GitHub form',
    dialog.lockedVisible && dialog.unlockField
      && typeof dialog.github === 'string'
      && dialog.github.includes('template=add-quote.yml'),
    `unlock panel visible=${dialog.lockedVisible}, code field=${dialog.unlockField}, `
    + `fallback → ${dialog.github}  ·  shot ${shot.split('/').slice(-2).join('/')}`);

  ctx.rec('19 · Escape closes it and gives focus back',
    closed.open === false && closed.focus === 'controls-add',
    `after Escape: open=${closed.open}, focus on "${closed.focus}"`);
}


/**
 * A Worker that answers, installed before any page script runs.
 *
 * The write path only exists once a Cloudflare Worker is deployed and a key is
 * in hand, and neither belongs in an acceptance run: a check that files real
 * quotes into his real collection is a check nobody dares run twice. So this
 * stands in for the Worker at its own origin and nowhere else, which makes the
 * unlocked half of case 19 a genuine round trip — unlock, type, save, watch the
 * quote arrive at the top of the list — against everything the page really does.
 */
const CODE = 'test-code';
const WORKER_STUB = `(() => {
  const real = window.fetch.bind(window);
  window.__worker = { calls: [], pending: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('workers.dev') < 0) return real(input, init);
    const opts = init || {};
    const headers = opts.headers || {};
    const auth = headers.authorization || headers.Authorization || '';
    window.__worker.calls.push({ url: url, method: opts.method || 'GET', auth: auth });
    const json = (body, status) => new Response(JSON.stringify(body), {
      status: status || 200, headers: { 'content-type': 'application/json' },
    });
    if (/\\/state$/.test(url)) {
      return json({ works: {}, favorites: {}, pending: window.__worker.pending, generatedAt: null });
    }
    if (auth !== 'Bearer ${CODE}') return new Response('', { status: 401 });
    if (/\\/ping$/.test(url)) return new Response('', { status: 200 });
    if (/\\/quote$/.test(url)) {
      const payload = JSON.parse(opts.body || '{}');
      const id = 'stub-' + window.__worker.pending.length;
      const createdAt = new Date().toISOString();
      window.__worker.pending.push({ id: id, payload: payload, createdAt: createdAt });
      return json({ ok: true, id: id, createdAt: createdAt });
    }
    return json({ ok: true });
  };
})()`;

/** 19b — unlocked, the same control files the quote and the list shows it. */
async function addQuoteUnlocked(ctx) {
  const installed = await ctx.send('Page.addScriptToEvaluateOnNewDocument', { source: WORKER_STUB });
  try {
    await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
    await ctx.ev("localStorage.removeItem('shelf-edit-code')");
    await reload(ctx);

    await ctx.click('#controls-add');
    await ctx.wait(350);

    // Unlock through the dialog's own field, the way he would.
    await ctx.ev(`(() => {
      const code = document.getElementById('add-code');
      code.value = ${JSON.stringify(CODE)};
      code.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await ctx.click('#add-unlock');
    await ctx.wait(400);

    const unlocked = await ctx.ev(`(() => ({
      panelHidden: document.getElementById('add-locked').hidden,
      status: (document.getElementById('add-status').textContent || '').trim(),
      stored: localStorage.getItem('shelf-edit-code'),
    }))()`);

    const words = 'A line filed from the page itself, to prove the door opens.';
    await ctx.ev(`(() => {
      const set = (id, value) => {
        const node = document.getElementById(id);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('add-text', ${JSON.stringify(words)});
      set('add-author', 'The Collection Builder');
      set('add-work', 'A build brief');
      return true;
    })()`);
    await ctx.click('#add-save');
    await ctx.wait(700);

    const landed = await ctx.ev(`(() => {
      const first = document.querySelector('.collection li');
      const posted = (window.__worker ? window.__worker.calls : []).filter((c) => /\\/quote$/.test(c.url));
      return {
        dialogOpen: document.getElementById('add-dialog').open === true,
        posted: posted.length,
        pending: window.__worker ? window.__worker.pending.length : -1,
        topId: first ? first.id : null,
        topPending: first ? first.dataset.pending === 'true' : false,
        topTag: first ? (first.querySelector('.pending-tag')?.textContent || '').trim() : '',
        topText: first ? (first.querySelector('.quote-text')?.textContent || '').trim().slice(0, 48) : '',
        summary: (document.getElementById('result-summary').textContent || '').trim(),
      };
    })()`);

    const shot = await ctx.shot('index-quote-filed');

    ctx.rec('19 · the edit code unlocks the dialog in place',
      unlocked.panelHidden === true && typeof unlocked.stored === 'string',
      `after Unlock: locked panel hidden=${unlocked.panelHidden}, `
      + `status "${unlocked.status}", code remembered on this device=${Boolean(unlocked.stored)}`);

    ctx.rec('19 · unlocked, saving files the quote and closes the form',
      landed.posted === 1 && landed.pending === 1 && landed.dialogOpen === false,
      `${landed.posted} POST to /quote, the worker holds ${landed.pending} pending, `
      + `dialog closed=${!landed.dialogOpen}`);

    ctx.rec('19 · the filed quote is at the top of the list, marked pending',
      landed.topPending && landed.topTag.length > 0 && landed.topText.startsWith('A line filed'),
      `top of the list is ${landed.topId} — "${landed.topText}…" tagged "${landed.topTag}"; `
      + `summary now reads "${landed.summary}"  ·  shot ${shot.split('/').slice(-2).join('/')}`);
  } finally {
    await ctx.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: installed.identifier }).catch(() => {});
    await ctx.ev("localStorage.removeItem('shelf-edit-code'); localStorage.removeItem('shelf-state')").catch(() => {});
  }
}


/**
 * Not one of the numbered cases, but nothing else covers it: the board, read-next
 * and the importer each carry the shared header now, and a one-line mount that
 * silently does nothing would look exactly like a page nobody had got to yet.
 */
async function headerOnEveryPage(ctx) {
  const pages = [
    ['/scout.html', 'board', '.board, .board-note'],
    ['/suggest.html', 'next', '.controls'],
    ['/import.html', 'import', '#dropzone, .controls'],
  ];
  const seen = [];
  for (const [pathname, active, waitFor] of pages) {
    await ctx.goto(pathname, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor });
    const header = await ctx.ev(`(() => {
      const node = document.getElementById('site-nav');
      if (!node) return { mounted: false };
      const doc = document.documentElement;
      return {
        mounted: node.querySelectorAll('.nav-pill').length > 0,
        variant: node.dataset.variant ?? null,
        pills: node.querySelectorAll('.nav-pill').length,
        current: (node.querySelector('[aria-current="page"]')?.textContent || '').trim(),
        toggles: node.querySelectorAll('.nav-toggle, .lang-toggle').length,
        overflow: doc.scrollWidth - doc.clientWidth,
      };
    })()`);
    seen.push({ pathname, active, ...header });
  }
  const bad = seen.filter((page) => !page.mounted || page.variant !== 'bar' || page.overflow > 1);
  ctx.rec('the shared header is mounted on the board, read-next and the importer',
    bad.length === 0,
    seen.map((page) => `${page.pathname}: ${page.pills} pills as "${page.variant}", `
      + `current "${page.current}", ${page.toggles} toggles, overflow ${page.overflow}px`).join('\n'));
}


/**
 * Not a numbered case either, but the front page had a working keyboard and a
 * shareable URL before any of this, and the brief says keep both. A rewrite
 * that quietly drops "press / to search" is a regression nobody would notice
 * until the day they reached for it.
 */
async function keyboardAndUrl(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });

  await ctx.pressKey('/');
  const searching = await ctx.ev("document.activeElement?.id ?? ''");
  await ctx.pressKey('Escape');

  await ctx.pressKey('j');
  await ctx.wait(120);
  const cursor = await ctx.ev("document.querySelectorAll('.quote[data-targeted]').length");

  await ctx.pressKey('f');
  await ctx.wait(200);
  const focusOpen = await ctx.ev("!document.getElementById('focus').hidden");
  const starBefore = await ctx.ev("document.getElementById('focus-favorite').getAttribute('aria-pressed')");
  await ctx.pressKey('s');
  await ctx.wait(220);
  const starAfter = await ctx.ev("document.getElementById('focus-favorite').getAttribute('aria-pressed')");
  await ctx.pressKey('s');
  await ctx.wait(220);
  await ctx.pressKey('Escape');
  await ctx.wait(160);
  const focusClosed = await ctx.ev("document.getElementById('focus').hidden");

  await ctx.pressKey('c');
  await ctx.wait(160);
  const curating = await ctx.ev("document.body.dataset.curate + '/' + document.querySelectorAll('.quote-curate').length");
  await ctx.pressKey('c');
  await ctx.wait(160);
  const curateOff = await ctx.ev("document.body.dataset.curate");

  const keys = [
    ['/', searching === 'search'],
    ['J', cursor === 1],
    ['F', focusOpen === true && focusClosed === true],
    ['C', curating.startsWith('true/') && !curating.endsWith('/0') && curateOff === 'false'],
    ['S', starBefore !== starAfter],
  ];

  ctx.rec('the keyboard still works: / J K F R C, plus S in focus mode',
    keys.every(([, ok]) => ok),
    `/ focused "${searching}"; J marked ${cursor} quote; F opened=${focusOpen} and Escape closed=${focusClosed}; `
    + `C gave curate=${curating} then ${curateOff}; S flipped the focus star ${starBefore} → ${starAfter}`);

  // URL state: a filtered view has to survive being pasted to somebody else.
  const pick = await ctx.ev(`(() => {
    const option = document.getElementById('filter-author').options[1];
    return { value: option.value, label: option.textContent.trim() };
  })()`);
  await ctx.goto(`${PAGE}?author=${encodeURIComponent(pick.value)}&sort=year&fav=0`, {
    width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY,
  });
  const restored = await ctx.ev(`(() => ({
    author: document.getElementById('filter-author').value,
    sort: document.getElementById('sort').value,
    chips: [...document.querySelectorAll('#active-filters [data-clear]')].map((c) => c.dataset.clear).join(','),
    shown: (document.getElementById('result-summary').textContent || '').trim(),
    items: document.querySelectorAll('.collection li').length,
  }))()`);

  ctx.rec('a filtered view still arrives from its URL',
    restored.author === pick.value && restored.sort === 'year'
      && restored.chips.includes('author') && restored.items > 0,
    `?author=${pick.value}&sort=year → select "${restored.author}", sort "${restored.sort}", `
    + `chips [${restored.chips}], ${restored.items} of the collection shown ("${restored.shown}") for ${pick.label}`);
}

/* ------------------------------------------------------------------ run */

export async function run(ctx) {
  await shelfAboveFold(ctx, 1440, 1000);
  await shelfAboveFold(ctx, 390, 844);
  await shelfWhileScrolled(ctx);
  await focusFavourite(ctx);
  await focusMotion(ctx);
  await language(ctx);
  await addQuote(ctx);
  await addQuoteUnlocked(ctx);
  await headerOnEveryPage(ctx);
  await keyboardAndUrl(ctx);
}
