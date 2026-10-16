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
