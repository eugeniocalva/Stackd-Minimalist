/* XML, read without a DOM (PRD 1.7.0 §06.1): the import guide reads XML
   files, and an Excel file is XML inside a zip. scan() walks the text once
   and reports tags and text; parseXML() builds a small tree from that;
   toValue() turns a tree into plain records the guide reads like JSON.

   A file is untrusted. Nothing is fetched and nothing is expanded: a
   DOCTYPE is skipped whole, so an entity a file declares is never looked
   up (no "billion laughs", no outside file), and only the five built-in
   entities and character numbers are decoded. Every search goes forward
   once, with no pattern that can back up over a long tag, so reading takes
   time in proportion to the file's length; the tree is capped in depth and
   in number of elements. Pure: no DOM, no store; scripts/check-import.mjs
   runs it under Node. */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decode = (s) => (s.includes('&') ? s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (all, e) => {
  if (e[0] !== '#') return NAMED[e] ?? all;
  const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : '';
}) : s);

/* Characters no XML file may hold, and halves of a character on their own. */
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Text → text an XML file can hold, in an element or in a quoted attribute. */
export const xmlText = (s) => String(s ?? '').replace(BAD_XML, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAX_TAG = 100000;
const space = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** Attributes of a tag's inside ('row r="1" spans="1:3"') → { r: '1', spans: '1:3' }.
    Read by hand, one pass: a pattern here would try every start again on a
    long tag with no "=" in it, and a file can hold megabytes of those. */
export function attrs(tag) {
  const out = Object.create(null);
  const n = tag.length;
  let i = 0;
  while (i < n) {
    while (i < n && (space(tag[i]) || tag[i] === '/')) i++;
    const start = i;
    while (i < n && !space(tag[i]) && tag[i] !== '=' && tag[i] !== '/') i++;
    if (i === start) { i++; continue; }            // a stray "="
    const name = tag.slice(start, i);
    while (i < n && space(tag[i])) i++;
    if (tag[i] !== '=') continue;                  // a name with no value
    i++;
    while (i < n && space(tag[i])) i++;
    const quote = tag[i];
    if (quote !== '"' && quote !== "'") continue;
    const end = tag.indexOf(quote, i + 1);
    if (end === -1) break;
    out[name] = decode(tag.slice(i + 1, end));
    i = end + 1;
  }
  return out;
}

/** Walks the text once. open(name, inside, selfClosing), close(name), text(string).
    inside is the raw text of the tag after its name, for attrs(). */
export function scan(xml, { open, close, text }) {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) { if (text) text(decode(xml.slice(i))); break; }
    if (lt > i && text) text(decode(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e === -1 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); if (text) text(xml.slice(lt + 9, e === -1 ? n : e)); i = e === -1 ? n : e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e === -1 ? n : e + 2; continue; }
    if (xml.startsWith('<!', lt)) {              // a DOCTYPE, with or without declarations in [ ]: skipped whole
      let e = lt + 2, depth = 0;
      for (; e < n; e++) { const c = xml[e]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = e + 1; continue;
    }
    /* the end of the tag: a > that is not inside a quoted attribute value */
    let gt = lt + 1, quote = '';
    for (; gt < n; gt++) {
      const c = xml[gt];
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (gt >= n || gt - lt > MAX_TAG) throw new Error('a tag that does not end');
    let tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') { if (close) close(tag.slice(1).trim()); continue; }
    const self = tag.endsWith('/');
    if (self) tag = tag.slice(0, -1);
    let sp = 0;
    while (sp < tag.length && !space(tag[sp])) sp++;
    const name = tag.slice(0, sp);
    if (!name) throw new Error('a tag with no name');
    if (open) open(name, tag.slice(sp), self);
    if (self && close) close(name);
  }
}

const MAX_DEPTH = 60;
const MAX_NODES = 1500000;       // 5,000 rows of 200 fields is a million
const NO_KIDS = Object.freeze([]);
const NO_ATTRS = Object.freeze(Object.create(null));

/** text → the root element: { name, attrs, kids: [element…], text }. Throws on text that is not XML. */
export function parseXML(xml) {
  const top = { name: '', attrs: NO_ATTRS, kids: [], text: '' };
  const stack = [top];
  let nodes = 0;
  scan(String(xml ?? ''), {
    open: (name, inside) => {
      if (stack.length > MAX_DEPTH) throw new Error('too deep');
      if (++nodes > MAX_NODES) throw new Error('too large');
      const node = { name, attrs: inside.trim() ? attrs(inside) : NO_ATTRS, kids: NO_KIDS, text: '' };
      const parent = stack.at(-1);
      if (parent.kids === NO_KIDS) parent.kids = [node]; else parent.kids.push(node);
      stack.push(node);
    },
    close: (name) => { if (stack.length > 1 && stack.at(-1).name === name) stack.pop(); else throw new Error(`</${name}> does not close what is open`); },
    text: (t) => { const node = stack.at(-1); if (node !== top) node.text += t; },
  });
  if (stack.length !== 1) throw new Error('an element that is not closed');
  if (top.kids.length !== 1) throw new Error('not one root element');
  return top.kids[0];
}

/** 'ss:Name' → 'Name': the part of a name a person would call it by. */
export const localName = (name) => { const i = name.lastIndexOf(':'); return i === -1 ? name : name.slice(i + 1); };
/* attributes that describe the XML, not the thing */
const noise = (name) => name === 'xmlns' || name.startsWith('xmlns:') || name.startsWith('xml:') || name.startsWith('xsi:');

/** A tree → plain values, the shape a JSON file would have, whatever the
    names in the file:

    - an element with only text is that text;
    - an element with attributes or elements inside is a record of them
      (its own text, if it has attributes, is kept as "text");
    - names that come more than once in a record are a list;
    - a wrapper is the list of what it wraps: an element with nothing of
      its own whose children all have one name, when there are several or
      the one is a record. <cards> around each <card>, <labels> around
      each <label>, <subtasks> around a single <subtask>, and a root around
      one task, so a file with one task reads like a file with many;
    - a record written as pairs, <field name="title">…</field>, is read as
      { title: … }.

    Records inherit nothing, so an element called "constructor" is a field
    like any other. Text beside child elements is dropped. */
export function toValue(root) {
  const own = (node) => Object.keys(node.attrs).filter((k) => !noise(k));
  const value = (node, isRoot) => {
    const a = isRoot ? [] : own(node);          // what a root says about itself is about the file
    const kids = node.kids;
    if (!kids.length) {
      const text = node.text.trim();
      if (!a.length) return text;
      const o = Object.create(null);
      for (const k of a) o[localName(k)] = node.attrs[k];
      if (text) o['text' in o ? '#text' : 'text'] = text;
      return o;
    }
    const first = kids[0].name;
    let same = true, pairs = true;
    for (const k of kids) {
      if (k.name !== first) same = false;
      if (k.kids.length || typeof k.attrs.name !== 'string' || !k.attrs.name.trim()) pairs = false;
    }
    if (same && pairs && !a.length) {
      const o = Object.create(null);
      for (const k of kids) { const key = k.attrs.name.trim().slice(0, 200); if (!(key in o)) o[key] = k.text.trim(); }
      return o;
    }
    if (same && !a.length && (kids.length > 1 || kids[0].kids.length > 0 || own(kids[0]).length > 0)) {
      const values = kids.map((k) => value(k, false));
      return values.every(Array.isArray) ? values.flat() : values;   // a wrapper of wrappers is one list
    }
    const o = Object.create(null);
    for (const k of a) o[localName(k)] = node.attrs[k];
    const many = new Set();                      // the names that came more than once
    for (const kid of kids) {
      const v = value(kid, false);
      const key = localName(kid.name);
      if (!(key in o)) o[key] = v;
      else if (many.has(key)) o[key].push(v);
      else { o[key] = [o[key], v]; many.add(key); }
    }
    return o;
  };
  return value(root, true);
}
