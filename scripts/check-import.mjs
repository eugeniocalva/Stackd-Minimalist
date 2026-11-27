/* Checks for the import guide's logic (src/importer.js, src/formats/csv.js;
   PRD 1.7.0 §06.1) — `npm run check`. Every file here is made up: the
   repository is public, and no real export is kept in it. */
import assert from 'node:assert/strict';

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

console.log('check-import: CSV, values, columns, parts, plans and refusals all pass');
