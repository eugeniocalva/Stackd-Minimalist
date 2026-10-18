/* Note bodies are a sanitised HTML subset (PRD-notes §05): text, <br> and —
   from Phase 12 — <b> <i> <u> <s>. This module is pure string work with a
   small tokenizer, no DOM, so scripts/check-text.mjs runs it under Node and
   the app never round-trips untrusted markup through innerHTML. Every body
   satisfies sanitize(body) === body. */

/** Tags a body may contain. Phase 7: line breaks only. */
export const ALLOWED_TAGS = ['br'];

/* Tag names mapped onto the subset; anything else is dropped (its text stays). */
const INLINE_MAP = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', del: 's' };
/* Block-level boundaries become a line break. */
const BLOCK = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article']);
/* Whole elements whose content is never text. */
const DROP_CONTENT = /<(script|style|head|title|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?\/?>|<[^>]*>/g;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escText = (s) => s.replace(/[<>"']/g, (c) => ESC[c]).replace(/&(?!#?\w+;)/g, '&amp;');

/** Keep ALLOWED_TAGS, map known synonyms onto them, turn block boundaries
    into <br>, drop attributes and every other tag (text kept), balance the
    result and trim leading/trailing breaks. Idempotent. */
export function sanitize(html) {
  const src = String(html ?? '').replace(DROP_CONTENT, '');
  const out = [];
  const open = [];               // stack of allowed inline tags currently open
  let last = 0, atStart = true, boundary = false;
  /* a block boundary (</div><div>, </p><p>) is one break, emitted only once
     real content follows; an explicit <br> consumes it */
  const flushBoundary = () => { if (boundary && !atStart) out.push('<br>'); boundary = false; };
  const pushText = (text) => {
    if (!text) return;
    if (text.trim()) { flushBoundary(); atStart = false; }
    out.push(escText(text));
  };
  const closeTo = (name) => {
    const i = open.lastIndexOf(name);
    if (i === -1) return;
    while (open.length > i) out.push(`</${open.pop()}>`);
  };
  for (const m of src.matchAll(TOKEN)) {
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const raw = m[1] ? m[1].toLowerCase() : null;
    if (!raw) continue;                                   // comment / junk
    const closing = m[0][1] === '/';
    if (raw === 'br') { if (ALLOWED_TAGS.includes('br') && !atStart) out.push('<br>'); boundary = false; continue; }
    if (BLOCK.has(raw)) { boundary = true; continue; }    // open or close
    const mapped = INLINE_MAP[raw];
    if (!mapped || !ALLOWED_TAGS.includes(mapped)) continue;
    if (closing) closeTo(mapped);
    else if (!open.includes(mapped)) { flushBoundary(); out.push(`<${mapped}>`); open.push(mapped); }
  }
  pushText(src.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('')
    .replace(/^(?:\s|<br>)+/, '')                         // leading breaks / space
    .replace(/(?:<br>|\s)+$/, '')                         // trailing breaks / space
    .replace(/(?:<br>){3,}/g, '<br><br>');                // at most one blank line
}

/** Plain text → body: escape and turn newlines into <br>. */
export const fromPlain = (text) => sanitize(escText(String(text ?? '')).replace(/\r?\n/g, '<br>'));

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : all;
  }
  return ENTITY[e.toLowerCase()] ?? all;
});

/** Body → plain text for search, previews and the untitled-row fallback:
    <br> and block boundaries → newline, other tags dropped, entities decoded. */
export function toText(html) {
  const src = String(html ?? '').replace(DROP_CONTENT, '');
  let s = '', last = 0, boundary = false;
  const text = (t) => { if (!t) return; if (t.trim() && boundary) { s += '\n'; boundary = false; } s += t; };
  for (const m of src.matchAll(TOKEN)) {
    text(src.slice(last, m.index));
    last = m.index + m[0].length;
    const raw = m[1] ? m[1].toLowerCase() : null;
    if (raw === 'br') { s += '\n'; boundary = false; }
    else if (raw && BLOCK.has(raw)) boundary = true;
  }
  text(src.slice(last));
  return decode(s).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

/** First line of the text, for row titles and previews. */
export const firstLine = (html) => toText(html).split('\n').find((l) => l.trim()) || '';

export const isEmpty = (html) => toText(html).trim() === '';
