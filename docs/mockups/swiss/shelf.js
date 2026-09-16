/* ==========================================================================
   The shelf — "swiss" direction, behaviour
   --------------------------------------------------------------------------
   One tile element per work, created once and moved between sections, so a
   re-sort is a DOM reorder the FLIP can animate rather than a re-render.
   ========================================================================== */

(function () {
  'use strict';

  var DATA = window.SHELF || [];
  var root = document.documentElement;
  var params = new URLSearchParams(location.search);

  /* --- Two small dictionaries, hard-coded. Titles and authors are never
         translated; everything the page says itself is. -------------------- */

  var DICT = {
    en: {
      shelfTitle: 'The Shelf',
      works: 'works',
      searchLabel: 'Search by title or author',
      searchPlaceholder: 'Title or author',
      arrangeLabel: 'Arrange',
      byShelf: 'Shelf status', bySubject: 'Subject', byAuthor: 'Author',
      byYear: 'Year written', byAdded: 'Date added', byRating: 'Rating',
      shelvesLabel: 'Shelves',
      all: 'All', read: 'Read', reading: 'Reading', 'to-read': 'Want to read',
      abandoned: 'Unfinished', unshelved: 'Not on a shelf', talks: 'Talks & essays',
      nothing: 'Nothing on the shelf matches that.',
      notRated: 'Not rated yet',
      howGood: 'How good was it', howMuch: 'How much do I want to read it',
      shelfField: 'Shelf', subject: 'Subject', author: 'Author', year: 'Year',
      pages: 'Pages', added: 'Added', readOn: 'Finished', quotes: 'Quotes', kind: 'Kind',
      readQuotes: 'Read the quotes', noQuotes: 'No quotes yet',
      goodreads: 'On Goodreads', source: 'Open the source',
      close: 'Close', outOf: 'of 10',
      subjects: {
        literature: 'Literature', philosophy: 'Philosophy', ethics: 'Ethics',
        politics: 'Politics', economics: 'Economics', psychology: 'Psychology',
        sociology: 'Sociology', science: 'Science', technology: 'Technology',
        history: 'History', military: 'Strategy', religion: 'Religion',
        law: 'Law', education: 'Education'
      },
      kinds: {
        book: 'Book', essay: 'Essay', interview: 'Interview', speech: 'Speech',
        letter: 'Letter', document: 'Document', other: 'Other'
      },
      eras: {
        antiquity: 'Antiquity', medieval: 'Medieval', 'early-modern': 'Early modern',
        c19: '19th century', c20: '20th century', contemporary: 'Contemporary',
        undated: 'Undated'
      }
    },
    da: {
      shelfTitle: 'Hylden',
      works: 'værker',
      searchLabel: 'Søg på titel eller forfatter',
      searchPlaceholder: 'Titel eller forfatter',
      arrangeLabel: 'Ordn',
      byShelf: 'Hyldestatus', bySubject: 'Emne', byAuthor: 'Forfatter',
      byYear: 'Skriveår', byAdded: 'Tilføjet', byRating: 'Bedømmelse',
      shelvesLabel: 'Hylder',
      all: 'Alle', read: 'Læst', reading: 'I gang', 'to-read': 'Vil læse',
      abandoned: 'Lagt fra mig', unshelved: 'Uden hylde', talks: 'Taler & essays',
      nothing: 'Ingen værker passer på det.',
      notRated: 'Ikke bedømt endnu',
      howGood: 'Hvor god var den', howMuch: 'Hvor gerne vil jeg læse den',
      shelfField: 'Hylde', subject: 'Emne', author: 'Forfatter', year: 'År',
      pages: 'Sider', added: 'Tilføjet', readOn: 'Færdig', quotes: 'Citater', kind: 'Slags',
      readQuotes: 'Læs citaterne', noQuotes: 'Ingen citater endnu',
      goodreads: 'På Goodreads', source: 'Åbn kilden',
      close: 'Luk', outOf: 'af 10',
      subjects: {
        literature: 'Litteratur', philosophy: 'Filosofi', ethics: 'Etik',
        politics: 'Politik', economics: 'Økonomi', psychology: 'Psykologi',
        sociology: 'Sociologi', science: 'Naturvidenskab', technology: 'Teknologi',
        history: 'Historie', military: 'Krigskunst', religion: 'Religion',
        law: 'Jura', education: 'Uddannelse'
      },
      kinds: {
        book: 'Bog', essay: 'Essay', interview: 'Interview', speech: 'Tale',
        letter: 'Brev', document: 'Dokument', other: 'Andet'
      },
      eras: {
        antiquity: 'Antikken', medieval: 'Middelalderen', 'early-modern': 'Tidlig moderne',
        c19: '1800-tallet', c20: '1900-tallet', contemporary: 'Nutiden',
        undated: 'Uden år'
      }
    }
  };

  var state = {
    lang: params.get('lang') === 'da' ? 'da' : 'en',
    arrange: params.get('sort') || 'shelf',
    shelf: 'all',
    q: '',
    open: null,
    edits: {}          /* slug -> { rating, want, shelf } — this session only */
  };

  var t = function (key) { return DICT[state.lang][key]; };

  /* --- Element helpers ---------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var SHELF_ORDER = ['reading', 'read', 'to-read', 'abandoned', 'unshelved', 'talks'];

  var ERAS = [
    { id: 'antiquity', from: -900, to: 500 },
    { id: 'medieval', from: 501, to: 1500 },
    { id: 'early-modern', from: 1501, to: 1800 },
    { id: 'c19', from: 1801, to: 1900 },
    { id: 'c20', from: 1901, to: 2000 },
    { id: 'contemporary', from: 2001, to: 2200 }
  ];

  function eraOf(year) {
    if (year == null) return 'undated';
    for (var i = 0; i < ERAS.length; i++) if (year >= ERAS[i].from && year <= ERAS[i].to) return ERAS[i].id;
    return 'undated';
  }

  function shelfKey(item) {
    var e = state.edits[item.slug];
    var s = (e && e.shelf !== undefined) ? e.shelf : item.shelf;
    return s === null || s === undefined ? 'talks' : s;
  }

  function scoreOf(item) {
    var e = state.edits[item.slug] || {};
    var key = shelfKey(item);
    if (key === 'to-read' || key === 'reading') {
      return { field: 'want', value: e.want !== undefined ? e.want : item.want };
    }
    return { field: 'rating', value: e.rating !== undefined ? e.rating : item.rating };
  }

  function surname(author) {
    var parts = String(author || '').trim().split(/\s+/);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(+d)) return iso;
    return d.toLocaleDateString(state.lang === 'da' ? 'da-DK' : 'en-GB',
      { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtYear(y) {
    if (y == null) return '—';
    return y < 0 ? Math.abs(y) + (state.lang === 'da' ? ' f.Kr.' : ' BC') : String(y);
  }

  /* --- One tile per work, built once -------------------------------------- */

  var tiles = new Map();

  function kindLine(item) {
    var kind = t('kinds')[item.kind] || item.kind;
    return item.year == null ? kind : kind + ' · ' + fmtYear(item.year);
  }

  function typographicCover(item) {
    var box = el('span', 'cover');
    var inner = el('span', 'cover-type');
    inner.appendChild(el('span', 'cover-kind', kindLine(item)));
    inner.appendChild(el('span', 'cover-type-title', item.title));
    inner.appendChild(el('span', 'cover-type-author', item.author));
    box.appendChild(inner);
    return box;
  }

  function buildTile(item) {
    var li = el('li', 'tile');
    li.dataset.slug = item.slug;

    var btn = el('button', 'tile-open');
    btn.type = 'button';

    var cover;
    if (item.cover) {
      cover = el('span', 'cover');
      var img = new Image();
      img.src = item.cover;
      img.alt = '';
      img.loading = 'eager';
      img.decoding = 'async';
      cover.appendChild(img);
    } else {
      cover = typographicCover(item);
    }
    btn.appendChild(cover);

    var cap = el('span', 'tile-caption');
    cap.appendChild(el('span', 'cap-title', item.title));
    cap.appendChild(el('span', 'cap-meta'));
    var foot = el('span', 'cap-foot');
    var bars = el('span', 'bars');
    for (var i = 0; i < 10; i++) bars.appendChild(el('i'));
    foot.appendChild(bars);
    foot.appendChild(el('span', 'cap-shelf'));
    cap.appendChild(foot);
    btn.appendChild(cap);

    li.appendChild(btn);
    btn.addEventListener('click', function () { openSheet(item.slug); });

    tiles.set(item.slug, li);
    paintTile(item);
    return li;
  }

  /* The caption is the only part of a tile that changes: language, rating,
     shelf. Repainting it is cheaper than rebuilding and keeps FLIP identity. */
  function paintTile(item) {
    var li = tiles.get(item.slug);
    if (!li) return;
    var bits = [item.author];
    if (item.year != null) bits.push(fmtYear(item.year));
    li.querySelector('.cap-meta').textContent = bits.join(' · ');

    var key = shelfKey(item);
    li.querySelector('.cap-shelf').textContent = key === 'talks' ? '' : t(key);

    var score = scoreOf(item);
    var bars = li.querySelector('.bars');
    bars.classList.toggle('empty', score.value == null);
    bars.hidden = key === 'talks';
    var segs = bars.children;
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle('on', score.value != null && i < score.value);
    }
    var typeTitle = li.querySelector('.cover-kind');
    if (typeTitle) typeTitle.textContent = kindLine(item);
  }

  /* --- Grouping ----------------------------------------------------------- */

  function byTitle(a, b) { return a.title.localeCompare(b.title, 'en'); }

  function groupsFor(items) {
    var map = new Map();
    var push = function (key, label, sortAt, item) {
      if (!map.has(key)) map.set(key, { key: key, label: label, at: sortAt, items: [] });
      map.get(key).items.push(item);
    };

    items.forEach(function (item) {
      if (state.arrange === 'shelf') {
        var k = shelfKey(item);
        push(k, t(k), SHELF_ORDER.indexOf(k), item);
      } else if (state.arrange === 'subject') {
        push(item.subject, t('subjects')[item.subject] || item.subject, 0, item);
      } else if (state.arrange === 'author') {
        var letter = (surname(item.author)[0] || '#').toUpperCase();
        push(letter, letter, letter.charCodeAt(0), item);
      } else if (state.arrange === 'year') {
        var era = eraOf(item.year);
        push(era, t('eras')[era], era === 'undated' ? 99 : ERAS.map(function (e) { return e.id; }).indexOf(era), item);
      } else if (state.arrange === 'added') {
        var y = item.added ? item.added.slice(0, 4) : '—';
        push(y, y, -Number(y || 0), item);
      } else if (state.arrange === 'rating') {
        var s = scoreOf(item).value;
        var key = s == null ? 'none' : String(s);
        push(key, s == null ? t('notRated') : s + ' / 10', s == null ? 99 : -s, item);
      }
    });

    var groups = Array.from(map.values());

    if (state.arrange === 'subject') {
      groups.sort(function (a, b) { return b.items.length - a.items.length || a.label.localeCompare(b.label); });
    } else {
      groups.sort(function (a, b) { return a.at - b.at; });
    }

    groups.forEach(function (g) {
      if (state.arrange === 'year') g.items.sort(function (a, b) { return (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b); });
      else if (state.arrange === 'added') g.items.sort(function (a, b) { return String(b.added || '').localeCompare(String(a.added || '')) || byTitle(a, b); });
      else if (state.arrange === 'author') g.items.sort(function (a, b) { return surname(a.author).localeCompare(surname(b.author)) || byTitle(a, b); });
      else g.items.sort(byTitle);
    });

    return groups;
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.filter(function (item) {
      if (state.shelf !== 'all' && shelfKey(item) !== state.shelf) return false;
      if (!q) return true;
      return (item.title + ' ' + item.author).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* --- FLIP ---------------------------------------------------------------
     Measure, reorder, invert, play. The emphasized easing at 500 ms with a
     few milliseconds of stagger per item, in visual order. */

  var DURATION = 500;
  var flipTimer = null;

  function flip(mutate) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { mutate(); return; }

    var before = new Map();
    tiles.forEach(function (node, slug) {
      if (node.isConnected) before.set(slug, node.getBoundingClientRect());
    });

    mutate();

    var moved = [];
    var entered = [];
    tiles.forEach(function (node, slug) {
      if (!node.isConnected) return;
      var was = before.get(slug);
      var now = node.getBoundingClientRect();
      if (!was) { entered.push(node); return; }
      var dx = was.left - now.left;
      var dy = was.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      node.style.transition = 'none';
      node.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moved.push({ node: node, top: now.top, left: now.left });
    });

    entered.forEach(function (node) {
      node.style.transition = 'none';
      node.style.opacity = '0';
      node.style.transform = 'scale(0.965)';
    });

    if (!moved.length && !entered.length) return;

    moved.sort(function (a, b) { return a.top - b.top || a.left - b.left; });

    root.classList.add('is-flipping');
    /* Force the inverted position to be committed before it is played back. */
    void document.body.offsetHeight;

    requestAnimationFrame(function () {
      moved.forEach(function (m, i) {
        var delay = Math.min(i * 4, 140);
        m.node.style.transition = 'transform ' + DURATION + 'ms cubic-bezier(0.2,0,0,1) ' + delay + 'ms';
        m.node.style.transform = '';
      });
      entered.forEach(function (node, i) {
        var delay = 90 + Math.min(i * 4, 140);
        node.style.transition = 'opacity 260ms cubic-bezier(0.2,0,0,1) ' + delay + 'ms, transform 360ms cubic-bezier(0.2,0,0,1) ' + delay + 'ms';
        node.style.opacity = '';
        node.style.transform = '';
      });
    });

    clearTimeout(flipTimer);
    flipTimer = setTimeout(function () {
      root.classList.remove('is-flipping');
      tiles.forEach(function (node) { node.style.transition = ''; node.style.transform = ''; node.style.opacity = ''; });
    }, DURATION + 260);
  }

  /* --- Render -------------------------------------------------------------- */

  var host = document.getElementById('sections');
  var emptyNote = document.getElementById('empty');

  function render(animate) {
    var items = visible();
    var groups = groupsFor(items);

    var build = function () {
      host.textContent = '';
      groups.forEach(function (g) {
        var sec = el('section', 'section');
        var head = el('div', 'section-head');
        head.appendChild(el('h2', null, g.label));
        head.appendChild(el('span', 'section-n', g.items.length));
        head.appendChild(el('span', 'section-line'));
        sec.appendChild(head);

        var ul = el('ul', 'grid');
        g.items.forEach(function (item) {
          var node = tiles.get(item.slug) || buildTile(item);
          ul.appendChild(node);
        });
        sec.appendChild(ul);
        host.appendChild(sec);
      });
      emptyNote.hidden = items.length > 0;
      emptyNote.textContent = t('nothing');
    };

    if (animate) flip(build); else build();

    document.getElementById('count').textContent = items.length + ' ' + t('works');
  }

  /* --- Chips --------------------------------------------------------------- */

  var CHIPS = ['all', 'read', 'reading', 'to-read', 'abandoned'];

  function paintChips() {
    var box = document.getElementById('chips');
    box.textContent = '';
    box.setAttribute('aria-label', t('shelvesLabel'));
    CHIPS.forEach(function (key) {
      var b = el('button', 'chip');
      b.type = 'button';
      b.appendChild(document.createTextNode(t(key)));
      var n = key === 'all' ? DATA.length : DATA.filter(function (i) { return shelfKey(i) === key; }).length;
      b.appendChild(el('span', 'chip-n', n));
      b.setAttribute('aria-pressed', String(state.shelf === key));
      b.addEventListener('click', function () {
        if (state.shelf === key) return;
        state.shelf = key;
        paintChips();
        render(true);
      });
      box.appendChild(b);
    });
  }

  /* --- The detail sheet ---------------------------------------------------- */

  var sheet = document.getElementById('sheet');
  var scrim = document.getElementById('scrim');
  var sheetBody = document.getElementById('sheet-body');

  function row(dl, label, value) {
    if (value == null || value === '') return;
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, value));
  }

  function paintSheet() {
    var item = DATA.find(function (i) { return i.slug === state.open; });
    if (!item) return;
    sheetBody.textContent = '';
    document.getElementById('sheet-kind').textContent = t('kinds')[item.kind] || item.kind;
    document.getElementById('sheet-close').setAttribute('aria-label', t('close'));

    var cov = el('div', 'sheet-cover');
    if (item.cover) {
      var img = new Image();
      img.src = item.cover;
      img.alt = '';
      cov.appendChild(img);
    } else {
      var inner = el('span', 'cover-type');
      inner.appendChild(el('span', 'cover-kind', kindLine(item)));
      inner.appendChild(el('span', 'cover-type-title', item.title));
      inner.appendChild(el('span', 'cover-type-author', item.author));
      cov.appendChild(inner);
    }
    sheetBody.appendChild(cov);

    var h = el('h2', 'sheet-title', item.title);
    h.id = 'sheet-title';
    sheetBody.appendChild(h);
    sheetBody.appendChild(el('p', 'sheet-author', item.author));

    var key = shelfKey(item);
    var dl = el('dl', 'sheet-dl');
    row(dl, t('year'), fmtYear(item.year));
    row(dl, t('subject'), t('subjects')[item.subject] || item.subject);
    if (key !== 'talks') row(dl, t('shelfField'), t(key));
    row(dl, t('pages'), item.pages);
    row(dl, t('added'), fmtDate(item.added));
    row(dl, t('readOn'), fmtDate(item.read));
    row(dl, t('quotes'), item.quotes);
    sheetBody.appendChild(dl);

    /* Rating. Ten small squares that fill; the chosen one pops. */
    if (key !== 'talks') {
      var score = scoreOf(item);
      var field = el('div', 'field');
      field.appendChild(el('span', 'field-label',
        (key === 'to-read' || key === 'reading') ? t('howMuch') : t('howGood')));
      var rate = el('div', 'rate');
      var squares = el('div', 'rate-squares');
      for (var n = 1; n <= 10; n++) {
        (function (value) {
          var b = el('button');
          b.type = 'button';
          b.setAttribute('aria-label', value + ' ' + t('outOf'));
          if (score.value != null && value <= score.value) b.classList.add('on');
          b.addEventListener('click', function () {
            var e = state.edits[item.slug] || (state.edits[item.slug] = {});
            e[score.field] = value;
            paintSheet();
            paintTile(item);
            var fresh = sheetBody.querySelectorAll('.rate-squares button')[value - 1];
            if (fresh) { fresh.classList.remove('pop'); void fresh.offsetWidth; fresh.classList.add('pop'); }
          });
          squares.appendChild(b);
        })(n);
      }
      rate.appendChild(squares);
      var val = el('span', 'rate-value');
      val.appendChild(document.createTextNode(score.value == null ? '—' : String(score.value)));
      val.appendChild(el('span', null, ' ' + t('outOf')));
      rate.appendChild(val);
      field.appendChild(rate);
      sheetBody.appendChild(field);

      var sf = el('div', 'field');
      sf.appendChild(el('span', 'field-label', t('shelfField')));
      var seg = el('div', 'seg');
      ['read', 'reading', 'to-read', 'abandoned'].forEach(function (s) {
        var b = el('button', 'chip', t(s));
        b.type = 'button';
        b.setAttribute('aria-pressed', String(key === s));
        b.addEventListener('click', function () {
          var e = state.edits[item.slug] || (state.edits[item.slug] = {});
          e.shelf = s;
          paintSheet();
          paintTile(item);
          paintChips();
          render(true);
        });
        seg.appendChild(b);
      });
      sf.appendChild(seg);
      sheetBody.appendChild(sf);
    }

    var actions = el('div', 'sheet-actions');
    var primary = el('button', 'btn-primary');
    primary.type = 'button';
    if (item.quotes > 0) {
      primary.textContent = t('readQuotes') + ' · ' + item.quotes;
      primary.addEventListener('click', function () {
        location.href = '../../../index.html?work=' + encodeURIComponent(item.slug);
      });
    } else {
      primary.textContent = t('noQuotes');
      primary.disabled = true;
      primary.style.opacity = '0.42';
      primary.style.cursor = 'default';
    }
    actions.appendChild(primary);

    if (item.goodreads) {
      var a = el('a', 'link-quiet', t('goodreads'));
      a.href = item.goodreads;
      a.rel = 'noreferrer';
      a.target = '_blank';
      actions.appendChild(a);
    } else if (item.url) {
      var s = el('a', 'link-quiet', t('source'));
      s.href = item.url;
      s.rel = 'noreferrer';
      s.target = '_blank';
      actions.appendChild(s);
    }
    sheetBody.appendChild(actions);
  }

  function openSheet(slug) {
    state.open = slug;
    paintSheet();
    sheet.hidden = false;
    scrim.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('on');
    scrim.classList.add('on');
    document.getElementById('sheet-close').focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!state.open) return;
    state.open = null;
    sheet.classList.remove('on');
    scrim.classList.remove('on');
    setTimeout(function () {
      if (state.open) return;
      sheet.hidden = true;
      scrim.hidden = true;
    }, 420);
  }

  scrim.addEventListener('click', closeSheet);
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  /* --- Language and edition ------------------------------------------------ */

  function paintStrings() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (n) { n.placeholder = t(n.dataset.i18nPh); });
    document.getElementById('lang').textContent = state.lang === 'en' ? 'EN' : 'DA';
    document.title = t('shelfTitle') + ' — swiss';
    DATA.forEach(paintTile);
    paintChips();
  }

  document.getElementById('lang').addEventListener('click', function () {
    state.lang = state.lang === 'en' ? 'da' : 'en';
    paintStrings();
    render(false);
    if (state.open) paintSheet();
  });

  document.getElementById('edition').addEventListener('click', function () {
    root.dataset.edition = root.dataset.edition === 'night' ? 'paper' : 'night';
  });

  document.getElementById('arrange').addEventListener('change', function (e) {
    state.arrange = e.target.value;
    render(true);
  });

  var searchTimer = null;
  document.getElementById('q').addEventListener('input', function (e) {
    var value = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = value;
      render(true);
    }, 110);
  });

  /* --- Boot ---------------------------------------------------------------- */

  if (params.get('dark') === '1') root.dataset.edition = 'night';
  document.getElementById('arrange').value = state.arrange;
  paintStrings();
  render(false);

  /* Deterministic states for the screenshots. */
  var hover = params.get('hover');
  if (hover) {
    /* ?hover=1 lifts the third book; ?hover=<n> lifts the nth, for checking
       that a caption never collides with the row beneath it. */
    var nth = hover === '1' ? 2 : Number(hover) - 1;
    var target = host.querySelectorAll('.tile')[nth];
    if (target) target.classList.add('is-hover');
  }
  var open = params.get('open');
  if (open) {
    /* ?open=<slug> opens that work; ?open=1 opens the most-quoted one, which
       is the state worth photographing. */
    var pick = open === '1'
      ? DATA.slice().sort(function (a, b) { return b.quotes - a.quotes; })[0]
      : DATA.find(function (i) { return i.slug === open; });
    if (pick) openSheet(pick.slug);
  }
})();
