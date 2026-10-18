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
store.addTask({ listId: 'work', title: 'New with past reminder', priority: 'none', tags: [], due: new Date(recent).toLocaleDateString('sv'), dueTime: hhmm(recent), reminder: 0 });
assert.ok(typeof find('New with past reminder').reminderFiredAt === 'number');

// settings: priority levels drive sorting; deleting one clears it from tasks
assert.deepEqual(S.priorities.map((p) => p.id), ['high', 'medium', 'low']);
assert.equal(S.theme, 'system');
S.sort = 'priority';
store.addTask({ listId: 'prio', title: 'P-low', priority: 'low', tags: [] });
store.addTask({ listId: 'prio', title: 'P-high', priority: 'high', tags: [] });
store.addTask({ listId: 'prio', title: 'P-none', priority: 'none', tags: [] });
store.addTask({ listId: 'prio', title: 'P-medium', priority: 'medium', tags: [] });
const prioOrder = () => store.sortedTasks('prio').filter((x) => x.priority !== 'none').map((x) => x.priority);
assert.deepEqual([...new Set(prioOrder())], ['high', 'medium', 'low']);
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
  assert.equal(d.body, 'x<br>y', 'draft body is re-sanitised on load');
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

// v1 migration arms migrated reminders (fresh module instance, v1 store only)
mem.clear();
mem.set('stackd-v1', JSON.stringify({
  onboarded: true, currentList: 'work', view: 'list', sort: 'manual', lastAuto: null,
  lists: [{ id: 'work', name: 'Work' }],
  tasks: [
    { id: 'p', listId: 'work', title: 'Past noon', due: '2020-01-01', priority: 'none', tags: [], subtasks: [], done: false, lane: 'backlog', order: 0, reminder: 'Noon · 12:00 PM' },
    { id: 'f', listId: 'work', title: 'Future noon', due: '2999-01-01', priority: 'none', tags: [], subtasks: [], done: false, lane: 'backlog', order: 1, reminder: 'Noon · 12:00 PM' },
  ],
}));
const v1 = await import('../src/store.js?v1');
assert.ok(typeof v1.S.tasks.find((x) => x.id === 'p').reminderFiredAt === 'number');
assert.equal(v1.S.tasks.find((x) => x.id === 'f').reminderFiredAt, null);

console.log('check-store: all assertions passed');
