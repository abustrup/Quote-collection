/**
 * What the page does with a star, and what the unlock form is made of.
 *
 * Added on 2026-11-16, after a review found that nothing automated guarded the
 * two things that decide whether a favourite is ever lost again. On 2026-11-15
 * it turned out that none of his favourites had been saved anywhere durable: a
 * star pressed while editing was locked kept itself on that device and said
 * nothing, and nobody noticed for months. The pure parts of the fix are covered
 * by `tests/favorites.test.mjs`. This file covers the part those tests cannot
 * see, which is the page itself, in a real browser:
 *
 *   - a star pressed while locked says, once per page load, that it is kept on
 *     this device only, in English and in Danish, with an Unlock action;
 *   - that action opens the existing dialog with nothing but the unlock form in
 *     it, and unlocking from there sends the Worker what was pressed;
 *   - the unlock form is a real form a password manager can fill: a username, a
 *     password field with the right `autocomplete`, and the code is never put in
 *     an address;
 *   - when the browser will not store anything, the toast does not claim that it
 *     did;
 *   - a bad link typed into the folded "Source details" cannot block the Add
 *     button in silence;
 *   - a new work with a subject needs its year, which is what keeps the
 *     registry's era rule true.
 *
 * Everything runs against a stand-in for the Worker, installed in the page
 * before any of its own script runs, so no check ever writes to his real
 * collection and none depends on what the real Worker holds today.
 */

const PAGE = '/index.html';
const READY = '.collection li';
const CODE = 'test-code';

const TEXT_EN = 'Saved on this device only. Unlock to keep it everywhere.';
const TEXT_DA = 'Gemt kun på denne enhed. Lås op for at beholde det overalt.';

/**
 * A Worker that knows nothing and takes one code. `GET /state` is empty,
 * `POST /ping` and `POST /favorite` say yes to the right code and 401 to
 * anything else, and every call is written down for the checks to read. The
 * code itself is never stored with a call, only whether it was the right one.
 */
const WORKER_STUB = `(() => {
  const real = window.fetch.bind(window);
  window.__worker = { calls: [] };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('workers.dev') < 0) return real(input, init);
    const opts = init || {};
    const headers = opts.headers || {};
    const auth = headers.authorization || headers.Authorization || '';
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch (error) { body = null; }
    window.__worker.calls.push({ url: url, method: opts.method || 'GET', right: auth === 'Bearer ${CODE}', body: body });
    const json = (value, status) => new Response(JSON.stringify(value), {
      status: status || 200, headers: { 'content-type': 'application/json' },
    });
    if (/\\/state$/.test(url)) return json({ works: {}, favorites: {}, pending: [], generatedAt: null });
    if (auth !== 'Bearer ${CODE}') return new Response('', { status: 401 });
    return json({ ok: true });
  };
})()`;

/** A browser that refuses to store anything: every read and every write of localStorage throws. */
const STORAGE_REFUSED = `(() => {
  if (!/index\\.html$/.test(location.pathname)) return;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
})()`;

/** Everything the page keeps about favourites and unlocking on this device. */
const FORGET_THIS_DEVICE = `(() => {
  for (const key of ['shelf-edit-code', 'shelf-state', 'shelf-queue', 'quotes-favorites', 'quotes-favorites-choices', 'quotes-add-subject']) {
    localStorage.removeItem(key);
  }
  return true;
})()`;

const TOAST = `(() => {
  const bar = document.getElementById('toast');
  if (!bar) return null;
  const button = bar.querySelector('button');
  const box = bar.getBoundingClientRect();
  return {
    visible: bar.dataset.visible,
    words: [...bar.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(''),
    action: button ? button.textContent.trim() : null,
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
})()`;

const HIDE_TOAST = `(() => {
  const bar = document.getElementById('toast');
  bar.replaceChildren();
  bar.dataset.visible = 'false';
  return true;
})()`;

/* --------------------------------------------------------------- helpers */

async function reload(ctx) {
  await ctx.send('Page.reload', {});
  await ctx.wait(250);
  for (let i = 0; i < 100; i += 1) {
    const ready = await ctx.ev(`document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(READY)})`).catch(() => false);
    if (ready) { await ctx.wait(250); return true; }
    await ctx.wait(100);
  }
  return false;
}

/** The index page as a visitor with an empty browser and no edit code sees it. */
async function emptyBrowser(ctx, { lang = 'en', width = 1440, height = 1000 } = {}) {
  await ctx.goto(PAGE, { width, height, edition: 'paper', lang, waitFor: READY });
  await ctx.ev(FORGET_THIS_DEVICE);
  return reload(ctx);
}

/** The id of the nth quote on the page, and its star as the page shows it. */
const quoteAt = (n) => `(() => {
  const item = document.querySelector('.collection li:nth-child(${n})');
  const star = item && item.querySelector('[data-action="favorite"]');
  return item ? { id: item.id, pressed: star ? star.getAttribute('aria-pressed') : null } : null;
})()`;

const starSelector = (n) => `.collection li:nth-child(${n}) [data-action="favorite"]`;

/** Run `body` with a script installed to run before every page's own script, and take it away afterwards. */
async function withScripts(ctx, sources, body) {
  const installed = [];
  for (const source of sources) installed.push(await ctx.send('Page.addScriptToEvaluateOnNewDocument', { source }));
  try {
    await body();
  } finally {
    for (const one of installed) {
      await ctx.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: one.identifier }).catch(() => {});
    }
    await ctx.ev(FORGET_THIS_DEVICE).catch(() => {});
  }
}

/* ----------------------------------------------------------------- cases */

/**
 * A star pressed while locked, from the press to the Worker.
 *
 * One long case on purpose: each step is what the next one starts from, and the
 * whole chain is the thing that was broken, not any one link.
 */
async function lockedStar(ctx) {
  await withScripts(ctx, [WORKER_STUB], async () => {
    await emptyBrowser(ctx);

    const first = await ctx.ev(quoteAt(1));
    await ctx.click(starSelector(1));
    await ctx.wait(350);
    const pressed = await ctx.ev(TOAST);
    const after = await ctx.ev(quoteAt(1));
    const kept = await ctx.ev("JSON.parse(localStorage.getItem('quotes-favorites-choices') || '{}')");
    const shot = await ctx.shot('index-star-kept-here');

    ctx.rec('stars · with editing locked, a star says it is kept on this device only, and offers Unlock',
      pressed && pressed.visible === 'true' && pressed.words === TEXT_EN && pressed.action === 'Unlock',
      `toast ${pressed && pressed.visible}: "${pressed && pressed.words}" with the action "${pressed && pressed.action}"  ·  shot ${shot.split('/').slice(-2).join('/')}`);

    ctx.rec('stars · the star is kept on this device when it is pressed, with the time it was pressed',
      after.pressed !== first.pressed && Boolean(kept[first.id]) && /^\d{4}-\d{2}-\d{2}T/.test(kept[first.id].at),
      `star ${first.pressed} → ${after.pressed}; choices hold ${first.id}: ${JSON.stringify(kept[first.id])}`);

    // A second press, with the first toast gone: the page has said it once.
    await ctx.ev(HIDE_TOAST);
    const second = await ctx.ev(quoteAt(2));
    await ctx.click(starSelector(2));
    await ctx.wait(350);
    const again = await ctx.ev(TOAST);
    const secondAfter = await ctx.ev(quoteAt(2));
    ctx.rec('stars · it says so once per page load, not on every star',
      again.visible !== 'true' && again.action === null && secondAfter.pressed !== second.pressed,
      `second press: star ${second.pressed} → ${secondAfter.pressed}, toast ${again.visible} with action ${again.action}`);

    // A new page load says it again.
    await reload(ctx);
    const third = await ctx.ev(quoteAt(3));
    await ctx.click(starSelector(3));
    await ctx.wait(350);
    const fresh = await ctx.ev(TOAST);
    ctx.rec('stars · and on the next page load it says it again',
      fresh.visible === 'true' && fresh.words === TEXT_EN && fresh.action === 'Unlock',
      `after a reload: toast ${fresh.visible}, "${fresh.words}"`);

    // The action opens the one existing dialog, with only the unlock form in it.
    await ctx.click('#toast button');
    await ctx.wait(450);
    const dialog = await ctx.ev(`(() => {
      const node = document.getElementById('add-dialog');
      if (!node) return { present: false };
      const shown = (selector) => {
        const found = node.querySelector(selector);
        return Boolean(found && !found.hidden && found.getClientRects().length);
      };
      const user = node.querySelector('#add-user');
      const code = node.querySelector('#add-code');
      return {
        present: true,
        open: node.open === true,
        modal: node.matches(':modal'),
        title: (node.querySelector('#add-dialog-title') || {}).textContent,
        unlockShown: shown('#add-locked'),
        fieldsShown: shown('#add-fields'),
        saveShown: shown('#add-save'),
        focusOnCode: document.activeElement === code,
        dialogs: document.querySelectorAll('dialog').length,
        form: code && code.form ? code.form.id : null,
        formTag: code && code.form ? code.form.tagName : null,
        userForm: user && user.form ? user.form.id : null,
        user: user ? {
          type: user.type, name: user.name, autocomplete: user.autocomplete, readOnly: user.readOnly, value: user.value,
        } : null,
        code: code ? { type: code.type, name: code.name, autocomplete: code.autocomplete } : null,
        passwordFields: document.querySelectorAll('input[type="password"]').length,
        toastGone: document.getElementById('toast').querySelector('button') === null,
      };
    })()`);
    const dialogShot = await ctx.shot('index-unlock-dialog');

    ctx.rec('stars · Unlock opens the existing dialog with only the unlock form in it',
      dialog.present && dialog.open && dialog.modal && dialog.title === 'Unlock editing'
        && dialog.unlockShown && !dialog.fieldsShown && !dialog.saveShown && dialog.focusOnCode
        && dialog.dialogs === 1 && dialog.passwordFields === 1 && dialog.toastGone,
      `title "${dialog.title}", unlock form shown=${dialog.unlockShown}, quote fields shown=${dialog.fieldsShown}, `
      + `focus on the code=${dialog.focusOnCode}, ${dialog.dialogs} dialog and ${dialog.passwordFields} password field on the page  ·  shot ${dialogShot.split('/').slice(-2).join('/')}`);

    ctx.rec('stars · the unlock form is a form a password manager can fill: a username and a current-password field',
      dialog.formTag === 'FORM' && dialog.form === 'add-locked' && dialog.userForm === 'add-locked'
        && dialog.user && dialog.user.type === 'text' && dialog.user.name === 'username'
        && dialog.user.autocomplete === 'username' && dialog.user.readOnly === true && dialog.user.value === 'Alexander'
        && dialog.code && dialog.code.type === 'password' && dialog.code.name === 'password'
        && dialog.code.autocomplete === 'current-password',
      `both inside <${dialog.formTag} id=${dialog.form}>; username ${JSON.stringify(dialog.user)}; code ${JSON.stringify(dialog.code)}`);

    // A wrong code: said no to, kept out of the address, and not remembered.
    const before = await ctx.ev('location.href');
    const wrong = 'definitely-not-the-code-9f3a';
    await ctx.ev(`(() => {
      const code = document.getElementById('add-code');
      code.value = ${JSON.stringify(wrong)};
      code.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await ctx.click('#add-unlock');
    await ctx.wait(450);
    const refused = await ctx.ev(`(() => ({
      href: location.href,
      status: (document.getElementById('add-status').textContent || '').trim(),
      remembered: localStorage.getItem('shelf-edit-code'),
      urls: window.__worker.calls.map((call) => call.url),
      stillOpen: document.getElementById('add-dialog').open === true,
    }))()`);
    ctx.rec('stars · a wrong code is refused, and the code is not in the address, the calls or the console',
      refused.href === before && !refused.href.includes(wrong) && refused.status === 'That code was not accepted.'
        && refused.remembered === null && refused.stillOpen
        && !refused.urls.some((url) => url.includes(wrong))
        && !ctx.consoleErrors.some((line) => line.includes(wrong)),
      `address unchanged=${refused.href === before}, status "${refused.status}", remembered=${refused.remembered}, `
      + `${refused.urls.length} calls to the Worker, none carrying the code`);

    // The right one: the dialog closes and what was pressed while locked goes up.
    await ctx.ev(`(() => {
      const code = document.getElementById('add-code');
      code.value = ${JSON.stringify(CODE)};
      code.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await ctx.click('#add-unlock');
    await ctx.wait(900);
    const unlocked = await ctx.ev(`(() => ({
      open: document.getElementById('add-dialog').open === true,
      remembered: Boolean(localStorage.getItem('shelf-edit-code')),
      sent: window.__worker.calls.filter((call) => call.method === 'POST' && /\\/favorite$/.test(call.url) && call.right)
        .map((call) => call.body),
      href: location.href,
    }))()`);
    const sentIds = unlocked.sent.map((body) => body.id).sort();
    const pressedIds = [first.id, second.id, third.id].sort();
    ctx.rec('stars · unlocking from the toast closes the dialog and sends the Worker every star pressed while locked',
      unlocked.open === false && unlocked.remembered === true && unlocked.href === before
        && JSON.stringify(sentIds) === JSON.stringify(pressedIds),
      `dialog open=${unlocked.open}, code remembered=${unlocked.remembered}, `
      + `the Worker was sent ${sentIds.length} of the ${pressedIds.length} presses (${unlocked.sent.map((body) => `${body.id.slice(2, 8)}:${body.on}`).join(', ')})`);
  });
}

/** The same toast in Danish. */
async function lockedStarDanish(ctx) {
  await withScripts(ctx, [WORKER_STUB], async () => {
    await emptyBrowser(ctx, { lang: 'da' });
    await ctx.click(starSelector(1));
    await ctx.wait(350);
    const toast = await ctx.ev(TOAST);
    await ctx.click('#toast button');
    await ctx.wait(450);
    const title = await ctx.ev("(document.getElementById('add-dialog-title') || {}).textContent");
    const user = await ctx.ev("(document.getElementById('add-user') || {}).getAttribute && document.getElementById('add-user').getAttribute('aria-label')");
    ctx.rec('stars · the toast, its action and the unlock dialog are in Danish when the page is',
      toast.words === TEXT_DA && toast.action === 'Lås op' && title === 'Lås redigering op' && user === 'Brugernavn',
      `"${toast.words}" with the action "${toast.action}"; dialog "${title}", username field "${user}"`);
  });
}

/** On a phone the toast takes the room it needs and is not a tower of words. */
async function lockedStarOnAPhone(ctx) {
  await withScripts(ctx, [WORKER_STUB], async () => {
    await emptyBrowser(ctx, { width: 390, height: 844 });
    await ctx.click(starSelector(1));
    await ctx.wait(350);
    const toast = await ctx.ev(TOAST);
    const overflow = await ctx.ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1');
    ctx.rec('stars · at 390px the toast is two lines wide, inside the screen, and the page does not scroll sideways',
      toast.width >= 280 && toast.width <= 390 - 24 && toast.height <= 96 && overflow === true,
      `toast ${toast.width}×${toast.height}px on a 390px screen; no sideways scroll=${overflow}`);
  });
}

/** A browser that will not store anything must not be told that something was stored. */
async function storageRefused(ctx) {
  await ctx.goto(PAGE, { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: READY });
  await withScripts(ctx, [WORKER_STUB, STORAGE_REFUSED], async () => {
    await reload(ctx);
    const drawn = await ctx.ev("document.querySelectorAll('.collection li').length");
    const first = await ctx.ev(quoteAt(1));
    const countBefore = await ctx.ev("document.getElementById('favorites-count').textContent.trim()");
    await ctx.click(starSelector(1));
    await ctx.wait(500);
    const toast = await ctx.ev(TOAST);
    const after = await ctx.ev(quoteAt(1));
    const countAfter = await ctx.ev("document.getElementById('favorites-count').textContent.trim()");
    ctx.rec('stars · when the browser will not store anything, the page says so and does not claim it was saved',
      drawn > 0 && toast.visible === 'true' && toast.words === 'Could not save that on this device.'
        && toast.action === null && !toast.words.includes('Saved on this device')
        && after.pressed === first.pressed && countAfter === countBefore,
      `${drawn} quotes drawn; toast "${toast.words}", action ${toast.action}; star ${first.pressed} → ${after.pressed}; count ${countBefore || '(none)'} → ${countAfter || '(none)'}`);
  });
}

/** A bad link, folded away, must not leave the Add button dead and silent. */
async function foldedLink(ctx) {
  await withScripts(ctx, [WORKER_STUB], async () => {
    await emptyBrowser(ctx);
    await ctx.click('#controls-add');
    await ctx.wait(400);
    await ctx.ev(`(() => {
      const set = (id, value) => {
        const node = document.getElementById(id);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('add-text', 'A line typed to try the Add button with a link that is not one.');
      set('add-author', 'The Check');
      const more = document.getElementById('add-more');
      more.open = true;
      set('add-url', 'not-a-url');
      more.open = false;
      return true;
    })()`);
    const before = await ctx.ev("({ folded: document.getElementById('add-more').open === false, valid: document.getElementById('add-url').validity.valid })");
    await ctx.click('#add-save');
    await ctx.wait(450);
    const after = await ctx.ev(`(() => {
      const note = document.getElementById('add-problem-url');
      return {
        unfolded: document.getElementById('add-more').open === true,
        focus: document.activeElement && document.activeElement.id,
        shown: document.getElementById('add-url').getClientRects().length > 0,
        dialogOpen: document.getElementById('add-dialog').open === true,
        posts: window.__worker.calls.filter((call) => call.method === 'POST' && /\\/quote$/.test(call.url)).length,
        words: note.hidden ? null : note.textContent,
        wordsShown: note.getClientRects().length > 0,
      };
    })()`);
    const shot = await ctx.shot('index-add-bad-link');
    await ctx.ev(`(() => {
      const node = document.getElementById('add-url');
      node.value = 'https://example.org/essay';
      node.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const gone = await ctx.ev("document.getElementById('add-problem-url').hidden === true");
    ctx.rec('stars · a bad link inside the folded Source details unfolds them and points at the field',
      before.folded && before.valid === false && after.unfolded && after.focus === 'add-url' && after.shown
        && after.dialogOpen && after.posts === 0,
      `folded before=${before.folded}; after Add: unfolded=${after.unfolded}, focus on "${after.focus}", `
      + `field showing=${after.shown}, dialog open=${after.dialogOpen}, ${after.posts} quotes sent  ·  shot ${shot.split('/').slice(-2).join('/')}`);

    // iOS Safari shows no message of its own, so the words are on the page too.
    ctx.rec('stars · and it says so in words under the field, which go as soon as the field is edited',
      after.words === 'That is not a web address. It should start with https://.' && after.wordsShown && gone === true,
      `under the field: "${after.words}" (showing=${after.wordsShown}); hidden after an edit=${gone}`);
  });
}

/** A new work with a subject needs its year; a registered work, or no subject, does not. */
async function newWorkNeedsYear(ctx) {
  await withScripts(ctx, [WORKER_STUB], async () => {
    await emptyBrowser(ctx);
    await ctx.click('#controls-add');
    // The registry's titles arrive after the dialog opens; the rule waits for them.
    for (let i = 0; i < 60; i += 1) {
      const loaded = await ctx.ev("document.querySelectorAll('#add-works option').length");
      if (loaded > 0) break;
      await ctx.wait(100);
    }
    const registeredTitle = await ctx.ev("document.querySelector('#add-works option').value");

    const state = () => ctx.ev(`(() => {
      const year = document.getElementById('add-year');
      return {
        required: year.required,
        message: year.validationMessage,
        valid: document.getElementById('add-form').checkValidity(),
      };
    })()`);
    const fill = (work, subject, year) => ctx.ev(`(() => {
      const set = (id, value) => {
        const node = document.getElementById(id);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('add-text', 'A line typed to try the year rule on a work nobody has registered.');
      set('add-author', 'The Check');
      set('add-work', ${JSON.stringify(work)});
      set('add-subject', ${JSON.stringify(subject)});
      set('add-year', ${JSON.stringify(year)});
      return true;
    })()`);

    await fill('A Work Nobody Has Registered Yet', 'technology', '');
    const needed = await state();
    await ctx.click('#add-save');
    await ctx.wait(350);
    const stopped = await ctx.ev(`(() => {
      const note = document.getElementById('add-problem-year');
      return {
        focus: document.activeElement && document.activeElement.id,
        open: document.getElementById('add-dialog').open === true,
        words: note.hidden ? null : note.textContent,
        wordsShown: note.getClientRects().length > 0,
      };
    })()`);
    await fill('A Work Nobody Has Registered Yet', 'technology', '2020');
    const wordsGone = await ctx.ev("document.getElementById('add-problem-year').hidden === true");
    const typed = await state();
    await fill(registeredTitle, 'technology', '');
    const known = await state();
    await fill(registeredTitle.toUpperCase(), 'technology', '');
    const spelled = await state();
    await fill('A Work Nobody Has Registered Yet', '', '');
    const noSubject = await state();

    ctx.rec('stars · a new work with a subject needs its year, and the form says so at the field',
      needed.required && needed.valid === false && needed.message === 'A new work needs a year. Type it, or choose no subject.'
        && stopped.focus === 'add-year' && stopped.open,
      `new work + subject, no year: required=${needed.required}, form valid=${needed.valid}, `
      + `message "${needed.message}"; Add leaves the dialog open with focus on "${stopped.focus}"`);

    // iOS Safari shows no message of its own, so the words are on the page too.
    ctx.rec('stars · and it says so in words under the year, which go once a year is typed',
      stopped.words === 'A new work needs a year. Type it, or choose no subject.' && stopped.wordsShown && wordsGone === true,
      `under the year: "${stopped.words}" (showing=${stopped.wordsShown}); hidden once a year is typed=${wordsGone}`);

    ctx.rec('stars · with the year typed, a registered work (in any case) or no subject, the form goes through',
      typed.valid && !known.required && known.valid && !spelled.required && spelled.valid && !noSubject.required && noSubject.valid,
      `year typed: valid=${typed.valid}; "${registeredTitle}" registered: required=${known.required}; `
      + `in capitals: required=${spelled.required}; no subject: required=${noSubject.required}`);
  });
}

/** The shelf page's own unlock card is the same kind of form. */
async function shelfUnlockCard(ctx) {
  await ctx.goto('/works.html', { width: 1440, height: 1000, edition: 'paper', lang: 'en', waitFor: '.shelf, .book, .shelf-grid' });
  const card = await ctx.ev(`(() => {
    const form = document.getElementById('unlock-form');
    const user = document.getElementById('unlock-user');
    const code = document.getElementById('unlock-code');
    return {
      form: form ? form.tagName : null,
      sameForm: Boolean(form && user && code && user.form === form && code.form === form),
      user: user ? { type: user.type, name: user.name, autocomplete: user.autocomplete, readOnly: user.readOnly, value: user.value } : null,
      code: code ? { type: code.type, name: code.name, autocomplete: code.autocomplete } : null,
    };
  })()`);
  ctx.rec('stars · the shelf page\'s unlock card is a real form too, with a username and a current-password field',
    card.form === 'FORM' && card.sameForm
      && card.user && card.user.autocomplete === 'username' && card.user.readOnly === true && card.user.value === 'Alexander'
      && card.code && card.code.type === 'password' && card.code.name === 'password' && card.code.autocomplete === 'current-password',
    `<${card.form}>; username ${JSON.stringify(card.user)}; code ${JSON.stringify(card.code)}`);
}

export async function run(ctx) {
  await lockedStar(ctx);
  await lockedStarDanish(ctx);
  await lockedStarOnAPhone(ctx);
  await storageRefused(ctx);
  await foldedLink(ctx);
  await newWorkNeedsYear(ctx);
  await shelfUnlockCard(ctx);
}
