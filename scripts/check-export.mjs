/* Export (PRD 1.7.0 §06.2): every format written from made-up boards, the
   spreadsheet formats read back through the import guide's reader, the
   documents taken apart and checked, hostile text kept as text. No DOM:
   the writers are pure. */
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import * as ex from '../src/exporter.js';
import * as imp from '../src/importer.js';
import { entries, readEntry } from '../src/docx.js';
import { parseXML } from '../src/formats/xml.js';
import { zipStore } from '../src/formats/zip.js';
import { pdfCannotShow } from '../src/formats/pdf.js';

const ch = (...codes) => String.fromCharCode(...codes);
const buf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const text = (bytes) => new TextDecoder().decode(bytes);

/* ── a zip Excel and Word accept ─────────────────────────────────────── */
{
  const z = zipStore([['a.txt', 'hello'], ['dir/é.xml', '<x/>'], ['bin', new Uint8Array([0, 255, 1])]]);
  const list = entries(buf(z));
  assert.deepEqual(list.map((e) => [e.name, e.method, e.size]), [['a.txt', 0, 5], ['dir/é.xml', 0, 4], ['bin', 0, 3]]);
  assert.equal(await readEntry(buf(z), 'dir/é.xml'), '<x/>');
  const v = new DataView(buf(z));
  assert.equal(v.getUint32(14, true), crc32(Buffer.from('hello')), 'the CRC-32 every zip reader checks');
  assert.deepEqual(zipStore([['a', 'b']]), zipStore([['a', 'b']]), 'the same files make the same bytes');
}

/* ── made-up boards ──────────────────────────────────────────────────── */
const at = (y, m, d, h = 8, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const state = {
  lists: [
    { id: 'b1', name: 'Home', lanes: [{ id: 'backlog', name: 'This week' }, { id: 'later', name: 'Later' }, { id: 'done', name: 'Done' }] },
    { id: 'b2', name: 'Work: Q4 / plans', lanes: [{ id: 'backlog', name: 'Backlog' }, { id: 'done', name: 'Done' }] },
    { id: 'b3', name: 'Shared trip', share: { role: 'editor' } },
  ],
  priorities: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }],
  tasks: [
    { id: 't1', listId: 'b1', lane: 'backlog', title: 'Book the dentist', done: false, order: 1, priority: 'high', tags: ['health'], subtasks: [{ id: 's1', title: 'Find the number', done: true }, { id: 's2', title: 'Call before noon', done: false }],
      description: 'Ask for a <b>morning</b> slot.<br>Bring the <i>insurance card</i>, <u>pay</u> <s>cash</s>. Café &amp; cr&#232;me, 5 € &lt;b&gt;', due: '2026-12-01', dueTime: '09:00', start: null, recur: 'none', reminder: 60, status: 'active', createdAt: at(2026, 11, 20) },
    { id: 't2', listId: 'b1', lane: 'backlog', title: 'Renew the car insurance', done: false, order: 0, priority: 'low', tags: ['money', 'car'], subtasks: [], description: '', due: '2026-12-05', dueTime: null, start: '2026-11-28', recur: 'none', reminder: null, status: 'active', createdAt: at(2026, 11, 21) },
    { id: 't3', listId: 'b1', lane: 'later', title: 'Water the plants', done: false, order: 0, priority: 'none', tags: [], subtasks: [], description: '', due: '2026-11-30', recur: 'weekly', reminder: 0, status: 'active', createdAt: at(2026, 11, 22), lastCompletedAt: at(2026, 11, 23, 19) },
    { id: 't4', listId: 'b1', lane: 'done', title: '=HYPERLINK("http://x","click") tax', done: true, order: 0, priority: 'none', tags: [], subtasks: [], description: '', due: null, start: '2026-11-20', recur: 'none', reminder: null, status: 'active', createdAt: at(2026, 11, 1), lastCompletedAt: at(2026, 11, 25, 15, 30) },
    { id: 't5', listId: 'b1', lane: 'later', title: 'Old shopping list', done: false, order: 2, priority: 'none', tags: [], subtasks: [], description: '', status: 'archived', createdAt: at(2026, 10, 1) },
    { id: 't6', listId: 'b2', lane: 'backlog', title: `Слайды ${ch(0x1F4C8)} <w:t>]]></w:t> (a) \\ x`, done: false, order: 0, priority: 'none', tags: ['review'], subtasks: [{ title: 'Outline', done: false }], description: `bad ${ch(1)}${ch(0xD800)} chars`, recur: 'none', status: 'active', createdAt: at(2026, 11, 23) },
    { id: 't7', listId: 'b2', lane: 'backlog', title: 'Gone', done: false, status: 'deleted', createdAt: 1 },
    { id: 't8', listId: 'b3', lane: 'backlog', title: 'Pack', done: false, status: 'active', createdAt: 2 },
  ],
};
const ALL = ex.EXPORT_FIELDS.map(([k]) => k);

/* ── which tasks, in which order ─────────────────────────────────────── */
{
  const ids = (o) => ex.selectTasks(state, o).map((t) => t.id);
  assert.deepEqual(ids({ boardIds: ['b2', 'b1'] }), ['t2', 't1', 't3', 't4', 't6'], 'board order, then lane order, then the order on the board; nothing archived or deleted');
  assert.deepEqual(ids({ boardIds: ['b1'], done: false }), ['t2', 't1', 't3']);
  assert.deepEqual(ids({ boardIds: ['b1'], archived: true }), ['t2', 't1', 't3', 't5', 't4']);
  assert.deepEqual(ids({ boardIds: ['b3'] }), ['t8'], 'a shared board, when chosen');
  assert.deepEqual(ex.DEFAULT_FIELDS, ['board', 'list', 'title', 'description', 'labels', 'priority', 'due', 'start', 'done', 'subtasks'], 'decision 53');
}

/* ── values ──────────────────────────────────────────────────────────── */
{
  const v = ex.taskValues(state, state.tasks[0]);
  assert.deepEqual([v.board, v.list, v.priority, v.due, v.reminder, v.repeat, v.done, v.archived], ['Home', 'This week', 'High', { date: '2026-12-01', time: '09:00' }, '1 hour before', '', false, false]);
  assert.deepEqual(ex.taskValues(state, state.tasks[2]).completed, { date: '2026-11-23', time: '19:00' }, 'a repeating task keeps when it was last done');
  assert.equal(ex.taskValues(state, state.tasks[1]).completed, null);
  assert.equal(ex.toMarkdown(state.tasks[0].description), 'Ask for a **morning** slot.\nBring the *insurance card*, pay ~~cash~~. Café & crème, 5 € <b>');
  assert.equal(ex.toMarkdown('<b>bold <i>both</i></b>'), '**bold** ***both***');
  assert.equal(ex.toMarkdown('<b> spaced </b>x'), ' **spaced** x', 'marks hug the words, or they would not be read back');
  assert.deepEqual(ex.richLines('a<br><br>b'), [[{ text: 'a', b: false, i: false, u: false, s: false }], [], [{ text: 'b', b: false, i: false, u: false, s: false }]]);
}

/* ── CSV, JSON, XML and Excel come back through the import guide ─────── */
const make = (format, extra = {}) => ex.makeExport(state, { boardIds: ['b1', 'b2'], fields: ALL, format, dateFormat: 'dmy', now: new Date(2026, 10, 27), ...extra });
for (const format of ['csv', 'json', 'xml', 'xlsx']) {
  const r = make(format);
  assert.equal(r.count, 5);
  const read = await imp.readUpload(r.name, buf(r.bytes));
  assert.equal(read.kind, 'table', format);
  const m = imp.guessMapping(read.table);
  assert.deepEqual([m.title, m.list, m.description, m.labels, m.priority, m.due, m.start, m.done, m.archived, m.checklist].every(Boolean), true, `${format}: every field placed`);
  const p = imp.plan(read.table, { mapping: m, archived: 'leave', repeats: 'skip' }, { lanes: [], existing: [], priorities: state.priorities });
  const got = p.items.map((i) => [i.title, i.lane.name ?? i.lane.id, i.tags, i.priority, i.due, i.dueTime, i.start, i.done, i.subtasks]);
  assert.deepEqual(got, [
    ['Renew the car insurance', 'This week', ['money', 'car'], 'low', '2026-12-05', null, '2026-11-28', false, []],
    ['Book the dentist', 'This week', ['health'], 'high', '2026-12-01', '09:00', null, false, [{ title: 'Find the number', done: true }, { title: 'Call before noon', done: false }]],
    ['Water the plants', 'Later', [], 'none', '2026-11-30', null, null, false, []],
    ['=HYPERLINK("http://x","click") tax', 'done', [], 'none', null, null, '2026-11-20', true, []],
    [`Слайды ${ch(0x1F4C8)} <w:t>]]></w:t> (a) \\ x`, 'Backlog', ['review'], 'none', null, null, null, false, [{ title: 'Outline', done: false }]],
  ], `${format}: the same tasks come back`);
  const desc = p.items[1].description;
  assert.equal(desc, format === 'xlsx'
    ? 'Ask for a morning slot.<br>Bring the insurance card, pay cash. Café &amp; crème, 5 € &lt;b&gt;'
    : 'Ask for a <b>morning</b> slot.<br>Bring the <i>insurance card</i>, pay <s>cash</s>. Café &amp; crème, 5 € &lt;b&gt;', `${format}: the description, its markup as text`);
  assert.equal(p.items[4].description, 'bad  chars', `${format}: control characters and half characters are left out`);
}
{
  const csv = text(make('csv').bytes);   // TextDecoder takes the mark off
  assert.deepEqual([...make('csv').bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'a mark so Excel reads accents');
  assert.ok(csv.includes('\r\n') && !/[^\r]\n(?=[^"]*$)/.test(csv.split('\r\n')[1]), 'rows end in CRLF');
  assert.ok(csv.includes(`,"'=HYPERLINK(""http://x"",""click"") tax",`), 'a formula is written as text, quotes doubled');
  const names = text(make('csv', { fields: ['title', 'due'] }).bytes).split('\r\n')[0];
  assert.equal(names, 'Title,Due date', 'only the fields chosen, in the page\'s order, title always');
  const json = JSON.parse(text(make('json').bytes));
  assert.deepEqual(Object.keys(json[0]).slice(0, 4), ['Board', 'List', 'Title', 'Description']);
  assert.deepEqual([json[1].Labels, json[1].Subtasks[0], json[1].Done, json[1]['Due date']], [['health'], { title: 'Find the number', done: true }, false, '2026-12-01 09:00']);
  const xml = text(make('xml').bytes);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && !/[\u0001\uD800]/.test(xml));
  assert.doesNotThrow(() => parseXML(xml), 'well formed, whatever the tasks hold');
  assert.ok(xml.includes('&lt;w:t&gt;]]&gt;&lt;/w:t&gt;'));
}

/* ── Excel's own parts ───────────────────────────────────────────────── */
{
  const z = buf(make('xlsx', { dateFormat: 'mdy' }).bytes);
  const names = entries(z).map((e) => e.name);
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  for (const n of names) parseXML(await readEntry(z, n));
  const styles = await readEntry(z, 'xl/styles.xml');
  assert.ok(styles.includes('formatCode="mm/dd/yyyy"') && styles.includes('formatCode="mm/dd/yyyy hh:mm"'), 'dates in the person\'s format');
  const sheet = await readEntry(z, 'xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('<c r="G3" s="3"><v>46357.375</v></c>'), 'a due date and time as a real date');
  assert.ok(sheet.includes('<r><rPr><b/><sz val="11"/>') && sheet.includes('<strike/>'), 'a description keeps its formatting');
  assert.ok(!/<f>/.test(sheet), 'no formula anywhere');
  assert.ok(sheet.includes('<autoFilter ref="A1:O6"/>') && sheet.includes('state="frozen"'));
}

/* ── Word ────────────────────────────────────────────────────────────── */
{
  const z = buf(make('docx').bytes);
  const names = entries(z).map((e) => e.name);
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/settings.xml']);
  for (const n of names) parseXML(await readEntry(z, n));
  const doc = await readEntry(z, 'word/document.xml');
  const paras = [...doc.matchAll(/<w:p>(.*?)<\/w:p>/g)].map((m) => [m[1].match(/w:pStyle w:val="(\w+)"/)[1], [...m[1].matchAll(/<w:t xml:space="preserve">(.*?)<\/w:t>/g)].map((t) => t[1]).join('')]);
  assert.deepEqual(paras.slice(0, 9), [
    ['Heading1', 'Home'], ['Heading2', 'This week'],
    ['TaskTitle', 'Renew the car insurance'], ['TaskMeta', '#money #car · Low · Due 05/12/2026 · Starts 28/11/2026 · Created 21/11/2026 08:00'],
    ['TaskTitle', 'Book the dentist'], ['TaskMeta', '#health · High · Due 01/12/2026 09:00 · Reminder 1 hour before · Created 20/11/2026 08:00'],
    ['TaskText', 'Ask for a morning slot.Bring the insurance card, pay cash. Café &amp; crème, 5 € &lt;b&gt;'],
    ['Subtask', '☑\tFind the number'], ['Subtask', '☐\tCall before noon'],
  ]);
  assert.ok(doc.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">morning</w:t></w:r>') && doc.includes('<w:u w:val="single"/>') && doc.includes('<w:strike/>'));
  assert.ok(doc.includes('&lt;w:t&gt;]]&gt;&lt;/w:t&gt;'), 'text that looks like Word\'s own markup stays text');
  assert.ok((await readEntry(z, 'word/settings.xml')).includes('w:val="15"'), 'not opened in Compatibility Mode');
  const flat = await readEntry(buf(make('docx', { byList: false, boxes: false }).bytes), 'word/document.xml');
  assert.ok(!flat.includes('Heading2') && flat.includes('This week · #money') && flat.includes('•\t') && flat.includes(' (done)'), 'one list per board, subtasks as a list');
}

/* ── PDF ─────────────────────────────────────────────────────────────── */
function checkPdf(bytes) {
  const s = text(bytes);
  assert.ok(/^[\x00-\x7F]*$/.test(s), 'ASCII throughout, so offsets are character offsets');
  assert.ok(s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n'));
  const xref = +s.match(/startxref\n(\d+)\n%%EOF\n$/)[1];
  assert.ok(s.startsWith('xref\n', xref), 'startxref points at the table');
  const [, count] = s.slice(xref).match(/^xref\n0 (\d+)\n/);
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => +m[1]);
  assert.equal(offsets.length, count - 1);
  offsets.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj\n`, o), `object ${i + 1} is where the table says`));
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) assert.ok(s.startsWith('\nendstream', m.index + m[0].length + +m[1]), 'each stream is as long as it says');
  /* every string a page shows is closed: brackets inside are escaped */
  for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    for (const line of m[1].split('\n')) {
      if (!line.includes(' Tj')) continue;
      const str = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')'));
      assert.ok(!/(^|[^\\])[()]/.test(str.replace(/\\\\/g, '')), `a balanced string: ${line.slice(0, 80)}`);
    }
  }
  return { pages: +s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1], s };
}
{
  const { pages, s } = checkPdf(make('pdf').bytes);
  assert.equal(pages, 1);
  assert.ok(['(Caf\\351) Tj', '(cr\\350me,) Tj', '(\\200) Tj', '(<b>) Tj'].every((w) => s.includes(w)), 'Windows-1252 letters and the euro sign, a word at a time');
  assert.ok(s.includes('(Slaydy') === false && s.includes('(?????? ?) Tj') === false && /\(\?{6}\) Tj/.test(s), 'other letters print as ?');
  assert.ok(s.includes('re S'), 'boxes are drawn');
  assert.ok(s.includes('(\\(a\\)) Tj') && s.includes('(\\\\) Tj'), 'brackets and backslashes escaped');
  assert.equal(pdfCannotShow('Café 5 € – “quoted”'), false);
  assert.equal(pdfCannotShow('Слайды'), true);
  assert.equal(pdfCannotShow(`smile ${ch(0x1F600)}`), true);
  assert.equal(ex.pdfMisses(state, { boardIds: ['b1', 'b2'], fields: ALL }), 1);
}

/* ── what the independent review of phase 7 found ────────────────────── */
{
  const odd = {
    lists: [
      { id: 'h', name: 'Home', lanes: [{ id: 'backlog', name: 'To do' }, { id: 'done', name: 'Done' }] },
      { id: 'gone', name: 'Gone board', status: 'deleted', lanes: [{ id: 'backlog', name: 'To do' }] },
      { id: 'old', name: 'Old board', status: 'archived', lanes: [{ id: 'backlog', name: 'To do' }] },
    ],
    priorities: [],
    tasks: [
      { id: 'a', listId: 'h', lane: 'backlog', title: "'=quoted already", order: 0, status: 'active', tags: ['a, b', 'c;d'], subtasks: [{ title: 'Pay (done)', done: false }, null, { title: '[x] literal box', done: true }], description: 'a *star* b __init__ **not bold** ~x~ back\\slash \\*' },
      { id: 'b', listId: 'h', lane: 'backlog', title: "'-- dash comment", order: 1, status: 'active', tags: ['one'], description: 'x<i>foo</i>bar <i>Dune</i>\'s <b>a*b</b> <s>2~3</s>', due: '2026-02-30' },
      { id: 'c', listId: 'h', lane: 'backlog', title: `${ch(9)}Tabbed start`, order: 2, status: 'active', description: '', due: '1899-12-31', start: '0001-01-01' },
      { id: 'd', listId: 'h', lane: 'backlog', title: 'Xesc _x0041_ end', order: 3, status: 'active', tags: null, subtasks: 'not a list' },
      { id: 'e', listId: 'gone', lane: 'backlog', title: 'On a deleted board', status: 'active' },
      { id: 'f', listId: 'old', lane: 'backlog', title: 'On an archived board', status: 'active' },
    ],
  };
  const opts = { boardIds: ['h', 'gone', 'old'], fields: ALL, dateFormat: 'dmy', now: new Date(2026, 10, 27) };
  assert.deepEqual(ex.selectTasks(odd, opts).map((t) => t.id), ['a', 'b', 'c', 'd'], 'a board deleted or archived while the pages were open is not exported');
  assert.equal(ex.makeExport(odd, { ...opts, format: 'csv' }).name, 'stackd-tasks 2026-11-27.csv');
  const v = ex.taskValues(odd, odd.tasks[1]);
  assert.equal(v.due, null, 'a day that does not exist is no day');
  assert.deepEqual(ex.taskValues(odd, odd.tasks[3]).subtasks, [], 'old or broken data does not stop an export');
  for (const format of ['csv', 'json', 'xml', 'xlsx']) {
    const r = ex.makeExport(odd, { ...opts, format });
    const read = await imp.readUpload(r.name, buf(r.bytes));
    const m = imp.guessMapping(read.table);
    const p = imp.plan(read.table, { mapping: m, archived: 'leave', repeats: 'skip' }, { lanes: [], existing: [], priorities: [] });
    assert.deepEqual(p.items.map((i) => i.title), ["'=quoted already", "'-- dash comment", `${ch(9)}Tabbed start`.trim(), 'Xesc _x0041_ end'], `${format}: a ' or a tab the person typed is kept, _x0041_ is text`);
    assert.deepEqual(p.items[0].tags, ['a, b', 'c;d'], `${format}: a label with a comma in it stays one label`);
    assert.deepEqual(p.items[0].subtasks, [{ title: 'Pay (done)', done: false }, { title: '[x] literal box', done: true }], `${format}: "(done)" after a box is part of the title`);
    if (format !== 'xlsx') {
      assert.equal(p.items[0].description, 'a *star* b __init__ **not bold** ~x~ back\\slash \\*', `${format}: marks the person typed stay text`);
      assert.equal(p.items[1].description, 'x<i>foo</i>bar <i>Dune</i>&#39;s <b>a*b</b> <s>2~3</s>', `${format}: formatting inside a word comes back`);
    }
  }
  const sheet = await readEntry(buf(ex.makeExport(odd, { ...opts, format: 'xlsx' }).bytes), 'xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('Xesc _x005F_x0041_ end') && sheet.includes('>1899-12-31<'), 'Excel: its own escape written as text; a day before March 1900 as text');
  const pdf = text(ex.makeExport({ ...state, lists: [{ ...state.lists[0], name: 'Mum\u2019s \u2013 Q1 \u20AC' }] }, { boardIds: ['b1'], fields: ALL, format: 'pdf' }).bytes);
  assert.ok(pdf.includes('/Title <FEFF004D0075006D2019007300202013002000510031002020AC>'), 'the document title as viewers read it');
}

/* ── PDF: a title is never left alone at the foot of a page ──────────── */
{
  const long = { ...state, tasks: Array.from({ length: 1500 }, (_, i) => ({ ...state.tasks[0], id: `p${i}`, order: i, tags: i % 2 ? ['x'] : [],
    description: i % 3 ? 'One line of description.' : 'Several<br>lines<br>of description.', subtasks: i % 4 ? [] : [{ title: 'A subtask', done: false }] })) };
  const s = text(ex.makeExport(long, { boardIds: ['b1'], fields: ALL, format: 'pdf' }).bytes);
  let stranded = 0, pages = 0;
  for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    const shown = m[1].split('\n').filter((l) => l.includes(' Tj') && !l.includes('/F1 8 Tf'));
    pages++;
    const lastFont = shown.at(-1)?.match(/\/F\d \d+ Tf/)?.[0];
    if (lastFont === '/F2 11 Tf' || lastFont === '/F1 9 Tf') stranded++;
  }
  assert.ok(pages > 100);
  assert.equal(stranded, 0, `no page of ${pages} ends on a title or its details line`);
}

/* ── file names ──────────────────────────────────────────────────────── */
{
  const day = new Date(2026, 10, 27);
  assert.equal(ex.exportFileName(['Home'], 'xlsx', day), 'Home 2026-11-27.xlsx');
  assert.equal(ex.exportFileName(['Home', 'Work'], 'pdf', day), 'stackd-tasks 2026-11-27.pdf');
  assert.equal(ex.exportFileName(['Work: Q4 / plans'], 'csv', day), 'Work Q4 plans 2026-11-27.csv');
  assert.equal(ex.exportFileName(['..'], 'csv', day), 'stackd-tasks 2026-11-27.csv', 'a name that is only dots');
  assert.equal(ex.exportFileName([`${'x'.repeat(100)}`], 'csv', day).length, 60 + ' 2026-11-27.csv'.length);
}

/* ── many tasks, quickly, on several pages ───────────────────────────── */
{
  const many = { ...state, tasks: Array.from({ length: 5000 }, (_, i) => ({ ...state.tasks[0], id: `m${i}`, order: i, title: `Task ${i} ${'with a long title '.repeat(i % 5)}` })) };
  const t0 = performance.now();
  for (const format of ['csv', 'json', 'xml', 'xlsx', 'docx', 'pdf']) {
    const r = ex.makeExport(many, { boardIds: ['b1'], fields: ALL, format, dateFormat: 'dmy' });
    assert.equal(r.count, 5000);
    if (format === 'pdf') assert.ok(checkPdf(r.bytes).pages > 100, 'a long export runs over many pages, each numbered');
    if (format === 'xlsx') assert.equal((await imp.readUpload('m.xlsx', buf(r.bytes))).table.rows.length, 5000, 'and reads back');
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 15000, `5,000 tasks in every format in ${Math.round(ms)} ms`);
  console.log(`check-export: 5,000 tasks in all six formats in ${Math.round(ms)} ms`);
}

console.log('check-export: selection, values, six formats, round trips, documents and file names all pass');
