/**
 * Adding a quote without opening GitHub.
 *
 * For two years the only way into the collection was a prefilled issue form:
 * honest, auditable, and slow enough that lines went unkept. This is the other
 * door. It answers the `quotes:add` event the shared header dispatches, opens a
 * dialog on the page he is already reading, and sends the quote to the Worker,
 * which holds it until the scheduled sync folds it into `data/quotes.json`.
 *
 * Three things it refuses to do.
 *
 * It never pretends. `addQuote()` does not queue when the network is gone —
 * unlike a rating, a filed quote has nowhere local to live, and one that looked
 * saved would be one cleared browser away from lost. So a failure keeps the
 * words in the form and says what happened.
 *
 * It never replaces the old door. When editing is locked, or nobody has set an
 * edit key yet, the dialog offers the unlock field *and* a link to the GitHub
 * issue carrying everything already typed, so no draft is ever a dead end.
 *
 * It never owns the list. Saving hands the quote to `store.js`, which tells
 * `app.js`, which merges it. This file knows about a form and nothing else.
 */

import { hydrate, onLang, register, t } from './i18n.js';
import { addQuote, isUnlocked, unlock } from './store.js';

const REPO = 'https://github.com/abustrup/Quote-collection';
const WORKS_URL = 'data/works.json';

register({
  'add.title': { en: 'Add a quote', da: 'Tilføj et citat' },
  'add.intro': {
    en: 'It appears in the collection at once and joins data/quotes.json at the next sync.',
    da: 'Det vises i samlingen med det samme og lander i data/quotes.json ved næste synkronisering.',
  },
  'add.text': { en: 'The quote', da: 'Citatet' },
  'add.text.placeholder': { en: 'The words, as they were written.', da: 'Ordene, som de blev skrevet.' },
  'add.author': { en: 'Author', da: 'Forfatter' },
  'add.work': { en: 'Work', da: 'Værk' },
  'add.work.hint': { en: 'A book, essay, talk or interview. Leave it empty if there is none.', da: 'En bog, et essay, et foredrag eller et interview. Lad feltet stå tomt hvis der ikke er et.' },
  'add.year': { en: 'Year', da: 'År' },
  'add.note': { en: 'Note', da: 'Note' },
  'add.note.placeholder': { en: 'Why this one is worth keeping.', da: 'Hvorfor denne er værd at gemme.' },
  'add.tags': { en: 'Tags', da: 'Tags' },
  'add.tags.hint': { en: 'Separated by commas.', da: 'Adskilt af kommaer.' },
  'add.save': { en: 'Add it', da: 'Tilføj' },
  'add.saving': { en: 'Adding…', da: 'Tilføjer…' },
  'add.cancel': { en: 'Cancel', da: 'Annullér' },
  'add.saved': { en: 'Added. It is at the top of the collection.', da: 'Tilføjet. Det ligger øverst i samlingen.' },

  'add.locked.title': { en: 'Editing is locked on this device', da: 'Redigering er låst på denne enhed' },
  'add.locked.body': {
    en: 'Enter the edit code to add quotes from here. It lives in the owner’s .env file as EDIT_KEY.',
    da: 'Indtast redigeringskoden for at tilføje citater herfra. Den ligger i ejerens .env-fil som EDIT_KEY.',
  },
  'add.locked.wrong': { en: 'That code was not accepted.', da: 'Den kode blev ikke accepteret.' },
  'add.locked.ok': { en: 'Unlocked on this device.', da: 'Låst op på denne enhed.' },
  'add.github': { en: 'Open the GitHub form instead', da: 'Åbn GitHub-formularen i stedet' },
  'add.github.note': {
    en: 'The GitHub issue works whether or not this device can write, and carries whatever you have typed.',
    da: 'GitHub-sagen virker uanset om denne enhed kan skrive, og tager det du har skrevet med.',
  },

  'add.error.unconfigured': {
    en: 'Editing is not set up yet, so the quote cannot be sent from here.',
    da: 'Redigering er ikke slået til endnu, så citatet kan ikke sendes herfra.',
  },
  'add.error.offline': {
    en: 'Could not reach the collection service. Your words are still here — try again, or use the GitHub form.',
    da: 'Kunne ikke nå samlingens tjeneste. Dine ord står her endnu – prøv igen, eller brug GitHub-formularen.',
  },
  'add.error.failed': {
    en: 'The service refused the quote. Your words are still here.',
    da: 'Tjenesten afviste citatet. Dine ord står her endnu.',
  },
});

let dialog = null;
let form = null;
let titles = null;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child != null) node.append(child);
  return node;
};

function toast(message) {
  const bar = document.getElementById('toast');
  if (!bar) return;
  bar.textContent = message;
  bar.dataset.visible = 'true';
  setTimeout(() => { bar.dataset.visible = 'false'; }, 2600);
}

/**
 * The GitHub issue, carrying whatever has been typed.
 *
 * Rebuilt on every keystroke rather than at click time because the link is a
 * real link: middle-click, long-press and "open in new tab" all have to work,
 * and none of them run a click handler.
 */
function githubUrl() {
  const values = readForm();
  const params = new URLSearchParams({ template: 'add-quote.yml' });
  if (values.text) params.set('text', values.text);
  if (values.author) params.set('author', values.author);
  if (values.work) params.set('work', values.work);
  if (values.year) params.set('year', String(values.year));
  if (values.note) params.set('note', values.note);
  if (values.tags.length) params.set('tags', values.tags.join(', '));
  return `${REPO}/issues/new?${params}`;
}

function readForm() {
  const data = new FormData(form);
  const get = (name) => String(data.get(name) ?? '').trim();
  const year = get('year');
  return {
    text: get('text'),
    author: get('author'),
    work: get('work'),
    note: get('note'),
    year: year ? Number(year) : null,
    tags: get('tags').split(',').map((tag) => tag.trim()).filter(Boolean),
  };
}

/** The registry's titles, so the work field completes rather than invents. */
async function loadTitles() {
  if (titles) return titles;
  try {
    const response = await fetch(WORKS_URL, { cache: 'no-cache' });
    const registry = response.ok ? await response.json() : { works: [] };
    titles = (registry.works ?? [])
      .map((work) => work.title)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch {
    titles = [];
  }
  const list = dialog?.querySelector('#add-works');
  if (list) list.replaceChildren(...titles.map((title) => el('option', { value: title })));
  return titles;
}

function field(id, labelId, control, hintId) {
  return el(
    'p',
    { className: 'add-field' },
    el('label', { htmlFor: id, className: 'add-label' }, Object.assign(
      document.createElement('span'),
      { textContent: t(labelId) },
    )),
    control,
    hintId ? el('span', { className: 'add-hint', textContent: t(hintId) }) : null,
  );
}

function build() {
  const text = el('textarea', {
    id: 'add-text', name: 'text', rows: 4, required: true, spellcheck: true,
  });
  text.setAttribute('data-i18n-placeholder', 'add.text.placeholder');

  const author = el('input', { id: 'add-author', name: 'author', type: 'text', required: true, autocomplete: 'off' });
  const work = el('input', { id: 'add-work', name: 'work', type: 'text', autocomplete: 'off' });
  work.setAttribute('list', 'add-works');
  const year = el('input', { id: 'add-year', name: 'year', type: 'number', min: '-800', max: '2100', inputMode: 'numeric' });
  const note = el('textarea', { id: 'add-note', name: 'note', rows: 2 });
  note.setAttribute('data-i18n-placeholder', 'add.note.placeholder');
  const tags = el('input', { id: 'add-tags', name: 'tags', type: 'text', autocomplete: 'off' });

  const works = el('datalist', { id: 'add-works' });

  const status = el('p', { className: 'add-status', id: 'add-status', role: 'status', hidden: true });
  status.setAttribute('aria-live', 'polite');

  const code = el('input', { id: 'add-code', name: 'code', type: 'password', autocomplete: 'off' });
  code.setAttribute('data-i18n-placeholder', 'edit.code.placeholder');
  const unlockButton = el('button', { className: 'pill', type: 'button', id: 'add-unlock', textContent: t('edit.unlock') });
  const github = el('a', {
    className: 'add-github', id: 'add-github', href: `${REPO}/issues/new?template=add-quote.yml`,
    target: '_blank', rel: 'noopener', textContent: t('add.github'),
  });

  const locked = el(
    'div',
    { className: 'add-locked', id: 'add-locked' },
    el('p', { className: 'add-locked-title', textContent: t('add.locked.title') }),
    el('p', { className: 'add-locked-body', textContent: t('add.locked.body') }),
    el('div', { className: 'add-unlock-row' }, code, unlockButton),
    el('p', { className: 'add-fallback' }, github, el('span', { className: 'add-hint', textContent: t('add.github.note') })),
  );

  const save = el('button', { className: 'pill pill-primary', type: 'submit', id: 'add-save', textContent: t('add.save') });
  const cancel = el('button', { className: 'pill', type: 'button', id: 'add-cancel', textContent: t('add.cancel') });

  // The fields scroll, the buttons do not: on a 1000px screen the form is
  // taller than the dialog is allowed to be, and a Save button below the fold
  // of a modal is a button nobody finds.
  const body = el(
    'div',
    { className: 'add-body' },
    // Locked first, and the status with it: whether this device can save at
    // all is the thing to know before typing four fields, and the GitHub
    // fallback should not be a scroll away from the words it would carry.
    locked,
    status,
    field('add-text', 'add.text', text),
    el(
      'div',
      { className: 'add-pair' },
      field('add-author', 'add.author', author),
      field('add-year', 'add.year', year),
    ),
    field('add-work', 'add.work', work, 'add.work.hint'),
    field('add-note', 'add.note', note),
    field('add-tags', 'add.tags', tags, 'add.tags.hint'),
    works,
  );

  form = el(
    'form',
    { className: 'add-form', id: 'add-form', noValidate: false },
    body,
    el('div', { className: 'add-actions' }, cancel, save),
  );

  dialog = el(
    'dialog',
    { className: 'add-dialog', id: 'add-dialog' },
    el(
      'div',
      { className: 'add-head' },
      el('h2', { className: 'add-title', id: 'add-dialog-title', textContent: t('add.title') }),
      el('p', { className: 'add-intro', textContent: t('add.intro') }),
    ),
    form,
  );
  dialog.setAttribute('aria-labelledby', 'add-dialog-title');

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', onSubmit);
  form.addEventListener('input', () => { github.href = githubUrl(); });
  unlockButton.addEventListener('click', () => onUnlock(code, status));

  // The scrim is the dialog's own backdrop, so a click that lands on the
  // dialog element itself and not on its contents is a click outside.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.body.append(dialog);
  onLang(() => relabel());
  relabel();
  return dialog;
}

/** Every word in the dialog, after a language change. */
function relabel() {
  if (!dialog) return;
  const set = (selector, value) => {
    const node = dialog.querySelector(selector);
    if (node) node.textContent = value;
  };
  set('#add-dialog-title', t('add.title'));
  set('.add-intro', t('add.intro'));
  set('#add-save', t('add.save'));
  set('#add-cancel', t('add.cancel'));
  set('#add-unlock', t('edit.unlock'));
  set('#add-github', t('add.github'));
  set('.add-locked-title', t('add.locked.title'));
  set('.add-locked-body', t('add.locked.body'));

  const labels = [
    ['add-text', 'add.text'], ['add-author', 'add.author'], ['add-work', 'add.work'],
    ['add-year', 'add.year'], ['add-note', 'add.note'], ['add-tags', 'add.tags'],
  ];
  for (const [id, key] of labels) {
    const label = dialog.querySelector(`label[for="${id}"] span`);
    if (label) label.textContent = t(key);
  }
  const hints = dialog.querySelectorAll('.add-field .add-hint');
  if (hints[0]) hints[0].textContent = t('add.work.hint');
  if (hints[1]) hints[1].textContent = t('add.tags.hint');
  const fallbackHint = dialog.querySelector('.add-fallback .add-hint');
  if (fallbackHint) fallbackHint.textContent = t('add.github.note');
  hydrate(dialog);
}

function showLocked(on) {
  const locked = dialog?.querySelector('#add-locked');
  if (locked) locked.hidden = !on;
}

function say(message, tone = 'note') {
  const status = dialog?.querySelector('#add-status');
  if (!status) return;
  status.textContent = message ?? '';
  status.dataset.tone = tone;
  status.hidden = !message;
  // The fields scroll, so a message at the top of the form can be off-screen
  // at the moment it matters most: right after a save that did not happen.
  if (message) status.scrollIntoView({ block: 'nearest' });
}

async function onUnlock(code, status) {
  const value = code.value.trim();
  if (!value) return;
  try {
    const ok = await unlock(value);
    if (ok) {
      code.value = '';
      showLocked(false);
      say(t('add.locked.ok'), 'good');
    } else {
      say(t('add.locked.wrong'), 'bad');
    }
  } catch (error) {
    say(t(error?.code === 'unconfigured' ? 'add.error.unconfigured' : 'add.error.offline'), 'bad');
  }
  void status;
}

async function onSubmit(event) {
  event.preventDefault();
  const save = dialog.querySelector('#add-save');
  const values = readForm();
  if (!values.text || !values.author) return;

  save.disabled = true;
  save.textContent = t('add.saving');
  say('');
  try {
    await addQuote({
      text: values.text,
      author: values.author,
      work: values.work || undefined,
      note: values.note || undefined,
      year: values.year ?? undefined,
      tags: values.tags,
    });
    form.reset();
    dialog.close();
    toast(t('add.saved'));
  } catch (error) {
    const code = error?.code;
    if (code === 'locked') {
      showLocked(true);
      say(t('add.locked.body'), 'bad');
      dialog.querySelector('#add-code')?.focus();
    } else if (code === 'unconfigured') {
      showLocked(true);
      say(t('add.error.unconfigured'), 'bad');
    } else if (code === 'offline') {
      // No locked panel here. The device is unlocked; the network is not there.
      // Revealing "editing is locked on this device" beside "could not reach
      // the service" tells him two different stories about one failure, and
      // offers him a code field that would not have helped.
      say(t('add.error.offline'), 'bad');
    } else {
      say(t('add.error.failed'), 'bad');
    }
  } finally {
    save.disabled = false;
    save.textContent = t('add.save');
  }
}

function open() {
  if (!dialog) build();
  showLocked(!isUnlocked());
  say('');
  const github = dialog.querySelector('#add-github');
  if (github) github.href = githubUrl();
  loadTitles();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  dialog.querySelector('#add-text')?.focus();
}

/**
 * The header's "+ Add" dispatches this and falls back to GitHub when nobody
 * answers, so answering it *is* the handshake. preventDefault has to happen
 * synchronously, before anything is awaited.
 */
document.addEventListener('quotes:add', (event) => {
  event.preventDefault();
  open();
});

export { open };
