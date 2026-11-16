/**
 * Acceptance for the front page (index.html), cases 14 to 19 and 29 to 42 of
 * docs/ACCEPTANCE.md.
 *
 * Everything here is measured in a real browser and the measurement is printed,
 * not just the verdict: a green line nobody can check is worth less than no
 * line at all. Where a case says "visible" this asks the browser for rectangles
 * and computed styles rather than for the presence of a selector, because a
 * link can be in the DOM, in the right place, and under something else.
 *
 * The Shelf link is found by where it goes (`works.html`), never by a class
 * name. The More panel is the one thing these cases do have to know by name:
 * since the language switch, the edition and most of the filters moved into it,
 * a case that reaches for one of them has to open it first, and `openMore()`
 * below is the one place that says how.
 */

/* The page under test is the same one in every case. */
const PAGE = '/index.html';
const READY = '.collection li';

/**
 * The contrast of every native <select> against whatever is actually behind it.
 *
 * `appearance: none` strips the widget but not the UA's own fill, so a select
 * with no background of its own keeps Chrome's light Field colour — which in
 * the night edition put muted text on near-white at 2.89:1. Measured from
 * computed style rather than from a screenshot, and the background is walked up
 * the ancestors until something opaque is found, because a transparent control
 * is the colour of whatever it is sitting on.
 */
const SELECT_CONTRAST = `(() => {
  const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const parse = (s) => {
    const n = String(s).match(/-?[\\d.]+/g) || [];
    return { rgb: n.slice(0, 3).map(Number), a: n.length > 3 ? Number(n[3]) : 1 };
  };
  const under = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0.99) return c.rgb;
    }
    return [255, 255, 255];
  };
  return [...document.querySelectorAll('select.pill')]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const s = getComputedStyle(el);
      const own = parse(s.backgroundColor);
      const bg = own.a > 0.99 ? own.rgb : under(el.parentElement);
      const a = lum(parse(s.color).rgb) + 0.05;
      const b = lum(bg) + 0.05;
      return {
        id: el.id || el.name || 'select',
        ratio: Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100,
        ink: s.color,
        fill: s.backgroundColor,
      };
    });
})()`;

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

/**
 * Open the More panel, if it is not already open. Every page's header gives its
 * button the same id, so the same call opens the panel on any of them.
 */
async function openMore(ctx) {
  const open = await ctx.ev("document.getElementById('more-toggle')?.getAttribute('aria-expanded') === 'true'");
  if (!open) await ctx.click('#more-toggle');
  await ctx.wait(160);
}

/**
 * A real Enter, character and all. The harness's own pressKey('Enter') sends the
 * key without its character, which does not activate a focused button, and a case
 * about what a keyboard user is left with has to press the button the way a
 * keyboard does.
 */
async function pressEnter(ctx) {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, text: '\r', unmodifiedText: '\r' });
  await ctx.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await ctx.wait(250);
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
  return [...document.querySelectorAll('.nav-actions .nav-add')]
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
      name: text('.masthead h1'),
      title: document.title,
      more: text('.more-button'),
      shelf: text('#controls-shelf'),
      add: text('#controls-add'),
      edition: text('.more-settings .more-label'),
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
  await openMore(ctx);
  await ctx.click('.lang-toggle');
  await ctx.wait(300);
  const danish = await ctx.ev(read);

  const reloaded = await reload(ctx);
  const after = await ctx.ev(read);
  const shot = await ctx.shot('index-1440-danish');

  const switched = [
    ['the name of the site', english.name, danish.name],
    ['the browser tab title', english.title, danish.title],
    ['the More control', english.more, danish.more],
    ['the shelf control', english.shelf, danish.shelf],
    ['the edition label in the panel', english.edition, danish.edition],
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
  await openMore(ctx);
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
 * Not one of the numbered cases, but nothing else covers it: every page but the
 * front page carries the shared header as a bar, and a one-line mount that
 * silently does nothing would look exactly like a page nobody had got to yet.
 *
 * What it must hold is the same three controls on all of them, the name of the
 * site on the left as the way back to the quotes, and a panel behind More that
 * lists the other pages, leaves out the one you are on, and carries the edition
 * and the language switch.
 */
async function headerOnEveryPage(ctx) {
  const pages = [
    ['/works.html', 'shelf', '.shelf, .book, #shelf .book'],
    ['/scout.html', 'board', '.board, .board-note'],
    ['/suggest.html', 'next', '.controls'],
    ['/import.html', 'import', '#dropzone, .controls'],
  ];
  const seen = [];
  for (const [pathname, active, waitFor] of pages) {
    await ctx.goto(pathname, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor });
    const rest = await ctx.ev(`(() => {
      const node = document.getElementById('site-nav');
      if (!node) return { mounted: false };
      const doc = document.documentElement;
      const brand = node.querySelector('.nav-brand');
      // The name is a link too, but it is the name and not one of the controls.
      const shown = [...node.querySelectorAll('a:not(.nav-brand), button, select')].filter((el) => el.getClientRects().length);
      return {
        mounted: true,
        variant: node.dataset.variant ?? null,
        brand: (brand?.textContent || '').trim(),
        brandHref: brand?.getAttribute('href') ?? null,
        shelf: (node.querySelector('.nav-pill')?.textContent || '').trim(),
        shelfCurrent: node.querySelector('.nav-pill')?.getAttribute('aria-current') ?? null,
        add: (node.querySelector('.nav-add')?.textContent || '').trim(),
        more: (node.querySelector('.more-button')?.textContent || '').trim(),
        visible: shown.length,
        panelHidden: node.querySelector('.more-panel')?.hidden ?? null,
        overflow: doc.scrollWidth - doc.clientWidth,
        // A page's own pill that leads to another page would be a second copy of
        // the header: the name goes to the quotes, and More lists the rest.
        localPills: [...document.querySelectorAll('a.pill[href]')]
          .filter((a) => !a.closest('#site-nav') && a.getClientRects().length
            && /^(\\.\\/|index\\.html|scout\\.html|suggest\\.html|import\\.html|works\\.html)(\\?|#|$)/.test(a.getAttribute('href')))
          .map((a) => (a.textContent || '').trim()),
      };
    })()`);
    await openMore(ctx);
    const open = await ctx.ev(`(() => {
      const panel = document.querySelector('#site-nav .more-panel');
      const links = [...panel.querySelectorAll('.more-link')].map((a) => a.getAttribute('href'));
      const r = panel.getBoundingClientRect();
      return {
        shown: panel.getClientRects().length > 0,
        links,
        edition: Boolean(panel.querySelector('select#edition')),
        language: Boolean(panel.querySelector('.lang-toggle')),
        inside: r.left >= 0 && r.right <= window.innerWidth,
      };
    })()`);
    // Collected now, because the harness empties both lists at the next page.
    seen.push({
      pathname, active, ...rest, ...open, errors: [...ctx.consoleErrors], failed: [...ctx.failedRequests],
    });
  }

  // The panel lists every other page, in this order, and leaves out the one you are on.
  const pagesInPanel = { quotes: './', board: 'scout.html', next: 'suggest.html', import: 'import.html' };
  const bad = seen.filter((page) => {
    const expected = Object.entries(pagesInPanel)
      .filter(([id]) => id !== page.active)
      .map(([, href]) => href);
    return !page.mounted || page.variant !== 'bar'
      || page.brand !== 'My quote collection' || page.brandHref !== './'
      || page.shelf !== 'Shelf' || !/Add/.test(page.add) || !/More/.test(page.more)
      || page.visible !== 3 || page.panelHidden !== true
      || !page.shown || !page.edition || !page.language || !page.inside
      || JSON.stringify(page.links) !== JSON.stringify(expected)
      || page.localPills.length > 0
      || page.overflow > 1 || page.errors.length > 0 || page.failed.length > 0;
  });
  ctx.rec('36 · the shared header is the same three controls on the shelf, the board, read-next and the importer',
    bad.length === 0,
    seen.map((page) => `${page.pathname}: "${page.brand}" → ${page.brandHref}, ${page.visible} controls at rest `
      + `("${page.shelf}", "${page.add}", "${page.more}"), panel hidden=${page.panelHidden}; `
      + `opened it lists [${page.links.join(', ')}], edition select=${page.edition}, language toggle=${page.language}, `
      + `inside the window=${page.inside}; overflow ${page.overflow}px; `
      + `${page.localPills.length} page-link pills of its own${page.localPills.length ? ` (${page.localPills.join(' | ')})` : ''}; `
      + `${page.errors.length} console errors${page.errors.length ? ` (${page.errors.join(' | ')})` : ''}, `
      + `${page.failed.length} failed requests${page.failed.length ? ` (${page.failed.join(' | ')})` : ''}`).join('\n'));
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

/** 19b — a work slug the collection has never held says so, and offers a way out. */
async function unknownWork(ctx) {
  await ctx.goto(`${PAGE}?work=no-such-work-anywhere`, {
    width: 1440, height: 1000, edition: 'paper', lang: 'en', quiet: 900,
  });
  const shown = await ctx.ev(`(() => ({
    items: document.querySelectorAll('.collection li').length,
    emptyShown: !document.getElementById('empty').hidden,
    detail: ((document.getElementById('empty-detail') || {}).textContent || '').trim(),
    clears: [...document.querySelectorAll('#active-filters [data-clear]')].map((c) => c.dataset.clear),
  }))()`);

  ctx.rec('a work slug the collection never had shows the empty state, not the whole collection',
    shown.items === 0 && shown.emptyShown && /no quotes from that work/i.test(shown.detail)
      && shown.clears.includes('work'),
    `./?work=no-such-work-anywhere → ${shown.items} quotes listed, empty state up saying "${shown.detail}", `
    + `chips [${shown.clears.join(', ')}], the work's own chip being the way out. It used to answer with all 240, `
    + `because the filter was dropped the moment the menu had no option for it`);
  await ctx.shot('index-unknown-work');
}

/** 23 — the five filters and the edition picker, read against their own fill. */
async function selectContrast(ctx) {
  const rows = [];
  for (const edition of ['paper', 'night', 'folio', 'index']) {
    await ctx.goto(PAGE, { width: 1440, height: 1000, edition, lang: 'en', waitFor: READY });
    // Four of the six selects, and the edition picker itself, are in the panel,
    // and a select that is not showing has no colour to measure.
    await openMore(ctx);
    for (const row of await ctx.ev(SELECT_CONTRAST)) rows.push({ edition, ...row });
  }
  const dim = rows.filter((row) => row.ratio < 4.5);
  ctx.rec('23 · every filter and the edition picker are legible in every edition',
    rows.length > 0 && dim.length === 0,
    dim.length
      ? dim.map((row) => `${row.edition} #${row.id}: ${row.ratio}:1 (${row.ink} on ${row.fill})`).join('\n')
      : `${rows.length} selects measured; worst ${Math.min(...rows.map((r) => r.ratio))}:1 `
        + `(${[...new Set(rows.map((r) => `${r.edition} ${Math.min(...rows.filter((x) => x.edition === r.edition).map((x) => x.ratio))}:1`))].join(', ')})`);

  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'night', lang: 'en', waitFor: READY });
  await openMore(ctx);
  await ctx.shot('index-controls-1440-night');
}

/* ===========================================================================
   The quiet front page, cases 29 to 35: five things at rest, and everything
   else one press away.
   =========================================================================== */

/** The ids a reader meets, in order, on the quotes page's controls row. */
const AT_REST = ['search', 'filter-subject', 'toggle-favorites', 'controls-shelf', 'controls-add', 'more-toggle'];

/** The controls that used to sit on the row and are now behind More. */
const TUCKED_AWAY = ['filter-author', 'filter-work', 'filter-era', 'sort', 'edition', 'open-focus', 'toggle-curate'];

/** 29 — at rest the quotes page shows five things and a quiet More, and no duplicates. */
async function quietAtRest(ctx, width, height) {
  await ctx.goto(PAGE, { width, height, edition: 'paper', lang: 'en', waitFor: READY });
  const seen = await ctx.ev(`(() => {
    const shown = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; };
    const rowEls = [...document.querySelectorAll('#controls .controls-row input, #controls .controls-row select, #controls .controls-row button, #controls .controls-row a[href]')]
      .filter(shown);
    const row = rowEls.map((el) => el.id);
    const shortest = Math.round(Math.min(...rowEls.map((el) => el.getBoundingClientRect().height)));
    const tucked = ${JSON.stringify(TUCKED_AWAY)}.filter((id) => shown(document.getElementById(id)));
    const shelfLinks = [...document.querySelectorAll('a[href$="works.html"]')].filter((a) => shown(a) && inView(a)).length;
    const addControls = [...document.querySelectorAll('.nav-add, #controls-add')].filter((a) => shown(a) && inView(a)).length;
    return {
      row,
      shortest,
      tucked,
      language: [...document.querySelectorAll('.lang-toggle')].filter(shown).length,
      header: document.getElementById('site-nav') ? 'a bar is still mounted' : 'no separate header',
      quotesPill: [...document.querySelectorAll('a')].filter((a) => shown(a) && inView(a) && (a.textContent || '').trim() === 'Quotes').length,
      shelfLinks,
      addControls,
    };
  })()`);

  ctx.rec(`29 · ${width}px · at rest the controls row holds the search, subject, favourites, shelf, Add and More`,
    JSON.stringify(seen.row) === JSON.stringify(AT_REST),
    `visible in the row, in order: ${seen.row.join(', ')}`);

  // A thumb needs 44px: at a phone's width, and on anything that reports a
  // coarse pointer, every control in the row has to be that tall. With a mouse
  // at desktop width the pills are the usual 34.
  if (width <= 700) {
    ctx.rec(`29 · ${width}px · every control in the row is at least 44px tall`,
      seen.shortest >= 44,
      `${seen.row.length} controls, shortest ${seen.shortest}px`);
  }

  ctx.rec(`29 · ${width}px · author, work, era, sort, edition, focus, curate and the language switch are not showing`,
    seen.tucked.length === 0 && seen.language === 0,
    seen.tucked.length || seen.language
      ? `showing at rest: ${[...seen.tucked, ...(seen.language ? ['language toggle'] : [])].join(', ')}`
      : 'all eight are in the panel, closed');

  ctx.rec(`29 · ${width}px · the shelf and Add each appear once, and there is no Quotes pill on the Quotes page`,
    seen.shelfLinks === 1 && seen.addControls === 1 && seen.quotesPill === 0 && seen.header === 'no separate header',
    `${seen.shelfLinks} shelf link and ${seen.addControls} Add control above the fold; ${seen.quotesPill} "Quotes" pill; ${seen.header}`);

  await ctx.shot(`index-rest-${width}`);
}

/**
 * 30 — More opens a panel that holds the rest, and gets out of the way.
 *
 * Everything the old row carried has to be reachable from here, so the case
 * lists what it found rather than only saying yes. It also has to behave like
 * something a thumb and a keyboard can both use: Escape closes it and hands
 * focus back, a press anywhere else closes it, and it never hangs off the edge
 * of the window.
 */
async function morePanel(ctx, width, height) {
  await ctx.goto(PAGE, { width, height, edition: 'paper', lang: 'en', waitFor: READY });
  const closed = await ctx.ev(`(() => ({
    expanded: document.getElementById('more-toggle').getAttribute('aria-expanded'),
    hidden: document.getElementById('more-panel').hidden,
  }))()`);

  await ctx.click('#more-toggle');
  await ctx.wait(200);
  const open = await ctx.ev(`(() => {
    const panel = document.getElementById('more-panel');
    const button = document.getElementById('more-toggle');
    const shown = (el) => Boolean(el) && el.getClientRects().length > 0;
    const box = panel.getBoundingClientRect();
    const need = {
      author: '#filter-author', work: '#filter-work', era: '#filter-era', sort: '#sort',
      focus: '#open-focus', curate: '#toggle-curate', edition: 'select#edition', language: '.lang-toggle',
    };
    return {
      expanded: button.getAttribute('aria-expanded'),
      shown: shown(panel),
      reachable: Object.entries(need).filter(([, selector]) => shown(panel.querySelector(selector))).map(([name]) => name),
      pages: [...panel.querySelectorAll('.more-link')].map((a) => a.getAttribute('href')),
      insideWindow: box.left >= 0 && box.right <= window.innerWidth,
      belowButton: box.top >= button.getBoundingClientRect().bottom - 1,
    };
  })()`);
  await ctx.shot(`index-more-open-${width}`);

  await ctx.pressKey('Escape');
  await ctx.wait(160);
  const escaped = await ctx.ev(`(() => ({
    hidden: document.getElementById('more-panel').hidden,
    expanded: document.getElementById('more-toggle').getAttribute('aria-expanded'),
    focus: document.activeElement?.id ?? null,
  }))()`);

  await ctx.click('#more-toggle');
  await ctx.wait(160);
  // A press on the empty corner of the window, which is nothing the page owns.
  await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 3, y: height - 3, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 3, y: height - 3, button: 'left', buttons: 0, clickCount: 1 });
  await ctx.wait(160);
  const outside = await ctx.ev("document.getElementById('more-panel').hidden");

  const everything = ['author', 'work', 'era', 'sort', 'focus', 'curate', 'edition', 'language'];
  ctx.rec(`30 · ${width}px · More is closed at rest and says so`,
    closed.expanded === 'false' && closed.hidden === true,
    `aria-expanded="${closed.expanded}", panel hidden=${closed.hidden}`);

  ctx.rec(`30 · ${width}px · opened, it holds the author, work, era and sort filters, Focus, Curate, the edition and the language switch`,
    open.expanded === 'true' && open.shown && everything.every((name) => open.reachable.includes(name)),
    `reachable: ${open.reachable.join(', ')}; missing: ${everything.filter((name) => !open.reachable.includes(name)).join(', ') || 'none'}`);

  ctx.rec(`30 · ${width}px · it also links the board, read next and the importer, and sits inside the window`,
    JSON.stringify(open.pages) === JSON.stringify(['scout.html', 'suggest.html', 'import.html'])
      && open.insideWindow && open.belowButton,
    `links [${open.pages.join(', ')}]; inside the window=${open.insideWindow}; below its button=${open.belowButton}`);

  ctx.rec(`30 · ${width}px · Escape closes it and gives focus back to the button; a press elsewhere closes it too`,
    escaped.hidden === true && escaped.expanded === 'false' && escaped.focus === 'more-toggle' && outside === true,
    `after Escape: hidden=${escaped.hidden}, focus on "${escaped.focus}"; after a press outside: hidden=${outside}`);
}

/** 30 — the panel is still the panel when the page is scrolled, and what is in it works. */
async function moreActions(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.ev('window.scrollTo(0, 2400)');
  await ctx.wait(300);
  await ctx.click('#more-toggle');
  await ctx.wait(200);
  const scrolled = await ctx.ev(`(() => {
    const box = document.getElementById('more-panel').getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), shown: box.height > 0, y: Math.round(window.scrollY) };
  })()`);

  // A filter chosen in the panel narrows the list and leaves the panel open.
  const filtered = await ctx.ev(`(() => {
    const before = document.getElementById('result-summary').textContent.trim();
    const select = document.getElementById('filter-author');
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, picked: select.options[1].textContent.trim() };
  })()`);
  await ctx.wait(300);
  const afterFilter = await ctx.ev(`(() => ({
    summary: document.getElementById('result-summary').textContent.trim(),
    open: document.getElementById('more-toggle').getAttribute('aria-expanded'),
    chip: [...document.querySelectorAll('#active-filters [data-clear]')].map((c) => c.dataset.clear).join(','),
  }))()`);

  // Focus, from the panel, and back.
  await ctx.click('#open-focus');
  await ctx.wait(350);
  const focusOpen = await ctx.ev(`(() => ({
    shown: !document.getElementById('focus').hidden,
    panelHidden: document.getElementById('more-panel').hidden,
  }))()`);
  await ctx.pressKey('Escape');
  await ctx.wait(250);
  const focusBack = await ctx.ev(`(() => ({
    closed: document.getElementById('focus').hidden,
    focus: document.activeElement?.id ?? null,
  }))()`);

  // Curate, from the panel, and out again by the bar that says it is on.
  await ctx.click('#more-toggle');
  await ctx.wait(160);
  await ctx.click('#toggle-curate');
  await ctx.wait(300);
  const curating = await ctx.ev(`(() => ({
    on: document.body.dataset.curate,
    bar: !document.getElementById('curate-bar').hidden,
    done: Boolean(document.getElementById('curate-done')?.getClientRects().length),
    panelHidden: document.getElementById('more-panel').hidden,
  }))()`);
  await ctx.click('#curate-done');
  await ctx.wait(250);
  const curateOff = await ctx.ev(`(() => ({
    on: document.body.dataset.curate,
    bar: !document.getElementById('curate-bar').hidden,
  }))()`);

  ctx.rec('30 · scrolled a long way down, More still opens its panel inside the window',
    scrolled.shown && scrolled.top >= 0 && scrolled.bottom <= 1000 && scrolled.y > 1000,
    `scrolled to ${scrolled.y}px, the panel spans ${scrolled.top}px to ${scrolled.bottom}px of a 1000px window`);

  ctx.rec('30 · a filter chosen in the panel narrows the list and leaves the panel open',
    afterFilter.summary !== filtered.before && afterFilter.open === 'true' && afterFilter.chip.includes('author'),
    `"${filtered.before}" → "${afterFilter.summary}" after choosing ${filtered.picked}; panel expanded=${afterFilter.open}; chips [${afterFilter.chip}]`);

  ctx.rec('30 · Focus opens from the panel, closes it, and Escape brings focus back to More',
    focusOpen.shown && focusOpen.panelHidden && focusBack.closed && focusBack.focus === 'more-toggle',
    `Focus open=${focusOpen.shown} with the panel closed=${focusOpen.panelHidden}; after Escape focus is on "${focusBack.focus}"`);

  ctx.rec('30 · Curate turns on from the panel, and Done on the curate bar turns it off',
    curating.on === 'true' && curating.bar && curating.done && curating.panelHidden
      && curateOff.on === 'false' && !curateOff.bar,
    `curate=${curating.on}, bar shown=${curating.bar}, Done shown=${curating.done}, panel closed=${curating.panelHidden}; `
    + `after Done: curate=${curateOff.on}, bar shown=${curateOff.bar}`);
}

/**
 * 30: Escape closes More wherever focus is, and a choice made from it keeps focus.
 *
 * A press on the panel's own padding is a press on nothing that takes focus, so
 * focus falls to the page. Escape was heard only while focus was inside the
 * control, so from there it left the panel open and cleared the search instead.
 * And choosing Curate from the keyboard hid the button that had focus and left
 * it on nothing, so the next Tab started again from the top of the page.
 */
async function moreKeyboard(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  // A word in the search box, so that a page-level Escape would be seen clearing it.
  await ctx.ev(`(() => {
    const field = document.getElementById('search');
    field.value = 'ai';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await ctx.wait(400);
  await ctx.click('#more-toggle');
  await ctx.wait(200);
  const corner = await ctx.ev(`(() => {
    const box = document.getElementById('more-panel').getBoundingClientRect();
    return { x: box.left + 8, y: box.top + 3 };
  })()`);
  await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...corner, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...corner, button: 'left', buttons: 0, clickCount: 1 });
  await ctx.wait(150);
  const onPage = await ctx.ev(`(() => ({
    expanded: document.getElementById('more-toggle').getAttribute('aria-expanded'),
    onBody: document.activeElement === document.body,
  }))()`);
  await ctx.pressKey('Escape');
  await ctx.wait(160);
  const escaped = await ctx.ev(`(() => ({
    hidden: document.getElementById('more-panel').hidden,
    expanded: document.getElementById('more-toggle').getAttribute('aria-expanded'),
    focus: document.activeElement?.id ?? null,
    search: document.getElementById('search').value,
  }))()`);

  // Curate, chosen the way a keyboard does it: focus the button, press Enter.
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.ev("document.getElementById('more-toggle').focus(); true");
  await pressEnter(ctx);
  await ctx.ev("document.getElementById('toggle-curate').focus(); true");
  await pressEnter(ctx);
  const chosen = await ctx.ev(`(() => ({
    curate: document.body.dataset.curate,
    hidden: document.getElementById('more-panel').hidden,
    focus: document.activeElement?.id || document.activeElement?.tagName || null,
  }))()`);

  ctx.rec('30 · Escape closes More when focus has fallen to the page, and does not clear the search',
    onPage.expanded === 'true' && onPage.onBody
      && escaped.hidden === true && escaped.expanded === 'false' && escaped.focus === 'more-toggle' && escaped.search === 'ai',
    `after a press on the panel's padding: expanded=${onPage.expanded}, focus on the page body=${onPage.onBody}; `
    + `after Escape: hidden=${escaped.hidden}, focus on "${escaped.focus}", the search box still reads "${escaped.search}"`);

  ctx.rec('30 · Curate chosen from the panel with the keyboard leaves focus on More',
    chosen.curate === 'true' && chosen.hidden === true && chosen.focus === 'more-toggle',
    `curate=${chosen.curate}, panel hidden=${chosen.hidden}, focus on "${chosen.focus}"`);
}

/** 31 — a quote card carries its words and its byline, and no labels. */
async function noLabelsOnCards(ctx) {
  await ctx.goto(`${PAGE}?subject=technology`, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const list = await ctx.ev(`(async () => {
    const data = await fetch('data/quotes.json').then((r) => r.json());
    const quotes = data.quotes || data;
    const cards = [...document.querySelectorAll('.collection .quote')];
    const meta = cards.flatMap((card) => [...card.querySelectorAll('.quote-meta *')]);
    return {
      cards: cards.length,
      summary: document.getElementById('result-summary').textContent.trim(),
      chips: document.querySelectorAll('.quote .tag, .quote .verify, .quote .theme').length,
      badges: meta.map((el) => el.textContent.trim()).filter((text) => /^(verified|reported|unverified|disputed)$/i.test(text)).length,
      themesInData: quotes.filter((q) => (q.themes || []).length > 0).length,
      verificationInData: quotes.filter((q) => q.verification && q.verification.status).length,
      total: quotes.length,
    };
  })()`);

  await ctx.pressKey('f');
  await ctx.wait(250);
  const focus = await ctx.ev(`(() => ({
    open: !document.getElementById('focus').hidden,
    chips: document.querySelectorAll('#focus .tag, #focus .verify, #focus .theme').length,
    words: document.getElementById('focus-quote').innerText.replace(/\\s+/g, ' ').slice(0, 80),
  }))()`);
  await ctx.pressKey('Escape');
  await ctx.wait(200);

  ctx.rec('31 · no theme chip and no verification badge on any card in the list',
    list.cards > 0 && list.chips === 0 && list.badges === 0,
    `${list.cards} cards shown ("${list.summary}"): ${list.chips} chips, ${list.badges} badges in their meta rows`);

  ctx.rec('31 · none in the Focus view either',
    focus.open && focus.chips === 0 && !/reported|verified|disputed/i.test(focus.words),
    `Focus open=${focus.open}, ${focus.chips} chips; it reads "${focus.words}"`);

  ctx.rec('31 · the data is untouched: themes and verification are still in data/quotes.json',
    list.themesInData > 0 && list.verificationInData === list.total,
    `${list.themesInData} of ${list.total} quotes still carry themes; ${list.verificationInData} still carry a verification status`);

  // The Subject filter stays, and narrows.
  const subject = await ctx.ev(`(() => {
    const all = document.getElementById('filter-subject').options.length;
    return { options: all, value: document.getElementById('filter-subject').value, shown: document.querySelectorAll('.collection .quote').length };
  })()`);
  ctx.rec('31 · the Subject filter stays and narrows the list',
    subject.value === 'technology' && subject.options > 2 && subject.shown > 0 && subject.shown < list.total,
    `?subject=technology selects "${subject.value}" among ${subject.options - 1} subjects and shows ${subject.shown} of ${list.total}`);

  // Search is unchanged: a word from a quote, an author and a work still find
  // it. Run on the whole collection, since the Subject filter above would have
  // left the quote out of the list before a word of it was typed.
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const search = await ctx.ev(`(async () => {
    const data = await fetch('data/quotes.json').then((r) => r.json());
    const quote = (data.quotes || data).find((q) => q.work && q.author && q.text.length > 80);
    const run = async (query) => {
      const box = document.getElementById('search');
      box.value = query;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((done) => setTimeout(done, 400));
      return [...document.querySelectorAll('.collection .quote')].some((card) => card.id === quote.id);
    };
    const word = quote.text.split(/\\s+/).filter((w) => w.length > 6)[0] || quote.text.split(/\\s+/)[0];
    const out = { byWord: await run(word.replace(/[^\\p{L}]/gu, '')), byAuthor: await run(quote.author), byWork: await run(quote.work) };
    document.getElementById('search').value = '';
    document.getElementById('search').dispatchEvent(new Event('input', { bubbles: true }));
    return { ...out, quote: quote.author + ' / ' + quote.work };
  })()`);
  ctx.rec('31 · search still finds a quote by a word in it, by its author and by its work',
    search.byWord && search.byAuthor && search.byWork,
    `${search.quote}: by word=${search.byWord}, by author=${search.byAuthor}, by work=${search.byWork}`);
}

/** WCAG's lightness of a colour, for the star's contrast against its page. */
const STAR_PROBE = `(() => {
  const chan = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
  const rgb = (s) => (String(s).match(/-?[\\d.]+/g) || []).slice(0, 3).map(Number);
  const item = document.querySelector('.collection .quote');
  const star = item.querySelector('[data-action="favorite"]');
  const copy = item.querySelector('[data-action="copy"]');
  const box = star.getBoundingClientRect();
  const glyph = star.querySelector('svg').getBoundingClientRect();
  const a = lum(rgb(getComputedStyle(star).color)) + 0.05;
  const b = lum(rgb(getComputedStyle(document.body).backgroundColor)) + 0.05;
  const cb = copy.getBoundingClientRect();
  return {
    starW: Math.round(box.width), starH: Math.round(box.height), glyph: Math.round(glyph.width),
    starOpacity: getComputedStyle(star).opacity,
    ratio: Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100,
    copyOpacity: getComputedStyle(copy).opacity, copyW: Math.round(cb.width), copyH: Math.round(cb.height),
    coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches,
  };
})()`;

/** 32 — the star is on every card at rest, on a mouse and on a thumb. */
async function starAtRest(ctx) {
  const rows = [];
  for (const edition of ['paper', 'night']) {
    await ctx.goto(PAGE, { width: 1440, height: 1000, edition, lang: 'en', waitFor: READY });
    rows.push({ edition, ...(await ctx.ev(STAR_PROBE)) });
  }
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const moved = await ctx.ev("getComputedStyle(document.querySelector('.collection .quote [data-action=\"copy\"]')).opacity");
  await ctx.hover('.collection .quote .quote-text');
  await ctx.wait(350);
  // Headless Chrome stops producing frames between the harness's calls, so a
  // transition that has started can read its first value for as long as it
  // likes (the focus check above says the same of animations). Finishing the
  // transition reads where it was going, which is what this case is about: a
  // pointer that is not on the quote starts none, and the value stays 0.
  const hovered = await ctx.ev(`(() => {
    const copy = document.querySelector('.collection .quote [data-action="copy"]');
    copy.getAnimations().forEach((animation) => animation.finish());
    return getComputedStyle(copy).opacity;
  })()`);

  // A phone: the same page with touch switched on, which is what flips
  // `(hover: none)` and `(pointer: coarse)`.
  await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let phone;
  try {
    await ctx.goto(PAGE, { width: 390, height: 844, edition: 'paper', lang: 'en', waitFor: READY });
    phone = await ctx.ev(STAR_PROBE);
  } finally {
    await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  ctx.rec('32 · with no pointer on the card the star is there, in paper and in night, and readable',
    rows.every((row) => row.starOpacity === '1' && row.starW >= 36 && row.glyph >= 18 && row.ratio >= 3),
    rows.map((row) => `${row.edition}: ${row.starW}×${row.starH}px button, ${row.glyph}px star, opacity ${row.starOpacity}, contrast ${row.ratio}:1`).join(' · '));

  ctx.rec('32 · on a mouse the copy button waits for the pointer, and arrives with it',
    moved === '0' && hovered === '1',
    `copy opacity ${moved} at rest, ${hovered} with the pointer on the quote`);

  ctx.rec('32 · on a phone both buttons are there at rest and at least 44px square',
    phone.coarse && phone.starOpacity === '1' && phone.copyOpacity === '1'
      && phone.starW >= 44 && phone.starH >= 44 && phone.copyW >= 44 && phone.copyH >= 44,
    `touch emulated (pointer coarse=${phone.coarse}, hover=${phone.hover}): star ${phone.starW}×${phone.starH}px, copy ${phone.copyW}×${phone.copyH}px, opacity ${phone.starOpacity} and ${phone.copyOpacity}`);
}

/** 33 — the work title leads to the source, when there is one that is not Goodreads. */
async function sourceLink(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const seen = await ctx.ev(`(async () => {
    const data = await fetch('data/quotes.json').then((r) => r.json());
    const quotes = data.quotes || data;
    const sourced = quotes.filter((q) => q.work && q.source && q.source.kind !== 'goodreads' && /^https?:/i.test(q.source.url || ''));
    const goodreads = quotes.filter((q) => q.work && q.source && q.source.kind === 'goodreads');
    const probe = (q) => {
      const a = q && document.getElementById(q.id)?.querySelector('.attribution-work');
      return a ? { tag: a.tagName, href: a.href, attr: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent } : null;
    };
    const links = [...document.querySelectorAll('.collection .attribution-source')];
    return {
      expected: sourced.length,
      linked: links.length,
      toGoodreads: links.filter((a) => /goodreads\\.com/.test(a.href)).length,
      newTab: links.filter((a) => a.target === '_blank' && /noopener/.test(a.rel)).length,
      first: probe(sourced[0]), firstUrl: sourced[0] && new URL(sourced[0].source.url).href,
      plain: probe(goodreads[0]),
      kinds: [...new Set(quotes.map((q) => q.source && q.source.kind))].join(', '),
    };
  })()`);

  ctx.rec('33 · every quote with a non-Goodreads source url has its work title as a link to it',
    seen.expected > 0 && seen.linked === seen.expected && seen.first?.tag === 'A' && seen.first.href === seen.firstUrl,
    `${seen.linked} source links for ${seen.expected} quotes that have a source url (kinds in the data: ${seen.kinds}); `
    + `the first: <${seen.first?.tag}> "${seen.first?.text}" → ${seen.first?.href}`);

  ctx.rec('33 · each opens in a new tab with rel noopener, and none points at Goodreads',
    seen.newTab === seen.linked && seen.toGoodreads === 0,
    `${seen.newTab} of ${seen.linked} have target=_blank and rel noopener; ${seen.toGoodreads} go to goodreads.com; first rel="${seen.first?.rel}"`);

  ctx.rec('33 · a Goodreads-sourced quote keeps its plain filter link, and gains no source link',
    !seen.plain || (seen.plain.tag === 'A' && seen.plain.attr.startsWith('?work=') && !seen.plain.target),
    seen.plain
      ? `the work title is <${seen.plain.tag}> href="${seen.plain.attr}" target="${seen.plain.target}"`
      : 'no Goodreads-sourced quote with a work in the data');

  // In Focus the same title is the same link. The first sourced quote is near
  // the top of the list, so a few J presses reach it.
  const index = await ctx.ev(`(() => {
    const cards = [...document.querySelectorAll('.collection .quote')];
    return cards.findIndex((card) => card.querySelector('.attribution-source'));
  })()`);
  if (index >= 0 && index < 12) {
    for (let i = 0; i <= index; i += 1) await ctx.pressKey('j');
    await ctx.pressKey('f');
    await ctx.wait(300);
    const focus = await ctx.ev(`(() => {
      const a = document.querySelector('#focus-quote .attribution-work');
      return a ? { tag: a.tagName, target: a.target, rel: a.rel, href: a.href } : null;
    })()`);
    await ctx.pressKey('Escape');
    await ctx.wait(200);
    ctx.rec('33 · in Focus the work title is the same link',
      focus?.tag === 'A' && focus.target === '_blank' && /noopener/.test(focus.rel),
      focus ? `<${focus.tag}> → ${focus.href}, target ${focus.target}, rel "${focus.rel}"` : 'no work title in the Focus byline');
  } else {
    ctx.skip('33 · in Focus the work title is the same link', 'the first sourced quote is not near the top of the list');
  }
}

/**
 * 34 — a quote still has its own permanent address, with no button to copy it.
 *
 * The address is the quote's id as a hash. Arriving at one scrolls to the quote
 * and marks it; opening Focus keeps the address on the quote on screen, so
 * copying the address bar is how a link to one line is made now.
 */
async function permalinks(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const ids = await ctx.ev("[...document.querySelectorAll('.collection .quote')].map((card) => card.id)");
  const deep = ids[40];
  const buttons = await ctx.ev("document.querySelectorAll('.quote [data-action=\"permalink\"], .quote a[href^=\"#\"]').length");

  await ctx.goto(`${PAGE}#${deep}`, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const arrived = await ctx.ev(`(() => {
    const target = document.querySelector('.quote[data-targeted="true"]');
    const r = document.getElementById(${JSON.stringify(deep)}).getBoundingClientRect();
    return { targeted: target ? target.id : null, top: Math.round(r.top), bottom: Math.round(r.bottom), y: Math.round(window.scrollY) };
  })()`);

  await ctx.pressKey('f');
  await ctx.wait(300);
  const first = await ctx.ev("({ hash: location.hash, position: document.getElementById('focus-position').textContent.trim() })");
  await ctx.pressKey('ArrowRight');
  await ctx.wait(700);
  const next = await ctx.ev('location.hash');
  await ctx.pressKey('Escape');
  await ctx.wait(300);
  const closed = await ctx.ev('location.hash');

  ctx.rec('34 · a quote card has no link button and no permalink anchor',
    buttons === 0,
    `${buttons} permalink buttons or #anchors inside the cards`);

  ctx.rec('34 · arriving at #id scrolls to the quote and marks it',
    arrived.targeted === deep && arrived.top >= 0 && arrived.bottom <= 1000 && arrived.y > 500,
    `#${deep} (the 41st quote): marked ${arrived.targeted}, on screen from ${arrived.top}px to ${arrived.bottom}px after scrolling ${arrived.y}px`);

  ctx.rec('34 · from an address, F opens Focus on that quote: whoever is sent a line can read it on its own',
    first.hash === `#${deep}` && /^41 \/ /.test(first.position),
    `arrived at #${deep} and pressed F: the address reads ${first.hash} and Focus says "${first.position}" (the 41st quote, not the first)`);

  ctx.rec('34 · in Focus the address is the permanent link to the quote on screen, and Escape puts it back',
    next === `#${ids[41]}` && closed === `#${deep}`,
    `next quote: ${next} (expected #${ids[41]}); after Escape: ${closed} (it was #${deep} before)`);
}

/** 35 — the page is called My quote collection, and says nothing else about itself. */
async function nameOfTheSite(ctx) {
  const seen = [];
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await ctx.goto(PAGE, { width, height, edition: 'paper', lang: 'en', waitFor: READY });
    const page = await ctx.ev(`(() => {
      const h1 = document.querySelector('.masthead h1');
      const box = document.querySelector('.masthead').getBoundingClientRect();
      const lines = Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight));
      const html = document.documentElement.outerHTML;
      return {
        width: window.innerWidth,
        h1: h1.textContent.trim(),
        title: document.title,
        og: document.querySelector('meta[property="og:title"]')?.content ?? null,
        description: document.querySelector('meta[name="description"]')?.content ?? '',
        children: [...document.querySelector('.masthead').children].map((el) => el.tagName),
        lines,
        height: Math.round(box.height),
        stray: ['Lines Worth Keeping', 'A personal collection', 'Everything I have wanted to remember', 'masthead-kicker', 'masthead-dek']
          .filter((text) => html.includes(text)),
      };
    })()`);
    seen.push(page);
  }
  const bad = seen.filter((page) => page.h1 !== 'My quote collection' || page.title !== 'My quote collection'
    || page.og !== 'My quote collection' || /worth keeping/i.test(page.description)
    || page.children.join() !== 'H1' || page.stray.length > 0);
  ctx.rec('35 · the heading, the tab title and the share title all say My quote collection',
    bad.length === 0,
    seen.map((page) => `${page.width}px: h1 "${page.h1}" (${page.lines} line${page.lines === 1 ? '' : 's'}), title "${page.title}", `
      + `og:title "${page.og}", masthead holds ${page.children.join('+')} and is ${page.height}px tall`).join('\n'));
  ctx.rec('35 · no kicker, no subtitle, and the old name is nowhere in the page',
    seen.every((page) => page.stray.length === 0 && !/worth keeping/i.test(page.description)),
    `looked for the old name, the kicker, the dek and their classes in the whole document, and for "worth keeping" in the description ("${seen[0].description}")`);
}

/**
 * 37 — one filter, one way to clear it.
 *
 * With a single chip showing, its own cross does what "Clear all" does, so the
 * second control is not there. With two or more, "Clear all" is the shortest way
 * back, and it arrives.
 */
async function oneChipOneWayOut(ctx) {
  const chips = async (query) => {
    await ctx.goto(`${PAGE}${query}`, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
    return ctx.ev("[...document.querySelectorAll('#active-filters [data-clear]')].map((c) => c.dataset.clear)");
  };
  const one = await chips('?subject=technology');
  await ctx.click('#active-filters [data-clear="subject"]');
  await ctx.wait(250);
  const cleared = await ctx.ev(`(() => ({
    subject: document.getElementById('filter-subject').value,
    row: document.getElementById('active-filters').hidden,
    url: location.search,
  }))()`);
  const two = await chips('?subject=technology&fav=1');
  const three = await chips('?subject=technology&fav=1&q=ai');
  await ctx.click('#active-filters [data-clear="all"]');
  await ctx.wait(250);
  const all = await ctx.ev(`(() => ({
    subject: document.getElementById('filter-subject').value,
    search: document.getElementById('search').value,
    pressed: document.getElementById('toggle-favorites').getAttribute('aria-pressed'),
    row: document.getElementById('active-filters').hidden,
  }))()`);

  ctx.rec('37 · one filter on: its own chip is the way out, and there is no "Clear all" beside it',
    JSON.stringify(one) === '["subject"]' && cleared.subject === '' && cleared.row && cleared.url === '',
    `?subject=technology → chips [${one.join(', ')}]; pressing the chip: subject "${cleared.subject}", row hidden=${cleared.row}, address "${cleared.url}"`);

  ctx.rec('37 · two or more on: "Clear all" arrives, and clears them all',
    JSON.stringify(two) === '["subject","fav","all"]' && three.at(-1) === 'all' && three.length === 4
      && all.subject === '' && all.search === '' && all.pressed === 'false' && all.row,
    `two filters → [${two.join(', ')}]; three → [${three.join(', ')}]; after Clear all: subject "${all.subject}", search "${all.search}", favourites pressed=${all.pressed}, row hidden=${all.row}`);
}

/**
 * 38 — a byline is as wide as its card, so a long title takes the room it needs.
 *
 * It was held to a measure counted in ems of its own small type, so under a
 * quotation 800px wide the byline stopped at 450 and the year fell onto a line
 * by itself; in Folio the byline broke in three. A year that shares no line
 * with a title that is short enough to fit is the thing to look for.
 */
async function bylineWidth(ctx) {
  const rows = [];
  for (const [edition, width, height] of [['paper', 1440, 1000], ['folio', 1440, 1000], ['index', 1440, 1000], ['paper', 390, 844]]) {
    await ctx.goto(PAGE, { width, height, edition, lang: 'en', waitFor: READY });
    const seen = await ctx.ev(`(() => {
      const cards = [...document.querySelectorAll('.collection .quote')].slice(0, 80);
      let narrow = 0;
      let orphans = 0;
      let checked = 0;
      for (const card of cards) {
        const line = card.querySelector('.attribution');
        const box = card.querySelector('figure');
        if (Math.abs(line.clientWidth - box.clientWidth) > 1) narrow += 1;
        const work = line.querySelector('.attribution-work');
        const year = line.querySelector('.attribution-year');
        // A short title and a year: on any page wider than a phone they belong on one line.
        if (work && year && work.textContent.length <= 60 && window.innerWidth > 700) {
          checked += 1;
          if (year.getBoundingClientRect().top - work.getBoundingClientRect().top > 6) orphans += 1;
        }
      }
      return { cards: cards.length, narrow, orphans, checked };
    })()`);
    rows.push({ edition, width, ...seen });
  }
  ctx.rec('38 · the byline runs the width of its card, and a year is not left on a line of its own',
    rows.every((row) => row.cards > 0 && row.narrow === 0 && row.orphans === 0),
    rows.map((row) => `${row.edition} ${row.width}px: ${row.cards} cards, ${row.narrow} bylines narrower than their card, `
      + `${row.orphans} of ${row.checked} short-title years on a line of their own`).join('\n'));
}

/**
 * 39 — a phone is not shown the names of keys.
 *
 * The slash in the search box, the letters beside Focus and Curate, the S and
 * esc in the Focus bar and the line of shortcuts in the footer are for a
 * keyboard. With touch on (`hover: none`) none of them takes up room, and with a
 * mouse every one of them is still there.
 */
async function noKeyHintsOnTouch(ctx) {
  const probe = `(() => {
    const display = (selector) => [...document.querySelectorAll(selector)].map((el) => getComputedStyle(el).display);
    return {
      hover: matchMedia('(hover: none)').matches,
      search: display('.search-hint'),
      pill: display('.pill-key'),
      focusKey: display('.focus-fav-key'),
      esc: display('.focus-esc'),
      footer: display('#footer-keys'),
    };
  })()`;
  const hidden = (seen) => [seen.search, seen.pill, seen.focusKey, seen.esc, seen.footer]
    .every((list) => list.length > 0 && list.every((value) => value === 'none'));
  const shown = (seen) => [seen.search, seen.pill, seen.focusKey, seen.esc, seen.footer]
    .every((list) => list.length > 0 && list.every((value) => value !== 'none'));

  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  const mouse = await ctx.ev(probe);

  await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let touch;
  try {
    await ctx.goto(PAGE, { width: 390, height: 844, edition: 'paper', lang: 'en', waitFor: READY });
    touch = await ctx.ev(probe);
  } finally {
    await ctx.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  ctx.rec('39 · with a mouse the key hints are there: the slash, the letters, S, esc and the footer line',
    !mouse.hover && shown(mouse),
    `hover none=${mouse.hover}; display of search hint ${mouse.search}, pill keys ${mouse.pill}, focus S ${mouse.focusKey}, esc ${mouse.esc}, footer ${mouse.footer}`);

  ctx.rec('39 · with touch on none of them is shown',
    touch.hover && hidden(touch),
    `hover none=${touch.hover}; display of search hint ${touch.search}, pill keys ${touch.pill}, focus S ${touch.focusKey}, esc ${touch.esc}, footer ${touch.footer}`);
}

/**
 * 15: on a phone the controls row does not stick.
 *
 * Case 15 above is about 1440px, where the row follows the reader down the page.
 * At 390px the row is three lines tall, a fifth of the screen, and a sticky one
 * would leave a quarter of what is left to read under. So it lets go, and this
 * case holds that as a decision: a later edit that makes it stick again has to
 * change the case, not slip past it.
 */
async function controlsOnAPhone(ctx) {
  await ctx.goto(PAGE, { width: 390, height: 844, edition: 'paper', lang: 'en', waitFor: READY });
  const rest = await ctx.ev("Math.round(document.getElementById('controls').getBoundingClientRect().height)");
  await ctx.ev('window.scrollTo(0, 1800)');
  await ctx.wait(350);
  const seen = await ctx.ev(`(() => {
    const row = document.getElementById('controls');
    return {
      position: getComputedStyle(row).position,
      bottom: Math.round(row.getBoundingClientRect().bottom),
      y: Math.round(window.scrollY),
    };
  })()`);
  ctx.rec('15 · on a phone the controls row scrolls away with the page and covers nothing',
    seen.position !== 'sticky' && seen.bottom < 0 && seen.y > 1000,
    `at 390px the row is ${rest}px tall, ${Math.round((rest / 844) * 100)}% of an 844px screen, and is position:${seen.position}; `
    + `scrolled ${seen.y}px its bottom edge is at ${seen.bottom}px, above the top of the window`);
}

/**
 * 40: the Add dialog is thumb-sized on a phone.
 *
 * Adding a quote from a phone is what the dialog is for, and its own controls
 * were 34 to 42px tall, with the link to the GitHub form, the one way on for a
 * visitor who cannot unlock, at 17px. Everything a thumb can land on is measured:
 * buttons, links, fields, menus and the toggle for the source fields. The dialog
 * that opens only to unlock is measured too, and so is the desktop one, which is
 * reported and not held to 44px: with a mouse the compact sizes are the right ones.
 */
const DIALOG_CONTROLS = `(() => {
  const dialog = document.getElementById('add-dialog');
  return [...dialog.querySelectorAll('button, a[href], input, select, textarea, summary')]
    .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => ({
      name: el.id || el.name || el.tagName.toLowerCase(),
      h: Math.round(el.getBoundingClientRect().height * 10) / 10,
    }));
})()`;

async function addDialogTapTargets(ctx) {
  const measure = async (width, height, openIt) => {
    await ctx.goto(PAGE, { width, height, edition: 'paper', lang: 'en', waitFor: READY });
    await ctx.ev("localStorage.removeItem('shelf-edit-code')");
    await reload(ctx);
    await openIt();
    await ctx.wait(400);
    // The source fields are behind a toggle: open it, so they are on screen to be measured.
    await ctx.ev("(() => { const more = document.getElementById('add-more'); if (more) more.open = true; return true; })()");
    await ctx.wait(150);
    const found = await ctx.ev(DIALOG_CONTROLS);
    return { found, shortest: Math.min(...found.map((control) => control.h)) };
  };
  const phone = await measure(390, 844, () => ctx.click('#controls-add'));
  const unlockOnly = await measure(390, 844, () => ctx.ev("document.dispatchEvent(new CustomEvent('quotes:unlock')); true"));
  const desktop = await measure(1440, 1000, () => ctx.click('#controls-add'));

  const small = (run) => run.found.filter((control) => control.h < 43.5);
  const list = (run) => run.found.map((control) => `${control.name} ${control.h}`).join(', ');

  // A dialog that did not open would measure as nothing at all, and nothing is
  // not "at least 44px": the counts are the guard against passing on an empty one.
  ctx.rec('40 · on a phone every control in the Add dialog is at least 44px tall',
    phone.found.length >= 15 && small(phone).length === 0,
    small(phone).length
      ? `too short: ${small(phone).map((control) => `${control.name} ${control.h}px`).join(', ')}`
      : `${phone.found.length} controls, shortest ${phone.shortest}px: ${list(phone)}`);

  ctx.rec('40 · the dialog that opens only to unlock is thumb-sized too',
    unlockOnly.found.length >= 4 && small(unlockOnly).length === 0,
    small(unlockOnly).length
      ? `too short: ${small(unlockOnly).map((control) => `${control.name} ${control.h}px`).join(', ')}`
      : `${unlockOnly.found.length} controls, shortest ${unlockOnly.shortest}px: ${list(unlockOnly)}`);

  ctx.rec('40 · at 1440px the dialog keeps its compact desktop sizes',
    desktop.found.length >= 15 && desktop.shortest < 44,
    `${desktop.found.length} controls, shortest ${desktop.shortest}px: ${list(desktop)}`);
}

/**
 * 41: read next: its filters stick under the shared bar and not behind it.
 *
 * From 701px the bar sticks, and the page's own filter row stuck at the same top
 * edge, with a lower layer, so after a scroll only the bar showed and "Suggest
 * again" could not be pressed. The reachable part is measured with a hit test:
 * what is at the middle of the button is the button.
 */
async function readNextFiltersStick(ctx) {
  await ctx.goto('/suggest.html', { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: '#suggestions .work' });
  await ctx.wait(500);
  const room = await ctx.ev('document.documentElement.scrollHeight - window.innerHeight');
  if (room < 1900) {
    ctx.skip('41 · read next keeps its filters in reach under the bar when scrolled', `the page scrolls only ${room}px`);
    return;
  }
  await ctx.ev('window.scrollTo(0, 1800)');
  await ctx.wait(350);
  const seen = await ctx.ev(`(() => {
    const bar = document.getElementById('site-nav').getBoundingClientRect();
    const row = document.querySelector('.controls');
    const box = row.getBoundingClientRect();
    const again = document.getElementById('reroll').getBoundingClientRect();
    const hit = document.elementFromPoint(again.left + again.width / 2, again.top + again.height / 2);
    return {
      y: Math.round(window.scrollY),
      position: getComputedStyle(row).position,
      barBottom: Math.round(bar.bottom),
      rowTop: Math.round(box.top),
      rowBottom: Math.round(box.bottom),
      hit: hit ? (hit.id || hit.tagName.toLowerCase()) : null,
      reachable: Boolean(hit && hit.closest('#reroll')),
    };
  })()`);
  ctx.rec('41 · read next keeps its filters in reach under the bar when scrolled',
    seen.y > 1000 && seen.position === 'sticky' && seen.rowTop >= seen.barBottom - 1 && seen.reachable,
    `scrolled ${seen.y}px: the bar ends at ${seen.barBottom}px, the filter row (position:${seen.position}) spans ${seen.rowTop}px to ${seen.rowBottom}px, `
    + `and what is at the middle of "Suggest again" is "${seen.hit}"`);
}

/**
 * 42: copy puts the quotation and who said it where on the clipboard, and no em dash.
 *
 * What the button copies goes into his own writing, where an em dash reads as
 * machine-made, so the second line starts with a spaced en dash. The clipboard is
 * replaced by a recorder in the page, because headless Chrome has none to read.
 */
async function copyFormat(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await ctx.ev(`(() => {
    window.__copied = null;
    navigator.clipboard.writeText = async (text) => { window.__copied = text; };
    return true;
  })()`);
  await ctx.click('.collection .quote [data-action="copy"]');
  await ctx.wait(250);
  const seen = await ctx.ev(`(() => {
    const card = document.querySelector('.collection .quote');
    const words = card.querySelector('.quote-text').textContent;
    const author = card.querySelector('.attribution-author').textContent;
    const work = card.querySelector('.attribution-work')?.textContent;
    return {
      copied: window.__copied,
      expected: '“' + words + '”\\n– ' + [author, work].filter(Boolean).join(', '),
    };
  })()`);
  const show = (text) => JSON.stringify(String(text ?? '').slice(0, 90));
  // Spelled by its code, so that this file does not carry the character it forbids.
  const emDash = String.fromCharCode(0x2014);
  ctx.rec('42 · copy puts the quotation on the clipboard with its author and work on a second line, and no em dash',
    typeof seen.copied === 'string' && seen.copied === seen.expected && !seen.copied.includes(emDash),
    `copied ${show(seen.copied)} against the expected ${show(seen.expected)}; em dash in it: ${String(seen.copied).includes(emDash)}`);
}

export async function run(ctx) {
  await shelfAboveFold(ctx, 1440, 1000);
  await shelfAboveFold(ctx, 390, 844);
  await shelfWhileScrolled(ctx);
  await controlsOnAPhone(ctx);
  await focusFavourite(ctx);
  await focusMotion(ctx);
  await language(ctx);
  await addQuote(ctx);
  await addQuoteUnlocked(ctx);
  await addDialogTapTargets(ctx);
  await headerOnEveryPage(ctx);
  await readNextFiltersStick(ctx);
  await keyboardAndUrl(ctx);
  await unknownWork(ctx);
  await selectContrast(ctx);

  // The quiet front page.
  await quietAtRest(ctx, 1440, 1000);
  await quietAtRest(ctx, 390, 844);
  await morePanel(ctx, 1440, 1000);
  await morePanel(ctx, 390, 844);
  await moreActions(ctx);
  await moreKeyboard(ctx);
  await noLabelsOnCards(ctx);
  await starAtRest(ctx);
  await copyFormat(ctx);
  await sourceLink(ctx);
  await permalinks(ctx);
  await nameOfTheSite(ctx);
  await oneChipOneWayOut(ctx);
  await bylineWidth(ctx);
  await noKeyHintsOnTouch(ctx);
}
