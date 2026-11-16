#!/usr/bin/env python3
"""Render a ranked shortlist as one web page with tick boxes that collect the picks as numbers.

Usage:
  picker.py CANDIDATES.json OUT.html [--title "Quote Mine Shortlist"] [--lede "…"] [--left-out "…"] [--standalone]
  picker.py CANDIDATES.json --chat [--top 5]            the same list as plain text for the chat

OUT.html is the page as the Artifact tool wants it: a fragment (title, style, body) that the tool wraps in its own
document. It opens with a charset line so that the file reads correctly even when it is opened raw. --standalone writes
a whole document (doctype, charset, viewport) for opening the file by itself, a double-click or a local server.
When meta.json (named on each candidate) says the lines come from machine captions, the page and the --chat list say so.

CANDIDATES.json is the list described in select-picks.py (strongest first). Each item's `show` block
feeds the card: by, work_short, where (timestamp), about, why, flag. A version-2 item also gives the
card its time (`start`, seconds, shown as m:ss and linked to the moment in the video) and a "Main point"
label (`main_point`). Publish OUT.html with the Artifact tool. Alexander ticks lines, presses Copy
numbers, pastes the digits into chat.
The page needs no capability: ticks are kept in his browser only, the digits travel by paste.

--chat prints the numbered list the way it goes into the chat: the quote, then a plainer line with the
time, the speaker and the main point. Paste it as it stands so a number means the same line everywhere.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _text import fmt_time  # noqa: E402

CSS = """
:root{
  /* Layout: a ranked list of index cards; one fixed bar holds the picks. Fonts match the shelf (Source Serif 4 for lines, DM Sans for UI). */
  --bg:#f4f6f4; --surface:#ffffff; --ink:#18221e; --muted:#58675f; --line:#d8dfda;
  --accent:#1d5c48; --accent-ink:#ffffff; --sel:#e3f1ea; --warn-bg:#fbf1d9; --warn-ink:#6a4a00;
  --serif:'Source Serif 4',Georgia,'Times New Roman',serif; --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#101614; --surface:#18211e; --ink:#e8efeb; --muted:#9baba3; --line:#2a3732;
  --accent:#6fcaa5; --accent-ink:#0b1713; --sel:#1d3329; --warn-bg:#3a2f12; --warn-ink:#f1d48a; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#101614; --surface:#18211e; --ink:#e8efeb; --muted:#9baba3; --line:#2a3732;
  --accent:#6fcaa5; --accent-ink:#0b1713; --sel:#1d3329; --warn-bg:#3a2f12; --warn-ink:#f1d48a; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);padding-inline:16px;padding-block:28px 120px;margin:0}
main{max-width:760px;margin-inline:auto}
h1{font:600 28px/1.15 var(--sans);letter-spacing:-.01em;margin:0 0 8px;text-wrap:balance}
.lede{color:var(--muted);margin:0 0 20px;max-width:60ch}
.how{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 20px}
.how p{margin:0 0 6px} .how p:last-child{margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.chip{font:500 14px var(--sans);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:7px 12px;cursor:pointer}
.chip[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.chip:focus-visible,.btn:focus-visible,input:focus-visible+.body{outline:2px solid var(--accent);outline-offset:2px}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.q label{display:grid;grid-template-columns:34px 22px 1fr;gap:10px;align-items:start;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 14px 14px 12px;cursor:pointer}
.q:has(input:checked) label{background:var(--sel);border-color:var(--accent)}
.n{font:600 15px var(--sans);color:var(--muted);font-variant-numeric:tabular-nums;text-align:right;padding-top:3px}
input[type=checkbox]{width:20px;height:20px;margin:3px 0 0;accent-color:var(--accent)}
.body{display:flex;flex-direction:column;gap:6px;min-width:0}
.text{font:400 19px/1.45 var(--serif);text-wrap:pretty}
.meta{font-size:13px;color:var(--muted)}
.why{font-size:14px}
.flag{margin:2px 0 0;font-size:13px;background:var(--warn-bg);color:var(--warn-ink);border-radius:6px;padding:5px 8px}
.flag.machine{margin:0 0 16px;font-size:14px;border-radius:8px;padding:9px 12px;max-width:60ch}
.tag{font-weight:600;color:var(--accent)}
.mp{font-size:14px}.mp b{color:var(--accent);font-weight:600}
.meta a{color:inherit;text-underline-offset:2px}
.cut{margin:22px 0 10px;color:var(--muted);font-size:14px}
.cut b{color:var(--ink)}
hr{border:0;border-top:1px solid var(--line);margin:26px 0}
.notes{color:var(--muted);font-size:14px} .notes h2{font:600 16px var(--sans);color:var(--ink);margin:0 0 6px}
.notes ul{margin:0 0 14px;padding-left:18px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--surface);border-top:1px solid var(--line);padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));z-index:5}
.bar-in{max-width:760px;margin-inline:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.picks{flex:1 1 220px;min-width:0}
.picks small{display:block;color:var(--muted);font-size:12px}
#out{font:600 18px var(--sans);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.btn{font:600 14px var(--sans);border-radius:8px;padding:10px 14px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
@media (prefers-reduced-motion:no-preference){.q label{transition:background .15s,border-color .15s}}
"""

JS = """
(function(){
  var boxes=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
  var out=document.getElementById('out'), count=document.getElementById('count'), copy=document.getElementById('copy');
  var KEY=document.body.getAttribute('data-key');
  function sel(){return boxes.filter(function(b){return b.checked}).map(function(b){return +b.value}).sort(function(a,b){return a-b})}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(sel()))}catch(e){}}
  function render(){var s=sel();out.textContent=s.length?s.join(', '):'-';count.textContent=s.length?(s.length+' ticked'):'Nothing ticked yet';save()}
  try{var saved=JSON.parse(localStorage.getItem(KEY)||'[]');boxes.forEach(function(b){b.checked=saved.indexOf(+b.value)>-1})}catch(e){}
  boxes.forEach(function(b){b.addEventListener('change',render)});
  document.getElementById('clear').onclick=function(){boxes.forEach(function(b){b.checked=false});render()};
  document.getElementById('top10').onclick=function(){boxes.forEach(function(b){b.checked=+b.value<=10});render()};
  copy.onclick=function(){
    var t=sel().join(', ');if(!t)return;
    function done(){copy.textContent='Copied';setTimeout(function(){copy.textContent='Copy numbers'},1600)}
    function fallback(){var r=document.createRange();r.selectNodeContents(out);var s=window.getSelection();s.removeAllRanges();s.addRange(r);copy.textContent='Selected, copy it'}
    try{navigator.clipboard.writeText(t).then(done,fallback)}catch(e){fallback()}
  };
  var chips=[].slice.call(document.querySelectorAll('.chip'));
  chips.forEach(function(c){c.addEventListener('click',function(){
    chips.forEach(function(x){x.setAttribute('aria-pressed',x===c?'true':'false')});
    var w=c.getAttribute('data-work');
    [].slice.call(document.querySelectorAll('.q')).forEach(function(q){q.hidden=!(w==='all'||q.getAttribute('data-work')===w)});
  })});
  render();
})();
"""


def when_of(it: dict, show: dict):
    """(m:ss or the v1 `where` text, is it a real time). A version-2 item carries `start` seconds."""
    start = it.get("start")
    if isinstance(start, (int, float)) and not isinstance(start, bool):
        return fmt_time(start), True
    return show.get("where"), False


MACHINE_NOTE = (
    "These lines come from YouTube's machine captions, the only captions this video has. The machine can mishear "
    "words and names, and it does not mark who is speaking, so each speaker is judged from the turn of the conversation."
)


def machine_only(items: list) -> bool:
    """Do the lines come from a machine caption track? meta.json (named on each candidate) says which track was used;
    captions.py takes the uploader's own track whenever there is one, so a machine track means there was no other."""
    seen = set()
    for it in items:
        path = it.get("meta")
        if not path or path in seen:
            continue
        seen.add(path)
        try:
            meta = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (meta.get("track") or {}).get("kind") == "asr":
            return True
    return False


def chat_list(items: list, top: int = 0) -> str:
    """The numbered list for the chat: the quote, then a plainer line (two trailing spaces make the break show).
    With top, only the first `top` lines, still numbered as in the whole list. When the lines come from machine
    captions the list opens with a line that says so."""
    lines = []
    if machine_only(items):
        lines += [MACHINE_NOTE, ""]
    for n, it in enumerate(items, 1):
        if top and n > top:
            break
        rec, show = it["record"], it.get("show", {})
        when, _real = when_of(it, show)
        bits = [b for b in (when, rec.get("author")) if b]
        mp = it.get("main_point") or show.get("main_point")
        if mp:
            bits.append(f"Main point: {mp}")
        lines.append(f"{n}. {rec['text']}  ")
        lines.append(f"   {' · '.join(bits)}")
        flag = show.get("flag")
        if flag:
            lines.append(f"   Note: {flag}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--chat", action="store_true", help="print the numbered list for the chat instead of writing a page")
    ap.add_argument("--top", type=int, default=0, help="with --chat: only the first N lines (the numbers stay those of the whole list)")
    ap.add_argument("--title", default="Quote Mine Shortlist")
    ap.add_argument("--lede", default="")
    ap.add_argument("--left-out", default="", help="one sentence on lines dropped and why (cut-off captions, say)")
    ap.add_argument("--key", default="quote-mine-v2-picks", help="browser storage key; change it per shortlist")
    ap.add_argument("--standalone", action="store_true",
                    help="write a complete HTML document (doctype, charset, viewport) for opening the file directly; "
                         "without it the page is the fragment the Artifact tool wraps")
    a = ap.parse_args()
    e = lambda s: html.escape(str(s), quote=True)

    items = json.loads(Path(a.candidates).read_text(encoding="utf-8"))
    if a.chat:
        sys.stdout.write(chat_list(items, a.top))
        return
    if not a.out:
        raise SystemExit("Give the page to write (OUT.html), or --chat for the plain list.")
    works, cards = [], []
    for n, it in enumerate(items, 1):
        rec, show = it["record"], it.get("show", {})
        ws = show.get("work_short") or rec["work"]
        if ws not in works:
            works.append(ws)
        verified = rec.get("verification", {}).get("status") == "verified"
        when, real_time = when_of(it, show)
        url = (rec.get("source") or {}).get("url") or ""
        if real_time and url.startswith("https://"):
            # The time opens the video at the line. A link inside a label does not tick the box.
            where = f' · <a href="{e(url)}" target="_blank" rel="noopener noreferrer">{e(when)}</a>'
        else:
            where = e(f" · {when}") if when else ""
        flag = f'<p class="flag">{e(show["flag"])}</p>' if show.get("flag") else ""
        tag = ' · <b class="tag">read in the work itself</b>' if verified else ""
        main_point = it.get("main_point") or show.get("main_point")
        mp = f'<span class="mp"><b>Main point:</b> {e(main_point)}</span>' if main_point else ""
        cards.append(
            f'<li class="q" data-work="{works.index(ws)}"><label for="c{n}"><span class="n">{n}</span>'
            f'<input id="c{n}" type="checkbox" value="{n}"><span class="body">'
            f'<span class="text">{e(rec["text"])}</span>'
            f'<span class="meta">{e(rec["author"])} · {e(ws)}{where} · {e(show.get("about", ""))}</span>'
            f'{mp}'
            f'<span class="why">{e(show.get("why", ""))}{tag}</span>{flag}</span></label></li>'
        )
    chips = "".join(
        f'<button class="chip" type="button" data-work="{i}" aria-pressed="false">{e(w)}</button>' for i, w in enumerate(works)
    )
    left = f'<p class="cut"><b>Left out:</b> {e(a.left_out)}</p>' if a.left_out else ""
    has_mp = any(it.get("main_point") or (it.get("show") or {}).get("main_point") for it in items)
    mp_note = (
        "\n<li>The <b>Main point</b> under a quote is the point of the video the line carries. "
        "The time opens the video at that moment.</li>" if has_mp else ""
    )
    lede = a.lede or f"{len(items)} lines, ranked strongest first across all works."
    machine = f'<p class="flag machine">{e(MACHINE_NOTE)}</p>\n' if machine_only(items) else ""
    head = f"""<title>{e(a.title)}</title>
<style>{CSS}</style>"""
    body = f"""<main>
<h1>{e(a.title)}</h1>
<p class="lede">{e(lede)}</p>
{machine}<div class="how"><p><b>How to pick:</b> tick the ones you want. Your numbers collect at the bottom.</p>
<p>Press <b>Copy numbers</b> and paste them into the chat. I file them, register the works and send you the links.</p></div>
<div class="chips" role="group" aria-label="Filter by work">
<button class="chip" type="button" data-work="all" aria-pressed="true">All {len(items)}</button>{chips}</div>
<ol>{"".join(cards)}</ol>
{left}
<hr>
<section class="notes"><h2>What the labels mean</h2><ul>
<li>A line marked <b>read in the work itself</b> was read in the text on the author's own site. It files as <i>verified</i>.</li>
<li>Everything else comes from machine captions or a transcript, not the audio. It files as <i>reported</i>. Cuts are filler words and false starts only, and each is written into the quote's note.</li>
<li>Amber notes mark a line to weigh: widely quoted, a figure that is the speaker's own, a speaker judged from the interview turn, or a caption quirk.</li>{mp_note}</ul></section>
</main>
<div class="bar"><div class="bar-in">
<div class="picks"><small id="count">Nothing ticked yet</small><div id="out" aria-live="polite">-</div></div>
<button class="btn" type="button" id="top10">Tick top 10</button>
<button class="btn" type="button" id="clear">Clear</button>
<button class="btn primary" type="button" id="copy">Copy numbers</button></div></div>
<script>document.body.setAttribute('data-key',{json.dumps(a.key)});{JS}</script>"""
    if a.standalone:
        # A file opened by itself (a double-click, a local server) needs what the Artifact tool adds when it publishes.
        page = (
            '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f"{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n"
        )
    else:
        # The Artifact tool wraps this in its own document, which already carries the charset; the line is for the
        # file opened raw, where the browser reads its first bytes to learn that the "·" in it is UTF-8.
        page = f'<meta charset="utf-8">\n{head}\n{body}\n'
    Path(a.out).write_text(page, encoding="utf-8")
    print(f"{a.out}: {len(items)} cards, {len(works)} works, {len(page):,} bytes")


if __name__ == "__main__":
    main()
