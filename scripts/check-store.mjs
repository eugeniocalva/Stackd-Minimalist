/* Checks for the reminder rules in src/store.js — `npm run check`.
   The store is a browser module, so this provides just enough of the
   browser (localStorage, document, matchMedia) to import it in Node. */
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { getElementById: () => null };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };

const { todayISO, daysFrom, reminderInstant } = await import('../src/dates.js');
const store = await import('../src/store.js');
const { S } = store;
const stored = () => JSON.parse(mem.get(store.STORE_KEY));
const find = (title) => S.tasks.find((t) => t.title === title);
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const soon = Date.now() + 2 * 3600000;   // two hours from now
const recent = Date.now() - 2 * 3600000; // two hours ago

// seed: the demo reminder is a week out, so it starts armed
assert.equal(find('Prepare Q3 review deck').reminderFiredAt, null);

// post-commit hook runs once per commit
let hooked = 0;
store.setAfterCommit(() => { hooked++; });
const t = find('Research analytics tools');
store.setPriority(t.id, 'high');
assert.equal(hooked, 1);

// a reminder saved after its moment is used up, not fired
store.setSchedule(t.id, { due: new Date(recent).toLocaleDateString('sv'), dueTime: hhmm(recent), reminder: 0 });
assert.ok(typeof t.reminderFiredAt === 'number', 'past reminder is marked used');
// a future one is armed
store.setSchedule(t.id, { due: new Date(soon).toLocaleDateString('sv'), dueTime: hhmm(soon), reminder: 0 });
assert.equal(t.reminderFiredAt, null);
// once fired, saving the same dates again must not re-arm it
store.markReminderFired(t.id, 111);
store.setSchedule(t.id, { due: t.due, dueTime: t.dueTime, reminder: 0, recur: 'weekly' });
assert.equal(t.reminderFiredAt, 111, 'unchanged reminder keeps its fired state');
// changing the moment re-arms it
store.setSchedule(t.id, { due: daysFrom(3), dueTime: '10:00', reminder: 60 });
assert.equal(t.reminderFiredAt, null);

// markReminderFired writes in place and never overwrites another tab's edits
const other = find('Draft launch announcement');
const doc = stored();
doc.tasks.find((x) => x.id === other.id).title = 'Edited in another tab';
mem.set(store.STORE_KEY, JSON.stringify(doc));
store.markReminderFired(t.id, 222);
assert.equal(t.reminderFiredAt, 222);
assert.equal(stored().tasks.find((x) => x.id === t.id).reminderFiredAt, 222);
assert.equal(stored().tasks.find((x) => x.id === other.id).title, 'Edited in another tab');
assert.equal(other.title, 'Draft launch announcement', 'this tab\'s memory is untouched');

// roll-forward arms the next occurrence; a long offset can make it already past
const r = find('Email vendor about contract renewal');
store.setSchedule(r.id, { due: todayISO(), dueTime: '23:59', recur: 'weekly', reminder: 0 });
store.markReminderFired(r.id, 333);
const res = store.rollForward(r.id);
assert.equal(r.due, daysFrom(7));
assert.equal(r.reminderFiredAt, null, 'next weekly occurrence is armed');
store.undoRollForward(r.id, res.prev);
assert.equal(r.reminderFiredAt, 333, 'undo restores the fired state');
store.setSchedule(r.id, { due: todayISO(), dueTime: '23:59', recur: 'daily', reminder: 2880 });
store.rollForward(r.id);
assert.equal(r.due, daysFrom(1));
assert.ok(reminderInstant(r.due, r.dueTime, 2880) < Date.now());
assert.ok(typeof r.reminderFiredAt === 'number', 'a next reminder that is already past is used up');

// reopening a done task re-arms; archive + restore re-arms
const d = find('Book 1:1s for next sprint');
store.setSchedule(d.id, { due: daysFrom(2), dueTime: '10:00', reminder: 60 });
store.markReminderFired(d.id, 444);
store.toggleDone(d.id);
assert.equal(d.done, true);
store.toggleDone(d.id);
assert.equal(d.done, false);
assert.equal(d.reminderFiredAt, null);
store.markReminderFired(d.id, 555);
store.archiveTask(d.id);
store.restoreTask(d.id);
assert.equal(d.reminderFiredAt, null);
// moving out of Done re-arms too
store.markReminderFired(d.id, 666);
store.moveTask(d.id, d.listId, 'done');
store.moveTask(d.id, d.listId, 'backlog');
assert.equal(d.reminderFiredAt, null);

// copies and new tasks are armed on creation
store.markReminderFired(d.id, 777);
const copy = store.copyTask(d.id, d.listId, 'backlog');
assert.equal(copy.reminderFiredAt, null);

// description (PRD 1.7.0 §05): cleaned like a note body, capped, copied; emptied stays a field
assert.equal(d.description, '', 'a new task has an empty description');
store.setDescription(d.id, 'Bring <b onclick="x()">the form</b><script>alert(1)</script><br>and <em>ID</em>');
assert.equal(d.description, 'Bring <b>the form</b><br>and <i>ID</i>');
assert.equal(store.hasDescription(d), true);
assert.equal(store.copyTask(d.id, d.listId, 'backlog').description, d.description, 'a copy carries the description');
{
  let drawn = 0;
  store.setRenderer(() => { drawn++; });
  const edited = d.updatedAt;
  store.setDescription(d.id, 'typed so far', { quiet: true });
  assert.equal(drawn, 0, 'typing saves without a redraw');
  assert.ok(d.updatedAt >= edited && JSON.parse(localStorage.getItem(store.STORE_KEY)).tasks.find((x) => x.id === d.id).description === 'typed so far', 'and is on disk');
  store.setDescription(d.id, 'typed so far');
  assert.equal(drawn, 0, 'the same text again changes nothing');
  store.setRenderer(() => {});
}
store.setDescription(d.id, 'x'.repeat(store.DESCRIPTION_MAX + 50));
assert.equal(d.description.length, store.DESCRIPTION_MAX, 'capped');
store.setDescription(d.id, ' <br> ');
assert.deepEqual([d.description, store.hasDescription(d)], ['', false], 'emptied: the field stays, as empty text');
assert.equal(store.hasDescription({ title: 'made on 1.6.0' }), false, 'a task from before 1.7.0 has none');
store.addTask({ listId: 'work', title: 'New with past reminder', priority: 'none', tags: [], due: new Date(recent).toLocaleDateString('sv'), dueTime: hhmm(recent), reminder: 0 });
assert.ok(typeof find('New with past reminder').reminderFiredAt === 'number');

// settings: priority levels drive sorting; deleting one clears it from tasks
assert.deepEqual(S.priorities.map((p) => p.id), ['high', 'medium', 'low']);
assert.equal(S.theme, 'system');
S.sort = 'priority-desc';
store.addTask({ listId: 'prio', title: 'P-low', priority: 'low', tags: [] });
store.addTask({ listId: 'prio', title: 'P-high', priority: 'high', tags: [] });
store.addTask({ listId: 'prio', title: 'P-none', priority: 'none', tags: [] });
store.addTask({ listId: 'prio', title: 'P-medium', priority: 'medium', tags: [] });
const prioOrder = () => store.sortedTasks('prio').filter((x) => x.priority !== 'none').map((x) => x.priority);
assert.deepEqual([...new Set(prioOrder())], ['high', 'medium', 'low']);
// 1.4.2: every field sort has a direction; 'none' priority and undated tasks stay last either way
S.sort = 'priority-asc';
assert.deepEqual([...new Set(prioOrder())], ['low', 'medium', 'high'], 'priority · low first');
assert.equal(store.sortedTasks('prio').at(-1).priority, 'none');
store.addTask({ listId: 'prio', title: 'D-late', due: '2030-01-02', priority: 'none', tags: [] });
store.addTask({ listId: 'prio', title: 'D-early', due: '2030-01-01', priority: 'none', tags: [] });
const dueOrder = () => store.sortedTasks('prio').filter((x) => x.due).map((x) => x.title);
S.sort = 'due-asc'; assert.deepEqual(dueOrder(), ['D-early', 'D-late']);
assert.ok(!store.sortedTasks('prio').at(-1).due, 'undated last');
S.sort = 'due-desc'; assert.deepEqual(dueOrder(), ['D-late', 'D-early']);
assert.ok(!store.sortedTasks('prio').at(-1).due, 'undated still last');
assert.deepEqual(store.TASK_SORTS.map(([v]) => v), ['manual', 'due-asc', 'due-desc', 'priority-desc', 'priority-asc']);
S.tasks = S.tasks.filter((x) => !x.title.startsWith('D-'));
S.sort = 'priority-desc';
store.movePriority('low', -1); store.movePriority('low', -1);
assert.deepEqual([...new Set(prioOrder())], ['low', 'high', 'medium']);
store.deletePriority('low');
assert.equal(find('P-low').priority, 'none');
assert.equal(store.priorityName('low'), 'None');

// settings: labels rename across tasks, merge on collision, delete everywhere
store.addLabel('#Errands ');
assert.ok(S.labels.includes('Errands'));
store.addLabel('errands'); // duplicate (case-insensitive) is ignored
assert.equal(S.labels.length, 1);
store.renameLabel('team', 'Q3');            // merges into the existing q3 tag
assert.deepEqual(find('Book 1:1s for next sprint').tags, ['Q3']);
assert.ok(!store.allTags().some((x) => x === 'team'));
store.deleteLabel('q3');
assert.equal(store.tagUseCount('Q3'), 0);
assert.deepEqual(find('Prepare Q3 review deck').tags, []);

// notes (1.4.0, Phase 7): defaults on an existing store, draft key, add, sort, shared tags
assert.deepEqual(S.notes, []);
assert.equal(S.notesSort, 'created-desc');
assert.ok(['dmy', 'mdy', 'ymd'].includes(S.dateFormat));
assert.equal(store.loadDraft(), null);
store.saveDraft({ title: ' Draft ', body: '<div>x</div><b>y</b>', color: 'teal', tags: ['#A', 'a'], checklist: null });
{
  const d = store.loadDraft();
  assert.equal(d.body, 'x<br><b>y</b>', 'draft body is re-sanitised on load');
  assert.equal(d.color, null, 'unknown colour is dropped');
  assert.deepEqual(d.tags, ['A']);
  assert.ok(mem.has(store.NOTE_DRAFT_KEY));
}
assert.equal(store.addNote({ title: '  ', body: '<br>', tags: [], color: null, checklist: [{ id: 'c', text: ' ', done: false }] }), null, 'an empty draft is never added');
const n1 = store.addNote({ title: 'First', body: 'one<br>two', color: 'blue', tags: ['#Meeting'], checklist: null });
assert.ok(!mem.has(store.NOTE_DRAFT_KEY), 'adding clears the draft');
assert.equal(n1.order, -1);
assert.equal(n1.createdAt, n1.updatedAt);
assert.deepEqual(n1.tags, ['Meeting']);
const n2 = store.addNote({ title: '', body: '', color: null, tags: [], checklist: [{ id: 'a', text: ' milk ', done: true }, { id: 'b', text: '', done: false }] });
assert.equal(n2.order, -2, 'a new note goes first in manual order');
assert.deepEqual(n2.checklist, [{ id: 'a', text: 'milk', done: true }], 'empty items are dropped');
assert.deepEqual(store.checklistProgress(n2), { done: 1, total: 1 });
assert.equal(store.checklistProgress(n1), null);
assert.equal(store.noteIsEmpty(n2), false);
n1.createdAt = 1000; n1.updatedAt = 5000; n2.createdAt = 2000; n2.updatedAt = 3000;
const ids = (sort) => store.sortedNotes(sort).map((n) => n.id);
assert.deepEqual(ids('manual'), [n2.id, n1.id]);
assert.deepEqual(ids('created-desc'), [n2.id, n1.id]);
assert.deepEqual(ids('created-asc'), [n1.id, n2.id]);
assert.deepEqual(ids('updated-desc'), [n1.id, n2.id]);
assert.deepEqual(ids('updated-asc'), [n2.id, n1.id]);
assert.deepEqual(store.sortedChecklist([{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: true }, { id: 4, done: false }]).map((c) => c.id), [2, 4, 1, 3]);
assert.ok(store.allTags().includes('Meeting'), 'note tags join the shared pool');
assert.equal(store.tagUseCount('meeting'), 1);
n1.status = 'deleted';
assert.ok(!store.allTags().includes('Meeting'), 'deleted notes leave the pool');
assert.deepEqual(ids('manual'), [n2.id]);
assert.ok(JSON.parse(mem.get(store.STORE_KEY)).notes.length === 2, 'notes are persisted in the main document');

// notes (Phase 8): detail edits, copy, lifecycle, labels and purge reach notes
store.restoreNote(n1.id);
assert.equal(n1.status, 'active');
assert.equal(n1.order, -1, 'restore keeps the manual position');
{
  const before = n1.updatedAt;
  store.updateNote(n1.id, { title: ' Edited ', body: '<p>a</p><p>b</p>', color: 'red', tags: ['#x', 'X'], checklist: [{ id: 'k', text: 'item', done: false }, { text: '', done: false }] });
  assert.equal(n1.body, 'a<br>b');
  assert.equal(n1.color, 'red');
  assert.deepEqual(n1.tags, ['x']);
  assert.equal(n1.title, ' Edited ', 'autosave keeps the title as typed');
  assert.equal(n1.checklist.length, 2, 'empty items survive while editing');
  assert.ok(n1.updatedAt >= before);
  assert.equal(JSON.parse(mem.get(store.STORE_KEY)).notes.find((x) => x.id === n1.id).body, 'a<br>b', 'a quiet save still persists');
  n1.updatedAt = 1;
  store.toggleCheckItem(n1.id, 'k');
  assert.equal(n1.checklist[0].done, true);
  assert.ok(n1.updatedAt > 1, 'ticking is an edit');
  assert.equal(store.finalizeNote(n1.id), false);
  assert.equal(n1.title, 'Edited');
  assert.equal(n1.checklist.length, 1, 'leaving the detail drops empty items');
}
const c1 = store.copyNote(n1.id);
assert.equal(c1.title, 'Copy of Edited');
assert.equal(c1.checklist[0].done, false, 'a copy starts unticked');
assert.notEqual(c1.checklist[0].id, 'k');
assert.equal(c1.order, -3, 'the copy goes first');
assert.ok(c1.createdAt >= n1.createdAt);
{
  const e1 = store.addNote({ title: 'temp', body: '', tags: [], color: null, checklist: null });
  store.updateNote(e1.id, { title: '  ' });
  assert.equal(store.finalizeNote(e1.id), true, 'a note left empty is deleted on back');
  assert.equal(store.noteById(e1.id), undefined);
}
store.archiveNote(c1.id);
assert.equal(c1.status, 'archived'); assert.ok(c1.archivedAt);
assert.deepEqual(store.folderNotes('archived').map((x) => x.id), [c1.id]);
assert.equal(store.folderCount('archived'), store.folderTasks('archived').length + 1);
{
  const prev = store.softDeleteNote(c1.id);
  assert.equal(prev.status, 'archived'); assert.equal(c1.status, 'deleted'); assert.equal(c1.archivedAt, null);
  store.returnNoteToArchive(c1.id, prev.archivedAt);
  assert.equal(c1.status, 'archived'); assert.equal(c1.archivedAt, prev.archivedAt); assert.equal(c1.deletedAt, null);
  store.restoreNote(c1.id);
  assert.equal(c1.status, 'active'); assert.equal(c1.archivedAt, null);
}
store.renameLabel('x', 'Why');
assert.deepEqual(n1.tags, ['Why']); assert.deepEqual(c1.tags, ['Why']);
assert.deepEqual(store.tagUseCounts('why'), { tasks: 0, notes: 2 });
store.deleteLabel('why');
assert.deepEqual(n1.tags, []); assert.deepEqual(c1.tags, []);
store.softDeleteNote(c1.id);
c1.deletedAt = Date.now() - 31 * 86400000;
assert.equal(store.purgeDeleted(), 1, 'purge drops an old deleted note');
assert.equal(store.noteById(c1.id), undefined);
store.softDeleteNote(n1.id);
store.emptyDeleted();
assert.equal(store.noteById(n1.id), undefined, 'empty folder removes notes too');
store.deleteNoteForever(n2.id);
assert.equal(S.notes.length, 0);

// notes (Phase 9): sort setting and manual order
const mk = (title) => store.addNote({ title, body: '', tags: [], color: null, checklist: null });
const na = mk('A'), nb = mk('B'), nc = mk('C');            // manual order: C, B, A (newest first)
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['C', 'B', 'A']);
store.setNotesSort('bogus');
assert.equal(S.notesSort, 'created-desc', 'unknown sorts are ignored');
store.reorderNote(na.id, nb.id);
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['C', 'B', 'A'], 'no drag outside manual sort');
store.setNotesSort('manual');
store.reorderNote(na.id, nb.id);                           // A before B
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['C', 'A', 'B']);
assert.deepEqual([nc.order, na.order, nb.order], [0, 1, 2], 'reorder renumbers 0…n−1');
store.reorderNote(nc.id, null);                           // C to the end
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['A', 'B', 'C']);
const nd = mk('D');
[na, nb, nc, nd].forEach((x, i) => { x.createdAt = i + 1; });   // same-millisecond creations would tie
assert.equal(nd.order, -1, 'a new note still goes first');
store.setNotesSort('created-asc');
assert.deepEqual(store.sortedNotes().map((x) => x.title), ['A', 'B', 'C', 'D'], 'other sorts leave the manual order untouched');
store.setNotesSort('manual');
store.archiveNote(nb.id);
assert.deepEqual([na.order, nc.order], [0, 2], 'archiving does not renumber');
store.restoreNote(nb.id);
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['D', 'A', 'B', 'C'], 'restore returns to its old place');
na.order = nc.order;                                       // equal positions: newer (C) first
assert.deepEqual(store.sortedNotes('manual').map((x) => x.title), ['D', 'B', 'C', 'A']);
S.notes = [];
store.setNotesSort('created-desc');

// lanes per board (1.4.3): defaults on existing boards, add / rename / move / delete, Done protected
const wk = store.listById('work');
assert.deepEqual(wk.lanes.map((l) => l.id), ['backlog', 'inprogress', 'done'], 'existing boards get the built-in lanes');
assert.equal(store.laneName('work', 'inprogress'), 'In Progress');
assert.equal(store.validLane('work', 'nope'), 'backlog', 'an unknown lane falls back to the first');
assert.equal(store.addLane('work', '   '), null);
const review = store.addLane('work', ' Review ');
assert.deepEqual(wk.lanes.map((l) => l.name), ['Backlog', 'In Progress', 'Review', 'Done'], 'a new lane goes before Done');
store.renameLane('work', review.id, 'QA');
assert.equal(store.laneName('work', review.id), 'QA');
store.moveLane('work', review.id, -1);
assert.deepEqual(wk.lanes.map((l) => l.id), ['backlog', review.id, 'inprogress', 'done']);
store.moveLane('work', 'done', 1);
assert.equal(wk.lanes.at(-1).id, 'done', 'moving past the end is a no-op');
store.addTask({ listId: 'work', title: 'In QA', lane: review.id, priority: 'none', tags: [] });
store.addTask({ listId: 'work', title: 'In QA archived', lane: review.id, priority: 'none', tags: [] });
store.addTask({ listId: 'work', title: 'Elsewhere', lane: 'ghost', priority: 'none', tags: [] });
assert.equal(find('Elsewhere').lane, 'backlog', 'adding into a lane the board lacks lands in the first lane');
store.archiveTask(find('In QA archived').id);
assert.equal(find('In QA archived').origin.lane, review.id);
assert.equal(store.laneTaskCount('work', review.id), 1);
assert.equal(store.deleteLane('work', 'done'), null, 'Done cannot be deleted');
assert.equal(store.canDeleteLane('work', review.id), true);
const lanesBefore = store.lanesOf('work').map((l) => l.id);
const inReview = store.S.tasks.filter((t) => t.listId === 'work' && t.lane === review.id).map((t) => t.id);
const removed = store.deleteLane('work', review.id);
assert.deepEqual({ moved: removed.moved, binned: removed.binned, to: removed.to }, { moved: 1, binned: 0, to: 'backlog' }, 'one active task moved to the leftmost lane');
/* Undo: the lane back in its place, its tasks back in it */
assert.equal(store.restoreLane('work', removed.undo), true);
assert.deepEqual(store.lanesOf('work').map((l) => l.id), lanesBefore, 'the lane is back where it was');
assert.deepEqual(store.S.tasks.filter((t) => t.listId === 'work' && t.lane === review.id).map((t) => t.id), inReview, 'and so are its tasks');
assert.equal(store.restoreLane('work', removed.undo), false, 'a second Undo does nothing');
store.deleteLane('work', review.id);
assert.deepEqual(wk.lanes.map((l) => l.id), ['backlog', 'inprogress', 'done']);
assert.equal(find('In QA').lane, 'backlog');
assert.equal(find('In QA archived').origin.lane, 'backlog', 'origins pointing at the lane move too');
store.restoreTask(find('In QA archived').id);
assert.equal(find('In QA archived').lane, 'backlog');
store.deleteLane('work', 'inprogress');
store.moveTask(find('In QA').id, 'work', 'inprogress');
assert.equal(find('In QA').lane, 'backlog', 'moving to a lane the board no longer has lands in the first lane');
/* the last lane beside Done can go too (1.6.0, US-02): its cards go to Deleted, and Backlog comes back when needed */
assert.equal(store.canDeleteLane('work', 'backlog'), true);
assert.equal(store.laneHeir('work', 'backlog'), null);
const binnedN = S.tasks.filter((x) => x.listId === 'work' && x.lane === 'backlog' && x.status === 'active').length;
const last = store.deleteLane('work', 'backlog');
assert.deepEqual({ moved: last.moved, binned: last.binned, to: last.to }, { moved: 0, binned: binnedN, to: null });
/* Undo brings the binned cards back out of Deleted */
assert.equal(store.restoreLane('work', last.undo), true);
assert.equal(store.S.tasks.filter((t) => t.listId === 'work' && t.lane === 'backlog' && t.status === 'active').length, binnedN, 'binned cards are active again');
assert.deepEqual(store.deleteLane('work', 'backlog').binned, binnedN);
assert.deepEqual(wk.lanes.map((l) => l.id), ['done'], 'only Done is left');
assert.equal(find('In QA').status, 'deleted', 'its cards went to Deleted');
const fresh = store.addTask({ listId: 'work', title: 'After the last lane', priority: 'none', tags: [] });
assert.deepEqual([wk.lanes.map((l) => l.name), fresh.lane, fresh.done], [['Backlog', 'Done'], 'backlog', false], 'a new card brings Backlog back');
store.deleteLane('work', 'backlog');
store.restoreTask(find('In QA').id);
assert.deepEqual([wk.lanes.map((l) => l.id), find('In QA').lane, find('In QA').done], [['backlog', 'done'], 'backlog', false], 'restoring one does too');
/* drag and drop of lanes: Done stays last whatever the drop */
store.addLane('work', 'Two'); store.addLane('work', 'Three');
const [two, three] = wk.lanes.slice(1, 3).map((l) => l.id);
store.reorderLane('work', three, 0);
assert.deepEqual(wk.lanes.map((l) => l.id), [three, 'backlog', two, 'done']);
store.reorderLane('work', 'backlog', 99);
assert.deepEqual(wk.lanes.map((l) => l.id), [three, two, 'backlog', 'done'], 'dropped past Done: just before it');
store.reorderLane('work', 'done', 0);
assert.equal(wk.lanes.at(-1).id, 'done', 'Done is not dragged');
S.tasks = S.tasks.filter((x) => x.title !== 'After the last lane');
wk.lanes = [{ id: 'backlog', name: 'Backlog' }, { id: 'inprogress', name: 'In Progress' }, { id: 'done', name: 'Done' }];
S.tasks = S.tasks.filter((x) => !['In QA', 'In QA archived', 'Elsewhere'].includes(x.title));

// 1.6.0 (PRD-improvements US-01, US-02): the origin lane lasts one session; Done is fixed
{
  const o = store.addTask({ listId: 'work', title: 'Origin', lane: 'inprogress', priority: 'none', tags: [] });
  store.toggleDone(o.id);
  assert.deepEqual([o.lane, o.done], ['done', true]);
  store.toggleDone(o.id);
  assert.deepEqual([o.lane, o.done], ['inprogress', false], 'reopened in the session: back to the lane it came from');
  store.moveToLane(o.id, 'done');
  store.toggleDone(o.id);
  assert.equal(o.lane, 'inprogress', 'a card dragged into Done remembers its lane too');
  store.toggleDone(o.id);
  assert.deepEqual(Object.keys(stored().tasks.find((x) => x.id === o.id)).sort(), Object.keys(store.blankTask('work', 'x')).sort(), 'the origin lane is never written to storage');
  assert.ok(!Object.keys(stored()).some((k) => /origin/i.test(k)));
  store.forgetDoneOrigins();                               // what closing the app does
  store.toggleDone(o.id);
  assert.equal(o.lane, 'backlog', 'after a restart a reopened card goes to the first lane');
  const tmp = store.addLane('work', 'Temp');
  store.moveToLane(o.id, tmp.id);
  store.toggleDone(o.id);
  store.deleteLane('work', tmp.id);
  store.toggleDone(o.id);
  assert.equal(o.lane, 'backlog', 'an origin lane deleted meanwhile falls back to the first lane');

  store.renameLane('work', 'done', 'Finished');
  assert.equal(store.laneName('work', 'done'), 'Done', 'Done cannot be renamed');
  store.moveLane('work', 'done', -1);
  assert.equal(wk.lanes.at(-1).id, 'done', 'Done cannot be moved');
  store.moveLane('work', 'inprogress', 1);
  assert.deepEqual(wk.lanes.map((l) => l.id), ['backlog', 'inprogress', 'done'], 'no lane moves past Done');
  assert.deepEqual([store.canMoveLane('work', 'inprogress', 1), store.canMoveLane('work', 'inprogress', -1), store.canMoveLane('work', 'done', -1)], [false, true, false]);
  S.tasks = S.tasks.filter((x) => x.title !== 'Origin');
}

// 1.6.0 (PRD-improvements US-10): boards reorder, archive, delete and restore; their cards go with them
{
  const order = () => store.activeLists().map((l) => l.id);
  const before = order();
  const current = S.currentList;
  assert.equal(store.addList('  '), null);
  const b = store.addList(' Trip ');
  assert.deepEqual([b.name, b.status, S.currentList], ['Trip', 'active', b.id]);
  const c1 = store.addTask({ listId: b.id, title: 'Pack', priority: 'none', tags: ['trip-tag'] });
  const c2 = store.addTask({ listId: b.id, title: 'Old ticket', priority: 'none', tags: [] });
  store.archiveTask(c2.id);
  store.reorderList(b.id, before[0]);
  assert.equal(order()[0], b.id, 'dropped before the first board');
  store.reorderList(b.id, null);
  assert.equal(order().at(-1), b.id, 'dropped last');

  assert.deepEqual(store.archiveList(b.id), { status: 'active', archivedAt: null });
  assert.ok(!order().includes(b.id));
  assert.notEqual(S.currentList, b.id, 'the current board moves on');
  assert.equal(c1.status, 'active', 'the card keeps its own status');
  assert.equal(store.tasksOf(b.id).length, 0, 'but it is no longer live');
  assert.equal(store.boardCardCount(b.id), 1);
  assert.deepEqual(store.folderBoards('archived').map((l) => l.id), [b.id]);
  assert.ok(store.allTags().includes('trip-tag'), 'an archived board keeps its labels in the pool');
  assert.equal(store.copyTask(c1.id, b.id, 'backlog'), null, 'an archived board is not a destination');

  const archivedAt = b.archivedAt;
  store.softDeleteList(b.id);
  assert.deepEqual(store.folderBoards('deleted').map((l) => l.id), [b.id]);
  assert.ok(!store.allTags().includes('trip-tag'), 'a deleted board takes its labels out of the pool');
  store.restoreList(b.id, { toArchive: archivedAt });
  assert.deepEqual([b.status, b.archivedAt, b.deletedAt], ['archived', archivedAt, null], 'Undo of a delete made from Archived');
  assert.equal(store.restoreTask(c2.id).fellBack, true, 'a card restored while its board is away falls back to a live board');
  store.restoreList(b.id);
  assert.equal(b.status, 'active');
  assert.deepEqual(store.tasksOf(b.id).map((x) => x.title), ['Pack'], 'Restore brings the cards back where they were');

  store.softDeleteList(b.id);
  assert.equal(store.purgeDeleted(), 0, 'a board deleted today stays');
  b.deletedAt = Date.now() - 31 * 86400000;
  assert.equal(store.purgeDeleted(), 2, 'after 30 days the board goes, with its card');
  assert.deepEqual([store.listById(b.id), store.taskById(c1.id)], [undefined, undefined]);

  before.slice(1).forEach((id) => store.archiveList(id));
  assert.equal(store.canRemoveList(before[0]), false);
  assert.equal(store.archiveList(before[0]), null, 'the last board stays');
  assert.equal(store.softDeleteList(before[0]), null);
  before.slice(1).forEach((id) => store.restoreList(id));
  assert.deepEqual(order(), before);
  S.tasks = S.tasks.filter((x) => x.id !== c2.id);
  S.currentList = current;
}

// v1 migration arms migrated reminders (fresh module instance, v1 store only)
mem.clear();
mem.set('stackd-v1', JSON.stringify({
  onboarded: true, currentList: 'work', view: 'list', sort: 'due', lastAuto: null,
  lists: [{ id: 'work', name: 'Work' }],
  tasks: [
    { id: 'p', listId: 'work', title: 'Past noon', due: '2020-01-01', priority: 'none', tags: [], subtasks: [], done: false, lane: 'backlog', order: 0, reminder: 'Noon · 12:00 PM' },
    { id: 'f', listId: 'work', title: 'Future noon', due: '2999-01-01', priority: 'none', tags: [], subtasks: [], done: false, lane: 'backlog', order: 1, reminder: 'Noon · 12:00 PM' },
  ],
}));
const v1 = await import('../src/store.js?v1');
assert.ok(typeof v1.S.tasks.find((x) => x.id === 'p').reminderFiredAt === 'number');
assert.equal(v1.S.tasks.find((x) => x.id === 'f').reminderFiredAt, null);
assert.equal(v1.S.sort, 'due-asc', 'a pre-1.4.2 field sort gains its old direction');
assert.deepEqual(v1.S.lists[0].lanes.map((l) => l.id), ['backlog', 'inprogress', 'done'], 'a v1 board gets lanes');

// meetings (1.5.0, Phase 15): defaults, lifecycle, transcript, folders, purge (PRD-meetings US-03, US-06, US-10)
assert.deepEqual(S.meetings, []);
assert.equal(S.meetingsSort, 'created-desc');
assert.equal(S.plan.tier, 'free');
assert.ok(S.plan.subscriberId.length >= 16, 'a subscriber id is generated once');
store.save();   // the v1 test above left another instance's document in storage
assert.equal(JSON.parse(mem.get(store.STORE_KEY)).plan?.subscriberId, S.plan.subscriberId, 'and persisted with the main document');
assert.deepEqual(S.ai, { proxyUrl: null, disclosed: false, consented: false });
const m1 = store.newMeeting();
assert.equal(store.UI.screen, 'meeting');
assert.equal(store.UI.detailId, m1.id);
assert.equal(m1.title, '');
assert.match(store.meetingTitle(m1), /^Meeting · \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$|^Meeting · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
assert.equal(store.finalizeMeeting(m1.id), true, 'an untouched meeting is dropped on back');
assert.equal(store.meetingById(m1.id), undefined);
assert.equal(store.UI.screen, 'meetings');
const m2 = store.newMeeting();
store.updateMeeting(m2.id, { title: '  Weekly sync  ' });
assert.equal(JSON.parse(mem.get(store.STORE_KEY)).meetings.find((x) => x.id === m2.id).title, '  Weekly sync  ', 'quiet title save persists');
assert.equal(store.finalizeMeeting(m2.id), false);
assert.equal(m2.title, 'Weekly sync', 'back trims the title');
// a transcript replaces minutes and proposed actions, keeps added ones
m2.minutes = { summary: 'old', decisions: [], openQuestions: [], generatedAt: 1, transcriptUpdatedAt: 1 };
m2.actions = [{ id: 'p', title: 'proposed', status: 'proposed', taskId: null }, { id: 'a', title: 'added', status: 'added', taskId: 't1' }];
store.setTranscript(m2.id, { source: 'pasted', segments: [{ speaker: 'S1', startMs: 12000, text: ' hello ' }, { speaker: 'S2', startMs: null, text: '   ' }], speakers: { S1: 'Marco', S2: null } });
assert.equal(m2.minutes, null);
assert.deepEqual(m2.actions.map((a) => a.id), ['a']);
assert.equal(m2.transcript.segments.length, 1, 'blank segments are dropped');
assert.equal(m2.transcript.segments[0].text, 'hello');
assert.ok(m2.transcript.segments[0].id, 'segments get ids');
assert.equal(m2.transcript.source, 'pasted');
assert.equal(store.meetingIsEmpty(m2), false);
// speaker rename counts as a transcript edit and makes minutes stale
m2.minutes = { summary: 's', decisions: [], openQuestions: [], generatedAt: Date.now(), transcriptUpdatedAt: m2.transcript.updatedAt };
assert.equal(store.minutesStale(m2), false);
await new Promise((res) => setTimeout(res, 2));
store.renameSpeaker(m2.id, 'S2', '  Anna ');
assert.equal(m2.transcript.speakers.S2, 'Anna');
assert.equal(store.minutesStale(m2), true);
store.renameSpeaker(m2.id, 'S2', '');
assert.equal(m2.transcript.speakers.S2, null, 'an empty name returns the default label');
store.renameSpeaker(m2.id, 'S9', 'nobody');
assert.ok(!('S9' in m2.transcript.speakers), 'unknown labels are ignored');
// sorts
const m3 = store.newMeeting(); store.updateMeeting(m3.id, { title: 'alpha' }); store.finalizeMeeting(m3.id);
assert.deepEqual(store.sortedMeetings('created-desc').map((x) => x.id), [m3.id, m2.id]);
assert.deepEqual(store.sortedMeetings('created-asc').map((x) => x.id), [m2.id, m3.id]);
assert.deepEqual(store.sortedMeetings('title-asc').map((x) => x.title), ['alpha', 'Weekly sync']);
store.setMeetingsSort('bogus');
assert.equal(S.meetingsSort, 'created-desc');
store.setMeetingsSort('title-asc');
assert.equal(S.meetingsSort, 'title-asc');
// lifecycle and folders
const archivedBefore = store.folderCount('archived');
store.archiveMeeting(m3.id);
assert.equal(m3.status, 'archived');
assert.deepEqual(store.folderMeetings('archived').map((x) => x.id), [m3.id]);
assert.equal(store.folderCount('archived'), archivedBefore + 1, 'folder counts include meetings');
{
  const prev = store.softDeleteMeeting(m3.id);
  assert.equal(prev.status, 'archived');
  store.returnMeetingToArchive(m3.id, prev.archivedAt);
  assert.equal(m3.status, 'archived');
  store.restoreMeeting(m3.id);
  assert.equal(m3.status, 'active');
}
assert.equal(store.activeMeetings().length, 2);
store.softDeleteMeeting(m3.id);
m3.deletedAt -= 31 * 86400000;
assert.equal(store.purgeDeleted(), 1, 'purge drops an old deleted meeting');
store.softDeleteMeeting(m2.id);
store.emptyDeleted();
assert.equal(store.meetingById(m2.id), undefined, 'empty folder removes meetings too');
assert.equal(S.meetings.length, 0);

// action cards (Phase 17, PRD-meetings US-08): edit, dismiss / restore, add to a board, task.from
{
  const mA = store.newMeeting();
  store.setTranscript(mA.id, { source: 'pasted', segments: [{ speaker: 'S1', text: 'x' }], speakers: { S1: null } });
  store.setMinutes(mA.id, { summary: 's', decisions: [], openQuestions: [] }, [
    { title: 'Send the deck', due: '2030-01-10', priority: 'High', excerpt: 'e1' },
    { title: 'Call Luca', due: null, priority: null, excerpt: 'e2' },
  ]);
  const [a1, a2] = mA.actions;
  assert.deepEqual(store.actionCounts(mA), { proposed: 2, added: 0 });
  store.editAction(mA.id, a1.id, { title: 'Send the deck to finance', priority: 'bogus' });
  assert.equal(a1.title, 'Send the deck to finance');
  assert.equal(a1.priority, 'none', 'an unknown priority id falls back to none');
  store.editAction(mA.id, a1.id, { priority: 'medium', due: '' });
  assert.equal(a1.priority, 'medium'); assert.equal(a1.due, null);
  // dismiss and undo
  assert.equal(store.dismissAction(mA.id, a2.id), 'proposed');
  assert.equal(a2.status, 'dismissed');
  assert.equal(store.dismissAction(mA.id, a2.id), null, 'already dismissed');
  assert.deepEqual(store.actionCounts(mA), { proposed: 1, added: 0 });
  store.restoreAction(mA.id, a2.id, 'proposed');
  assert.equal(a2.status, 'proposed');
  // add to a board: a task with a pointer back, the card becomes added
  const t = store.addActionToBoard(mA.id, a1.id, { listId: 'personal', lane: 'inprogress', title: ' Send the deck to finance ', due: '2030-01-10', priority: 'high', tags: ['deck'] });
  assert.ok(t && store.taskById(t.id));
  assert.deepEqual([t.listId, t.lane, t.priority, t.due, t.tags], ['personal', 'inprogress', 'high', '2030-01-10', ['deck']]);
  assert.deepEqual(t.from, { meetingId: mA.id, actionId: a1.id });
  assert.equal(a1.status, 'added'); assert.equal(a1.taskId, t.id);
  assert.equal(a1.priority, 'high', 'the card mirrors what was saved');
  assert.deepEqual(store.actionCounts(mA), { proposed: 1, added: 1 });
  assert.equal(store.addActionToBoard(mA.id, a1.id, { listId: 'work', lane: 'backlog', title: 'again' }), null, 'an added card cannot be added twice');
  assert.equal(store.addActionToBoard(mA.id, a2.id, { listId: 'nope', lane: 'backlog', title: 'x' }), null, 'unknown board');
  store.editAction(mA.id, a1.id, { title: 'changed' });
  assert.equal(a1.title, 'Send the deck to finance', 'added cards are not editable');
  // the ✕ on an added card dismisses the card, the task stays; Undo brings it back as added
  assert.equal(store.dismissAction(mA.id, a1.id), 'added');
  assert.ok(store.taskById(t.id));
  store.restoreAction(mA.id, a1.id, 'added');
  assert.equal(a1.status, 'added');
  // regeneration keeps the added card, replaces the proposed one
  store.setMinutes(mA.id, { summary: 's2', decisions: [], openQuestions: [] }, [{ title: 'New', due: null, priority: null, excerpt: '' }]);
  assert.deepEqual(mA.actions.map((a) => [a.title, a.status]), [['Send the deck to finance', 'added'], ['New', 'proposed']]);
  // deleting the task forever leaves the card as added without a task
  store.deleteForever(t.id);
  assert.equal(a1.status, 'added'); assert.equal(store.taskById(t.id), undefined);
  // a 1.4.x task has no `from`; new ones default to null
  assert.equal(store.addTask({ listId: 'work', title: 'plain', priority: 'none', tags: [] }).from, null);
  store.softDeleteMeeting(mA.id); store.emptyDeleted();
}

// recordings (Phase 19, PRD-meetings AC-04.5, AC-04.8, AC-04.9, AC-10.4): the store keeps keys, the remover gets them
{
  const removed = [];
  store.setMediaRemover((keys) => removed.push(...keys));
  const mR = store.newMeeting();
  const rec = { key: `rec-${mR.id}`, mimeType: 'audio/webm', durationMs: 754000, sizeBytes: 4521000, recordedAt: 123, extra: 'dropped' };
  store.setRecording(mR.id, rec);
  assert.deepEqual(mR.recording, { key: `rec-${mR.id}`, mimeType: 'audio/webm', durationMs: 754000, sizeBytes: 4521000, recordedAt: 123 });
  assert.equal(store.meetingIsEmpty(mR), false, 'a recording makes the meeting worth keeping');
  store.setTranscript(mR.id, { source: 'recording', segments: [{ speaker: 'S1', text: 'hi' }], speakers: { S1: null } });
  store.setMinutes(mR.id, { summary: 's', decisions: [], openQuestions: [] }, [{ title: 'a', due: null, priority: null, excerpt: '' }]);
  mR.actions[0].status = 'added'; mR.actions[0].taskId = 't';
  mR.actions.push({ id: 'p', title: 'proposed', due: null, priority: 'none', excerpt: '', status: 'proposed', taskId: null });
  // delete the recording: transcript and minutes stay, the blob goes
  store.setRecording(mR.id, null);
  assert.equal(mR.recording, null);
  assert.ok(mR.transcript && mR.minutes, 'deleting the recording keeps the transcript and minutes');
  assert.deepEqual(removed, [`rec-${mR.id}`]);
  // record again: everything derived goes, added actions stay, the old blob goes
  store.setRecording(mR.id, { ...rec, key: 'old' });
  removed.length = 0;
  store.replaceRecording(mR.id, { ...rec, key: 'new', durationMs: 10 });
  assert.equal(mR.recording.key, 'new');
  assert.equal(mR.transcript, null); assert.equal(mR.minutes, null);
  assert.deepEqual(mR.actions.map((a) => a.status), ['added']);
  assert.deepEqual(removed, ['old']);
  // forever / empty / purge drop the blobs
  removed.length = 0;
  store.softDeleteMeeting(mR.id);
  store.emptyDeleted();
  assert.deepEqual(removed, ['new'], 'emptying the folder removes the recording');
  const mP = store.newMeeting(); store.setRecording(mP.id, { ...rec, key: 'purged' });
  store.softDeleteMeeting(mP.id); mP.deletedAt -= 31 * 86400000;
  removed.length = 0; store.purgeDeleted();
  assert.deepEqual(removed, ['purged']);
  const mF = store.newMeeting(); store.setRecording(mF.id, { ...rec, key: 'forever' });
  removed.length = 0; store.deleteMeetingForever(mF.id);
  assert.deepEqual(removed, ['forever']);
  store.setMediaRemover(() => {});
}

// transcript text edits (Phase 20, AC-06.4): a changed segment bumps the transcript and makes the minutes stale
{
  const mE = store.newMeeting();
  store.setTranscript(mE.id, { source: 'pasted', segments: [{ speaker: 'S1', text: 'one' }, { speaker: 'S2', text: 'two' }], speakers: { S1: null, S2: null } });
  store.setMinutes(mE.id, { summary: 's', decisions: [], openQuestions: [] }, []);
  const seg = mE.transcript.segments[0];
  const before = mE.transcript.updatedAt;
  store.editSegment(mE.id, seg.id, '  one  ');
  assert.equal(mE.transcript.updatedAt, before, 'an unchanged text is not an edit');
  await new Promise((res) => setTimeout(res, 2));
  store.editSegment(mE.id, seg.id, 'one edited');
  assert.equal(seg.text, 'one edited');
  assert.equal(store.minutesStale(mE), true);
  store.editSegment(mE.id, seg.id, '   ');
  assert.equal(seg.text, 'one edited', 'an empty edit is ignored');
  store.softDeleteMeeting(mE.id); store.emptyDeleted();
}

/* ── import (PRD 1.7.0 §06.1): add, never change; undo takes back exactly what was added ── */
{
  const snapshot = () => JSON.stringify({ lists: S.lists, tasks: S.tasks, currentList: S.currentList });
  const was = snapshot();
  const count = S.tasks.length;
  const board = S.lists.find((l) => l.status === 'active' && !l.share);
  const lanesWere = board.lanes.map((l) => l.name);
  let drawn = 0;
  store.setRenderer(() => { drawn++; });
  const made = store.importTasks({ boardId: board.id, items: [
    { title: '  Call   the plumber ', description: 'Ask <b onclick="x()">now</b><script>x()</script>', tags: ['home', 'Home', '#urgent'], priority: 'nope', due: '2026-12-01', dueTime: '09:30', start: '2026-12-05',
      lane: { id: board.lanes[0].id }, subtasks: [{ title: 'Find the number', done: true }, { title: '' }], key: 'c12:ab12' },
    { title: 'Slides', lane: { name: 'Doing' }, due: 'tomorrow', dueTime: '25:00' },
    { title: 'More slides', lane: { name: 'doing ' } },
    { title: 'Booked', lane: { name: 'DONE' }, done: false },
    { title: 'Finished elsewhere', lane: { id: board.lanes[0].id }, done: true },
    { title: 'Old idea', lane: { id: 'no-such-lane' }, archived: true },
    { title: '   ' },
  ] });
  assert.equal(made.error, undefined);
  assert.equal(drawn, 1, 'one commit for the whole import');
  assert.deepEqual([made.taskIds.length, made.laneIds.length, made.boardMade], [6, 1, false]);
  assert.deepEqual(JSON.parse(was).tasks, S.tasks.slice(0, count), 'no task that existed was touched');
  const t = made.taskIds.map(store.taskById);
  assert.deepEqual([t[0].title, t[0].description, t[0].tags, t[0].priority, t[0].due, t[0].dueTime, t[0].start, t[0].subtasks.map((x) => [x.title, x.done]), t[0].importKey],
    ['Call the plumber', 'Ask <b>now</b>', ['home', 'urgent'], 'none', '2026-12-01', '09:30', null, [['Find the number', true]], 'c12:ab12'], 'every value rebuilt as for a task typed by hand; a start after the due date is dropped');
  assert.deepEqual([t[1].due, t[1].dueTime, 'importKey' in t[1]], [null, null, false]);
  assert.equal(t[1].lane, t[2].lane, 'one lane for a name, whatever its capitals and spaces');
  assert.deepEqual(board.lanes.map((l) => l.name), [...lanesWere.slice(0, -1), 'Doing', 'Done'], 'a new lane goes before Done; no second Done');
  assert.deepEqual([t[3].lane, t[3].done, t[4].lane, t[4].done], ['done', true, 'done', true], 'Done means done, and done means Done');
  assert.deepEqual([t[5].status, t[5].origin.listId, typeof t[5].archivedAt], ['archived', board.id, 'number']);
  /* undo, after the person put a task of their own in the lane the import made */
  store.addTask({ listId: board.id, title: 'Mine', lane: t[1].lane, priority: 'none', tags: [] });
  store.undoImport(made);
  assert.ok(made.taskIds.every((id) => !store.taskById(id)), 'the imported tasks are gone');
  assert.ok(find('Mine') && board.lanes.some((l) => l.name === 'Doing'), 'a lane that now holds something else stays');
  store.deleteForever(find('Mine').id);
  board.lanes = board.lanes.filter((l) => l.name !== 'Doing');
  assert.equal(snapshot(), was, 'and everything else is as it was');

  /* a new board has the lanes its lists ask for; undo removes it and comes back to a board that exists */
  const fresh = store.importTasks({ newBoard: '  House  ', show: true, items: [{ title: 'A', lane: { name: 'To do' } }, { title: 'B', lane: { name: 'Waiting' } }, { title: 'C', lane: { id: 'done' } }] });
  const house = store.listById(fresh.listId);
  assert.deepEqual([house.name, house.lanes.map((l) => l.name), S.currentList === house.id, fresh.boardMade], ['House', ['To do', 'Waiting', 'Done'], true, true]);
  store.undoImport(fresh);
  assert.ok(!store.listById(fresh.listId) && store.listById(S.currentList)?.status === 'active');
  assert.equal(JSON.stringify({ lists: S.lists, tasks: S.tasks }), JSON.stringify({ lists: JSON.parse(was).lists, tasks: JSON.parse(was).tasks }));
  assert.deepEqual(store.importTasks({ newBoard: 'Plain', items: [{ title: 'A' }] }).laneIds, [], 'with no lists asked for, the usual three lanes');
  const plain = S.lists.at(-1);
  assert.deepEqual(plain.lanes.map((l) => l.id), ['backlog', 'inprogress', 'done']);
  S.tasks = S.tasks.filter((x) => x.listId !== plain.id); S.lists = S.lists.filter((l) => l.id !== plain.id); S.currentList = JSON.parse(was).currentList; store.commit();

  /* refused with nothing changed: a board that cannot take them, more than an account holds, a device with no room */
  const same = snapshot();
  assert.deepEqual(store.importTasks({ boardId: 'no-such-board', items: [{ title: 'A' }] }), { error: 'board' });
  assert.deepEqual(store.importTasks({ boardId: board.id, items: Array.from({ length: store.importRoom() + 1 }, () => ({ title: 'A' })) }), { error: 'too_many' });
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  drawn = 0;
  const ui = JSON.stringify(store.UI);
  assert.deepEqual(store.importTasks({ boardId: board.id, show: true, items: [{ title: 'A', lane: { name: 'Brand new lane' } }] }), { error: 'storage' });
  assert.deepEqual(store.importTasks({ newBoard: 'No room', show: true, items: [{ title: 'A' }] }), { error: 'storage' });
  localStorage.setItem = setItem;
  assert.deepEqual([snapshot() === same, drawn, JSON.stringify(store.UI) === ui], [true, 0, true], 'a device with no room: nothing added, nothing drawn, nothing moved');

  /* what the guide remembers: one entry per layout, counted, capped like what arrives from elsewhere */
  store.rememberImport({ name: 'A', signature: 'c2-x', columns: 2, part: null, mapping: { title: 'Name' }, lists: Array.from({ length: 300 }, (_, i) => [`L${i}`.padEnd(400, 'x'), { kind: 'done' }]), labels: [], dateOrder: null, archived: 'leave', repeats: 'skip' });
  store.rememberImport({ name: 'B', signature: 'c2-x', columns: 2, part: null, mapping: { title: 'Name' }, lists: [], labels: [], dateOrder: null, archived: 'leave', repeats: 'skip' });
  assert.deepEqual([S.importLayouts.length, S.importLayouts[0].name, S.importLayouts[0].used], [1, 'A', 2], 'the same columns are the same entry; its name stays');
  store.rememberImport({ name: 'C', signature: 'c3-y', columns: 3, part: null, mapping: { title: 'Name' }, lists: Array.from({ length: 300 }, (_, i) => [`L${i}`.padEnd(400, 'x'), { kind: 'done' }]), labels: [], dateOrder: null, archived: 'leave', repeats: 'skip' });
  assert.deepEqual([S.importLayouts[0].lists.length, S.importLayouts[0].lists[0][0].length], [200, 200]);
  const gone = store.deleteImportLayout(S.importLayouts[1].id);
  assert.equal(S.importLayouts.length, 1);
  store.restoreImportLayout(gone);
  assert.deepEqual(S.importLayouts.map((l) => l.name), ['C', 'A']);
  store.renameImportLayout(S.importLayouts[1].id, '  My tool  ');
  assert.equal(S.importLayouts[1].name, 'My tool');
  S.importLayouts = []; store.commit();
  store.setRenderer(() => {});
}

console.log('check-store: all assertions passed');
