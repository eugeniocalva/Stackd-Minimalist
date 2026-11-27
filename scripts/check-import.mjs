/* Checks for the import guide's logic (src/importer.js, src/formats/csv.js;
   PRD 1.7.0 §06.1) — `npm run check`. Every file here is made up: the
   repository is public, and no real export is kept in it. */
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

const { parseCSV } = await import('../src/formats/csv.js');
const imp = await import('../src/importer.js');

/* ── CSV ─────────────────────────────────────────────────────────────── */
assert.deepEqual(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
assert.deepEqual(parseCSV('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']], 'a mark at the start, CRLF, quotes');
assert.deepEqual(parseCSV('a,b\n"line one\nline two",2\n\n,\n3,4'), [['a', 'b'], ['line one\nline two', '2'], ['3', '4']], 'a cell over two lines; empty rows dropped');
assert.deepEqual(parseCSV('a;b;c\n1;2,5;3'), [['a', 'b', 'c'], ['1', '2,5', '3']], 'semicolons, when the first line uses them most');
assert.deepEqual(parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']], 'tabs');
assert.deepEqual(parseCSV(''), []);
assert.deepEqual(parseCSV('sep=;\nName;List\nA;B'), [['Name', 'List'], ['A', 'B']], 'a first line that names the separator');
assert.deepEqual(parseCSV('\n\nName;List\nA;B'), [['Name', 'List'], ['A', 'B']], 'empty lines before the names');
assert.deepEqual(parseCSV('"Last, first";"City, country";Age\n"A, B";"C, D";3'), [['Last, first', 'City, country', 'Age'], ['A, B', 'C, D', '3']], 'commas inside the names of a semicolon file');
assert.deepEqual(parseCSV('a,b\n1, "x, y"\n'), [['a', 'b'], ['1', 'x, y']], 'a space before an opening quote');
assert.deepEqual(parseCSV('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']], 'old line ends');

/* ── values ──────────────────────────────────────────────────────────── */
assert.deepEqual(imp.parseLabels('home (blue_light), Q3 (draft); #urgent, HOME'), ['home', 'Q3 (draft)', 'urgent'], 'a colour in brackets goes, other brackets stay, no repeats');
assert.deepEqual(imp.parseChecklist('[x] Book room\n- [ ] Send invite\n✓ Agenda\nPrint (done)\n\n'),
  [{ title: 'Book room', done: true }, { title: 'Send invite', done: false }, { title: 'Agenda', done: true }, { title: 'Print', done: true }]);
assert.deepEqual(imp.parseChecklist('milk; eggs | bread'), [{ title: 'milk', done: false }, { title: 'eggs', done: false }, { title: 'bread', done: false }]);
assert.deepEqual(imp.parseDate('2026-12-01'), { date: '2026-12-01', time: null });
assert.deepEqual(imp.parseDate('2026-12-01 09:30'), { date: '2026-12-01', time: '09:30' });
{
  const local = new Date('2026-12-01T22:59:00.000Z');
  const two = (n) => String(n).padStart(2, '0');
  assert.deepEqual(imp.parseDate('2026-12-01T22:59:00.000Z'), {
    date: `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())}`, time: `${two(local.getHours())}:${two(local.getMinutes())}`,
  }, 'a moment with a zone is read in this device\'s zone');
}
assert.deepEqual(imp.parseDate('03/04/2026'), { date: '2026-04-03', time: null });
assert.deepEqual(imp.parseDate('03/04/2026', 'mdy'), { date: '2026-03-04', time: null });
assert.deepEqual(imp.parseDate('28 Nov 2026, 23:59'), { date: '2026-11-28', time: '23:59' });
assert.deepEqual(imp.parseDate('December 5, 2026'), { date: '2026-12-05', time: null });
for (const bad of ['', 'soon', '31/02/2026', '2026-13-01', '<b>', '2026-02-31T10:00:00Z', '0001-01-01', '2026/12/011', '5 Marvelous 2026', '2026-12-01 25:00', '12/01/2026 13:00 PM']) assert.equal(imp.parseDate(bad), null, `${bad} is not a date`);
/* a.m. and p.m., seconds, and the ways a zone is written */
assert.deepEqual(imp.parseDate('12/01/2026 5:00 PM', 'mdy'), { date: '2026-12-01', time: '17:00' });
assert.deepEqual(imp.parseDate('Dec 1, 2026 5:00 pm'), { date: '2026-12-01', time: '17:00' });
assert.deepEqual(imp.parseDate('2026-12-01 12:15 AM'), { date: '2026-12-01', time: '00:15' });
assert.deepEqual(imp.parseDate('2026-12-01 10:30:00'), { date: '2026-12-01', time: '10:30' });
assert.deepEqual(imp.parseDate('2026-1-5'), { date: '2026-01-05', time: null });
{
  const two = (n) => String(n).padStart(2, '0');
  const local = (iso) => { const t = new Date(iso); return { date: `${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())}`, time: `${two(t.getHours())}:${two(t.getMinutes())}` }; };
  const noMidnight = (x) => (x.time === '00:00' ? { ...x, time: null } : x);
  for (const [written, iso] of [['2026-12-01 10:30:00 UTC', '2026-12-01T10:30:00Z'], ['2026-12-01T09:30:00+01', '2026-12-01T08:30:00Z'], ['2026-12-01 09:30 +0100', '2026-12-01T08:30:00Z'],
    ['2026-12-01T09:30:00-05:00', '2026-12-01T14:30:00Z'], ['2026-1-5T10:00Z', '2026-01-05T10:00:00Z']]) {
    assert.deepEqual(imp.parseDate(written), noMidnight(local(iso)), written);
  }
}
/* midnight with a zone is how a tool writes a day with no time: the day stays the one written, in every zone */
assert.deepEqual(imp.parseDate('2026-12-01T00:00:00Z'), { date: '2026-12-01', time: null });
assert.deepEqual(imp.parseDate('2026-12-01T00:00:00.000+09:00'), { date: '2026-12-01', time: null });
/* a year written with two digits */
assert.deepEqual([imp.parseDate('03/04/99').date, imp.parseDate('03/04/26').date], ['1999-04-03', '2026-04-03']);
assert.equal(imp.dateOrderOf(['03/04/2026', '25/04/2026']), 'dmy');
assert.equal(imp.dateOrderOf(['03/04/2026', '04/25/2026']), 'mdy');
assert.equal(imp.dateOrderOf(['03/04/2026', '05/06/2026']), 'ambiguous');
assert.equal(imp.dateOrderOf(['2026-04-03', '']), 'none');
assert.equal(imp.toDescription('Read the **new** plan, _then_ ~~wait~~ call.\n\n- one\n[site](https://example.test "t") and [https://example.test](https://example.test)'),
  'Read the <b>new</b> plan, <i>then</i> <s>wait</s> call.<br><br>- one<br>site (https://example.test) and https://example.test');
assert.equal(imp.toDescription('<script>alert(1)</script><img src=x onerror=alert(2)> 2 * 3 * 4'), '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt; 2 * 3 * 4', 'markup in a file is text');
assert.deepEqual(imp.parseChecklist('[x] Call A; then B'), [{ title: 'Call A; then B', done: true }], 'a box on one line is one item, whatever it holds');
{
  /* no value in a file can make a pattern run long: each of these took seconds or minutes before */
  const t0 = performance.now();
  imp.parseChecklist(`a${' '.repeat(200000)}b`);
  imp.parseChecklist(`a${'\t'.repeat(200000)}b`);
  imp.toDescription('['.repeat(200000));
  imp.toDescription(`${'[a]('.repeat(50000)}`);
  imp.parseLabels(`${'x ('.repeat(20000)}`);
  imp.parseDate(`1${' '.repeat(100000)}Jan 2026`);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `hostile values are read in ${Math.round(ms)} ms`);
  const long = imp.toDescription("it's ".repeat(8000));
  assert.ok(long.length <= 20000 && !/&[a-z#0-9]*$/.test(long), 'a description is cut before it is escaped, never in the middle of a mark');
}
for (const yes of ['TRUE', 'true', 'Yes', '1', 'x', 'done']) assert.equal(imp.truthy(yes), true);
for (const no of ['FALSE', '', 'No', '0', '-1']) assert.equal(imp.truthy(no), false);

/* ── a table as a board tool exports it: 12 columns, a cell over several lines ── */
const CSV = [
  'List Name,Name,Desc,Closed,Due Complete,Due,Start,Labels,Short Link,Check Items,Members,Description',
  'Backlog,Call the plumber,"Ask about the leak.',
  '',
  'Bring the **old** invoice.",FALSE,FALSE,2026-12-01,,home (blue_light),ab12,,,',
  'Backlog,Renew the car insurance,,FALSE,FALSE,,,"home (blue_light), money (green)",cd34,"[x] Find the policy',
  '[ ] Compare two offers",Ana,',
  'Doing,Slides for the review,,FALSE,FALSE,2026-12-03,2026-11-30,work (red),ef56,,,',
  'Done,Book the dentist,,FALSE,TRUE,,,,gh78,,,',
  'Backlog,Old idea,,TRUE,FALSE,,,,ij90,,,',
  'Backlog,,,FALSE,FALSE,,,,kl12,,,',
].join('\n');
const read = imp.readFile('board.csv', CSV);
assert.equal(read.kind, 'table');
const table = read.table;
assert.equal(table.columns.length, 12);
assert.equal(table.rows.length, 6);
const mapping = imp.guessMapping(table);
assert.deepEqual(mapping, {
  title: 'Name', list: 'List Name', description: 'Desc', labels: 'Labels', priority: null, due: 'Due', start: 'Start',
  done: 'Due Complete', archived: 'Closed', checklist: 'Check Items', key: 'Short Link',
}, 'every column placed by its name; of Desc and Description, the one that has text');
const facts = imp.analyse(table, mapping);
assert.deepEqual(facts.lists, [{ name: 'Backlog', count: 4 }, { name: 'Doing', count: 1 }, { name: 'Done', count: 1 }]);
assert.deepEqual(facts.labels, [{ name: 'home', count: 2 }, { name: 'money', count: 1 }, { name: 'work', count: 1 }]);
assert.deepEqual([facts.rows, facts.untitled, facts.archived, facts.done, facts.dates], [6, 1, 1, 1, 'none']);
assert.deepEqual(facts.unused, [{ column: 'Members', rows: 1 }], 'what will not come in, by column');

const lanes = [{ id: 'backlog', name: 'Backlog' }, { id: 'inprogress', name: 'In Progress' }, { id: 'done', name: 'Done' }];
const priorities = [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }];
const answers = {
  mapping,
  lists: { Backlog: { kind: 'lane', id: 'backlog' }, Doing: { kind: 'new', name: 'Doing' }, Done: { kind: 'done' } },
  labels: { work: { priority: 'high' }, money: 'drop' },
  dateOrder: 'dmy', archived: 'leave', repeats: 'skip',
};
const p = imp.plan(table, answers, { lanes, existing: [], priorities });
assert.deepEqual(p.items.map((t) => t.title), ['Call the plumber', 'Renew the car insurance', 'Slides for the review', 'Book the dentist']);
assert.deepEqual(p.leftOut, { untitled: 1, archived: 1, priority: 0 });
assert.deepEqual(p.items[0], {
  title: 'Call the plumber', description: 'Ask about the leak.<br><br>Bring the <b>old</b> invoice.', tags: ['home'], priority: 'none',
  due: '2026-12-01', dueTime: null, start: null, done: false, archived: false, lane: { id: 'backlog' }, subtasks: [], key: 'file:ab12',
});
assert.deepEqual(p.items[1].tags, ['home'], 'a label left out is left out');
assert.deepEqual(p.items[1].subtasks, [{ title: 'Find the policy', done: true }, { title: 'Compare two offers', done: false }]);
assert.deepEqual([p.items[2].lane, p.items[2].priority, p.items[2].tags, p.items[2].start], [{ name: 'Doing' }, 'high', [], '2026-11-30'], 'a new lane; a label turned into a priority');
assert.deepEqual([p.items[3].lane, p.items[3].done], [{ id: 'done' }, true], 'done goes to Done');
assert.deepEqual(p.counts, { done: 1, lanes: 1, labels: 1 });

/* imported before: by the link when there is one. The link is kept with the file's layout,
   so the same number in another kind of file is another card */
const sig = imp.signature(table.columns);
const again = imp.plan(table, answers, { lanes, keyPrefix: sig, existing: [{ title: 'x', lane: 'backlog', importKey: `${sig}:ab12` }, { title: 'y', lane: 'done', importKey: `${sig}:gh78` }], priorities });
assert.deepEqual([again.skipped, again.items.length, again.items[0].key], [2, 2, `${sig}:cd34`]);
assert.equal(imp.plan(table, { ...answers, repeats: 'import' }, { lanes, keyPrefix: sig, existing: [{ title: 'x', lane: 'backlog', importKey: `${sig}:ab12` }], priorities }).items.length, 4, 'or imported anyway');
assert.equal(imp.plan(table, answers, { lanes, keyPrefix: sig, existing: [{ title: 'x', lane: 'backlog', importKey: 'c3-other:ab12' }, { title: 'x', lane: 'backlog', importKey: 'ab12' }], priorities }).skipped, 0, 'a link from another kind of file is not this card');
{
  /* a column whose values repeat cannot tell cards apart: it is not placed as the link, and nothing is skipped */
  const t = imp.readFile('pts.csv', 'Name,Id\nA,1\nB,2\nC,1\nD,3\nE,2').table;
  const m = imp.guessMapping(t);
  assert.equal(m.key, null);
  assert.equal(imp.distinct(t, 'Id'), false);
  assert.deepEqual(imp.plan(t, { mapping: m, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities }).items.map((x) => x.title), ['A', 'B', 'C', 'D', 'E']);
  /* and when the person places it anyway, two rows of one file are still two cards */
  assert.equal(imp.plan(t, { mapping: { ...m, key: 'Id' }, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities }).items.length, 5);
}
/* …and without a link column, by the same title in the same lane */
const noKey = { ...answers, mapping: { ...mapping, key: null } };
const byTitle = imp.plan(table, noKey, { lanes, existing: [{ title: 'call the Plumber ', lane: 'backlog' }, { title: 'Slides for the review', lane: 'backlog' }], priorities });
assert.deepEqual([byTitle.skipped, byTitle.items.map((t) => t.title)], [1, ['Renew the car insurance', 'Slides for the review', 'Book the dentist']]);
/* archived cards, when asked for */
assert.equal(imp.plan(table, { ...answers, archived: 'archive' }, { lanes, existing: [], priorities }).items.find((t) => t.title === 'Old idea').archived, true);
assert.equal(imp.plan(table, { ...answers, archived: 'active' }, { lanes, existing: [], priorities }).items.find((t) => t.title === 'Old idea').archived, false);

/* names every object has are still the person's lists and labels */
{
  const t = imp.readFile('odd.csv', 'Name,List,Labels,Priority\nA,constructor,__proto__,High\nB,toString,hasOwnProperty,P1\nC,__proto__,,').table;
  const m = imp.guessMapping(t);
  const r = imp.plan(t, { mapping: m, lists: {}, labels: {}, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
  assert.deepEqual(r.items.map((x) => [x.lane, x.tags, x.priority]), [[{ name: 'constructor' }, ['__proto__'], 'high'], [{ name: 'toString' }, ['hasOwnProperty'], 'none'], [{ name: '__proto__' }, [], 'none']]);
  assert.equal(r.leftOut.priority, 1, 'a priority Stack\'d does not have is counted, not dropped without a word');
  assert.equal({}.kind, undefined);
}
/* past fifty new lanes the rest go to the board's first lane */
{
  const t = imp.readFile('many.csv', `Name,List\n${Array.from({ length: 60 }, (_, i) => `T${i},L${i}`).join('\n')}`).table;
  const r = imp.plan(t, { mapping: imp.guessMapping(t), archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
  assert.deepEqual([r.counts.lanes, r.items[49].lane, r.items[50].lane], [50, { name: 'L49' }, { id: 'backlog' }]);
}
/* columns named twice stay apart, however they are named */
assert.deepEqual(imp.readFile('n.csv', 'Name,Name,Name (2)\n1,2,3').table.columns, ['Name', 'Name (2)', 'Name (2) (2)']);
/* a layout in another alphabet has a signature of its own */
assert.notEqual(imp.signature(['Название', 'Список', 'Срок']), imp.signature(['名前', 'リスト', '期限']));

/* the same columns give the same signature, whatever the capitals and spaces */
assert.equal(imp.signature(table.columns), imp.signature(table.columns.map((c) => c.toUpperCase().replace(/ /g, '_'))));
assert.notEqual(imp.signature(table.columns), imp.signature(table.columns.slice(1)));

/* ── the same rows as a flat list of records (names with spaces, empty fields left out) ── */
const flat = imp.readFile('board.json', JSON.stringify([
  { 'List Name': 'Backlog', Name: 'Call the plumber', Desc: 'Ask about the leak.', Closed: false, 'Desc Data': { emoji: {} }, Labels: 'home (blue_light)', 'Short Link': 'ab12' },
  { 'List Name': 'Doing', Name: 'Slides for the review', Closed: false, Due: '2026-12-03', Labels: 'work (red)', 'Short Link': 'ef56', Pos: 12.5 },
]));
assert.equal(flat.kind, 'table');
assert.ok(!flat.table.columns.includes('Desc Data'), 'a field that only ever holds an object is not a column');
const fm = imp.guessMapping(flat.table);
assert.deepEqual([fm.title, fm.list, fm.description, fm.due, fm.key], ['Name', 'List Name', 'Desc', 'Due', 'Short Link']);
assert.deepEqual(imp.plan(flat.table, { mapping: fm, archived: 'leave', repeats: 'skip' }, { lanes: [], existing: [], priorities }).items.map((t) => [t.title, t.lane, t.due]),
  [['Call the plumber', { name: 'Backlog' }, null], ['Slides for the review', { name: 'Doing' }, '2026-12-03']], 'with no answer about lists, each becomes a lane of its name');

/* ── a file made of several parts: the tasks point at lists, checklists and people by id ── */
const nested = {
  name: 'House', prefs: { background: 'blue' },
  lists: [{ id: 'L1', name: 'To do' }, { id: 'L2', name: 'Done' }],
  members: [{ id: 'M1', fullName: 'Ana Example' }],
  checklists: [{ id: 'K1', name: 'Steps', idCard: 'C1', checkItems: [{ name: 'Measure', state: 'complete' }, { name: 'Order', state: 'incomplete' }] }],
  cards: [
    { id: 'C1', name: 'New shelf', desc: 'In the **hall**', idList: 'L1', idMembers: ['M1'], idChecklists: ['K1'], labels: [{ id: 'X1', name: 'home', color: 'green' }, { id: 'X2', name: '', color: 'red' }], closed: false, due: '2026-12-10', dueComplete: false, badges: { votes: 0 }, shortLink: 'zz91' },
    { id: 'C2', name: 'Paint the door', desc: '', idList: 'L2', idMembers: [], idChecklists: [], labels: [], closed: false, due: null, dueComplete: true, badges: { votes: 0 }, shortLink: 'zz92' },
  ],
};
const parts = imp.readFile('house.json', JSON.stringify(nested));
assert.equal(parts.kind, 'parts');
assert.deepEqual(parts.parts.map((x) => [imp.partName(x), x.count]), [['lists', 2], ['members', 1], ['checklists', 1], ['cards', 2]]);
assert.equal(imp.partName(parts.suggested), 'cards', 'the part that holds the tasks is suggested');
const nt = imp.tableFromPart(parts.doc, parts.parts, ['cards']);
assert.ok(nt.columns.includes('lists') && nt.columns.includes('checklists') && nt.columns.includes('members') && !nt.columns.includes('badges'), nt.columns.join(','));
const nm = imp.guessMapping(nt);
assert.deepEqual([nm.title, nm.list, nm.description, nm.labels, nm.due, nm.done, nm.archived, nm.checklist, nm.key],
  ['name', 'lists', 'desc', 'labels', 'due', 'dueComplete', 'closed', 'checklists', 'shortLink']);
const np = imp.plan(nt, { mapping: nm, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
assert.deepEqual(np.items.map((t) => [t.title, t.lane, t.tags, t.subtasks.length, t.done, t.description]),
  [['New shelf', { name: 'To do' }, ['home'], 2, false, 'In the <b>hall</b>'], ['Paint the door', { id: 'done' }, [], 0, true, '']]);
assert.deepEqual(np.items[0].subtasks, [{ title: 'Measure', done: true }, { title: 'Order', done: false }], 'a checklist reached through its id');
assert.deepEqual(imp.analyse(nt, nm).unused.map((u) => u.column).sort(), ['id', 'members']);
/* a number that happens to equal an id is not a pointer: only a field named for the part is followed */
{
  const doc = { lists: [{ id: 1, name: 'To do' }, { id: 2, name: 'Done' }], members: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }],
    tasks: [{ id: 10, title: 'A', priority: 2, estimate: 1, listId: 1, idMembers: [1, 2] }, { id: 11, title: 'B', priority: 1, estimate: 2, listId: 2, idMembers: [2] }, { id: 12, title: 'C', priority: 2, estimate: 1, listId: 1, idMembers: [] }] };
  const r = imp.readFile('t.json', JSON.stringify(doc));
  const t = imp.tableFromPart(r.doc, r.parts, ['tasks']);
  const col = (name) => t.rows.map((row) => row[t.columns.indexOf(name)]);
  assert.deepEqual(col('priority'), ['2', '1', '2'], 'priority stays a number');
  assert.deepEqual(col('estimate'), ['1', '2', '1']);
  assert.deepEqual(col('lists'), ['To do', 'Done', 'To do'], 'listId is followed into lists');
  assert.deepEqual(col('members'), ['Ana, Ben', 'Ben', ''], 'idMembers into members, though lists has the same ids');
  assert.equal(imp.guessMapping(t).list, 'lists');
}

/* ── what the guide refuses, in words ────────────────────────────────── */
for (const [name, text, code] of [['a.json', '{oops', 'unreadable'], ['a.csv', '', 'empty'], ['a.csv', 'only,names\n', 'empty'], ['a.json', '{"a":1}', 'empty'], ['a.json', '[]', 'empty'],
  ['book.xlsx', 'PK\u0003\u0004junk', 'unreadable'], ['photo.png', 'a,b\n1,2', 'unreadable'], ['renamed.csv', 'PK\u0003\u0004junk,more\n1,2', 'unreadable'], ['binary.csv', 'a,b\n1,\u0000', 'unreadable'],
  ['a.csv', `t\n${'x\n'.repeat(imp.MAX_ROWS + 1)}`, 'too_many']]) {
  assert.throws(() => imp.readFile(name, text), (e) => e instanceof imp.GuideError && e.code === code, `${name}: ${code}`);
}
/* hostile names and values stay text */
const evil = imp.readFile('x.csv', 'Name,"<img src=x onerror=alert(1)>",__proto__\n"<b>hi</b>",1,2\n');
assert.deepEqual(evil.table.columns, ['Name', '<img src=x onerror=alert(1)>', '__proto__']);
const ep = imp.plan(evil.table, { mapping: imp.guessMapping(evil.table), archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
assert.equal(ep.items[0].title, '<b>hi</b>', 'a title is kept as text; the views escape it');
assert.equal({}.polluted, undefined);

/* ── XML (phase 6): the same rows as a tool writes them, values padded with line breaks ── */
const xmlMod = await import('../src/formats/xml.js');
const bytes = (text) => new TextEncoder().encode(text).buffer;
const XML = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE base>
<base>
  <element>
    <List-Name>
      Backlog
    </List-Name>
    <Name>
      Call the plumber &amp; the &lt;electrician&gt;
    </Name>
    <Desc>
      Ask about the leak.

Bring the **old** invoice.
    </Desc>
    <Closed>false</Closed>
    <Due-Complete />
    <Desc-Data><emoji></emoji></Desc-Data>
    <Due>2026-12-01</Due>
    <Labels>home (blue_light)</Labels>
    <Short-Link>ab12</Short-Link>
  </element>
  <element>
    <List-Name>Doing</List-Name>
    <Name><![CDATA[Slides <for> the review]]></Name>
    <Desc />
    <Closed>false</Closed>
    <Due-Complete>true</Due-Complete>
    <Desc-Data><emoji></emoji></Desc-Data>
    <Due />
    <Labels>work (red)</Labels>
    <Short-Link>ef56</Short-Link>
  </element>
</base>`;
{
  const r = await imp.readUpload('board.xml', bytes(XML));
  assert.equal(r.kind, 'table');
  const m = imp.guessMapping(r.table);
  assert.deepEqual([m.title, m.list, m.description, m.labels, m.due, m.done, m.archived, m.key], ['Name', 'List-Name', 'Desc', 'Labels', 'Due', 'Due-Complete', 'Closed', 'Short-Link']);
  const x = imp.plan(r.table, { mapping: m, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
  assert.deepEqual(x.items.map((t) => [t.title, t.lane, t.tags, t.due, t.done, t.description]), [
    ['Call the plumber & the <electrician>', { id: 'backlog' }, ['home'], '2026-12-01', false, 'Ask about the leak.<br><br>Bring the <b>old</b> invoice.'],
    ['Slides <for> the review', { id: 'done' }, ['work'], null, true, ''],
  ], 'entities and CDATA are text; padding goes; an empty element is an empty value');
  /* one task is still a list of one */
  const one = await imp.readUpload('one.xml', bytes('<tasks><task><title>Only one</title><status>To do</status></task></tasks>'));
  assert.deepEqual([one.kind, one.table.columns, one.table.rows], ['table', ['title', 'status'], [['Only one', 'To do']]]);
  /* several lists of records in one XML file: asked which, and ids followed, as for JSON */
  const two = await imp.readUpload('two.xml', bytes('<board><lists><list><id>L1</id><name>To do</name></list><list><id>L2</id><name>Later</name></list></lists><cards><card><name>A</name><idList>L2</idList></card><card><name>B</name><idList>L1</idList></card></cards></board>'));
  assert.equal(two.kind, 'parts');
  assert.deepEqual(two.parts.map((x2) => imp.partName(x2)), ['lists', 'cards'], 'a wrapper is the list of what it wraps');
  assert.deepEqual(imp.tableOfPart(two, two.suggested).rows, [['A', 'Later'], ['B', 'To do']]);
  /* what a file declares is never looked up or expanded */
  const bomb = '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><tasks><task><title>&lol2; &xxe; &#x41;&#66;&#0;&#xD800;</title></task></tasks>';
  assert.deepEqual((await imp.readUpload('bomb.xml', bytes(bomb))).table.rows, [['&lol2; &xxe; AB']]);
  /* names every object has are fields like any other */
  const odd = xmlMod.toValue(xmlMod.parseXML('<r><x><constructor>1</constructor><__proto__>2</__proto__><toString>3</toString></x></r>'));
  assert.deepEqual([odd[0].constructor, odd[0].__proto__, odd[0].toString, {}.polluted], ['1', '2', '3', undefined]);
  for (const [bad, code] of [['<a><b></a>', 'unreadable'], ['<a>', 'unreadable'], ['plain text', 'unreadable'], [`${'<a>'.repeat(80)}${'</a>'.repeat(80)}`, 'unreadable'], ['<a><b>only text</b></a>', 'empty'], ['<a></a><b></b>', 'unreadable']]) {
    await assert.rejects(() => imp.readUpload('x.xml', bytes(bad)), (e) => e instanceof imp.GuideError && e.code === code, `${bad.slice(0, 30)}: ${code}`);
  }
  /* long hostile XML is read in a moment */
  const t0 = performance.now();
  await assert.rejects(() => imp.readUpload('x.xml', bytes('<'.repeat(300000))));
  await assert.rejects(() => imp.readUpload('x.xml', bytes(`<a ${'x="'.repeat(100000)}`)));
  await imp.readUpload('x.xml', bytes(`<r>${'<t><n>a</n></t>'.repeat(4000)}</r>`));
  assert.ok(performance.now() - t0 < 1500, 'hostile XML is read quickly');
}

/* ── Excel (phase 6): a workbook built here, two sheets and a hidden one ── */
function zip(files) {   // minimal writer: local headers + central directory + end record
  const enc = new TextEncoder(); const partsOut = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text, method] of files) {
    const nameB = enc.encode(name), data = enc.encode(text);
    const body = method === 8 ? deflateRawSync(data) : data;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...nameB]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(data.length), ...u16(nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB]));
    partsOut.push(local, body); offset += local.length + body.length;
  }
  const cdStart = offset; const cd = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(cdStart), ...u16(0)]);
  const all = new Uint8Array(offset + cd + eocd.length); let at = 0;
  for (const b of [...partsOut, ...central, eocd]) { all.set(b, at); at += b.length; }
  return all.buffer;
}
{
  const xlsx = await import('../src/formats/xlsx.js');
  assert.equal(xlsx.serialToDate(44927), '2023-01-01');
  assert.equal(xlsx.serialToDate(46324.4612803125), '2026-10-29 11:04', 'a day number with a time of day');
  assert.equal(xlsx.serialToDate(46324.99999), '2026-10-30', 'a time that rounds to midnight is the next day');
  assert.equal(xlsx.serialToDate(42005, true), '2019-01-02', 'the 1904 calendar of old Mac files');
  for (const bad of [NaN, -1, 1e9]) assert.equal(xlsx.serialToDate(bad), '');

  const strings = ['List', 'Name', 'Description', 'Archived', 'Due complete', 'Due', 'Labels', 'Short link', 'Checklists', 'Backlog', 'Call the plumber', 'No', 'home (blue_light)', 'ab12', 'Doing', 'Yes', 'ef56', 'Total', 'Cards'];
  const sst = `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}<si><r><t>Slides </t></r><r><rPr><b/></rPr><t xml:space="preserve">for the review</t></r><rPh><t>ignored</t></rPh></si></sst>`;
  const c = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const sheet1 = `<worksheet><sheetData>
    <row r="1">${'ABCDEFGHI'.split('').map((col, i) => c(`${col}1`, i)).join('')}</row>
    <row r="2">${c('A2', 9)}${c('B2', 10)}<c r="C2" t="inlineStr"><is><t>Ask about the &lt;leak&gt;</t></is></c>${c('D2', 11)}<c r="E2" t="b"><v>0</v></c><c r="F2" s="1"><v>46357</v></c>${c('G2', 12)}${c('H2', 13)}</row>
    <row r="3"></row>
    <row r="4">${c('A4', 14)}${c('B4', 19)}${c('D4', 11)}<c r="E4" t="b"><v>1</v></c><c r="F4" s="2"><v>46359.5</v></c>${c('H4', 16)}<c r="I4" t="str"><v>[x] One</v></c><c r="XFD4"><v>9</v></c></row>
  </sheetData></worksheet>`;
  const sheet2 = `<worksheet><sheetData><row r="1">${c('A1', 17)}${c('B1', 18)}</row><row r="2">${c('A2', 9)}<c r="B2"><v>2</v></c></row></sheetData></worksheet>`;
  const book = (sheets) => zip([
    ['[Content_Types].xml', '<Types/>', 0],
    ['xl/workbook.xml', `<workbook><sheets>${sheets}</sheets></workbook>`, 8],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId4" Target="worksheets/sheet1.xml"/><Relationship Id="rId5" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId6" Target="worksheets/sheet3.xml"/></Relationships>', 8],
    ['xl/sharedStrings.xml', sst, 8],
    ['xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="d mmm yyyy, hh:mm"/><numFmt numFmtId="165" formatCode="0.00 &quot;days&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs></styleSheet>', 8],
    ['xl/worksheets/sheet1.xml', sheet1, 8], ['xl/worksheets/sheet2.xml', sheet2, 0], ['xl/worksheets/sheet3.xml', sheet2, 8],
  ]);
  const two = await imp.readUpload('board.xlsx', book('<sheet name="Cards" sheetId="1" state="visible" r:id="rId4"/><sheet name="Summary" sheetId="2" r:id="rId5"/><sheet name="Secret" sheetId="3" state="hidden" r:id="rId6"/>'));
  assert.deepEqual([two.kind, two.what, two.parts.map((x) => [x.path[0], x.count]), two.suggested.path[0]], ['parts', 'sheets', [['Cards', 2], ['Summary', 1]], 'Cards'], 'the sheets with rows, the first suggested, the hidden one left out');
  const t = imp.tableOfPart(two, two.suggested);
  assert.deepEqual(t.columns, ['List', 'Name', 'Description', 'Archived', 'Due complete', 'Due', 'Labels', 'Short link', 'Checklists']);
  assert.deepEqual(t.rows, [
    ['Backlog', 'Call the plumber', 'Ask about the <leak>', 'No', 'FALSE', '2026-12-01', 'home (blue_light)', 'ab12', ''],
    ['Doing', 'Slides for the review', '', 'No', 'TRUE', '2026-12-03 12:00', '', 'ef56', '[x] One'],
  ], 'shared and inline text, yes and no, day numbers with a date style, a gap in a row, a cell far to the right ignored');
  const m = imp.guessMapping(t);
  assert.deepEqual([m.title, m.list, m.description, m.archived, m.done, m.due, m.labels, m.key, m.checklist], ['Name', 'List', 'Description', 'Archived', 'Due complete', 'Due', 'Labels', 'Short link', 'Checklists']);
  const x = imp.plan(t, { mapping: m, archived: 'leave', repeats: 'skip' }, { lanes, existing: [], priorities });
  assert.deepEqual(x.items.map((it) => [it.title, it.due, it.dueTime, it.done, it.subtasks.length]), [['Call the plumber', '2026-12-01', null, false, 0], ['Slides for the review', '2026-12-03', '12:00', true, 1]]);
  assert.deepEqual(imp.tableOfPart(two, two.parts[1]).rows, [['Backlog', '2']], 'a plain number stays a number');
  /* a program that writes every element with a prefix */
  const prefixed = zip([
    ['xl/workbook.xml', '<x:workbook xmlns:x="m" xmlns:rel="r"><x:sheets><x:sheet name="Tasks" sheetId="1" rel:id="R1"/></x:sheets></x:workbook>', 8],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="R1" Target="worksheets/s.xml"/></Relationships>', 8],
    ['xl/worksheets/s.xml', '<x:worksheet><x:sheetData><x:row><x:c t="inlineStr"><x:is><x:t>Title</x:t></x:is></x:c></x:row><x:row><x:c t="inlineStr"><x:is><x:t>Water the plants</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>', 8],
  ]);
  assert.deepEqual((await imp.readUpload('p.xlsx', prefixed)).table, { columns: ['Title'], rows: [['Water the plants']] }, 'prefixed elements, cells with no reference, no styles and no shared strings');
  /* one sheet: no question */
  assert.equal((await imp.readUpload('one.xlsx', book('<sheet name="Cards" sheetId="1" r:id="rId4"/>'))).kind, 'table');
  /* refused, in words */
  const code = (c2) => (e) => e instanceof imp.GuideError && e.code === c2;
  await assert.rejects(() => imp.readUpload('notes.xlsx', zip([['a.txt', 'hello', 0]])), code('unreadable'), 'a zip that is not a workbook');
  await assert.rejects(() => imp.readUpload('fake.xlsx', bytes('Name,List\nA,B')), code('unreadable'), 'a text file named .xlsx');
  await assert.rejects(() => imp.readUpload('empty.xlsx', book('<sheet name="Empty" sheetId="9" r:id="rId9"/>')), code('empty'));
  await assert.rejects(() => imp.readUpload('old.xls', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]).buffer), code('old_excel'));
  await assert.rejects(() => imp.readUpload('book.csv', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).buffer), code('old_excel'), 'whatever it is called');
  /* a part of a zip is unpacked up to a limit, not to whatever it claims */
  const docx = await import('../src/docx.js');
  const big = zip([['xl/workbook.xml', 'x'.repeat(200000), 8]]);
  await assert.rejects(() => docx.readEntry(big, 'xl/workbook.xml', 1000), /too large/);
  assert.equal((await docx.readEntry(big, 'xl/workbook.xml', 300000)).length, 200000);
  assert.equal((await docx.readEntry(big, 'xl/workbook.xml')).length, 200000, 'and with no limit given, as before');
}

/* ── what the independent review of phase 6 found ────────────────────── */
{
  const table = async (name, text) => { const r = await imp.readUpload(name, bytes(text)); return r.kind === 'table' ? r.table : { parts: r.parts.map((p) => imp.partName(p)) }; };
  /* XML shapes, whatever the names */
  assert.deepEqual(await table('a.xml', '<tasks version="2"><task title="A" due="2026-12-01"/><task title="B"/></tasks>'), { columns: ['title', 'due'], rows: [['A', '2026-12-01'], ['B', '']] }, 'fields written as attributes');
  assert.deepEqual(await table('a.xml', '<tasks><task id="1">Buy milk</task><task id="2">Call Ann</task></tasks>'), { columns: ['id', 'text'], rows: [['1', 'Buy milk'], ['2', 'Call Ann']] }, 'an element with attributes and text');
  assert.deepEqual(await table('a.xml', '<tasks version="2"><task title="Only one"/></tasks>'), { columns: ['title'], rows: [['Only one']] }, 'one task, and a root that says something about the file');
  assert.deepEqual(await table('a.xml', '<resultset statement="select"><row><field name="title">A</field><field name="due" xsi:nil="true"/></row><row><field name="title">B</field><field name="due">2026-12-01</field></row></resultset>'),
    { columns: ['title', 'due'], rows: [['A', ''], ['B', '2026-12-01']] }, 'records written as name and value pairs');
  assert.deepEqual(await table('a.xml', '<rss version="2.0"><channel><title>Board</title><link>x</link><item><title>[A-1] First</title></item><item><title>[A-2] Second</title></item></channel></rss>'),
    { columns: ['title'], rows: [['[A-1] First'], ['[A-2] Second']] }, 'a list inside the one record of a file');
  assert.deepEqual(await table('a.xml', '<export><board><cards><card><name>A</name></card><card><name>B</name></card></cards></board></export>'), { columns: ['name'], rows: [['A'], ['B']] }, 'wrappers inside wrappers');
  assert.deepEqual(await table('a.xml', `<t:tasks xmlns:t="urn:x"><t:task><t:title>A</t:title><t:labels><t:label>home</t:label><t:label>urgent</t:label></t:labels>
    <t:subtasks><t:subtask><t:name>One</t:name><t:done>true</t:done></t:subtask></t:subtasks><t:owner><t:name>Ann</t:name></t:owner></t:task>
    <t:task><t:title>B</t:title><t:labels><t:label>home</t:label></t:labels><t:subtasks><t:subtask><t:name>Two</t:name><t:done>false</t:done></t:subtask><t:subtask><t:name>Three</t:name><t:done>yes</t:done></t:subtask></t:subtasks></t:task></t:tasks>`),
  { columns: ['title', 'labels', 'subtasks', 'owner'], rows: [['A', 'home\nurgent', '[x] One', 'Ann'], ['B', 'home', '[ ] Two\n[x] Three', '']] }, 'prefixed names, a wrapped list of labels, one subtask or several, a record given by its name');
  await assert.rejects(() => imp.readUpload('book.xml', bytes('<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sheet1"><Table><Row><Cell><Data>x</Data></Cell></Row></Table></Worksheet></Workbook>')),
    (e) => e.code === 'old_excel' && /XML Spreadsheet 2003/.test(e.message));
  /* nothing in the name says what the file is */
  assert.deepEqual(await table('export', 'Name,List\nA,B'), { columns: ['Name', 'List'], rows: [['A', 'B']] });
  assert.deepEqual(await table('export', '<tasks><task><title>A</title><n>1</n></task></tasks>'), { columns: ['title', 'n'], rows: [['A', '1']] });
  assert.deepEqual(await table('export', '[{"title":"A"}]'), { columns: ['title'], rows: [['A']] });
  /* an XML file says what it is written in */
  const cp1250 = new Uint8Array([...[...'<?xml version="1.0" encoding="windows-1250"?><t><i><n>Za'].map((ch) => ch.charCodeAt(0)), 0xBF, 0xF3, 0xB3, 0xE6, ...[...'</n><m>1</m></i></t>'].map((ch) => ch.charCodeAt(0))]).buffer;
  assert.deepEqual((await imp.readUpload('pl.xml', cp1250)).table.rows, [['Za\u017C\u00F3\u0142\u0107', '1']]);
  /* hostile XML that used to take minutes, or gigabytes */
  const t0 = performance.now();
  await imp.readUpload('x.xml', bytes(`<r><a ${'x'.repeat(99000)}/><b><c>1</c><d>2</d></b></r>`)).catch(() => {});
  await imp.readUpload('x.xml', bytes(`<r>${`<a ${'x'.repeat(9000)} />`.repeat(40)}<b><c>1</c></b></r>`)).catch(() => {});
  await imp.readUpload('x.xml', bytes(`<r>${'<a><b><c/></b></a>'.repeat(40000)}</r>`)).catch(() => {});
  await imp.readUpload('x.xml', bytes(`<r>${'<a><b>1</b></a><z><b>1</b></z>'.repeat(30000)}</r>`)).catch(() => {});
  assert.ok(performance.now() - t0 < 2500, `long tags and wide trees are read quickly (${Math.round(performance.now() - t0)} ms)`);
  await assert.rejects(() => imp.readUpload('x.xml', bytes(`<r>${'<a/>'.repeat(1600000)}</r>`)), (e) => e.code === 'unreadable' && /too many items/.test(e.message));

  /* Excel: which numbers are dates, numbers as typed, text as typed */
  const cell = (ref, style, v) => `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  const formats = ['d/m/yyyy', '_-* #,##0.00\\ _D_i_n_._-;\\-* #,##0.00', '0.00 "h"', 'Standard', '[h]:mm:ss', 'h:mm', 'yyyy\\-mm\\-dd;@', '0.00E+00', '[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy', '#,##0.00 _d_e_n_.'];
  const styles = `<styleSheet><numFmts>${formats.map((f, i) => `<numFmt numFmtId="${170 + i}" formatCode="${f.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"/>`).join('')}</numFmts><cellXfs><xf numFmtId="0"/>${formats.map((_, i) => `<xf numFmtId="${170 + i}"/>`).join('')}<xf numFmtId="46"/><xf numFmtId="20"/></cellXfs></styleSheet>`;
  const head = `<row r="1">${'ABCDEFGHIJKLMNOPQ'.split('').map((col) => `<c r="${col}1" t="inlineStr"><is><t>${col}</t></is></c>`).join('')}</row>`;
  const values = [['A', 1, 46357], ['B', 2, 12.5], ['C', 3, 12.5], ['D', 4, 12.5], ['E', 5, 1.25], ['F', 6, 0.5], ['G', 7, 46357], ['H', 8, 12.5], ['I', 9, 46357], ['J', 10, 12.5], ['K', 11, 1.25], ['L', 12, 0.75],
    ['M', 0, '0.30000000000000004'], ['N', 0, '69.989999999999995'], ['O', 0, '1E-3'], ['P', 0, '12345678901234567']];
  const odd = zip([
    ['_rels/.rels', '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/book/Workbook2.xml"/></Relationships>', 8],
    ['book/workbook2.xml', '<workbook><sheets><sheet name="Numbers" sheetId="1" r:id="a"/></sheets></workbook>', 8],
    ['book/_rels/workbook2.xml.rels', '<Relationships><Relationship Id="a" Type="x/worksheet" Target="../book/sheets/one.xml"/><Relationship Id="b" Type="x/sharedStrings" Target="Strings.xml"/><Relationship Id="c" Type="x/styles" Target="look.xml"/><Relationship Id="d" Type="x/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>', 8],
    ['book/strings.xml', '<sst><si><t>line one_x000D_\nline two, a_x005F_b</t></si></sst>', 8],
    ['book/look.xml', styles, 8],
    ['book/sheets/one.xml', `<worksheet><sheetData>${head}<row r="2">${values.map(([col, st, v]) => cell(`${col}2`, st, v)).join('')}<c r="Q2" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"/></row></sheetData></worksheet>`, 8],
  ]);
  assert.deepEqual((await imp.readUpload('odd.xlsx', odd)).table.rows, [[
    '2026-12-01', '12.5', '12.5', '12.5', '1.25', '12:00', '2026-12-01', '12.5', '2026-12-01', '12.5', '1.25', '18:00',
    '0.3', '69.99', '0.001', '12345678901234567', 'line one\nline two, a_b',
  ]], 'dates by their format and nothing else as a date; a time of day; a length of time; numbers as typed; parts found where the file says they are');

  /* a sheet too long does not refuse the file, and says how long it is */
  const long = (n) => `<worksheet><sheetData>${Array.from({ length: n }, (_, i) => `<row><c t="inlineStr"><is><t>${i ? `Task ${i}` : 'Title'}</t></is></c></row>`).join('')}</sheetData></worksheet>`;
  const twoSheets = zip([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Dump" sheetId="1" r:id="a"/><sheet name="Tasks" sheetId="2" r:id="b"/></sheets></workbook>', 8],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/><Relationship Id="b" Target="worksheets/sheet2.xml"/></Relationships>', 8],
    ['xl/worksheets/sheet1.xml', long(7001), 8], ['xl/worksheets/sheet2.xml', long(3), 8],
  ]);
  const r = await imp.readUpload('two.xlsx', twoSheets);
  assert.deepEqual(r.parts.map((p) => [p.path[0], p.count]), [['Dump', 7000], ['Tasks', 2]]);
  assert.throws(() => imp.tableOfPart(r, r.parts[0]), (e) => e.code === 'too_many' && /This sheet has 7,000 rows/.test(e.message));
  assert.equal(imp.tableOfPart(r, r.parts[1]).rows.length, 2);
  await assert.rejects(() => imp.readUpload('one.xlsx', zip([['xl/workbook.xml', '<workbook><sheets><sheet name="Dump" r:id="a"/></sheets></workbook>', 8], ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/></Relationships>', 8], ['xl/worksheets/sheet1.xml', long(7001), 8]])),
    (e) => e.code === 'too_many' && /This file has 7,000 rows/.test(e.message));

  /* a small file that unpacks to a great deal: read up to a limit for the whole workbook */
  const t1 = performance.now();
  const filler = (mb) => `<worksheet><sheetData><row><c t="inlineStr"><is><t>Title</t></is></c></row><row><c t="inlineStr"><is><t>A task with a long enough name</t></is></c></row></sheetData>${' '.repeat(mb * 1024 * 1024)}</worksheet>`;
  const names4 = [1, 2, 3, 4];
  const bomb = zip([
    ['xl/workbook.xml', `<workbook><sheets>${names4.map((n) => `<sheet name="S${n}" r:id="r${n}"/>`).join('')}</sheets></workbook>`, 8],
    ['xl/_rels/workbook.xml.rels', `<Relationships>${names4.map((n) => `<Relationship Id="r${n}" Target="worksheets/sheet${n}.xml"/>`).join('')}</Relationships>`, 8],
    ...names4.map((n) => [`xl/worksheets/sheet${n}.xml`, filler(30), 8]),
  ]);
  assert.ok(bomb.byteLength < 400000, 'the file itself is small');
  const read = await imp.readUpload('bomb.xlsx', bomb);
  assert.deepEqual(read.parts.map((p) => p.path[0]), ['S1', 'S2', 'S3'], 'the sheets there was room for');
  await assert.rejects(() => imp.readUpload('big.xlsx', zip([['xl/workbook.xml', '<workbook><sheets><sheet name="S" r:id="a"/></sheets></workbook>', 8], ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="a" Target="worksheets/sheet1.xml"/></Relationships>', 8], ['xl/worksheets/sheet1.xml', filler(50), 8]])),
    (e) => e.code === 'unreadable' && /too large/.test(e.message));
  await assert.rejects(() => imp.readUpload('wide.xlsx', zip([['xl/workbook.xml', `<workbook><sheets>${'<sheet name="S" r:id="a"/>'.repeat(200000)}</sheets></workbook>`, 8]])), (e) => e.code === 'unreadable' && /too large/.test(e.message));
  console.log(`check-import: workbooks that unpack to 120 MB and more are cut off (${Math.round(performance.now() - t1)} ms)`);
}

/* ── how a file's bytes become text ──────────────────────────────────── */
{
  const utf16 = new Uint8Array([0xFF, 0xFE, ...[...'Name\nCafé'].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])]).buffer;
  assert.deepEqual((await imp.readUpload('u.csv', utf16)).table.rows, [['Café']], 'UTF-16, as some spreadsheets save');
  const latin = new Uint8Array([...[...'Name\nCaf'].map((ch) => ch.charCodeAt(0)), 0xE9]).buffer;
  assert.deepEqual((await imp.readUpload('l.csv', latin)).table.rows, [['Café']], 'Windows-1252, where an accent is one byte');
  assert.deepEqual((await imp.readUpload('b.csv', new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('Name\nCafé')]).buffer)).table.rows, [['Café']], 'UTF-8 with a mark');
  assert.equal((await imp.readUpload('board.json', bytes(JSON.stringify(nested)))).what, 'parts', 'a document of several parts says so');
}

console.log('check-import: CSV, Excel, XML, values, columns, parts, plans and refusals all pass');
