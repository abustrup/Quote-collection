/**
 * Acceptance for the shelf page (works.html) — cases 6 to 13 of
 * docs/ACCEPTANCE.md.
 *
 * STUB. The person building the shelf fills this in. Everything you need is on
 * the `ctx` the harness hands you; nothing in scripts/check-ui.mjs needs
 * editing, which is the point of this file existing separately.
 *
 *   await ctx.goto('/works.html', { width: 1440, height: 1000, edition: 'night',
 *                                   lang: 'da', waitFor: '.book' })
 *   const n = await ctx.ev('document.querySelectorAll(".book").length')
 *   await ctx.hover('.book')            // pointer enters, so :hover really fires
 *   await ctx.click('.book')
 *   await ctx.pressKey('Escape')
 *   await ctx.shot('shelf-detail-open') // → data/shots/shelf-detail-open.png
 *   ctx.rec('a name a person can read', passed, 'what was actually measured')
 *   ctx.skip('a check that does not apply yet', 'why')
 *
 * Also available: ctx.wait(ms), ctx.send(cdpMethod, params), ctx.base,
 * ctx.consoleErrors and ctx.failedRequests (both reset by every ctx.goto).
 *
 * Record what you measured in the detail string, not just a verdict: a green
 * line nobody can check is worth less than no line at all.
 */

export async function run(ctx) {
  ctx.rec('shelf checks are wired in', true, 'stub — the shelf builder fills scripts/checks/shelf.mjs in');
}
