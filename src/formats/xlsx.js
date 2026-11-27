/* An Excel file (.xlsx), read without a library (PRD 1.7.0 §06.1): it is a
   zip of XML parts. A relationships part says where the workbook is, the
   workbook names the sheets, its own relationships say which file each one
   is and where the shared strings and the styles are; the shared strings
   hold the text, the styles say which numbers are dates, and each sheet
   lists its cells.

   → { sheets: [{ name, rows: string[][], total }] }: every cell as text,
   as a CSV would have it. A date is written 2026-12-01 or 2026-12-01 14:05,
   a time of day 14:05, yes and no as TRUE and FALSE. total is the number
   of rows with something in them, which can be more than the rows kept.

   A file is untrusted: the zip's parts are inflated up to a limit each and
   up to a limit for the whole workbook (a small file can claim to unpack
   to gigabytes), rows, columns and the length of a cell are capped, each
   cell kept is a copy so it does not hold its whole sheet in memory, and
   the XML is read by src/formats/xml.js, which expands nothing. Pure
   except for the platform's DecompressionStream; scripts/check-import.mjs
   runs it under Node on files it builds itself. */

import { entries, readEntry } from '../docx.js';
import { scan as scanXML, attrs, localName } from './xml.js';

const MB = 1024 * 1024;
const MAX_TOTAL = 96 * MB;             // everything unpacked from one workbook
const MAX_SHEET = 48 * MB;             // one sheet, or the shared strings
const MAX_SMALL = 4 * MB;              // the workbook, a relationships part
const MAX_STYLES = 16 * MB;
const MAX_SHEETS = 50;
const MAX_ROWS = 6000;                 // a little over what the guide imports; the rest are counted, not kept
const MAX_COLUMNS = 200;
const MAX_STRINGS = 500000;
const MAX_STYLE_COUNT = 100000;
const MAX_CELL = 32767;                // what a cell of Excel holds

/* Some programs write every element with a prefix (<x:row>, <x:c>): the
   name after the colon is the one that counts. */
const scan = (xml, h) => scanXML(xml, {
  open: h.open && ((name, inside, self) => h.open(localName(name), inside, self)),
  close: h.close && ((name) => h.close(localName(name))),
  text: h.text,
});
const relId = (a) => a['r:id'] || Object.keys(a).filter((k) => k.endsWith(':id')).map((k) => a[k])[0] || a.id || '';

/* A cell kept is a copy: a piece cut from a sheet's text would keep all of
   that text in memory for as long as the cell lives. */
const copy = (s) => { const t = s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s; return t.length < 13 ? t : (' ' + t).slice(1); };
/* Excel writes a character XML cannot hold as _x000D_ */
const unescape = (s) => (s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : s).replace(/\r\n?/g, '\n');

/* ── which numbers are dates ─────────────────────────────────────────── */

/* Excel's own date formats, and any custom one that has a day, month,
   year, hour or second letter once the parts that are not letters of the
   format are taken out: text in quotes, [colours and conditions], \x and
   _x and *x (a character shown, a space as wide as x, x repeated). A
   format with a digit place (0 # ?) is a number, whatever unit follows
   it, unless the place is a fraction of a second. */
const BUILT_IN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);   // not 46, [h]:mm:ss, a length of time
function kindOfCode(code) {
  const first = String(code).split(';')[0];
  if (/\[(h+|m+|s+)\]/i.test(first)) return 'number';             // hours that run past 24: a length of time
  const bare = first.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/[\\_*]./g, '').replace(/s\.0+/gi, 's');
  if (/^(general|standard)$/i.test(bare.trim()) || /[0#?]/.test(bare)) return 'number';
  return /[dmyhs]/i.test(bare) ? 'date' : 'number';
}

/** For each cell style, whether it shows a number as a date. */
function dateStyles(xml) {
  const custom = new Map();
  const styles = [];
  let inXfs = false;
  scan(xml, {
    open: (name, inside) => {
      if (name === 'numFmt') { const a = attrs(inside); if (custom.size < MAX_STYLE_COUNT) custom.set(+a.numFmtId, kindOfCode(a.formatCode || '') === 'date'); }
      else if (name === 'cellXfs') inXfs = true;
      else if (name === 'xf' && inXfs && styles.length < MAX_STYLE_COUNT) {
        const id = +(attrs(inside).numFmtId || 0);
        styles.push(custom.has(id) ? custom.get(id) : BUILT_IN.has(id));
      }
    },
    close: (name) => { if (name === 'cellXfs') inXfs = false; },
  });
  return styles;
}

function sharedStrings(xml) {
  const out = [];
  let cur = null, inT = false, skip = 0;
  scan(xml, {
    open: (name, _inside, self) => {
      if (name === 'si') cur = '';
      else if (name === 'rPh') skip++;                       // a phonetic guide, not the text
      else if (name === 't' && !self && cur !== null && !skip) inT = true;
    },
    close: (name) => {
      if (name === 'si') { if (out.length < MAX_STRINGS) out.push(copy(unescape(cur ?? ''))); cur = null; }
      else if (name === 'rPh') skip = Math.max(0, skip - 1);
      else if (name === 't') inT = false;
    },
    text: (t) => { if (inT && cur.length <= MAX_CELL) cur += t; },
  });
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
/** Excel's day number → '2026-12-01' or '2026-12-01 14:05'; a number under
    one day is a time of day, '14:05'. Day 1 is 1 January 1900 (or 1904 in
    old Mac files). */
export function serialToDate(serial, date1904 = false) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return '';
  let days = Math.floor(serial);
  let minutes = Math.round((serial - days) * 1440);
  if (minutes >= 1440) { minutes = 0; days += 1; }
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  if (days === 0) return time;
  const t = new Date(Date.UTC(1899, 11, 30) + (days + (date1904 ? 1462 : 0)) * 86400000);
  const day = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return minutes ? `${day} ${time}` : day;
}

/* A number as a person typed it: Excel stores 0.3 as 0.30000000000000004,
   and shows fifteen digits. */
const tidyNumber = (v) => (/[.eE]/.test(v) && /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) ? String(+(+v).toPrecision(15)) : v);

/** 'AB12' → 27: the column a cell is in, from its reference. */
const columnOf = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length && i < 4; i++) { const c = ref.charCodeAt(i); if (c >= 65 && c <= 90) n = n * 26 + (c - 64); else if (c >= 97 && c <= 122) n = n * 26 + (c - 96); else break; }
  return n - 1;
};

function sheetRows(xml, strings, styles, date1904) {
  const rows = [];
  let total = 0;
  let row = null, filled = false, cell = null, inV = false, inT = false, next = 0;
  scan(xml, {
    open: (name, inside, self) => {
      if (name === 'row') { row = []; filled = false; next = 0; }
      else if (name === 'c' && row) {
        const a = attrs(inside);
        const at = a.r ? columnOf(a.r) : next;
        cell = { at: at >= 0 ? at : next, t: a.t || 'n', s: +(a.s || 0), v: '' };
        next = cell.at + 1;
      } else if (cell && !self && name === 'v') inV = true;
      else if (cell && !self && name === 't') inT = true;
    },
    close: (name) => {
      if (name === 'v') inV = false;
      else if (name === 't') inT = false;
      else if (name === 'c' && cell) {
        let v = cell.v;
        if (cell.t === 's') v = v === '' ? '' : strings[+v] ?? '';
        else if (cell.t === 'b') v = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (cell.t === 'e') v = '';
        else if (cell.t === 'n' && v !== '') v = styles[cell.s] ? serialToDate(+v, date1904) : tidyNumber(v);
        else if (cell.t !== 'n') v = copy(unescape(v));           // text written in the cell, or a formula's text
        if (row && v !== '' && cell.at < MAX_COLUMNS) {
          filled = true;
          if (rows.length < MAX_ROWS) { while (row.length < cell.at) row.push(''); row[cell.at] = String(v); }   // past the limit a row is counted, not kept
        }
        cell = null;
      } else if (name === 'row' && row) {
        if (filled) { total++; if (rows.length < MAX_ROWS) rows.push(row); }
        row = null;
      }
    },
    text: (t) => { if (cell && (inV || inT) && cell.v.length <= MAX_CELL) cell.v += t; },
  });
  return { rows, total };
}

/* ── where the parts are ─────────────────────────────────────────────── */

/** A relationship's Target, from the folder of the part that names it → a path in the zip. */
function resolve(dir, target) {
  const out = [];
  for (const seg of (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}
const dirOf = (path) => path.split('/').slice(0, -1).join('/');
const relsOf = (path) => { const parts = path.split('/'); const file = parts.pop(); return [...parts, '_rels', `${file}.rels`].join('/'); };

/** @param {ArrayBuffer} buffer @returns {Promise<{ sheets: { name: string, rows: string[][], total: number }[] }>}
    Throws when the file is not an Excel workbook, or unpacks to too much. Hidden sheets are left out. */
export async function readXLSX(buffer) {
  /* names as the zip spells them, found whatever their capitals */
  const names = new Map();
  for (const e of entries(buffer)) if (!names.has(e.name.toLowerCase())) names.set(e.name.toLowerCase(), e.name);
  let left = MAX_TOTAL;
  const part = async (path, max) => {
    const name = names.get(String(path).toLowerCase());
    if (!name) return null;
    const text = await readEntry(buffer, name, Math.min(max, left));
    left -= text.length;
    return text;
  };
  const relationships = async (path) => {
    const out = [];
    const xml = await part(path, MAX_SMALL);
    if (xml) scan(xml, { open: (name, inside) => { if (name === 'Relationship' && out.length < 1000) { const a = attrs(inside); out.push({ id: a.Id || '', type: String(a.Type || ''), target: String(a.Target || ''), outside: a.TargetMode === 'External' }); } } });
    return out.filter((r) => !r.outside && r.target);
  };

  const main = (await relationships('_rels/.rels')).find((r) => /\/officeDocument$/.test(r.type));
  const bookPath = main && names.has(resolve('', main.target).toLowerCase()) ? resolve('', main.target) : 'xl/workbook.xml';
  const workbook = await part(bookPath, MAX_SMALL);
  if (workbook === null) throw new Error('not an Excel workbook');
  const sheets = [];
  let date1904 = false;
  scan(workbook, {
    open: (name, inside) => {
      if (name === 'sheet' && sheets.length < MAX_SHEETS) { const a = attrs(inside); if (a.state !== 'hidden' && a.state !== 'veryHidden') sheets.push({ name: String(a.name || `Sheet ${sheets.length + 1}`).slice(0, 80), rid: relId(a) }); }
      else if (name === 'workbookPr') { const a = attrs(inside); date1904 = a.date1904 === '1' || a.date1904 === 'true'; }
    },
  });
  const dir = dirOf(bookPath);
  const rels = await relationships(relsOf(bookPath));
  const byId = new Map(rels.map((r) => [r.id, resolve(dir, r.target)]));
  const byType = (end, usual) => { const r = rels.find((x) => x.type.endsWith(end)); return r ? resolve(dir, r.target) : resolve(dir, usual); };
  const stringsXml = await part(byType('/sharedStrings', 'sharedStrings.xml'), MAX_SHEET);
  const strings = stringsXml ? sharedStrings(stringsXml) : [];
  const stylesXml = await part(byType('/styles', 'styles.xml'), MAX_STYLES);
  const styles = stylesXml ? dateStyles(stylesXml) : [];

  const out = [];
  for (const [i, s] of sheets.entries()) {
    /* the usual file names are a guess only for a workbook that says nothing about where its sheets are */
    const path = byId.get(s.rid) || (rels.length ? '' : resolve(dir, `worksheets/sheet${i + 1}.xml`));
    if (!path || !names.has(path.toLowerCase())) continue;
    let xml;
    try { xml = await part(path, MAX_SHEET); } catch (e) {
      if (out.length && /too large/.test(e?.message || '')) break;   // the sheets read so far are what there is room for
      throw e;
    }
    out.push({ name: s.name, ...sheetRows(xml, strings, styles, date1904) });
  }
  return { sheets: out };
}
