# What "working" means: the shelf, 2026-09-16

Fixed before the build. `npm run check:ui` (real headless Chrome, no
dependencies) is the executable form; anything below it cannot measure is
checked by a person against screenshots. A builder who cannot make one of
these pass says so; nobody quietly redefines the bar.

## Data
1. Every one of the 87 books on his Goodreads shelves (as of 2026-09-16: 30 read, 48 to-read, 3 currently reading, 6 did not finish) is in `data/works.json` with the right `shelf`, `added` date, `read` date where Goodreads had one, page count, and Goodreads id.
2. Books that were already quoted match their existing record rather than duplicating it (1984, Crime and Punishment, Sapiens, Nexus, Elon Musk, and so on); `IQ84` on Goodreads is the registry's `1Q84`; `On the Genealogy of Morals` is the registry's `On the Genealogy of Morality`.
3. Every book has a cover file under `assets/covers/`, at least 500 px tall, aspect ratio between 0.55 and 0.80, under 120 KB, and it is the front cover of that book (checked by a person on the contact sheet `npm run covers:sheet` produces).
4. The 21 Goodreads star ratings arrive as `rating` = stars × 2.
5. `npm run check` and `npm test` pass.

## The shelf page (`works.html`)
6. Renders every shelved book with its cover, title and author; non-book works appear in a "Talks & essays" section with a typographic cover.
7. Arrange by: shelf status (default), subject, author, year written, date added, date read, rating, how often quoted. Changing the arrangement moves the books with a FLIP animation (during the first 300 ms after a change at least one book carries a non-identity transform); the final DOM order matches the chosen sort.
8. Filter chips for the four shelves, and a search box that narrows by title or author.
9. Hover (pointer devices) lifts a book: its transform changes and its shadow deepens; the card shows title, author, year, shelf, and rating or want.
10. Click or tap opens the book's detail: large cover, author, year, pages, subject, shelf, dates, quotes count, a 0–10 rating control (labelled "How good was it" for read/abandoned and "How much do I want to read it" for to-read/reading), a shelf-status control, a primary button to the book's quotes (`./?work=<slug>`), a link to Goodreads, and a find-it link. Escape closes it.
11. Rating a book animates the chosen star (a transform keyframe runs on it) and the number updates without a page reload; when editing is unlocked the change is stored via the Worker and survives a reload on another browser profile; when it is not, the control says editing is locked and offers to unlock.
12. Works in all four editions (paper, night, folio, index) with legible contrast; in night the covers are not washed out or given a light frame.
13. Danish and English: the `DA`/`EN` toggle switches every label, button, heading and empty state on the page, and the choice survives a reload. Titles and authors are untouched.

## The front page (`index.html`)
14. A Shelf link is visible above the fold at 1440 px and at 390 px without scrolling, visibly the primary destination; an Add-quote control is beside it, smaller. (At 390 px the shelf, Add and More share one line as three buttons, the shelf the widest.)
15. At 701 px and wider the Shelf link is also present in the sticky controls row once the page has scrolled. On a phone the row does not stick: it is three lines tall, a fifth of the screen, so it scrolls away with the page and covers nothing, and the footer still links the shelf.
16. In focus mode there is a favourite button; pressing it toggles the same favourite the list shows, and the favourites count updates.
17. Focus mode's next and previous animate (a transition or animation runs on the quote figure); arrow keys still work.
18. The `DA`/`EN` toggle is under More, and switches the name of the site, the controls, the footer and the focus-mode labels.
19. When editing is unlocked, "Add a quote" opens an in-page form and saving it lands in the Worker's pending list; when locked it opens the GitHub issue form as today.

## The quiet front page (`index.html`), 2026-11-15
Added when the front page lost its subtitle, its chips and most of its buttons. Cases 14 to 19 above still hold; these say what "quiet" means so that nobody can add a button back without a case failing.

29. At rest the controls row shows the search field, the Subject filter, Favourites, the shelf, Add and a quiet More, in that order, at 1440 px and at 390 px. The author, work, era and sort filters, Focus, Curate, the edition and the language switch are not showing. The shelf and Add each appear once above the fold, and there is no "Quotes" pill on the Quotes page.
30. More opens a panel that holds the author, work, era and sort filters, Focus, Curate, the edition and the language switch, and links the board, read next and the importer. It sits inside the window, also when the page is scrolled a long way down. Escape closes it and gives focus back to the button, also when focus has fallen to the page (a press on the panel's own padding does that), and the page's own Escape does not fire as well, so a word in the search box stays. A press anywhere else closes it. A filter chosen in it narrows the list and leaves it open; Focus and Curate work from it and close it, and Curate chosen with the keyboard leaves focus on More; Done on the curate bar ends curate mode.
31. A quote card has no theme chip and no verification badge, in the list and in Focus. `data/quotes.json` is unchanged: themes and verification are still in it. The Subject filter still narrows the list, and search still finds a quote by a word in it, its author and its work.
32. The star is on every card at rest, without hover, in paper and night, at least 3:1 against the page. On a phone (touch) the star and copy buttons are both showing and at least 44 px square; with a mouse, copy appears with the pointer.
33. A quote whose record has a `source.url`, and whose `source.kind` is not `goodreads`, has its work title as a link to that url, in the list and in Focus, opening in a new tab with `rel="noopener"`. A Goodreads-sourced quote keeps the plain filter link and never links to Goodreads.
34. A quote's permanent address still works: `index.html#id` scrolls to the quote and marks it. The card has no link button. Opened at an address, pressing F opens Focus on that quote and not on the first one. In Focus the address bar holds the address of the quote on screen, and Escape puts the address back as it was.
35. The page is called "My quote collection" (Danish "Min citatsamling") in the heading, the tab title and the share title. The masthead is the heading and nothing else: no kicker, no subtitle, and the old name appears nowhere in the page.
36. Every page with the shared header (the shelf, the board, read next, the importer) shows the name as the way back, the shelf, Add and More, and nothing else at rest. Its panel lists the other pages, leaves out the one you are on, and holds the edition and the language switch. No page has a pill of its own that leads to another page: the name goes to the quotes, and More lists the rest.
37. One filter on the quotes page shows one chip, and its cross is the way out: there is no "Clear all" beside it. With two or more filters on, "Clear all" arrives and clears them all.
38. A byline is as wide as its card. A year is never left on a line of its own beside a title short enough to fit, in Paper, Folio and Index at 1440 px.
39. A phone is not shown the names of keys. With touch on (`hover: none`) the slash in the search box, the letters beside Focus and Curate, the S and esc in the Focus bar and the line of shortcuts in the footer take up no room; with a mouse every one of them is there.

Added on 2026-11-16, after the second review.

40. The Add dialog is thumb-sized on a phone. At 390 px every control in it, the buttons, the fields, the menus, the toggle for the source details and the link to the GitHub form, is at least 44 px tall; so is every control in the dialog that opens only to unlock. At 1440 px they keep their compact desktop sizes.
41. Read next, at 701 px and wider: its filter row sticks under the shared bar and not behind it, and "Suggest again" can be pressed while the page is scrolled.
42. Copy puts the quotation in curly quotes on the clipboard and, on a second line, a spaced en dash and the author and work. There is no em dash in it.

## Layout and hygiene, every page, both widths, all editions
20. No horizontal overflow: `document.documentElement.scrollWidth <= clientWidth + 1`.
21. No console errors and no failed requests for anything under the site's own origin.
22. Every `<img>` on the shelf has `naturalWidth >= 300` after load.
23. Tap targets in the controls are at least 34 px tall (44 px on the front page, in the shared header and in the Add dialog at 700 px and narrower, and on any touch device); text contrast of labels against the page is at least 4.5:1 in paper and night, with the More panel open.
24. Fonts: the pages use the chosen library fonts (the `document.fonts` set contains them after load), no font file is base64-inlined in CSS, and total font bytes transferred for the front page are under 400 KB.

## The write path
25. `worker/` deploys with `wrangler deploy`; `GET /state` answers with JSON; `POST /rate` without the key is refused (401); with the key it is stored and appears in the next `GET /state`.
26. `.github/workflows/sync-shelf.yml` applies the Worker's state to `data/works.json` and `data/quotes.json` and commits only when something changed; running `node scripts/apply-shelf-state.mjs --from fixture.json` locally shows the same result on a copy.
27. With the Worker unreachable, both pages still render fully and the edit controls say editing is offline.

## Ship gate
28. A side-by-side of the live site and the candidate, same pages, same widths, same editions, reviewed by someone who did not build it: the candidate is nowhere worse. Where it is worse and that is a genuine trade, the owner decides.
