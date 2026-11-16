/**
 * The page a quotation came from, when the record has one worth going to.
 *
 * The work's title in a quote's byline links here. Two kinds of address are
 * never offered:
 *
 *   A Goodreads one. `source.kind` is "goodreads" for every quote that arrived
 *   through the daily sync, and its address is the list page where another
 *   reader transcribed the line, not the place it was said or written.
 *
 *   One that is not a web address. A record is data, and data does not get to
 *   decide that a click runs a script, so only http and https are followed.
 *
 * It lives in a file of its own, and not inside the page's script, so that
 * `tests/source-link.test.mjs` can run it under Node with no browser.
 */

/** @returns {URL | null} the address to link to, or null when there is none. */
export function sourceUrl(quote) {
  const source = quote?.source;
  if (!source || source.kind === 'goodreads' || typeof source.url !== 'string') return null;
  try {
    const url = new URL(source.url.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The host as a reader would say it: no "www.", nothing after the slash. */
export function sourceHost(url) {
  return url ? url.hostname.replace(/^www\./, '') : '';
}
