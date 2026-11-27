/* The logic of the import guide (PRD 1.7.0 §06.1). A file becomes a table
   (columns and rows of text); the columns are placed on Stack'd's fields by
   their names and by what is in them, never by the tool that wrote the file
   (decision 18); the person's answers and the table then become a plan: the
   tasks to add, the lanes they need, what is skipped and what is left out.

   A file is untrusted. Nothing here touches the store or the page: every
   value in a plan is plain text or a checked shape, descriptions go through
   the same sanitising as typed text, and the store builds the tasks itself
   (importTasks). Pure, so scripts/check-import.mjs runs it under Node. */

import { parseCSV } from './formats/csv.js';
import { parseXML, toValue, localName } from './formats/xml.js';
import { readXLSX } from './formats/xlsx.js';
import { sanitize } from './richtext.js';

export const MAX_ROWS = 5000;         // a device's storage holds about ten thousand tasks in all
export const MAX_COLUMNS = 200;
export const MAX_CELL = 30000;        // longer than any description kept; bounds every pattern below
const MAX_SUBTASKS = 200;
const MAX_NEW_LANES = 50;
const MAX_LABELS = 20;                // on one task

/** code: 'unreadable' | 'empty' | 'too_many' | 'old_excel' */
export class GuideError extends Error {
  constructor(code, message) { super(message); this.name = 'GuideError'; this.code = code; }
}

/** The fields a column can be placed on, in the order the guide shows them. */
export const FIELDS = [
  ['title', 'Title'], ['list', 'List'], ['description', 'Description'], ['labels', 'Labels'], ['priority', 'Priority'],
  ['due', 'Due date'], ['start', 'Start date'], ['done', 'Done'], ['archived', 'Archived'], ['checklist', 'Checklist'],
  ['key', 'Link or number'],
];
export const FIELD_KEYS = FIELDS.map(([k]) => k);

/* Names a column may have for each field, best first. Compared without
   capitals, spaces or punctuation: "List Name", "list-name" and "listName"
   are one name. */
const NAMES = {
  title: ['name', 'title', 'task', 'card', 'cardname', 'taskname', 'summary', 'subject', 'item', 'todo'],
  list: ['list', 'listname', 'lists', 'lane', 'column', 'columnname', 'status', 'section', 'stage', 'bucket', 'state', 'board'],
  description: ['desc', 'description', 'notes', 'note', 'details', 'body', 'content'],
  labels: ['labels', 'label', 'tags', 'tag', 'categories', 'category'],
  priority: ['priority', 'importance', 'urgency'],
  due: ['due', 'duedate', 'dueon', 'deadline', 'enddate', 'end', 'date', 'when'],
  start: ['start', 'startdate', 'starton', 'begin'],
  done: ['duecomplete', 'done', 'completed', 'complete', 'iscomplete', 'finished', 'checked'],
  archived: ['closed', 'archived', 'isarchived'],
  checklist: ['checkitems', 'checklists', 'checklist', 'subtasks', 'subtask'],
  key: ['shortlink', 'id', 'cardid', 'taskid', 'key', 'issuekey', 'url', 'shorturl', 'link'],
};
/* letters and digits of any alphabet: a file's columns may be in any language */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const scalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const str = (v) => (v === null || v === undefined ? '' : String(v));
const cellText = (v) => str(v).slice(0, MAX_CELL).trim();

/* ── A file → a table ────────────────────────────────────────────────── */

/** Unique column names: a second "Description" becomes "Description (2)". */
function uniqueNames(names) {
  const taken = new Set();
  return names.map((raw, i) => {
    const base = str(raw).trim().slice(0, 200) || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    taken.add(name);
    return name;
  });
}

function tableFromRows(rows) {
  if (!rows.length) throw new GuideError('empty', 'This file has no rows.');
  const columns = uniqueNames(rows[0].slice(0, MAX_COLUMNS));
  const body = rows.slice(1).map((r) => columns.map((_, i) => cellText(r[i])));
  return finish({ columns, rows: body });
}

const tooMany = (n, what = 'This file') => new GuideError('too_many', `${what} has ${n.toLocaleString('en-GB')} rows. Stack'd imports up to ${MAX_ROWS.toLocaleString('en-GB')} at a time.`);
function finish(table) {
  if (!table.rows.length) throw new GuideError('empty', 'This file has column names and no rows under them.');
  if (table.rows.length > MAX_ROWS) throw tooMany(table.rows.length);
  return table;
}

const nameOf = (o) => (isObj(o) ? str(o.name ?? o.title ?? o.text ?? o.fullName ?? o.username ?? '') : '');
const yes = (v) => v === true || (typeof v === 'string' && /^(true|yes|y|1|x|done|complete|completed)$/i.test(v.trim()));
const doneOf = (o) => o.state === 'complete' || o.state === 'done' || yes(o.checked) || yes(o.done) || yes(o.completed) || yes(o.complete);
const itemLike = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && nameOf(x) !== '')
  && v.some((x) => 'state' in x || 'checked' in x || 'done' in x || 'completed' in x || 'complete' in x);
/** Checklist items as text the guide reads back: one per line, "[x] " in front of a ticked one. */
const itemLines = (items) => items.map((x) => `${doneOf(x) ? '[x]' : '[ ]'} ${nameOf(x).replace(/\s+/g, ' ')}`).join('\n');
/** An object that holds a checklist: one of its values is a list of items with a name and a state. */
const itemsIn = (o) => (isObj(o) ? Object.values(o).find(itemLike) || null : null);

/** The lists of records inside a document, down to two levels: where the tasks may be. */
export function findParts(doc, path = [], depth = 0) {
  if (!isObj(doc)) return [];
  const parts = [];
  for (const [key, v] of Object.entries(doc)) {
    if (Array.isArray(v) && v.length && v.slice(0, 20).every(isObj)) {
      const keys = new Set();
      v.slice(0, 50).forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
      parts.push({ path: [...path, key], count: v.length, keys: [...keys] });
    } else if (isObj(v) && depth < 2) parts.push(...findParts(v, [...path, key], depth + 1));
  }
  return parts;
}
export const partName = (part) => part.path.join(' › ');
const getPath = (doc, path) => path.reduce((o, k) => (isObj(o) ? o[k] : undefined), doc);
/** The part most likely to hold the tasks: a telling name, a title-like field, then the largest. */
export function suggestPart(parts) {
  const score = (p) => (p.path.slice(-2).some((k) => /^(cards?|tasks?|items?|issues?|todos?|rows?|records?|data)$/i.test(k)) ? 1e9 : 0)
    + (p.keys.some((k) => NAMES.title.includes(norm(k))) ? 1e8 : 0) + p.count;
  return [...parts].sort((a, b) => score(b) - score(a))[0] || null;
}

/** Records → a table. A field that holds the id of a record in another part
    of the same file is replaced by that record's name (a list, a member), or
    by its items when it is a checklist: so a file made of several parts
    reads like one table, whatever wrote it (decision 46). */
function tableFromRecords(records, others = []) {
  const index = others.map((p) => {
    const byId = new Map();
    p.items.forEach((o) => { if (isObj(o) && scalar(o.id)) byId.set(String(o.id), o); });
    return { name: p.path.at(-1), byId };
  }).filter((p) => p.byId.size);
  const keys = [];
  const seen = new Set();
  records.forEach((r) => { if (isObj(r)) Object.keys(r).forEach((k) => { if (!seen.has(k) && keys.length < MAX_COLUMNS) { seen.add(k); keys.push(k); } }); });

  /* which other part, if any, a field points into: judged on the values it has */
  const pointsTo = (key) => {
    const values = [];
    for (const r of records) {
      const v = r?.[key];
      if (scalar(v) && v !== '' && typeof v !== 'boolean') values.push(String(v));
      else if (Array.isArray(v)) v.forEach((x) => { if (scalar(x) && typeof x !== 'boolean') values.push(String(x)); });
      if (values.length >= 300) break;
    }
    if (!values.length || key === 'id') return null;
    /* A number that happens to equal an id is not a pointer. A field points
       into a part when its values are that part's ids AND its name says so:
       it is named after the part ("list", "idList", "list_id", "memberIds"),
       or it is plainly an id field and only one part has those ids. */
    const k = norm(key);
    const stem = k.replace(/^ids?(?=.)/, '').replace(/(?<=.)ids?$/, '');
    const isRef = k !== stem;
    const named = (p) => { const n = norm(p.name), one = n.replace(/s$/, ''); return !!stem && (stem === n || stem === one || stem + 's' === n || stem.replace(/s$/, '') === one); };
    const fits = index.map((p) => ({ p, n: values.filter((v) => p.byId.has(v)).length })).filter((x) => x.n >= values.length * 0.8);
    const byName = fits.filter((x) => named(x.p)).sort((a, b) => b.n - a.n)[0];
    if (byName) return byName.p;
    return isRef && fits.length === 1 ? fits[0].p : null;
  };

  const columns = [], cells = [];
  for (const key of keys) {
    const target = pointsTo(key);
    const resolve = (v) => {
      const o = target.byId.get(String(v));
      if (!o) return '';
      const items = itemsIn(o);
      return (items ? itemLines(items) : nameOf(o)).slice(0, MAX_CELL);
    };
    const cell = (v) => {
      if (v === null || v === undefined) return '';
      if (target && scalar(v)) return resolve(v);
      if (scalar(v)) return cellText(v);
      if (Array.isArray(v)) {
        if (target && v.every(scalar)) {
          const parts = v.map(resolve).filter(Boolean);
          return (parts.some((p) => /^\[[ x]\] /.test(p)) ? parts.join('\n') : parts.join(', ')).slice(0, MAX_CELL);
        }
        if (itemLike(v)) return itemLines(v).slice(0, MAX_CELL);
        if (v.every(scalar)) return v.map(String).join(', ').slice(0, MAX_CELL);
        if (v.every(isObj)) {
          const inner = v.map(itemsIn).filter(Boolean);
          if (inner.length) return inner.map(itemLines).join('\n').slice(0, MAX_CELL);
          return v.map(nameOf).filter(Boolean).join(', ').slice(0, MAX_CELL);
        }
      }
      if (isObj(v)) {                              // one record where a list could be: a single item, a list given by name
        if (itemLike([v])) return itemLines([v]).slice(0, MAX_CELL);
        const items = itemsIn(v);
        if (items) return itemLines(items).slice(0, MAX_CELL);
        if (nameOf(v) !== '') return nameOf(v).slice(0, MAX_CELL);
        /* a wrapper around one piece of text: <labels><label>home</label></labels> */
        const keys = Object.keys(v);
        const one = keys.length === 1 ? v[keys[0]] : null;
        if (typeof one === 'string') return cellText(one);
        return '';
      }
      return '';   // a mixed list: not a value a task can take
    };
    const column = records.map((r) => cell(r?.[key]));
    if (!column.some((c) => c !== '') && records.some((r) => isObj(r?.[key]) || Array.isArray(r?.[key]))) continue;   // only objects: no column
    /* a field resolved through another part is named after that part ("idList" → "lists"), unless that name is taken */
    columns.push(target && !seen.has(target.name) && !columns.includes(target.name) ? target.name : key);
    cells.push(column);
  }
  return finish({ columns: uniqueNames(columns), rows: records.map((_, i) => cells.map((c) => c[i])) });
}

/** The table of one part of a document with several (see findParts). */
export function tableFromPart(doc, parts, path) {
  const records = getPath(doc, path);
  if (!Array.isArray(records) || !records.length) throw new GuideError('empty', 'That part of the file has no rows.');
  const others = parts.filter((p) => p.path.join('/') !== path.join('/')).map((p) => ({ path: p.path, items: getPath(doc, p.path) || [] }));
  return tableFromRecords(records.filter(isObj), others);
}

/** A file's text → { kind: 'table', table } or, for a document with several
    lists of records in it, { kind: 'parts', doc, parts, suggested }.
    Throws a GuideError the guide can show. */
export function readFile(name, text) {
  const base = String(name ?? '').toLowerCase();
  const ext = base.includes('.') ? base.split('.').pop() : '';
  const loose = ext === '' || ext === 'txt';    // nothing in the name says what it is: its first characters do
  const body = String(text ?? '').replace(/^\uFEFF/, '');
  if (!body.trim()) throw new GuideError('empty', 'This file is empty.');
  /* text files only here (an Excel file goes through readUpload); anything else is refused, not read as a table of noise */
  if (!['', 'csv', 'tsv', 'txt', 'json', 'xml'].includes(ext) || /^(PK\u0003\u0004|%PDF)/.test(body) || body.slice(0, 4000).includes('\u0000')) {
    throw new GuideError('unreadable', "Stack'd imports CSV, Excel (.xlsx), JSON and XML files. This file is none of those.");
  }
  if (ext === 'json' || (loose && /^\s*[[{]/.test(body))) {
    let doc;
    try { doc = JSON.parse(body); } catch { throw new GuideError('unreadable', 'This file could not be read: it is not valid JSON.'); }
    return fromDocument(doc);
  }
  if (ext === 'xml' || (loose && /^\s*<[?!A-Za-z]/.test(body))) {
    let root;
    try { root = parseXML(body); } catch (e) {
      throw new GuideError('unreadable', /too large/.test(e?.message || '') ? 'This XML file has too many items to read.' : 'This file could not be read: it is not valid XML.');
    }
    if (localName(root.name) === 'Workbook' && Object.values(root.attrs).some((v) => String(v).includes('urn:schemas-microsoft-com:office:spreadsheet'))) {
      throw new GuideError('old_excel', "This is Excel's older XML format (XML Spreadsheet 2003). Open it in Excel, save it as .xlsx, then import that.");
    }
    return fromDocument(toValue(root));
  }
  return { kind: 'table', table: tableFromRows(parseCSV(body)) };
}

/* A document as JSON or XML gives it: a list of records, or a record that
   holds one or several lists of records. */
function fromDocument(doc) {
  if (Array.isArray(doc) && doc.length === 1 && isObj(doc[0])
    && findParts(doc[0]).some((p) => /^(cards?|tasks?|items?|issues?|todos?|rows?|records?|entry|entries)$/i.test(p.path.at(-1)))) doc = doc[0];
  if (Array.isArray(doc)) {
    const records = doc.filter(isObj);
    if (!records.length) throw new GuideError('empty', 'This file has no rows.');
    return { kind: 'table', table: tableFromRecords(records) };
  }
  const parts = findParts(doc);
  if (!parts.length) throw new GuideError('empty', 'This file has no list of items in it.');
  if (parts.length === 1) return { kind: 'table', table: tableFromPart(doc, parts, parts[0].path) };
  return { kind: 'parts', what: 'parts', doc, parts, suggested: suggestPart(parts) };
}

/** A file's bytes → text. Spreadsheets do not all write UTF-8: a file that
    starts with a UTF-16 mark is read as that, and one that is not valid
    UTF-8 as Windows-1252, where an accented letter is one byte. */
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buffer);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { /* not UTF-8 */ }
  /* an XML file says what it is written in */
  const head = String.fromCharCode(...b.subarray(0, 200));
  const said = /^\s*<\?xml[^>]{0,150}\bencoding\s*=\s*["']([\w.:-]{1,40})["']/i.exec(head);
  if (said) { try { return new TextDecoder(said[1]).decode(buffer); } catch { /* a name this device does not know */ } }
  return new TextDecoder('windows-1252').decode(buffer);
}

/** A chosen file → what readFile gives, for every kind the guide reads:
    CSV, JSON, XML as text, and Excel (.xlsx), which is a zip. An Excel file
    with several sheets that have rows comes back as parts, one a sheet,
    the first suggested (decision 50): { kind: 'parts', what: 'sheets', … }.
    Use tableOfPart() for the table of a part, whatever the kind. */
export async function readUpload(name, buffer) {
  const b = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  const ext = String(name ?? '').toLowerCase().split('.').pop();
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) {
    throw new GuideError('old_excel', 'This is an older kind of Excel file (.xls), or one protected with a password. Open it in Excel, save it as .xlsx without a password, then import that.');
  }
  const zipped = b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
  if (ext === 'xlsx' || (zipped && ext !== 'json' && ext !== 'csv')) {
    let book;
    try { if (!zipped) throw new Error('not a zip'); book = await readXLSX(buffer); } catch (e) {
      const why = e?.message || '';
      throw new GuideError('unreadable', /too large/.test(why) ? 'This Excel file is too large to read.'
        : /This browser cannot/.test(why) ? 'This browser cannot open Excel files. Save the sheet as CSV and import that.'
          : 'This file could not be read: it is not an Excel workbook (.xlsx).');
    }
    const sheets = book.sheets.filter((s) => s.rows.length > 1);
    if (!sheets.length) throw new GuideError('empty', book.sheets.length ? 'This Excel file has no sheet with rows under its column names.' : 'This Excel file has no sheet to read.');
    if (sheets.length === 1) {
      if (sheets[0].total - 1 > MAX_ROWS) throw tooMany(sheets[0].total - 1);
      return { kind: 'table', table: tableFromRows(sheets[0].rows) };
    }
    const parts = sheets.map((s) => ({ path: [s.name], count: s.total - 1, keys: s.rows[0].filter(Boolean).map((c) => String(c).slice(0, 40)), rows: s.rows }));
    return { kind: 'parts', what: 'sheets', doc: null, parts, suggested: parts[0] };
  }
  return readFile(name, decodeText(buffer));
}

/** The table of one part of a file read as parts: a sheet's rows, or a list of records inside a document. */
export function tableOfPart(read, part) {
  if (!part.rows) return tableFromPart(read.doc, read.parts, part.path);
  if (part.count > MAX_ROWS) throw tooMany(part.count, 'This sheet');
  return tableFromRows(part.rows);
}

/* ── Columns → fields ────────────────────────────────────────────────── */

const column = (table, name) => { const i = table.columns.indexOf(name); return i === -1 ? null : table.rows.map((r) => r[i]); };
const filled = (table, name) => (column(table, name) || []).filter((c) => c !== '').length;

/** True when no value of the column comes twice: only then can it tell one card from another. */
export function distinct(table, name) {
  const seen = new Set();
  for (const v of column(table, name) || []) { if (v === '') continue; if (seen.has(v)) return false; seen.add(v); }
  return true;
}

/** Which column goes on which field, judged by the columns' names; among
    columns with a fitting name, one that has values wins over an empty one.
    { title: 'Name', list: 'List Name', … , start: null } */
export function guessMapping(table) {
  const used = new Set();
  const mapping = {};
  for (const key of FIELD_KEYS) {
    const found = table.columns
      .map((name) => ({ name, rank: NAMES[key].indexOf(norm(name)), n: filled(table, name) }))
      .filter((c) => c.rank !== -1 && !used.has(c.name))
      .sort((a, b) => (b.n > 0) - (a.n > 0) || a.rank - b.rank)[0];
    mapping[key] = found ? found.name : null;
    if (found) used.add(found.name);
  }
  if (mapping.key && !distinct(table, mapping.key)) mapping.key = null;
  /* a table needs a title: failing a name, the first column that mostly has text */
  if (!mapping.title) {
    mapping.title = table.columns.find((name) => !used.has(name) && filled(table, name) >= table.rows.length / 2) || table.columns[0] || null;
  }
  return mapping;
}

/** A short name for the layout of a file: the same columns give the same signature. */
export function signature(columns) {
  let h = 5381;
  for (const c of columns.map(norm).join('|')) h = ((h << 5) + h + c.codePointAt(0)) >>> 0;
  return `c${columns.length}-${h.toString(36)}`;
}

/* ── Reading values ──────────────────────────────────────────────────── */

export const truthy = (v) => /^(true|yes|y|1|x|done|complete|completed|✓)$/i.test(str(v).trim());

const COLOURS = /^(green|yellow|orange|red|purple|blue|sky|lime|pink|black|grey|gray|white|brown|teal|violet|amber)(_(light|dark))?$/i;
/** "home (blue_light), Q3; #urgent" → ['home', 'Q3', 'urgent']: a colour in brackets after a name is dropped. */
export function parseLabels(cell) {
  const seen = new Set();
  return str(cell).split(/[,;\n]/).map((raw) => {
    let s = raw.trim().replace(/^#+/, '');
    const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(s);
    if (m && COLOURS.test(m[2].trim())) s = m[1].trim();
    return s.slice(0, 64);
  }).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, MAX_LABELS);
}

/** Lines of a checklist → [{ title, done }]. "[x] ", "- [ ] ", a leading "✓" or a trailing "(done)" are read. */
export function parseChecklist(cell) {
  const text = str(cell).slice(0, MAX_CELL);
  /* one item a line; a single line is split at ; or | unless it is written as a box, which may hold either */
  const lines = /\n/.test(text) || /^\s*(?:[-*•]\s+)?\[[ xX✓]?\]/.test(text) ? text.split(/\r?\n/) : text.split(/[;|]/);
  return lines.map((raw) => {
    let s = raw.trim().replace(/^[-*•]\s+/, '');
    let done = false;
    const box = /^\[( |x|X|✓)?\]\s*(.*)$/.exec(s);
    if (box) { done = !!box[1] && box[1] !== ' '; s = box[2]; }
    else if (/^[✓✔]\s*/.test(s)) { done = true; s = s.replace(/^[✓✔]\s*/, ''); }
    const tail = /^(.*\S)\s*\((done|complete|completed|checked)\)$/i.exec(s);
    if (tail) { done = true; s = tail[1]; }
    return { title: s.trim().slice(0, 500), done };
  }).filter((x) => x.title).slice(0, MAX_SUBTASKS);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
const hm = (h, m) => (h === undefined || h === null || +h > 23 || +m > 59 ? null : `${pad(+h)}:${pad(+m)}`);
/* a clock time, with or without seconds and a.m. / p.m. */
const TIME = '(?:[ ,T]+(\\d{1,2}):(\\d{2})(?::\\d{2}(?:[.,]\\d+)?)?(?:\\s*([AaPp])\\.?[Mm]\\.?)?)?';
const ZONE = '(?:\\s*(Z|UTC|GMT|[+-]\\d{2}(?::?\\d{2})?))?';
const RE = {
  iso: new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${TIME}${ZONE}$`),
  ymd: new RegExp(`^(\\d{4})[/.](\\d{1,2})[/.](\\d{1,2})${TIME}$`),
  num: new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})${TIME}$`),
  dmon: new RegExp(`^(\\d{1,2})\\s+([A-Za-z]{3,9})\\.?,?\\s+(\\d{4})${TIME}$`),
  mond: new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${TIME}$`),
};
/** A real day → 'YYYY-MM-DD', else null. A year written with two digits is 1970 to 2069. */
function ymd(y, m, d) {
  if (String(y).length <= 2) y = +y + (+y >= 70 ? 1900 : 2000);
  y = +y; m = +m; d = +d;
  const t = new Date(y, m - 1, d);
  return y >= 1900 && y <= 2200 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
function clock(h, m, ap) {
  if (h === undefined) return null;
  let hour = +h;
  if (ap) { if (hour < 1 || hour > 12) return null; hour = (hour % 12) + (/p/i.test(ap) ? 12 : 0); }
  return hm(hour, m);
}
const month = (name) => { const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase()); return i === -1 || !MONTHS_FULL[i].startsWith(name.toLowerCase().replace(/\.$/, '')) ? 0 : i + 1; };
const timed = (date, time) => (date ? { date, time: time === '00:00' ? null : time } : null);

/** A date as files write it → { date: 'YYYY-MM-DD', time: 'HH:MM' | null }, or null.
    order: 'dmy' or 'mdy', for 03/04/2026. Midnight counts as no time. A
    moment written with a time zone is read in this device's zone, unless it
    is midnight there: that is how a tool writes a day with no time, and the
    day stays the one written. */
export function parseDate(cell, order = 'dmy') {
  const s = str(cell).trim().slice(0, 60);
  if (!s) return null;
  let m = RE.iso.exec(s);
  if (m) {
    const date = ymd(m[1], m[2], m[3]);
    if (!date) return null;
    const time = clock(m[4], m[5], m[6]);
    if (m[4] !== undefined && !time) return null;
    if (!m[7] || !time || time === '00:00') return timed(date, time);
    const z = /^[+-]/.test(m[7]) ? (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +(m[7].replace(':', '').slice(3, 5) || 0)) : 0;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +time.slice(0, 2), +time.slice(3)) - z * 60000);
    return timed(`${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, hm(t.getHours(), t.getMinutes()));
  }
  const tail = (mm, at) => { const time = clock(mm[at], mm[at + 1], mm[at + 2]); return mm[at] !== undefined && !time ? undefined : time; };
  m = RE.ymd.exec(s);
  if (m) { const time = tail(m, 4); return time === undefined ? null : timed(ymd(m[1], m[2], m[3]), time); }
  m = RE.num.exec(s);
  if (m) { const time = tail(m, 4); return time === undefined ? null : timed(order === 'mdy' ? ymd(m[3], m[1], m[2]) : ymd(m[3], m[2], m[1]), time); }
  m = RE.dmon.exec(s);
  if (m && month(m[2])) { const time = tail(m, 4); return time === undefined ? null : timed(ymd(m[3], month(m[2]), m[1]), time); }
  m = RE.mond.exec(s);
  if (m && month(m[1])) { const time = tail(m, 4); return time === undefined ? null : timed(ymd(m[3], month(m[1]), m[2]), time); }
  return null;
}

/** How the day and the month are ordered in dates written 03/04/2026:
    'dmy' or 'mdy' when the values settle it, 'ambiguous' when they do not,
    'none' when no date is written that way. */
export function dateOrderOf(values) {
  let day = false, month = false, any = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(str(v).trim());
    if (!m) continue;
    any = true;
    if (+m[1] > 12) day = true;
    if (+m[2] > 12) month = true;
  }
  return !any ? 'none' : day && !month ? 'dmy' : month && !day ? 'mdy' : 'ambiguous';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Text as other tools keep it (Markdown, mostly) → a description: bold,
    italic and struck text become formatting, a link becomes its text and its
    address, list and heading marks stay as typed. The file's own angle
    brackets are text, never markup. */
export function toDescription(text, max = 20000) {
  const raw = str(text).replace(/\r\n?/g, '\n');
  let out = describe(raw.slice(0, max));
  /* escaping makes text longer: cut the source until what is kept fits, so nothing is cut in the middle of a mark */
  for (let keep = max; out.length > max && keep > 0;) { keep = Math.floor(keep * (max / out.length) * 0.98); out = describe(raw.slice(0, keep)); }
  return out;
}
function describe(text) {
  let s = text.replace(/[&<>"']/g, (c) => ESC[c]);
  s = s.replace(/\[([^\][\n]{1,500})\]\(\s*([^\s()]{1,2000})(?:\s+(?:&quot;|&#39;)[^()\n]{0,500})?\s*\)/g, (_, label, url) => (label.trim() === url.trim() ? url : `${label} (${url})`));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>').replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>');
  return sanitize(s.replace(/\n/g, '<br>'));
}

/* ── What the file holds, for the guide's questions ──────────────────── */

const tally = (values) => {
  const m = new Map();
  values.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  return [...m].map(([name, count]) => ({ name, count }));
};

/** { rows, untitled, lists: [{ name, count }], labels: [{ name, count }],
      dates: 'none' | 'dmy' | 'mdy' | 'ambiguous', archived, done,
      unused: [{ column, rows }] } */
export function analyse(table, mapping) {
  const col = (key) => (mapping[key] ? column(table, mapping[key]) : null);
  const titles = col('title') || [];
  const lists = col('list');
  const labels = col('labels');
  const placed = new Set(Object.values(mapping).filter(Boolean));
  return {
    rows: table.rows.length,
    untitled: titles.filter((t) => !t.trim()).length,
    lists: lists ? tally(lists.map((v) => v.trim()).filter(Boolean)) : [],
    labels: labels ? tally(labels.flatMap(parseLabels)) : [],
    dates: dateOrderOf([...(col('due') || []), ...(col('start') || [])]),
    archived: (col('archived') || []).filter(truthy).length,
    done: (col('done') || []).filter(truthy).length,
    unused: table.columns.filter((c) => !placed.has(c)).map((c) => ({ column: c, rows: filled(table, c) })).filter((x) => x.rows > 0),
  };
}

/** Where a list of the file goes when nobody has said: Done for a list
    called done, a lane of the same name, else a new lane with its name. */
export function defaultListChoice(name, lanes = []) {
  if (/^(done|completed?|finished|closed)$/i.test(name.trim())) return { kind: 'done' };
  const lane = lanes.find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase());
  return lane ? { kind: 'lane', id: lane.id } : { kind: 'new', name: name.trim().slice(0, 80) };
}

/* ── The plan ────────────────────────────────────────────────────────── */

const same = (a, b) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();

/** The table and the answers → what an import would do. Changes nothing.
    answers: { mapping, lists: { [name]: { kind: 'lane', id } | { kind: 'new', name } | { kind: 'done' } },
               labels: { [name]: 'keep' | 'drop' | { priority: id } },
               dateOrder: 'dmy' | 'mdy', archived: 'leave' | 'archive' | 'active', repeats: 'skip' | 'import' }
    ctx: { lanes: [{ id, name }] of the board the tasks go to ([] for a new board),
           existing: [{ title, lane, importKey }] the tasks that count for "imported before"
                     (on the target board for titles, anywhere for keys),
           priorities: [{ id, name }] }
    → { items, skipped, leftOut: { untitled, archived }, counts: { done, lanes, labels } }
    An item: { title, description, tags, priority, due, dueTime, start, done, archived,
               lane: { id } | { name }, subtasks: [{ title, done }], key } */
export function plan(table, answers, ctx) {
  const { mapping } = answers;
  const at = (key) => (mapping[key] ? table.columns.indexOf(mapping[key]) : -1);
  const idx = Object.fromEntries(FIELD_KEYS.map((k) => [k, at(k)]));
  const get = (row, key) => (idx[key] === -1 ? '' : str(row[idx[key]]));
  const order = answers.dateOrder === 'mdy' ? 'mdy' : 'dmy';
  const fallback = ctx.lanes.find((l) => l.id !== 'done') ? { id: ctx.lanes.find((l) => l.id !== 'done').id } : { name: 'Backlog' };
  const keysHere = new Set(ctx.existing.map((t) => t.importKey).filter(Boolean));
  const titlesHere = new Set(ctx.existing.map((t) => `${t.lane}\n${str(t.title).trim().toLowerCase()}`));
  const out = { items: [], skipped: 0, leftOut: { untitled: 0, archived: 0, priority: 0 }, counts: { done: 0, lanes: 0, labels: 0 } };
  const newLanes = new Set(), labelsUsed = new Set();

  for (const row of table.rows) {
    const title = get(row, 'title').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!title) { out.leftOut.untitled++; continue; }
    const archived = truthy(get(row, 'archived'));
    if (archived && answers.archived !== 'archive' && answers.archived !== 'active') { out.leftOut.archived++; continue; }

    const listName = get(row, 'list').trim();
    const choice = listName ? (own(answers.lists, listName) ? answers.lists[listName] : defaultListChoice(listName, ctx.lanes)) : null;
    let done = truthy(get(row, 'done'));
    let lane = fallback;
    if (choice?.kind === 'done') { done = true; lane = { id: 'done' }; }
    else if (choice?.kind === 'lane' && ctx.lanes.some((l) => l.id === choice.id)) lane = { id: choice.id };
    else if (choice?.kind === 'new' && str(choice.name).trim()) {
      const existing = ctx.lanes.find((l) => same(l.name, choice.name));
      const fresh = str(choice.name).trim().slice(0, 80);
      /* past fifty new lanes a board is no longer a board: the rest go to its first lane */
      lane = existing ? { id: existing.id } : newLanes.has(fresh.toLowerCase()) || newLanes.size < MAX_NEW_LANES ? { name: fresh } : fallback;
    }
    if (done) lane = { id: 'done' };   // a finished card lives in Done, as in the app

    const written = get(row, 'key').trim().slice(0, 160);
    const key = written ? `${ctx.keyPrefix || 'file'}:${written}` : '';
    const laneRef = lane.id || `new:${lane.name.toLowerCase()}`;
    const before = key ? keysHere.has(key) : titlesHere.has(`${laneRef}\n${title.toLowerCase()}`);
    if (before && answers.repeats !== 'import') { out.skipped++; continue; }

    const tags = []; let priority = 'none';
    for (const label of parseLabels(get(row, 'labels'))) {
      const what = own(answers.labels, label) ? answers.labels[label] : 'keep';
      if (what === 'drop') continue;
      if (isObj(what) && ctx.priorities.some((p) => p.id === what.priority)) { priority = what.priority; continue; }
      tags.push(label);
    }
    const named = get(row, 'priority').trim();
    if (named) { const p = ctx.priorities.find((x) => same(x.name, named)); if (p) priority = p.id; else out.leftOut.priority++; }

    const due = parseDate(get(row, 'due'), order);
    const start = parseDate(get(row, 'start'), order);
    out.items.push({
      title,
      description: toDescription(get(row, 'description')),
      tags, priority,
      due: due?.date ?? null, dueTime: due ? due.time : null,
      start: start && (!due || start.date <= due.date) ? start.date : null,
      done, archived: archived && answers.archived === 'archive',
      lane, subtasks: parseChecklist(get(row, 'checklist')),
      key: key || null,
    });
    if (done) out.counts.done++;
    if (lane.name) newLanes.add(lane.name.toLowerCase());
    tags.forEach((t) => labelsUsed.add(t.toLowerCase()));
  }
  out.counts.lanes = newLanes.size;
  out.counts.labels = labelsUsed.size;
  return out;
}
