/**
 * Acceptance for the front page (index.html) — cases 14 to 19 of
 * docs/ACCEPTANCE.md.
 *
 * STUB. The person building the collection page fills this in. The `ctx` the
 * harness hands you carries everything; scripts/check-ui.mjs stays untouched.
 *
 *   await ctx.goto('/index.html', { width: 390, height: 844, edition: 'paper',
 *                                   lang: 'da', waitFor: '.collection li' })
 *   const aboveFold = await ctx.ev(`(() => {
 *     const el = document.querySelector('.nav-shelf');
 *     const r = el?.getBoundingClientRect();
 *     return r ? r.top >= 0 && r.bottom <= window.innerHeight : null;
 *   })()`)
 *   await ctx.pressKey('f')             // focus mode
 *   await ctx.pressKey('ArrowRight')
 *   await ctx.shot('focus-da')          // → data/shots/focus-da.png
 *   ctx.rec('a name a person can read', aboveFold === true, `top ${…}px of ${…}`)
 *
 * Also available: ctx.hover, ctx.click, ctx.wait(ms), ctx.send(cdpMethod,
 * params), ctx.skip(name, why), ctx.base, ctx.consoleErrors and
 * ctx.failedRequests (both reset by every ctx.goto).
 *
 * Record what you measured in the detail string, not just a verdict: a green
 * line nobody can check is worth less than no line at all.
 */

export async function run(ctx) {
  ctx.rec('collection checks are wired in', true, 'stub — the front-page builder fills scripts/checks/collection.mjs in');
}
