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
 *
 * Added on 2026-11-15, all of it in this one dialog so there is still only one
 * place that unlocks editing:
 *
 *   - The unlock panel is a real form, with the username "Alexander" beside the
 *     code field (`autocomplete="username"` and `"current-password"`), so a
 *     password manager such as iCloud Keychain can store the code once and fill
 *     it on every device. The code is never printed, logged or put in a URL.
 *   - The page can open this dialog on its own for unlocking alone, by
 *     dispatching `quotes:unlock`. That is what the "Unlock" on the favourites
 *     toast does. The quote fields are hidden in that mode.
 *   - A Subject, and optional source details (link, place in it, kind of work),
 *     which go to the Worker's richer intake.
 *   - A link such as `?add=1&text=…&author=…` opens the dialog filled in. The
 *     address is read by `add-prefill.js`; this file only sets the values.
 *
 * The quote fields sit outside the dialog's `<form>` elements in the markup and
 * belong to the add form through their `form` attribute. That is what lets the
 * unlock panel be a form of its own (a form inside a form is not allowed) while
 * still scrolling with the fields, as it always has.
 */

import { SUBJECTS, WORK_KINDS, canonicalWork, slug } from './quote-core.js';
import { hydrate, onLang, register, t } from './i18n.js';
import { takePrefill } from './add-prefill.js';
import { addQuote, isUnlocked, unlock } from './store.js';

const REPO = 'https://github.com/abustrup/Quote-collection';
const WORKS_URL = 'data/works.json';
const SUBJECT_KEY = 'quotes-add-subject';
const OWNER = 'Alexander';

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
    en: 'Could not reach the collection service. Your words are still here. Try again, or use the GitHub form.',
    da: 'Kunne ikke nå samlingens tjeneste. Dine ord står her endnu – prøv igen, eller brug GitHub-formularen.',
  },
  'add.error.failed': {
    en: 'The service refused the quote. Your words are still here.',
    da: 'Tjenesten afviste citatet. Dine ord står her endnu.',
  },

  // The subject lives on the work, so it only matters when the work is new.
  'add.subject': { en: 'Subject', da: 'Emne' },
  'add.subject.none': { en: 'None', da: 'Intet' },
  'add.subject.hint': {
    en: 'Needed only when the work is new to the shelf. A new work also needs its year.',
    da: 'Kun nødvendigt hvis værket er nyt på hylden. Et nyt værk skal også have et år.',
  },
  // Shown by the browser when the form is sent without it: a work the shelf has
  // never heard of is registered with its year, or not at all.
  'add.year.needed': {
    en: 'A new work needs a year. Type it, or choose no subject.',
    da: 'Et nyt værk skal have et år. Skriv det, eller vælg intet emne.',
  },
  'add.url.invalid': {
    en: 'That is not a web address. It should start with https://.',
    da: 'Det er ikke en webadresse. Den skal starte med https://.',
  },

  'add.more': { en: 'Source details', da: 'Kildedetaljer' },
  'add.url': { en: 'Link', da: 'Link' },
  'add.url.hint': {
    en: 'Where it can be read or watched. A time in the link is fine.',
    da: 'Hvor det kan læses eller ses. Et tidspunkt i linket er fint.',
  },
  'add.locator': { en: 'Where in it', da: 'Hvor i værket' },
  'add.locator.hint': { en: 'A time, a page or a chapter.', da: 'Et tidspunkt, en side eller et kapitel.' },
  'add.kind': { en: 'Kind of work', da: 'Slags værk' },
  'add.kind.none': { en: 'Not sure', da: 'Ikke sikker' },
  'add.kind.book': { en: 'Book', da: 'Bog' },
  'add.kind.essay': { en: 'Essay', da: 'Essay' },
  'add.kind.paper': { en: 'Paper', da: 'Artikel' },
  'add.kind.speech': { en: 'Speech', da: 'Tale' },
  'add.kind.interview': { en: 'Interview', da: 'Interview' },
  'add.kind.film': { en: 'Film', da: 'Film' },
  'add.kind.poem': { en: 'Poem', da: 'Digt' },
  'add.kind.letter': { en: 'Letter', da: 'Brev' },
  'add.kind.document': { en: 'Document', da: 'Dokument' },
  'add.kind.song': { en: 'Song', da: 'Sang' },
  'add.kind.other': { en: 'Other', da: 'Andet' },

  'add.user': { en: 'Username', da: 'Brugernavn' },
  'add.unlock.title': { en: 'Unlock editing', da: 'Lås redigering op' },
  'add.unlock.intro': {
    en: 'Enter the edit code to keep your favourites on every device. Your phone can remember it for next time.',
    da: 'Indtast redigeringskoden for at beholde dine favoritter på alle enheder. Din telefon kan huske den til næste gang.',
  },
});

let dialog = null;
let form = null;       // the empty <form> that owns the quote fields, see build()
let titles = null;
let registered = null; // the registry's titles and their slugs, lower-cased; null until it has loaded
let mode = 'add';      // 'add', or 'unlock' when opened only to unlock editing

/**
 * The few rules the dialog needs that `app.css` does not have.
 *
 * Kept with the markup that uses them on purpose: the page's stylesheet is
 * being reworked by somebody else, and a dialog that carries its own styles
 * cannot be broken by that. Everything here uses the page's own colour and type
 * variables, so all four editions come along.
 */
const STYLES = `
.add-dialog [hidden] { display: none !important; }
.add-field select {
  display: block;
  width: 100%;
  min-height: 40px;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background-color: var(--surface);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 0.98rem;
  line-height: 1.45;
}
.add-field select:focus-visible {
  outline: none;
  border-color: var(--gold);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--gold) 30%, transparent);
}
.add-more { margin: 0 0 0.9rem; }
.add-more-summary {
  margin: 0 0 0.7rem;
  color: var(--muted);
  font-family: var(--font-label);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  cursor: pointer;
}
.add-unlock-row input[readonly] { color: var(--muted); }
/* The words under a field the browser refused to send. Chrome shows its own
   bubble; Safari can show nothing and only move the cursor to the field, and it
   scrolls the field to the top of what is left above the keyboard, so what sits
   under the field is what stays in view. */
.add-problem { margin: -0.5rem 0 0.9rem; color: var(--accent-ink); font-size: 0.78rem; }
.add-unlock-row .pill { flex: 0 0 auto; }
/* iOS Safari zooms the page when a field under 16px gets focus, and leaves it
   zoomed with the dialog cut off at the edge. This was seen on the unlock code
   field, which is 13.6px. A phone gets 16px fields. */
@media (pointer: coarse) {
  dialog.add-dialog input,
  dialog.add-dialog textarea,
  dialog.add-dialog select { font-size: 16px; }
}
`;

function ensureStyles() {
  if (document.getElementById('add-quote-styles')) return;
  const style = document.createElement('style');
  style.id = 'add-quote-styles';
  style.textContent = STYLES;
  document.head.append(style);
}

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
  // The issue form's own field ids. A dropdown only takes a value that is one
  // of its options, which `kind` always is.
  if (values.kind) params.set('work-kind', values.kind);
  if (values.url) params.set('source-url', values.url);
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
    subject: get('subject'),
    url: get('url'),
    locator: get('locator'),
    kind: get('kind'),
  };
}

/** The registry's titles, so the work field completes rather than invents. */
async function loadTitles() {
  if (titles) return titles;
  try {
    const response = await fetch(WORKS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const registry = await response.json();
    titles = (registry.works ?? [])
      .map((work) => work.title)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'));
    // Both spellings the sync matches on: the title itself, and its slug, which
    // is how the page tells works apart.
    registered = new Set(titles.flatMap((title) => [title.trim().toLowerCase(), slug(title)]).filter(Boolean));
  } catch {
    titles = [];
    registered = null;
  }
  const list = dialog?.querySelector('#add-works');
  if (list) list.replaceChildren(...titles.map((title) => el('option', { value: title })));
  syncYearRule();
  return titles;
}

/**
 * True for a work the shelf does not have yet. False when the registry did not
 * load, because then there is nothing to say it is new and the form must not
 * guess: the sync decides in the end, from the same two spellings.
 */
function isNewWork(value) {
  if (!registered) return false;
  const named = canonicalWork(value);
  if (!named) return false;
  return !registered.has(named.toLowerCase()) && !registered.has(slug(named));
}

/**
 * A new work with a subject needs its year.
 *
 * The subject lives on the work, so a new work is registered with it, and the
 * registry holds a year for every work: the era filter needs it, the
 * repository's own test checks it, and without one the sync leaves the work
 * unregistered and the quote outside every subject filter. The last subject is
 * remembered and pre-selected, so this comes up more often than it would by
 * chance; "choose no subject" is the way out for someone who does not know the
 * year. The browser shows the message at the field when the form is sent.
 */
function syncYearRule() {
  const year = dialog?.querySelector('#add-year');
  if (!year) return;
  const subject = dialog.querySelector('#add-subject')?.value ?? '';
  const work = dialog.querySelector('#add-work')?.value ?? '';
  const needed = Boolean(subject) && isNewWork(work);
  year.required = needed;
  year.setCustomValidity(needed && year.value === '' ? t('add.year.needed') : '');
}

/**
 * A label, a control and an optional hint. The words are marked for
 * `hydrate()`, so a language change rewrites them without this file listing
 * every one.
 */
function field(id, labelId, control, hintId) {
  const label = el('span', { textContent: t(labelId) });
  label.setAttribute('data-i18n', labelId);
  const hint = hintId ? el('span', { className: 'add-hint', textContent: t(hintId) }) : null;
  hint?.setAttribute('data-i18n', hintId);
  return el(
    'p',
    { className: 'add-field' },
    el('label', { htmlFor: id, className: 'add-label' }, label),
    control,
    hint,
  );
}

/** An empty note for a field's problem, placed under the field. Shown by `showProblem`, hidden again by the next edit. */
function problem(id) {
  return el('p', { className: 'add-hint add-problem', id, role: 'status', hidden: true });
}

/**
 * Say, in words under the field, what the browser refused to send. Chrome shows
 * a bubble of its own, in the browser's language. Safari does not always: for
 * the year rule, which is a message of our own, it only moved the cursor to the
 * field and showed nothing (iPhone simulator, 2026-11-16), which reads as a
 * button that does nothing. So the words are put on the page as well.
 */
function showProblem(control) {
  let words = '';
  if (control.id === 'add-url') words = t('add.url.invalid');
  // Only the year this form asked for. A year out of range has its own native message.
  else if (control.id === 'add-year' && control.validity.customError) words = t('add.year.needed');
  const note = words && dialog.querySelector(`#add-problem-${control.id.replace(/^add-/, '')}`);
  if (!note) return;
  note.textContent = words;
  note.hidden = false;
}

function hideProblems() {
  for (const note of dialog?.querySelectorAll('.add-problem') ?? []) note.hidden = true;
}

/** A `<select>` with a first option for "nothing chosen", then one per id. */
function menu(id, noneKey, ids, labelOf) {
  const select = el('select', { id, name: id.replace(/^add-/, '') });
  select.append(new Option(t(noneKey), ''), ...ids.map((value) => new Option(labelOf(value), value)));
  select.dataset.none = noneKey;
  return select;
}

/** The subject and kind menus carry words that change with the language. */
function relabelMenu(select, labelOf) {
  if (!select) return;
  const [none, ...rest] = select.options;
  none.textContent = t(select.dataset.none);
  for (const option of rest) option.textContent = labelOf(option.value);
}

const subjectLabel = (id) => t(`shelf.subject.${id}`);
const kindLabel = (id) => t(`add.kind.${id}`);

/** The last subject chosen, or none. Storage may be off, and the dialog works without it. */
function rememberedSubject() {
  try {
    const value = localStorage.getItem(SUBJECT_KEY);
    return SUBJECTS.includes(value) ? value : '';
  } catch {
    return '';
  }
}

function rememberSubject(value) {
  try {
    if (value) localStorage.setItem(SUBJECT_KEY, value);
    else localStorage.removeItem(SUBJECT_KEY);
  } catch { /* nothing to remember it with */ }
}

function build() {
  ensureStyles();

  const text = el('textarea', {
    id: 'add-text', name: 'text', rows: 4, required: true, spellcheck: true, maxLength: 4000,
  });
  text.setAttribute('data-i18n-placeholder', 'add.text.placeholder');

  const author = el('input', { id: 'add-author', name: 'author', type: 'text', required: true, autocomplete: 'off', maxLength: 200 });
  const work = el('input', { id: 'add-work', name: 'work', type: 'text', autocomplete: 'off', maxLength: 300 });
  work.setAttribute('list', 'add-works');
  const year = el('input', { id: 'add-year', name: 'year', type: 'number', min: '-800', max: '2100', inputMode: 'numeric' });
  const subject = menu('add-subject', 'add.subject.none', SUBJECTS, subjectLabel);
  const note = el('textarea', { id: 'add-note', name: 'note', rows: 2, maxLength: 2000 });
  note.setAttribute('data-i18n-placeholder', 'add.note.placeholder');
  const tags = el('input', { id: 'add-tags', name: 'tags', type: 'text', autocomplete: 'off' });

  // Where it came from. Tucked away until it is wanted, or until a link
  // arrives that carries them.
  const url = el('input', {
    id: 'add-url', name: 'url', type: 'url', autocomplete: 'off', inputMode: 'url', maxLength: 500, placeholder: 'https://',
  });
  url.setAttribute('pattern', 'https://\\S+');
  const locator = el('input', { id: 'add-locator', name: 'locator', type: 'text', autocomplete: 'off', maxLength: 200 });
  const kind = menu('add-kind', 'add.kind.none', WORK_KINDS, kindLabel);

  const works = el('datalist', { id: 'add-works' });

  const status = el('p', { className: 'add-status', id: 'add-status', role: 'status', hidden: true });
  status.setAttribute('aria-live', 'polite');

  // The unlock panel is a form of its own, with a username next to the code, so
  // a password manager sees an ordinary sign-in and can keep the code for every
  // device. The name is shown and cannot be edited: it is only there to give
  // the saved entry something to be called.
  const user = el('input', {
    id: 'add-user', name: 'username', type: 'text', value: OWNER, readOnly: true, autocomplete: 'username',
  });
  user.setAttribute('data-i18n-aria', 'add.user');
  const code = el('input', {
    id: 'add-code', name: 'password', type: 'password', autocomplete: 'current-password', autocapitalize: 'off', spellcheck: false,
  });
  code.setAttribute('data-i18n-placeholder', 'edit.code.placeholder');
  code.setAttribute('data-i18n-aria', 'edit.code.placeholder');
  const unlockButton = el('button', { className: 'pill', type: 'submit', id: 'add-unlock', textContent: t('edit.unlock') });
  const closeUnlock = el('button', { className: 'pill', type: 'button', id: 'add-unlock-close', textContent: t('ui.close'), hidden: true });
  const github = el('a', {
    className: 'add-github', id: 'add-github', href: `${REPO}/issues/new?template=add-quote.yml`,
    target: '_blank', rel: 'noopener', textContent: t('add.github'),
  });
  github.setAttribute('data-i18n', 'add.github');
  const githubNote = el('span', { className: 'add-hint', textContent: t('add.github.note') });
  githubNote.setAttribute('data-i18n', 'add.github.note');

  const locked = el(
    'form',
    { className: 'add-locked', id: 'add-locked' },
    el('p', { className: 'add-locked-title', textContent: t('add.locked.title') }),
    el('p', { className: 'add-locked-body', textContent: t('add.locked.body') }),
    el('div', { className: 'add-unlock-row' }, user, code, unlockButton, closeUnlock),
    el('p', { className: 'add-fallback' }, github, githubNote),
  );
  locked.setAttribute('autocomplete', 'on');

  const save = el('button', { className: 'pill pill-primary', type: 'submit', id: 'add-save', textContent: t('add.save') });
  const cancel = el('button', { className: 'pill', type: 'button', id: 'add-cancel', textContent: t('add.cancel') });

  const more = el(
    'details',
    { className: 'add-more', id: 'add-more' },
    el('summary', { className: 'add-more-summary', textContent: t('add.more') }),
    field('add-url', 'add.url', url, 'add.url.hint'),
    problem('add-problem-url'),
    field('add-locator', 'add.locator', locator, 'add.locator.hint'),
    field('add-kind', 'add.kind', kind),
  );

  const fields = el(
    'div',
    { className: 'add-fields', id: 'add-fields' },
    field('add-text', 'add.text', text),
    el(
      'div',
      { className: 'add-pair' },
      field('add-author', 'add.author', author),
      field('add-year', 'add.year', year),
    ),
    problem('add-problem-year'),
    field('add-work', 'add.work', work, 'add.work.hint'),
    field('add-subject', 'add.subject', subject, 'add.subject.hint'),
    field('add-note', 'add.note', note),
    field('add-tags', 'add.tags', tags, 'add.tags.hint'),
    more,
    works,
  );

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
    fields,
  );

  // The form that files the quote is empty. Its fields and its Save button are
  // in the markup above and belong to it by their `form` attribute, which is
  // what leaves the unlock panel free to be a form of its own.
  form = el('form', { id: 'add-form', hidden: true });
  for (const control of [text, author, year, subject, work, note, tags, url, locator, kind, save]) {
    control.setAttribute('form', 'add-form');
  }

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
    el(
      'div',
      { className: 'add-form' },
      body,
      el('div', { className: 'add-actions', id: 'add-actions' }, cancel, save),
    ),
  );
  dialog.setAttribute('aria-labelledby', 'add-dialog-title');

  cancel.addEventListener('click', () => dialog.close());
  closeUnlock.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', onSubmit);
  locked.addEventListener('submit', onUnlock);
  // The fields are not inside the form, so their events do not pass through
  // it: listen on the dialog instead.
  const sync = () => {
    github.href = githubUrl();
    syncYearRule();
    hideProblems();
  };
  fields.addEventListener('input', sync);
  fields.addEventListener('change', sync);
  subject.addEventListener('change', () => rememberSubject(subject.value));
  // A link that is not a link, typed into the folded "Source details" and then
  // folded away again, makes the browser refuse to send the form and then fail
  // to point at the field: it cannot focus a control inside a closed <details>,
  // so nothing happens and nothing is said. `invalid` does not bubble but it
  // does travel down to the field, so the dialog hears it first, in the capture
  // phase, and unfolds the part that holds the field before the browser looks.
  dialog.addEventListener('invalid', (event) => {
    const more = dialog.querySelector('#add-more');
    if (more && !more.open && more.contains(event.target)) {
      more.open = true;
      // Safari looks for a field to point at straight after this event and, with
      // the part that holds it only just opened, gives up: the section unfolds
      // but nothing is focused and no message shows (seen in the iPhone
      // simulator on 2026-11-16). Focusing the field here, once it can take
      // focus, is what makes Safari point at it.
      event.target.focus();
    }
    showProblem(event.target);
  }, true);
  dialog.addEventListener('close', () => { code.value = ''; });

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

/**
 * What the dialog is for right now. Opened to add a quote it shows the fields;
 * opened only to unlock it shows the unlock panel by itself, with a title that
 * says so and a Close button, since there is no Cancel without the fields.
 */
function applyMode() {
  if (!dialog) return;
  const only = mode === 'unlock';
  const set = (selector, value) => {
    const node = dialog.querySelector(selector);
    if (node) node.textContent = value;
  };
  const hide = (selector, hidden) => {
    const node = dialog.querySelector(selector);
    if (node) node.hidden = hidden;
  };
  set('#add-dialog-title', t(only ? 'add.unlock.title' : 'add.title'));
  set('.add-intro', t(only ? 'add.unlock.intro' : 'add.intro'));
  hide('#add-fields', only);
  hide('#add-actions', only);
  hide('.add-locked-title', only);
  hide('.add-locked-body', only);
  hide('.add-fallback', only);
  hide('#add-unlock-close', !only);
}

/** Every word in the dialog, after a language change. */
function relabel() {
  if (!dialog) return;
  const set = (selector, value) => {
    const node = dialog.querySelector(selector);
    if (node) node.textContent = value;
  };
  applyMode();
  set('#add-save', t('add.save'));
  set('#add-cancel', t('add.cancel'));
  set('#add-unlock', t('edit.unlock'));
  set('#add-unlock-close', t('ui.close'));
  set('.add-locked-title', t('add.locked.title'));
  set('.add-locked-body', t('add.locked.body'));
  set('.add-more-summary', t('add.more'));
  relabelMenu(dialog.querySelector('#add-subject'), subjectLabel);
  relabelMenu(dialog.querySelector('#add-kind'), kindLabel);
  syncYearRule();
  // Labels, hints, placeholders and the GitHub link carry `data-i18n*`.
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

/**
 * The unlock form was submitted, by the button or by Enter in the code field.
 *
 * The code goes to `store.unlock()` and nowhere else: not into a message, not
 * into the console, not into the address. It stays in the field until the
 * dialog closes, so a password manager that looks at the form after it is
 * hidden still finds what was sent; `close` empties it.
 */
async function onUnlock(event) {
  event.preventDefault();
  const code = dialog.querySelector('#add-code');
  const button = dialog.querySelector('#add-unlock');
  const value = code.value.trim();
  if (!value) {
    code.focus();
    return;
  }
  button.disabled = true;
  try {
    const ok = await unlock(value);
    if (ok) {
      showLocked(false);
      if (mode === 'unlock') {
        dialog.close();
        toast(t('add.locked.ok'));
      } else {
        say(t('add.locked.ok'), 'good');
      }
    } else {
      say(t('add.locked.wrong'), 'bad');
      code.select();
    }
  } catch (error) {
    say(t(error?.code === 'unconfigured' ? 'add.error.unconfigured' : 'add.error.offline'), 'bad');
  } finally {
    button.disabled = false;
  }
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
      subject: values.subject || undefined,
      url: values.url || undefined,
      locator: values.locator || undefined,
      workKind: values.kind || undefined,
    });
    form.reset();
    syncYearRule();
    hideProblems();
    dialog.querySelector('#add-more').open = false;
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

/**
 * Put what a link carried into the fields. Values go in through `.value` only,
 * so nothing from an address is ever read as markup. Fields the link did not
 * mention are left as they are.
 */
function fill(values) {
  const put = (selector, value) => {
    const node = dialog.querySelector(selector);
    if (node && value !== null && value !== undefined && value !== '') node.value = String(value);
  };
  put('#add-text', values.text);
  put('#add-author', values.author);
  put('#add-work', values.work);
  put('#add-year', values.year);
  put('#add-url', values.url);
  put('#add-locator', values.locator);
  put('#add-kind', values.kind);
  put('#add-subject', values.subject);
  // The source details are folded away until wanted; a link that carries some
  // of them should not hide them.
  if (values.url || values.locator || values.kind) dialog.querySelector('#add-more').open = true;
}

/** Where the cursor goes: the code field when it is the only way forward, else the first gap. */
function focusFirst({ unlockOnly, prefilled }) {
  const pick = (selector) => dialog.querySelector(selector);
  if (unlockOnly || (prefilled && !isUnlocked())) {
    pick('#add-code')?.focus();
    return;
  }
  const gap = ['#add-text', '#add-author'].map(pick).find((node) => node && !node.value);
  (gap ?? (prefilled ? pick('#add-note') : pick('#add-text')))?.focus();
}

/**
 * Open the dialog.
 *
 *   unlockOnly  show nothing but the unlock panel (the favourites toast's "Unlock")
 *   prefill     fields to fill in, from `add-prefill.js`
 */
function open({ unlockOnly = false, prefill = null } = {}) {
  if (!dialog) build();
  mode = unlockOnly ? 'unlock' : 'add';
  applyMode();
  showLocked(!isUnlocked());
  say('');

  if (prefill) fill(prefill);
  // The last subject he chose, unless a link or a draft has already set one.
  const subject = dialog.querySelector('#add-subject');
  if (subject && !subject.value) subject.value = rememberedSubject();
  syncYearRule();
  hideProblems();

  const github = dialog.querySelector('#add-github');
  if (github) github.href = githubUrl();
  loadTitles();
  // Already showing and asked again (a quote being typed, then "Unlock"): change
  // what it shows and leave it open. showModal() throws on an open dialog.
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  focusFirst({ unlockOnly, prefilled: Boolean(prefill) });
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

/**
 * The same handshake for unlocking on its own: the favourites toast dispatches
 * it when a star was kept on this device only. Already unlocked, there is
 * nothing to ask, so it only says so.
 */
document.addEventListener('quotes:unlock', (event) => {
  event.preventDefault();
  if (isUnlocked()) {
    toast(t('add.locked.ok'));
    return;
  }
  open({ unlockOnly: true });
});

// A link from the video library may have come with a quote already filled in.
// It was taken out of the address when `store.js` loaded; this is its one use.
const arrived = takePrefill();
if (arrived) open({ prefill: arrived });

export { open };
