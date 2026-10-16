/* State, persistence, migration, selectors and mutations. Every mutation
   ends in commit() (save + re-render); UI-only changes use rerender(). The
   renderer is injected by app.js so this module never imports the view
   layer. Schema: docs/architecture.md §3. */

import { uid } from './util.js';
import { daysFrom, nextOccurrence, addDays, daysBetween } from './dates.js';

export const STORE_KEY = 'stackd-v2';
const LEGACY_KEY = 'stackd-v1';
export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 86400000;

export const LANES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'inprogress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];
export const laneName = (id) => LANES.find((l) => l.id === id)?.name || id;
export const PRIORITIES = ['high', 'medium', 'low', 'none'];
export const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
/* reminder = minutes before the due time; null = none */
export const REMINDER_OPTIONS = [
  [null, 'None'], [0, 'At time of due'], [10, '10 minutes before'],
  [60, '1 hour before'], [1440, '1 day before'], [2880, '2 days before'],
];
export const reminderLabel = (m) => (REMINDER_OPTIONS.find(([v]) => v === m) || REMINDER_OPTIONS[0])[1];

/* ── State ───────────────────────────────────────────────────────────── */

/* v1 reminder presets were time-of-day labels with no date behind them. */
const V1_REMINDER_TIME = { 'Morning · 9:00 AM': '09:00', 'Noon · 12:00 PM': '12:00', 'Evening · 6:00 PM': '18:00' };

/* S is built at module load; everything migrate() touches must be declared above. */
export let S = migrate();

/* transient UI state (not persisted) */
export const UI = {
  screen: 'list',        // 'lists' | 'list' | 'detail' | 'folders'
  folder: 'archived',    // which tab the folders screen shows
  detailId: null,
  sortMenu: false,
  refocusAddsub: false,
};
export const isDesktop = window.matchMedia('(min-width: 900px)');

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
export function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }
export function rerender() { renderer(); }
export function commit() { save(); renderer(); }

/* ── Migration ───────────────────────────────────────────────────────── */

function migrate() {
  const v2 = read(STORE_KEY);
  if (v2) return v2;
  const v1 = read(LEGACY_KEY);
  const state = v1 ? upgradeV1(v1) : seed();
  localStorage.setItem(STORE_KEY, JSON.stringify(state)); // v1 key is left for rollback
  return state;
}

function upgradeV1(v1) {
  const now = Date.now();
  return {
    ...v1,
    version: 2,
    tasks: (v1.tasks || []).map((t) => {
      const time = V1_REMINDER_TIME[t.reminder];
      const hasSchedule = !!(t.due && time);
      return {
        ...blankTask(t.listId, t.title),
        ...t,
        dueTime: hasSchedule ? time : null,
        reminder: hasSchedule ? 0 : null,
        createdAt: now, updatedAt: now,
      };
    }),
  };
}

/** A task with every v2 field at its default. */
export function blankTask(listId, title, extra = {}) {
  const now = Date.now();
  return {
    id: uid(), listId, lane: 'backlog', title, done: false, order: 0,
    priority: 'none', tags: [], subtasks: [],
    start: null, due: null, dueTime: null, recur: 'none', reminder: null, reminderFiredAt: null,
    completedCount: 0, lastCompletedAt: null,
    status: 'active', archivedAt: null, deletedAt: null, origin: null,
    createdAt: now, updatedAt: now,
    ...extra,
  };
}

function seed() {
  const work = 'work', personal = 'personal', shopping = 'shopping', family = 'family';
  let o = 0;
  const t = (listId, title, extra = {}) => blankTask(listId, title, { order: o++, ...extra });
  return {
    version: 2,
    onboarded: false,
    currentList: work,
    view: 'list',
    sort: 'manual',
    lastAuto: null,
    lists: [
      { id: work, name: 'Work' },
      { id: personal, name: 'Personal' },
      { id: shopping, name: 'Shopping' },
      { id: family, name: 'Family' },
    ],
    tasks: [
      t(work, 'Prepare Q3 review deck', {
        due: daysFrom(7), dueTime: '09:00', reminder: 0, priority: 'high', tags: ['q3'], lane: 'inprogress',
        subtasks: [
          { id: uid(), title: 'Pull revenue numbers', done: true },
          { id: uid(), title: 'Outline the narrative', done: true },
          { id: uid(), title: 'Design summary slides', done: false },
          { id: uid(), title: 'Dry-run with team', done: false },
        ],
      }),
      t(work, 'Email vendor about contract renewal', { due: daysFrom(0), tags: ['vendor'], lane: 'inprogress' }),
      t(work, 'Book 1:1s for next sprint', { priority: 'medium', tags: ['team'] }),
      t(work, 'Draft launch announcement', { due: daysFrom(9), tags: ['launch', 'comms'] }),
      t(work, 'Research analytics tools', { priority: 'low', tags: ['tooling'] }),
      t(work, 'Send weekly status update', { done: true, lane: 'done' }),
      t(personal, 'Call the dentist', { due: daysFrom(0), tags: ['health'] }),
      t(personal, 'Pick up dry cleaning', { tags: ['errand'] }),
      t(personal, 'Plan weekend trip', {}),
      t(personal, 'Water the plants', { done: true, lane: 'done' }),
      t(shopping, 'Milk and eggs', {}),
      t(shopping, 'Birthday card for Sam', { due: daysFrom(2) }),
      t(shopping, 'Replace desk lamp', { priority: 'low' }),
      t(family, 'Schedule school pickup rotation', { due: daysFrom(1) }),
      t(family, 'Fix the bike tire', {}),
    ],
  };
}

/* ── Selectors (active tasks only unless named otherwise) ────────────── */

export const listById = (id) => S.lists.find((l) => l.id === id);
export const taskById = (id) => S.tasks.find((t) => t.id === id);      // any status
const active = () => S.tasks.filter((t) => t.status === 'active');
export const tasksOf = (listId) => active().filter((t) => t.listId === listId);
export const openCount = (listId) => tasksOf(listId).filter((t) => !t.done).length;

export function folderTasks(status) {
  const key = status === 'archived' ? 'archivedAt' : 'deletedAt';
  return S.tasks.filter((t) => t.status === status).sort((a, b) => b[key] - a[key]);
}

export const allTags = () =>
  [...new Set(S.tasks.filter((t) => t.status !== 'deleted').flatMap((t) => t.tags))];

export function sortedTasks(listId) {
  const rank = { high: 3, medium: 2, low: 1, none: 0 };
  const when = (t) => `${t.due} ${t.dueTime || '24:00'}`; // untimed tasks sort after timed ones that day
  const ts = tasksOf(listId).slice();
  ts.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1; // completed sink to the bottom
    if (S.sort === 'due') {
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      if (a.due && when(a) !== when(b)) return when(a) < when(b) ? -1 : 1;
    } else if (S.sort === 'priority') {
      if (rank[a.priority] !== rank[b.priority]) return rank[b.priority] - rank[a.priority];
    }
    return a.order - b.order;
  });
  return ts;
}

/* ── Mutations ───────────────────────────────────────────────────────── */

const touch = (t) => { t.updatedAt = Date.now(); };
const nextOrder = () => Math.max(0, ...S.tasks.map((t) => t.order + 1));
const leaveDetail = (id) => { if (UI.detailId === id) { UI.detailId = null; UI.screen = 'list'; } };

export function toggleDone(id) {
  const t = taskById(id); if (!t) return;
  if (!t.done && t.recur !== 'none' && t.due) { rollForward(id); return; } // recurring: never "done"
  t.done = !t.done;
  if (t.done) { t.lane = 'done'; S.lastAuto = Date.now(); }
  else if (t.lane === 'done') t.lane = 'backlog';
  touch(t); commit();
}

export function reorderTask(id, beforeId) {
  const ordered = sortedTasks(taskById(id).listId).filter((t) => t.id !== id);
  const idx = ordered.findIndex((t) => t.id === beforeId);
  ordered.splice(idx === -1 ? ordered.length : idx, 0, taskById(id));
  ordered.forEach((t, i) => { t.order = i; });
  commit();
}

export function moveToLane(id, lane) {
  const t = taskById(id); if (!t || !lane) return;
  if (lane === 'done' && t.recur !== 'none' && t.due) { rollForward(id); return; }
  t.lane = lane;
  t.done = lane === 'done';
  touch(t); commit();
}

export function addTask(draft) {
  S.tasks.push(blankTask(draft.listId, draft.title, {
    priority: draft.priority, tags: normalizeTags(draft.tags || []),
    start: draft.start || null, due: draft.due || null, dueTime: draft.dueTime || null,
    recur: draft.recur || 'none', reminder: draft.reminder ?? null,
    lane: draft.lane || 'backlog', done: draft.lane === 'done', order: nextOrder(),
  }));
  commit();
}

export function setReminder(id, minutes) {
  const t = taskById(id); if (!t) return;
  t.reminder = minutes; touch(t); commit();
}

export function setPriority(id, priority) {
  const t = taskById(id); if (!t) return;
  t.priority = priority; touch(t); commit();
}

export function setTitle(id, title) {
  const t = taskById(id); if (!t || !title.trim()) return;
  t.title = title.trim(); touch(t); commit();
}

/** Trimmed, no leading #, de-duplicated case-insensitively, empties dropped. */
export function normalizeTags(tags) {
  const seen = new Set();
  return tags.map((x) => String(x).trim().replace(/^#+/, '')).filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

export function setTags(id, tags) {
  const t = taskById(id); if (!t) return;
  t.tags = normalizeTags(tags); touch(t); commit();
}

/* — schedule — */

/** Normalise and store the five schedule fields in one go. Repeat and
    reminder need a due date; a start date after the due date is dropped. */
export function setSchedule(id, { start = null, due = null, dueTime = null, recur = 'none', reminder = null }) {
  const t = taskById(id); if (!t) return;
  t.due = due || null;
  t.dueTime = t.due ? (dueTime || null) : null;
  t.start = start && (!t.due || start <= t.due) ? start : null;
  t.recur = t.due ? recur : 'none';
  t.reminder = t.due ? reminder : null;
  t.reminderFiredAt = null;
  touch(t); commit();
}

export const clearSchedule = (id) => setSchedule(id, {});

/** Completing a recurring task: advance due (and start by the same number
    of days), reset subtasks, count the completion. Lane and done state are
    untouched. Returns what Undo needs, or null when not applicable. */
export function rollForward(id) {
  const t = taskById(id);
  if (!t || t.status !== 'active' || t.recur === 'none' || !t.due) return null;
  const prev = {
    start: t.start, due: t.due, subtasks: t.subtasks.map((s) => s.done),
    completedCount: t.completedCount, lastCompletedAt: t.lastCompletedAt, reminderFiredAt: t.reminderFiredAt,
  };
  const nextDue = nextOccurrence(t.due, t.recur);
  if (t.start) t.start = addDays(t.start, daysBetween(t.due, nextDue));
  t.due = nextDue;
  t.reminderFiredAt = null;
  t.subtasks.forEach((s) => { s.done = false; });
  t.completedCount += 1;
  t.lastCompletedAt = Date.now();
  touch(t); commit();
  return { prev, next: { due: t.due, start: t.start } };
}

export function undoRollForward(id, prev) {
  const t = taskById(id); if (!t) return;
  t.start = prev.start; t.due = prev.due; t.reminderFiredAt = prev.reminderFiredAt;
  t.subtasks.forEach((s, i) => { s.done = !!prev.subtasks[i]; });
  t.completedCount = prev.completedCount; t.lastCompletedAt = prev.lastCompletedAt;
  touch(t); commit();
}

/** Move to another board and/or lane; the task lands at the end of the
    target lane and the moved-to board becomes the current one. A recurring
    task never enters Done: it keeps its lane (callers roll it forward). */
export function moveTask(id, listId, lane) {
  const t = taskById(id); if (!t || !listById(listId)) return;
  if (lane === 'done' && t.recur !== 'none' && t.due) lane = t.lane;
  if (t.listId === listId && t.lane === lane) return;
  t.listId = listId; t.lane = lane; t.order = nextOrder();
  t.done = lane === 'done';
  S.currentList = listId;
  touch(t); commit();
}

/** Duplicate into a board/lane: same fields and schedule, subtasks reset,
    fresh ids and timestamps. Returns the copy. */
export function copyTask(id, listId, lane) {
  const t = taskById(id); if (!t || !listById(listId)) return null;
  const copy = blankTask(listId, t.title, {
    lane, done: lane === 'done', order: nextOrder(),
    priority: t.priority, tags: [...t.tags],
    subtasks: t.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
    start: t.start, due: t.due, dueTime: t.dueTime, recur: t.recur, reminder: t.reminder,
  });
  S.tasks.push(copy);
  commit();
  return copy;
}

export function newList() {
  const name = prompt('New board name');
  if (!name || !name.trim()) return;
  const list = { id: uid(), name: name.trim() };
  S.lists.push(list);
  S.currentList = list.id;
  UI.screen = 'list';
  commit();
}

/* — lifecycle: archive / soft delete / restore / purge — */

function snapshotOrigin(t) {
  if (!t.origin) t.origin = { listId: t.listId, lane: t.lane, order: t.order };
}

export function archiveTask(id) {
  const t = taskById(id); if (!t || t.status !== 'active') return;
  snapshotOrigin(t);
  t.status = 'archived'; t.archivedAt = Date.now();
  leaveDetail(id); touch(t); commit();
}

/** Returns the status and archivedAt it had, so Undo can put it back. */
export function softDelete(id) {
  const t = taskById(id); if (!t || t.status === 'deleted') return null;
  const prev = { status: t.status, archivedAt: t.archivedAt };
  snapshotOrigin(t);
  t.status = 'deleted'; t.deletedAt = Date.now(); t.archivedAt = null;
  leaveDetail(id); touch(t); commit();
  return prev;
}

/** Undo for a task deleted from the Archived folder: back into Archived. */
export function returnToArchive(id, archivedAt) {
  const t = taskById(id); if (!t || t.status !== 'deleted') return;
  t.status = 'archived'; t.archivedAt = archivedAt; t.deletedAt = null;
  touch(t); commit();
}

/** Back to the origin board + lane. keepPosition restores the old order
    (Undo); otherwise the task goes to the end. Falls back to the first
    board's Backlog when the origin board is gone. */
export function restoreTask(id, { keepPosition = false } = {}) {
  const t = taskById(id); if (!t || t.status === 'active') return null;
  const o = t.origin || { listId: t.listId, lane: t.lane, order: t.order };
  const fellBack = !listById(o.listId);
  t.listId = fellBack ? S.lists[0].id : o.listId;
  t.lane = fellBack ? 'backlog' : o.lane;
  t.order = keepPosition ? o.order : nextOrder();
  t.done = t.lane === 'done';
  t.status = 'active'; t.archivedAt = null; t.deletedAt = null; t.origin = null;
  touch(t); commit();
  return { listId: t.listId, lane: t.lane, fellBack };
}

export function deleteForever(id) {
  S.tasks = S.tasks.filter((t) => t.id !== id);
  commit();
}

export function emptyDeleted() {
  S.tasks = S.tasks.filter((t) => t.status !== 'deleted');
  commit();
}

/** Drops deleted tasks older than RETENTION_DAYS. Returns how many went. */
export function purgeDeleted(now = Date.now()) {
  const before = S.tasks.length;
  S.tasks = S.tasks.filter((t) => t.status !== 'deleted' || now - t.deletedAt < RETENTION_MS);
  const removed = before - S.tasks.length;
  if (removed) save();
  return removed;
}
