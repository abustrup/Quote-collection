# What "working" means — the shelf, 2026-09-16

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
14. A Shelf link is visible above the fold at 1440 px and at 390 px without scrolling, visibly the primary destination; an Add-quote control is beside it, smaller.
15. The Shelf link is also present in the sticky controls row once the page has scrolled.
16. In focus mode there is a favourite button; pressing it toggles the same favourite the list shows, and the favourites count updates.
17. Focus mode's next and previous animate (a transition or animation runs on the quote figure); arrow keys still work.
18. The `DA`/`EN` toggle exists here too and switches the controls, footer and focus-mode labels.
19. When editing is unlocked, "Add a quote" opens an in-page form and saving it lands in the Worker's pending list; when locked it opens the GitHub issue form as today.

## Layout and hygiene, every page, both widths, all editions
20. No horizontal overflow: `document.documentElement.scrollWidth <= clientWidth + 1`.
21. No console errors and no failed requests for anything under the site's own origin.
22. Every `<img>` on the shelf has `naturalWidth >= 300` after load.
23. Tap targets in the controls are at least 34 px tall; text contrast of labels against the page is at least 4.5:1 in paper and night.
24. Fonts: the pages use the chosen library fonts (the `document.fonts` set contains them after load), no font file is base64-inlined in CSS, and total font bytes transferred for the front page are under 400 KB.

## The write path
25. `worker/` deploys with `wrangler deploy`; `GET /state` answers with JSON; `POST /rate` without the key is refused (401); with the key it is stored and appears in the next `GET /state`.
26. `.github/workflows/sync-shelf.yml` applies the Worker's state to `data/works.json` and `data/quotes.json` and commits only when something changed; running `node scripts/apply-shelf-state.mjs --from fixture.json` locally shows the same result on a copy.
27. With the Worker unreachable, both pages still render fully and the edit controls say editing is offline.

## Ship gate
28. A side-by-side of the live site and the candidate, same pages, same widths, same editions, reviewed by someone who did not build it: the candidate is nowhere worse. Where it is worse and that is a genuine trade, the owner decides.
