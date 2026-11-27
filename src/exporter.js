/* Export (PRD 1.7.0 §06.2): tasks → a file, in six formats. Pure: it is
   handed the state ({ lists, tasks, priorities }) and returns bytes, so
   scripts/check-export.mjs runs every format under Node and reads the
   spreadsheet formats back through the import guide's reader.

   Three steps decide what goes in: which boards (with done and archived
   tasks or not), which fields, which type of file. Deleted tasks never do.

   - CSV, Excel, JSON and XML hold one row (one record) a task, one column
     a field, under the names of the Fields step, so a file Stack'd wrote
     imports back with every column placed. In CSV, JSON and XML a
     description is written with the marks the importer reads (**bold**,
     *italic*, ~~struck~~), a checklist one item a line with [x] or [ ], a
     date as 2026-12-01 or 2026-12-01 09:00. Excel has real dates in the
     person's date format, and a description as formatted text in its cell
     (read back, its text comes in without the formatting).
   - Word and PDF are for reading: a heading a board, a heading a list when
     grouped by list, each task with a line of what is known about it, its
     description with its formatting, and its subtasks as boxes (decision
     20). Dates are in the person's date format. No cover page, no colour.

   Text from tasks is the person's own, but it may have come from a file:
   every writer escapes it for its format, CSV cells that a spreadsheet
   would run as a formula are written as text, and characters a format
   cannot hold are left out. */

import { zipStore } from './formats/zip.js';
import { xmlText } from './formats/xml.js';
import { writeXLSX } from './formats/xlsx-write.js';
import { writeDOCX } from './formats/docx-write.js';
import { writePDF, pdfCannotShow } from './formats/pdf.js';

/* ── What can go in ──────────────────────────────────────────────────── */

/** [key, name in the file and on the Fields page, ticked at first] (decision 53). */
export const EXPORT_FIELDS = [
  ['board', 'Board', true], ['list', 'List', true], ['title', 'Title', true], ['description', 'Description', true],
  ['labels', 'Labels', true], ['priority', 'Priority', true], ['due', 'Due date', true], ['start', 'Start date', true],
  ['done', 'Done', true], ['subtasks', 'Subtasks', true],
  ['archived', 'Archived', false], ['repeat', 'Repeat', false], ['reminder', 'Reminder', false],
  ['created', 'Created on', false], ['completed', 'Completed on', false],
];
export const DEFAULT_FIELDS = EXPORT_FIELDS.filter(([, , on]) => on).map(([k]) => k);
const LABEL = Object.fromEntries(EXPORT_FIELDS.map(([k, l]) => [k, l]));

/** [key, name, file extension, type] in the order the Type of file page lists them. */
export const FORMATS = [
  ['xlsx', 'Excel', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['csv', 'CSV', 'csv', 'text/csv'],
  ['pdf', 'PDF', 'pdf', 'application/pdf'],
  ['docx', 'Word', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['json', 'JSON', 'json', 'application/json'],
  ['xml', 'XML', 'xml', 'application/xml'],
];

const RECUR = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const REMIND = { 0: 'At time of due', 10: '10 minutes before', 60: '1 hour before', 1440: '1 day before', 2880: '2 days before' };
const DONE_LANE = 'done';
const lanesOf = (list) => (Array.isArray(list?.lanes) && list.lanes.length ? list.lanes
  : [{ id: 'backlog', name: 'Backlog' }, { id: 'inprogress', name: 'In Progress' }, { id: DONE_LANE, name: 'Done' }]);

/* ── Which tasks ─────────────────────────────────────────────────────── */

/** The tasks chosen, in board order, then lane order, then the order on the board. */
export function selectTasks(state, { boardIds, done = true, archived = false }) {
  const chosen = new Set(boardIds);
  const out = [];
  for (const list of state.lists) {
    if (!chosen.has(list.id) || (list.status ?? 'active') !== 'active') continue;
    const lanes = lanesOf(list).map((l) => l.id);
    const rank = (t) => { const i = lanes.indexOf(t.lane); return i === -1 ? lanes.length : i; };
    const tasks = state.tasks.filter((t) => t.listId === list.id
      && (t.status === 'active' || (archived && t.status === 'archived'))
      && (done || !t.done));
    tasks.sort((a, b) => rank(a) - rank(b) || (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    out.push(...tasks);
  }
  return out;
}

/* ── A task as values ────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const localStamp = (ms) => { if (!ms) return null; const d = new Date(ms); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const isoDay = (v) => {
  const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(2000, +m[2] - 1, +m[3]));
  d.setUTCFullYear(+m[1]);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? v : null;
};
const isoTime = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
/* Text as every format can hold it: no control characters other than tab and line breaks, no half of a character on its own. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (v) => String(v ?? '').replace(CONTROL, '');

/** One task → { key: value } for every field: text, a list of labels, a
    day ({ date, time }), yes or no, subtasks ({ title, done }) or the
    description as it is kept (the rich text subset of notes). */
export function taskValues(state, t) {
  const list = state.lists.find((l) => l.id === t.listId);
  const lane = lanesOf(list).find((l) => l.id === t.lane);
  const due = isoDay(t.due);
  return {
    board: clean(list?.name),
    list: clean(lane?.name || (t.lane === DONE_LANE ? 'Done' : '')),
    title: clean(t.title),
    description: clean(t.description),
    labels: Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string' && x).map(clean) : [],
    priority: t.priority && t.priority !== 'none' ? clean(state.priorities.find((p) => p.id === t.priority)?.name) : '',
    due: due ? { date: due, time: isoTime(t.dueTime) } : null,
    start: isoDay(t.start) ? { date: t.start, time: null } : null,
    done: !!t.done,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && typeof s === 'object').map((s) => ({ title: clean(s.title ?? s.text), done: !!s.done })).filter((s) => s.title) : [],
    archived: t.status === 'archived',
    repeat: RECUR[t.recur] || '',
    reminder: t.due && t.reminder !== null && t.reminder !== undefined ? REMIND[t.reminder] || '' : '',
    created: localStamp(t.createdAt),
    completed: t.done || (t.recur && t.recur !== 'none') ? localStamp(t.lastCompletedAt) : null,
  };
}

/* ── Values as text ──────────────────────────────────────────────────── */

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] !== '#') return ENTITY[e.toLowerCase()] ?? all;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : '';
});

/** A description → the lines of runs it is made of: [[{ text, b, i, u, s }]].
    The description is already cleaned to b, i, u, s and br; anything else
    is dropped and its text kept. */
export function richLines(html) {
  const lines = [[]];
  const on = { b: 0, i: 0, u: 0, s: 0 };
  const re = /<(\/?)([a-z]+)[^>]*>|([^<]+)/gi;
  for (let m; (m = re.exec(String(html ?? '')));) {
    if (m[3] !== undefined) {
      const text = decode(m[3]);
      if (text) lines.at(-1).push({ text, b: on.b > 0, i: on.i > 0, u: on.u > 0, s: on.s > 0 });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (tag === 'br') { lines.push([]); continue; }
    const k = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'strike' || tag === 'del' ? 's' : tag;
    if (k in on) on[k] = Math.max(0, on[k] + (m[1] ? -1 : 1));
  }
  while (lines.length > 1 && !lines.at(-1).length) lines.pop();
  return lines.length === 1 && !lines[0].length ? [] : lines;
}

/** A description → text with the marks the importer reads back: **bold**, *italic*, ~~struck~~. */
export function toMarkdown(html) {
  return richLines(html).map((runs) => runs.map((r) => {
    if (!r.text.trim()) return r.text.replace(/[\\*_~]/g, '\\$&');
    const lead = r.text.match(/^\s*/)[0], tail = r.text.match(/\s*$/)[0];
    let core = r.text.trim().replace(/[\\*_~]/g, '\\$&');
    if (r.s) core = `~~${core}~~`;
    if (r.i) core = `*${core}*`;
    if (r.b) core = `**${core}**`;
    return lead + core + tail;
  }).join('')).join('\n');
}

const dayText = (d) => (d ? (d.time ? `${d.date} ${d.time}` : d.date) : '');
const checklistText = (items) => items.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title.replace(/\s+/g, ' ')}`).join('\n');

/** A value as one cell of text, for CSV and the text cells of Excel. */
function cellText(key, v) {
  if (key === 'description') return toMarkdown(v);
  if (key === 'labels') return v.join(v.some((l) => /[,;\n]/.test(l)) ? '\n' : ', ');
  if (key === 'subtasks') return checklistText(v);
  if (key === 'done' || key === 'archived') return v ? 'Yes' : 'No';
  if (v && typeof v === 'object' && 'date' in v) return dayText(v);
  return v ?? '';
}


/* ── The six formats ─────────────────────────────────────────────────── */

/* A cell a spreadsheet would run as a formula starts with one of these. It
   is written with a ' in front, which spreadsheets show as text and the
   import guide takes off again. */
const FORMULA = /^'*[=+\-@\t\r]/;
function csv(records, fields) {
  const cell = (s) => {
    let t = String(s).replace(/\r\n?/g, '\n');
    if (FORMULA.test(t)) t = `'${t}`;
    return /[",\n]|^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [fields.map((k) => cell(LABEL[k])).join(',')];
  for (const r of records) lines.push(fields.map((k) => cell(cellText(k, r[k]))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;   // the mark tells Excel the file is UTF-8, so accents survive
}

function json(records, fields) {
  const value = (k, v) => {
    if (k === 'description') return toMarkdown(v);
    if (k === 'subtasks') return v.map((s) => ({ title: s.title, done: s.done }));
    if (v && typeof v === 'object' && 'date' in v) return dayText(v);
    return v ?? null;
  };
  return `${JSON.stringify(records.map((r) => Object.fromEntries(fields.map((k) => [LABEL[k], value(k, r[k])]))), null, 2)}\n`;
}

const tagOf = (k) => LABEL[k].toLowerCase().replace(/\s+/g, '-');
function xml(records, fields, at) {
  const el = (name, inner) => (inner === '' ? `<${name}/>` : `<${name}>${inner}</${name}>`);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>\n<tasks exported="${xmlText(at)}" app="Stack'd">`];
  for (const r of records) {
    const parts = fields.map((k) => {
      const v = r[k];
      if (k === 'labels') return el('labels', v.map((x) => el('label', xmlText(x))).join(''));
      if (k === 'subtasks') return el('subtasks', v.map((s) => `<subtask><title>${xmlText(s.title)}</title><done>${s.done}</done></subtask>`).join(''));
      if (k === 'done' || k === 'archived') return el(tagOf(k), String(v));
      return el(tagOf(k), xmlText(cellText(k, v)));
    });
    out.push(`  <task>${parts.join('')}</task>`);
  }
  out.push('</tasks>\n');
  return out.join('\n');
}

/* ── Word and PDF: the same reading layout ───────────────────────────── */

const DAY_ORDER = { dmy: (y, m, d) => `${d}/${m}/${y}`, mdy: (y, m, d) => `${m}/${d}/${y}`, ymd: (y, m, d) => `${y}-${m}-${d}` };
const showDay = (v, format) => { if (!v) return ''; const [y, m, d] = v.date.split('-'); return (DAY_ORDER[format] || DAY_ORDER.dmy)(y, m, d) + (v.time ? ` ${v.time}` : ''); };

/** The tasks as a document: [{ board, groups: [{ list | null, tasks: [{ title, done, meta, lines, subtasks }] }] }]. */
export function documentModel(records, fields, { byList = true, format = 'dmy' } = {}) {
  const has = new Set(fields);
  const boards = [];
  for (const r of records) {
    let b = boards.at(-1);
    if (!b || b.board !== r.board) { b = { board: r.board, groups: [] }; boards.push(b); }
    const group = byList ? r.list : null;
    let g = b.groups.at(-1);
    if (!g || g.list !== group) { g = { list: group, tasks: [] }; b.groups.push(g); }
    const meta = [
      !byList && has.has('list') ? r.list : '',
      has.has('labels') ? r.labels.map((l) => `#${l}`).join(' ') : '',
      has.has('priority') ? r.priority : '',
      has.has('due') && r.due ? `Due ${showDay(r.due, format)}` : '',
      has.has('start') && r.start ? `Starts ${showDay(r.start, format)}` : '',
      has.has('done') && r.done ? 'Done' : '',
      has.has('archived') && r.archived ? 'Archived' : '',
      has.has('repeat') && r.repeat ? `Repeats ${r.repeat.toLowerCase()}` : '',
      has.has('reminder') && r.reminder ? `Reminder ${r.reminder.toLowerCase()}` : '',
      has.has('created') && r.created ? `Created ${showDay(r.created, format)}` : '',
      has.has('completed') && r.completed ? `Completed ${showDay(r.completed, format)}` : '',
    ].filter(Boolean);
    g.tasks.push({
      title: r.title, done: r.done, meta,
      lines: has.has('description') ? richLines(r.description) : [],
      subtasks: has.has('subtasks') ? r.subtasks : [],
    });
  }
  return boards;
}

/* ── One call for the page ───────────────────────────────────────────── */

const SAFE_NAME = /[\u0000-\u001F\u007F/\\:*?"<>|]+/g;
/** 'Work 2026-11-27.xlsx' for one board, 'stackd-tasks 2026-11-27.xlsx' for several (decision 55). */
export function exportFileName(boardNames, ext, now = new Date()) {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const one = boardNames.length === 1 ? String(boardNames[0]).replace(SAFE_NAME, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60).trim() : '';
  return `${one || 'stackd-tasks'} ${day}.${ext}`;
}

/** Everything chosen → { bytes, name, type, count }. options: { boardIds, done, archived, fields, format, byList, boxes, dateFormat, now } */
export function makeExport(state, options) {
  const { boardIds, fields: wanted, format, now = new Date() } = options;
  const tasks = selectTasks(state, options);
  const records = tasks.map((t) => taskValues(state, t));
  /* the Fields page's order, whatever order they were ticked in; a title always */
  const fields = EXPORT_FIELDS.map(([k]) => k).filter((k) => k === 'title' || wanted.includes(k));
  const [, , ext, type] = FORMATS.find(([k]) => k === format) || FORMATS[0];
  const names = state.lists.filter((l) => boardIds.includes(l.id)).map((l) => l.name);
  const at = now.toISOString();
  let body;
  if (format === 'csv') body = csv(records, fields);
  else if (format === 'json') body = json(records, fields);
  else if (format === 'xml') body = xml(records, fields, at);
  else if (format === 'xlsx') body = writeXLSX(records, fields, { label: LABEL, text: cellText, rich: richLines, dateFormat: options.dateFormat, zip: zipStore });
  else {
    const doc = documentModel(records, fields, { byList: options.byList !== false, format: options.dateFormat });
    body = format === 'docx' ? writeDOCX(doc, { boxes: options.boxes !== false, zip: zipStore }) : writePDF(doc, { boxes: options.boxes !== false, title: names.length === 1 ? names[0] : "Stack'd tasks" });
  }
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return { bytes, name: exportFileName(names, ext, now), type, count: records.length };
}

/** How many of the chosen tasks hold letters a PDF made here cannot show. */
export function pdfMisses(state, options) {
  const fields = new Set(options.fields);
  return selectTasks(state, options).filter((t) => {
    const r = taskValues(state, t);
    const texts = [r.board, r.list, r.title, ...(fields.has('labels') ? r.labels : []), fields.has('description') ? richLines(r.description).flat().map((x) => x.text).join(' ') : '',
      ...(fields.has('subtasks') ? r.subtasks.map((s) => s.title) : []), fields.has('priority') ? r.priority : ''];
    return texts.some(pdfCannotShow);
  }).length;
}
