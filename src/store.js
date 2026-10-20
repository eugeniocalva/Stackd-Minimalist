/* State, persistence, migration, selectors and mutations. Every mutation
   ends in commit() (save + re-render); UI-only changes use rerender(). The
   renderer is injected by app.js so this module never imports the view
   layer. Schema: docs/architecture.md §3. */

import { uid } from './util.js';
import {
  daysFrom, nextOccurrence, addDays, daysBetween, reminderInstant,
  defaultDateFormat, isDateFormat, setDefaultDateFormat, fmtDate, fmtClock,
} from './dates.js';
import { reminderKey } from './reminders.js';
import { sanitize, toText } from './richtext.js';

export const STORE_KEY = 'stackd-v2';
const LEGACY_KEY = 'stackd-v1';
export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 86400000;

/* Lanes are per board (1.4.3): list.lanes = [{ id, name }], in column
   order. The lane whose id is DONE_LANE is the board's Done lane: it can be
   renamed and moved but not deleted, because completing a task means moving
   it there (and the automation depends on it). Other lanes are free. */
export const DONE_LANE = 'done';
export const defaultLanes = () => [
  { id: 'backlog', name: 'Backlog' },
  { id: 'inprogress', name: 'In Progress' },
  { id: DONE_LANE, name: 'Done' },
];
export const lanesOf = (listId) => listById(listId)?.lanes || defaultLanes();
export const laneName = (listId, laneId) => lanesOf(listId).find((l) => l.id === laneId)?.name || laneId;
/** Where new and reopened tasks land: the board's first lane that is not Done. */
export const firstLane = (listId) => (lanesOf(listId).find((l) => l.id !== DONE_LANE) || lanesOf(listId)[0]).id;
/** A lane id the board has: the given one, else its first lane. */
export const validLane = (listId, laneId) => (lanesOf(listId).some((l) => l.id === laneId) ? laneId : firstLane(listId));
/** Active tasks in a lane. */
export const laneTaskCount = (listId, laneId) =>
  S.tasks.filter((t) => t.status === 'active' && t.listId === listId && t.lane === laneId).length;
/* Task sort: manual order, or a field with a direction. [value, menu label, button label] */
export const TASK_SORTS = [
  ['manual', 'Manual', 'Sort'],
  ['due-asc', 'Due date · soonest first', 'Due · soonest'], ['due-desc', 'Due date · latest first', 'Due · latest'],
  ['priority-desc', 'Priority · high first', 'High first'], ['priority-asc', 'Priority · low first', 'Low first'],
];
export const isManualSort = () => S.sort === 'manual';
/* Priority levels are user-configurable (Settings): S.priorities, highest
   first. 'none' is implicit and always sorts last. */
export const PRIORITY_COLORS = ['red', 'amber', 'green', 'blue', 'violet', 'gray'];
const defaultPriorities = () => [
  { id: 'high', name: 'High', color: 'red' },
  { id: 'medium', name: 'Medium', color: 'amber' },
  { id: 'low', name: 'Low', color: 'gray' },
];
export const THEMES = ['light', 'dark', 'system'];
/* Notes (docs/prd-notes.md): list order and the composer draft's own key. */
export const NOTES_SORTS = [
  ['manual', 'Manual'],
  ['created-desc', 'Created · newest first'], ['created-asc', 'Created · oldest first'],
  ['updated-desc', 'Edited · newest first'], ['updated-asc', 'Edited · oldest first'],
];
export const NOTE_COLORS = PRIORITY_COLORS;
export const NOTE_DRAFT_KEY = 'stackd-note-draft';
/* Meetings (docs/prd-meetings.md, architecture §19): list order, the
   recording cap, the plan tiers and the proxy the AI steps talk to. */
export const MEETINGS_SORTS = [
  ['created-desc', 'Newest first'], ['created-asc', 'Oldest first'], ['title-asc', 'Title A–Z'],
];
export const MAX_RECORDING_MS = 30 * 60 * 1000;
export const PLAN_TIERS = ['free', 'plus', 'pro', 'max'];
/* The PRD's plan table (AC-12.1); the proxy's plans.js is the one that counts,
   this is what the cards show. Prices are the fallback when the store has
   not answered (and on the web). */
export const PLAN_POOLS = { plus: { hours: 8, summaries: 20 }, pro: { hours: 16, summaries: 50 }, max: { hours: 24, summaries: 100 } };
export const PLAN_PRICES = { plus: '€9.99', pro: '€19.99', max: '€29.99' };
export const planName = (tier) => ({ free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max', tester: 'Tester' }[tier] || 'Free');
export const PROXY_URL = 'https://stackd-proxy.eugeniocalva.workers.dev';
/* A low-value constant that stops drive-by use of the proxy; the subscriber
   entitlement is the real gate (architecture §20). Must equal the Worker's
   APP_TOKEN secret. */
export const APP_TOKEN = 'stackd-app-2026-10';
export const proxyUrl = () => S.ai.proxyUrl || PROXY_URL;
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
  screen: 'list',        // 'lists' | 'list' | 'detail' | 'folders' | 'settings' | 'notes' | 'note' | 'meetings' | 'meeting'
  folder: 'archived',    // which tab the folders screen shows
  folderKind: 'tasks',   // 'tasks' | 'notes' | 'meetings' — segment inside a folder
  detailId: null,        // task id on 'detail', note id on 'note', meeting id on 'meeting'
  transcriptAll: false,  // meeting detail: the transcript is expanded past its first lines
  recorder: null,        // { meetingId } while a recording runs (ui/recorder.js owns the session)
  recorderDenied: false, // the microphone permission was refused on the last attempt
  sortMenu: false,
  refocusAddsub: false,
  composer: { expanded: false, formatOpen: false, focus: null },   // Notes composer; focus = field to refocus after a render
  query: '',             // search text of the current screen; cleared on screen / board change
  queryKey: null,        // which screen / board the query belongs to (ui/search.js queryFor)
  tagFilter: null,       // Notes: tag chip filter
  searchOpen: false,     // mobile: search field expanded from its icon
  searchFocus: false,    // refocus the search field after the next render
  searchCaret: null,     // [start, end] to restore with it
};
export const isDesktop = window.matchMedia('(min-width: 900px)');

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
export function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

let renderer = () => {};
let afterCommit = () => {};
export function setRenderer(fn) { renderer = fn; }
/** Runs after every commit (app.js wires native reminder sync here). The
    hook must never commit or re-render itself. */
export function setAfterCommit(fn) { afterCommit = fn; }
export function rerender() { renderer(); }
export function commit() { save(); renderer(); afterCommit(); }

/* ── Migration ───────────────────────────────────────────────────────── */

function migrate() {
  const v2 = read(STORE_KEY);
  if (v2) return withSettings(v2);
  const v1 = read(LEGACY_KEY);
  const state = withSettings(v1 ? upgradeV1(v1) : seed());
  localStorage.setItem(STORE_KEY, JSON.stringify(state)); // v1 key is left for rollback
  return state;
}

/** Settings fields added after v2 shipped, at their defaults. */
function withSettings(state) {
  state.theme ??= 'system';
  state.priorities ??= defaultPriorities();
  state.labels ??= [];   // labels created in Settings; tags on tasks count too
  /* Notes (1.4.0): no migration, just defaults */
  state.notes ??= [];
  state.notesSort ??= 'created-desc';
  /* 1.4.2: task sorts carry a direction; the old field-only values map to their old order */
  if (state.sort === 'due') state.sort = 'due-asc';
  else if (state.sort === 'priority') state.sort = 'priority-desc';
  else if (!TASK_SORTS.some(([v]) => v === state.sort)) state.sort = 'manual';
  /* 1.4.3: lanes per board; boards from before carry the three built-in lanes */
  state.lists.forEach((l) => { l.lanes ??= defaultLanes(); });
  /* Meetings (1.5.0): defaults only. The plan cache keeps its subscriber id
     across loads; everything else in it is overwritten by the proxy. */
  state.meetings ??= [];
  if (!MEETINGS_SORTS.some(([v]) => v === state.meetingsSort)) state.meetingsSort = 'created-desc';
  state.ai = { proxyUrl: null, disclosed: false, consented: false, ...(state.ai || {}) };
  state.plan = {
    tier: 'free', subscriberId: uid() + uid(), renewsAt: null,
    audioSecondsLeft: 0, audioSecondsTotal: 0, summariesLeft: 0, summariesTotal: 0, checkedAt: 0,
    ...(state.plan || {}),
  };
  if (!PLAN_TIERS.includes(state.plan.tier)) state.plan.tier = 'free';
  if (!isDateFormat(state.dateFormat)) state.dateFormat = defaultDateFormat();
  setDefaultDateFormat(state.dateFormat);   // every date the app writes follows it
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
      const task = {
        ...blankTask(t.listId, t.title),
        ...t,
        dueTime: hasSchedule ? time : null,
        reminder: hasSchedule ? 0 : null,
        createdAt: now, updatedAt: now,
      };
      armReminder(task, now);
      return task;
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
    from: null,                              // { meetingId, actionId } when made from an action card (1.5.0)
    createdAt: now, updatedAt: now,
    ...extra,
  };
}

/** A note with every field at its default (schema: docs/architecture.md §10). */
export function blankNote(extra = {}) {
  const now = Date.now();
  return {
    id: uid(), order: 0, title: '', body: '', color: null, tags: [], checklist: null,
    status: 'active', archivedAt: null, deletedAt: null,
    createdAt: now, updatedAt: now,
    ...extra,
  };
}

/** A meeting with every field at its default (schema: docs/architecture.md
    §19). The title is '' until the user types one; meetingTitle() shows the
    dated default meanwhile, so it follows the Date format setting live. */
export function blankMeeting(extra = {}) {
  const now = Date.now();
  return {
    id: uid(), title: '', createdAt: now, updatedAt: now,
    recording: null, transcript: null, minutes: null, actions: [],
    jobs: { transcribe: null, summarise: null }, lastError: null,
    status: 'active', archivedAt: null, deletedAt: null,
    ...extra,
  };
}
export const defaultMeetingTitle = (ts) => `Meeting · ${fmtDate(ts)} ${fmtClock(ts)}`;
export const meetingTitle = (m) => m.title.trim() || defaultMeetingTitle(m.createdAt);

/* — composer draft: its own key, no commit, no render — */

export const blankDraft = () => ({ title: '', body: '', color: null, tags: [], checklist: null });

export function loadDraft() {
  const d = read(NOTE_DRAFT_KEY);
  if (!d || typeof d !== 'object') return null;
  const draft = { ...blankDraft(), ...d, body: sanitize(d.body), tags: normalizeTags(d.tags || []) };
  if (!NOTE_COLORS.includes(draft.color)) draft.color = null;
  if (draft.checklist !== null && !Array.isArray(draft.checklist)) draft.checklist = null;
  return draft;
}
export function saveDraft(draft) {
  try { localStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() })); } catch { /* storage full or unavailable: the in-memory draft still works */ }
}
export function clearDraft() { localStorage.removeItem(NOTE_DRAFT_KEY); }

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
      { id: work, name: 'Work', lanes: defaultLanes() },
      { id: personal, name: 'Personal', lanes: defaultLanes() },
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

/* tags and notes share one pool (PRD-notes Q3) */
const tagged = () => [...S.tasks, ...S.notes].filter((x) => x.status !== 'deleted');
export const allTags = () => normalizeTags([...S.labels, ...tagged().flatMap((x) => x.tags)]);

const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();
/** Non-deleted tasks and notes carrying the tag (case-insensitive). */
export const tagUseCount = (name) => tagged().filter((x) => x.tags.some((t) => sameTag(t, name))).length;

/* — notes — */

export const noteById = (id) => S.notes.find((n) => n.id === id);   // any status
export const activeNotes = () => S.notes.filter((n) => n.status === 'active');

/** Manual: by order. Date sorts: by the field, ties by order. */
export function sortedNotes(sort = S.notesSort) {
  const ns = activeNotes();
  const [field, dir] = sort === 'manual' ? [null, 1]
    : [sort.startsWith('updated') ? 'updatedAt' : 'createdAt', sort.endsWith('asc') ? 1 : -1];
  ns.sort((a, b) => {
    if (field && a[field] !== b[field]) return (a[field] - b[field]) * dir;
    if (a.order !== b.order) return a.order - b.order;
    return b.createdAt - a.createdAt;          // equal positions (a restored note): newer first
  });
  return ns;
}

export const checklistProgress = (n) => (n.checklist && n.checklist.length
  ? { done: n.checklist.filter((c) => c.done).length, total: n.checklist.length } : null);

/** Open items first, then ticked ones, each in authoring order (PRD-notes Q14). */
export const sortedChecklist = (items) => [...items.filter((c) => !c.done), ...items.filter((c) => c.done)];

export const noteIsEmpty = (n) =>
  !n.title.trim() && toText(n.body).trim() === '' && !(n.checklist || []).some((c) => c.text.trim());

/** Row / detail title: the title, else the body's first line, else the first
    checklist item, else 'Untitled'. */
export function noteTitle(n) {
  return n.title.trim() || toText(n.body).split('\n').find((l) => l.trim())?.trim()
    || (n.checklist || []).map((c) => c.text.trim()).find(Boolean) || 'Untitled';
}

export function folderNotes(status) {
  const key = status === 'archived' ? 'archivedAt' : 'deletedAt';
  return S.notes.filter((n) => n.status === status).sort((a, b) => b[key] - a[key]);
}
/* — meetings — */

export const meetingById = (id) => S.meetings.find((m) => m.id === id);   // any status
export const activeMeetings = () => S.meetings.filter((m) => m.status === 'active');

/** Date sorts by createdAt; title sort is case-insensitive, ties newest first. */
export function sortedMeetings(sort = S.meetingsSort) {
  const ms = activeMeetings();
  if (sort === 'title-asc') {
    ms.sort((a, b) => meetingTitle(a).localeCompare(meetingTitle(b), undefined, { sensitivity: 'base' }) || b.createdAt - a.createdAt);
  } else {
    ms.sort((a, b) => (sort === 'created-asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }
  return ms;
}

export function folderMeetings(status) {
  const key = status === 'archived' ? 'archivedAt' : 'deletedAt';
  return S.meetings.filter((m) => m.status === status).sort((a, b) => b[key] - a[key]);
}

/** Proposed vs added action cards (row chip, Actions heading). */
export const actionCounts = (m) => ({
  proposed: m.actions.filter((a) => a.status === 'proposed').length,
  added: m.actions.filter((a) => a.status === 'added').length,
});
/** The transcript changed after the minutes were made (AC-07.5). */
export const minutesStale = (m) => !!(m.minutes && m.transcript && m.transcript.updatedAt > m.minutes.transcriptUpdatedAt);
/** Nothing in it and no title of its own: dropped silently on back (AC-03.5). */
export const meetingIsEmpty = (m) => !m.recording && !m.transcript && !m.title.trim();

/** Tasks + notes + meetings in a folder (sidebar and Boards-menu counts). */
export const folderCount = (status) => folderTasks(status).length + folderNotes(status).length + folderMeetings(status).length;

/** Label usage split by kind, for Settings › Labels. */
export const tagUseCounts = (name) => ({
  tasks: S.tasks.filter((t) => t.status !== 'deleted' && t.tags.some((x) => sameTag(x, name))).length,
  notes: S.notes.filter((n) => n.status !== 'deleted' && n.tags.some((x) => sameTag(x, name))).length,
});

export const priorityById = (id) => S.priorities.find((p) => p.id === id);
/** The id of the priority whose name matches (case-insensitive), else 'none'. */
export const priorityIdByName = (name) => S.priorities.find((p) => p.name.toLowerCase() === String(name ?? '').trim().toLowerCase())?.id || 'none';
export const priorityName = (id) => priorityById(id)?.name || 'None';
export const priorityUseCount = (id) =>
  S.tasks.filter((t) => t.status !== 'deleted' && t.priority === id).length;

/** Manual: by order. Field sorts: by the field in S.sort's direction, ties by order. */
export function sortedTasks(listId) {
  const n = S.priorities.length;
  const rank = (p) => { const i = S.priorities.findIndex((x) => x.id === p); return i === -1 ? 0 : n - i; };
  const when = (t) => `${t.due} ${t.dueTime || '24:00'}`; // untimed tasks sort after timed ones that day
  const [field, dir] = S.sort === 'manual' ? [null, 1] : [S.sort.split('-')[0], S.sort.endsWith('asc') ? 1 : -1];
  const ts = tasksOf(listId).slice();
  ts.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1; // completed sink to the bottom
    if (field === 'due') {
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;  // undated tasks last, whichever direction
      if (a.due && when(a) !== when(b)) return (when(a) < when(b) ? -1 : 1) * dir;
    } else if (field === 'priority') {
      const ra = rank(a.priority), rb = rank(b.priority);
      if (!!ra !== !!rb) return ra ? -1 : 1;              // no priority last, whichever direction
      if (ra !== rb) return (ra - rb) * dir;
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
  if (t.done) { t.lane = DONE_LANE; S.lastAuto = Date.now(); }
  else { if (t.lane === DONE_LANE) t.lane = firstLane(t.listId); armReminder(t); }
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
  lane = validLane(t.listId, lane);
  if (lane === DONE_LANE && t.recur !== 'none' && t.due) { rollForward(id); return; }
  const wasDone = t.done;
  t.lane = lane;
  t.done = lane === 'done';
  if (wasDone && !t.done) armReminder(t);
  touch(t); commit();
}

export function addTask(draft) {
  const t = blankTask(draft.listId, draft.title, {
    priority: draft.priority, tags: normalizeTags(draft.tags || []),
    start: draft.start || null, due: draft.due || null, dueTime: draft.dueTime || null,
    recur: draft.recur || 'none', reminder: draft.reminder ?? null,
    lane: validLane(draft.listId, draft.lane || firstLane(draft.listId)), order: nextOrder(),
    from: draft.from || null,
  });
  t.done = t.lane === DONE_LANE;
  armReminder(t);
  S.tasks.push(t);
  commit();
  return t;
}

export function setPriority(id, priority) {
  const t = taskById(id); if (!t) return;
  t.priority = priority; touch(t); commit();
}

/* — notes — */

/** Normalised checklist: trimmed text, empty items dropped; null stays null. */
const cleanChecklist = (items) => (items === null || items === undefined ? null
  : items.map((c) => ({ id: c.id || uid(), text: String(c.text ?? '').trim(), done: !!c.done })).filter((c) => c.text));

/** The composer's Add: a new note goes first in manual order; the draft is cleared. */
export function addNote(draft) {
  const n = blankNote({
    title: String(draft.title ?? '').trim(),
    body: sanitize(draft.body),
    color: NOTE_COLORS.includes(draft.color) ? draft.color : null,
    tags: normalizeTags(draft.tags || []),
    checklist: cleanChecklist(draft.checklist),
    order: Math.min(0, ...activeNotes().map((x) => x.order)) - 1,
  });
  if (noteIsEmpty(n)) return null;
  S.notes.push(n);
  clearDraft();
  commit();
  return n;
}

/* Detail edits save without a re-render (the editor keeps its caret); the
   post-commit hook still runs. Lifecycle changes below use commit(). */
const touchNote = (n) => { n.updatedAt = Date.now(); };
const persistQuiet = () => { save(); afterCommit(); };
const leaveNote = (id) => { if (UI.screen === 'note' && UI.detailId === id) { UI.detailId = null; UI.screen = 'notes'; } };

/** Autosave from the detail: title, body, color, tags, checklist (items kept
    as typed; finalizeNote() tidies them when the note is left). */
export function updateNote(id, patch) {
  const n = noteById(id); if (!n || n.status !== 'active') return;
  if (patch.title !== undefined) n.title = String(patch.title);
  if (patch.body !== undefined) n.body = sanitize(patch.body);
  if (patch.color !== undefined) n.color = NOTE_COLORS.includes(patch.color) ? patch.color : null;
  if (patch.tags !== undefined) n.tags = normalizeTags(patch.tags);
  if (patch.checklist !== undefined) {
    n.checklist = patch.checklist === null ? null
      : patch.checklist.map((c) => ({ id: c.id || uid(), text: String(c.text ?? ''), done: !!c.done }));
  }
  touchNote(n); persistQuiet();
}

export function toggleCheckItem(id, itemId) {
  const n = noteById(id); const c = n?.checklist?.find((x) => x.id === itemId); if (!c) return;
  c.done = !c.done; touchNote(n); persistQuiet();      // ticking is an edit (PRD-notes Q15)
}

/** Leaving the detail: trim the title, drop empty checklist items (an empty
    section becomes none), and delete a note left completely empty (AC-04.6). */
export function finalizeNote(id) {
  const n = noteById(id); if (!n || n.status !== 'active') return false;
  const title = n.title.trim();
  const checklist = cleanChecklist(n.checklist);
  const changed = title !== n.title || JSON.stringify(checklist) !== JSON.stringify(n.checklist);
  n.title = title; n.checklist = checklist && checklist.length ? checklist : null;
  if (noteIsEmpty(n)) { S.notes = S.notes.filter((x) => x.id !== id); leaveNote(id); commit(); return true; }
  if (changed) touchNote(n);
  commit();
  return false;
}

/** "Copy of …" with the checklist unticked, fresh dates and ids, first in manual order. */
export function copyNote(id) {
  const n = noteById(id); if (!n) return null;
  const copy = blankNote({
    title: n.title.trim() ? `Copy of ${n.title.trim()}` : '',
    body: n.body, color: n.color, tags: [...n.tags],
    checklist: n.checklist ? n.checklist.map((c) => ({ id: uid(), text: c.text, done: false })) : null,
    order: Math.min(0, ...activeNotes().map((x) => x.order)) - 1,
  });
  S.notes.push(copy);
  commit();
  return copy;
}

export function archiveNote(id) {
  const n = noteById(id); if (!n || n.status !== 'active') return;
  n.status = 'archived'; n.archivedAt = Date.now();
  leaveNote(id); commit();
}

/** Returns the status and archivedAt it had, so Undo can put it back. */
export function softDeleteNote(id) {
  const n = noteById(id); if (!n || n.status === 'deleted') return null;
  const prev = { status: n.status, archivedAt: n.archivedAt };
  n.status = 'deleted'; n.deletedAt = Date.now(); n.archivedAt = null;
  leaveNote(id); commit();
  return prev;
}

export function returnNoteToArchive(id, archivedAt) {
  const n = noteById(id); if (!n || n.status !== 'deleted') return;
  n.status = 'archived'; n.archivedAt = archivedAt; n.deletedAt = null;
  commit();
}

/** Back to the Notes list at its stored manual position. */
export function restoreNote(id) {
  const n = noteById(id); if (!n || n.status === 'active') return;
  n.status = 'active'; n.archivedAt = null; n.deletedAt = null;
  commit();
}

export function deleteNoteForever(id) {
  S.notes = S.notes.filter((n) => n.id !== id);
  commit();
}

/* — notes: sort and manual order (PRD-notes US-07) — */

export function setNotesSort(sort) {
  if (!NOTES_SORTS.some(([v]) => v === sort) || S.notesSort === sort) return;
  S.notesSort = sort; commit();
}

/** Drop the note before `beforeId` (or last when null); manual sort only.
    Renumbers the active notes 0…n−1, so the next new note (min − 1) stays first. */
export function reorderNote(id, beforeId) {
  const n = noteById(id);
  if (!n || n.status !== 'active' || S.notesSort !== 'manual') return;
  const ordered = sortedNotes('manual').filter((x) => x.id !== id);
  const idx = ordered.findIndex((x) => x.id === beforeId);
  ordered.splice(idx === -1 ? ordered.length : idx, 0, n);
  ordered.forEach((x, i) => { x.order = i; });
  commit();
}

/* — meetings (PRD-meetings US-03, US-06, US-10) — */

/* Recordings live outside this document (media.js). The store only knows
   their keys; app.js injects the function that deletes the blobs, so the
   store stays free of IndexedDB and the Node checks can stub it. */
let mediaRemover = () => {};
export function setMediaRemover(fn) { mediaRemover = fn; }
const dropMedia = (ms) => { const keys = ms.map((m) => m.recording?.key).filter(Boolean); if (keys.length) mediaRemover(keys); };

/** The recorder saved (or deleted) this meeting's recording (AC-04.5, AC-04.8). */
export function setRecording(id, rec) {
  const m = meetingById(id); if (!m || m.status !== 'active') return;
  if (!rec && m.recording) mediaRemover([m.recording.key]);
  m.recording = rec ? { key: rec.key, mimeType: rec.mimeType, durationMs: rec.durationMs, sizeBytes: rec.sizeBytes, recordedAt: rec.recordedAt } : null;
  touchMeeting(m); commit();
}

/** Recording again (AC-04.9): the new recording replaces the old one, and the
    transcript, minutes and proposed actions go with it; added ones stay. */
export function replaceRecording(id, rec) {
  const m = meetingById(id); if (!m || m.status !== 'active') return;
  if (m.recording && m.recording.key !== rec.key) mediaRemover([m.recording.key]);
  m.recording = { key: rec.key, mimeType: rec.mimeType, durationMs: rec.durationMs, sizeBytes: rec.sizeBytes, recordedAt: rec.recordedAt };
  m.transcript = null; m.minutes = null;
  m.actions = m.actions.filter((a) => a.status === 'added');
  m.jobs = { transcribe: null, summarise: null }; m.lastError = null;
  touchMeeting(m); commit();
}

const touchMeeting = (m) => { m.updatedAt = Date.now(); };
const leaveMeeting = (id) => { if (UI.screen === 'meeting' && UI.detailId === id) { UI.detailId = null; UI.screen = 'meetings'; } };

/** The + on the Meetings screen: a blank meeting, opened at once. */
export function newMeeting() {
  const m = blankMeeting();
  S.meetings.push(m);
  UI.detailId = m.id; UI.screen = 'meeting'; UI.transcriptAll = false;
  commit();
  return m;
}

/** Title autosave from the detail (quiet: the input keeps its caret). */
export function updateMeeting(id, patch) {
  const m = meetingById(id); if (!m || m.status !== 'active') return;
  if (patch.title !== undefined) m.title = String(patch.title);
  touchMeeting(m); persistQuiet();
}

/** Leaving the detail: trim the title; an untouched meeting is dropped (AC-03.5). */
export function finalizeMeeting(id) {
  const m = meetingById(id); if (!m || m.status !== 'active') return false;
  m.title = m.title.trim();
  if (meetingIsEmpty(m)) { S.meetings = S.meetings.filter((x) => x.id !== id); leaveMeeting(id); commit(); return true; }
  commit();
  return false;
}

/** A transcript from any source replaces the old one; the minutes and the
    proposed actions go with it, added actions keep their tasks (AC-04.9). */
export function setTranscript(id, { source, fileName = null, segments, speakers }) {
  const m = meetingById(id); if (!m || m.status !== 'active') return;
  const now = Date.now();
  m.transcript = {
    source, fileName,
    segments: segments
      .map((s) => ({ id: s.id || uid(), speaker: s.speaker, startMs: s.startMs ?? null, text: String(s.text ?? '').trim() }))
      .filter((s) => s.text),
    speakers: { ...speakers },
    createdAt: now, updatedAt: now,
  };
  m.minutes = null;
  m.actions = m.actions.filter((a) => a.status === 'added');
  m.lastError = null;
  touchMeeting(m); commit();
}

/** A name for a speaker label, for every segment of this meeting; null or
    '' returns the default label (AC-06.2). Counts as a transcript edit. */
export function renameSpeaker(id, label, name) {
  const m = meetingById(id); const t = m?.transcript;
  if (!t || !Object.hasOwn(t.speakers, label)) return;
  const n = String(name ?? '').trim();
  t.speakers[label] = n || null;
  t.updatedAt = Date.now();
  touchMeeting(m); commit();
}

/** The proxy's answer to Summarise (AC-07.1): the minutes, stamped with the
    transcript version they were made from, and the proposed actions, which
    replace the previous proposed ones (added and dismissed ones stay). */
export function setMinutes(id, minutes, actions = []) {
  const m = meetingById(id); if (!m || !m.transcript) return;
  const now = Date.now();
  m.minutes = {
    summary: String(minutes?.summary ?? '').trim(),
    decisions: (minutes?.decisions || []).map((x) => String(x).trim()).filter(Boolean),
    openQuestions: (minutes?.openQuestions || []).map((x) => String(x).trim()).filter(Boolean),
    generatedAt: now, transcriptUpdatedAt: m.transcript.updatedAt,
  };
  m.actions = [
    ...m.actions.filter((a) => a.status !== 'proposed'),
    ...actions.map((a) => ({
      id: uid(), title: String(a.title ?? '').trim(), due: a.due || null, priority: priorityIdByName(a.priority),
      excerpt: String(a.excerpt ?? '').trim(), status: 'proposed', taskId: null,
    })).filter((a) => a.title),
  ];
  m.lastError = null;
  touchMeeting(m); commit();
}

/** In-place edits of the minutes text (AC-07.4); quiet, like a note body. */
export function editMinutes(id, patch) {
  const m = meetingById(id); if (!m?.minutes || m.status !== 'active') return;
  if (patch.summary !== undefined) m.minutes.summary = String(patch.summary);
  if (patch.decisions !== undefined) m.minutes.decisions = patch.decisions.map((x) => String(x));
  if (patch.openQuestions !== undefined) m.minutes.openQuestions = patch.openQuestions.map((x) => String(x));
  touchMeeting(m); persistQuiet();
}

/** Job and error state from ai.js (jobs, lastError); re-renders so buttons follow. */
export function setJobState(id, patch) {
  const m = meetingById(id); if (!m) return;
  if (patch.jobs !== undefined) m.jobs = patch.jobs;
  if (patch.lastError !== undefined) m.lastError = patch.lastError;
  commit();
}

/* — plan cache and AI settings (PRD-meetings US-09, US-11) — */

/** The proxy's allowance answer → S.plan (the proxy is the truth; the app only copies). */
export function setPlanCache(a) {
  const tier = PLAN_TIERS.includes(a?.tier) || a?.tier === 'tester' ? a.tier : S.plan.tier;
  const changed = tier !== S.plan.tier;
  Object.assign(S.plan, {
    tier, renewsAt: a?.renewsAt ?? null,
    audioSecondsLeft: a?.audioSecondsLeft ?? 0, audioSecondsTotal: a?.audioSecondsTotal ?? 0,
    summariesLeft: a?.summariesLeft ?? 0, summariesTotal: a?.summariesTotal ?? 0,
    checkedAt: Date.now(),
  });
  if (changed) commit(); else persistQuiet();
}

/** Settings › Developer: https only (http for localhost); '' clears. Returns false when rejected. */
export function setProxyUrl(url) {
  const u = String(url ?? '').trim().replace(/\/+$/, '');
  if (u && !/^https:\/\/[^\s]+$|^http:\/\/localhost(:\d+)?$/.test(u)) return false;
  S.ai.proxyUrl = u || null; S.plan.checkedAt = 0;
  commit();
  return true;
}
export function markDisclosed() { S.ai.disclosed = true; persistQuiet(); }
export function markConsented() { S.ai.consented = true; persistQuiet(); }
export function resetNotices() { S.ai.disclosed = false; S.ai.consented = false; commit(); }

/* — action cards (PRD-meetings US-08) — */

const actionOf = (m, actionId) => m?.actions.find((a) => a.id === actionId);

/** Inline edits on a proposed card (title, due, priority); quiet. */
export function editAction(id, actionId, patch) {
  const m = meetingById(id); const a = actionOf(m, actionId);
  if (!a || a.status !== 'proposed') return;
  if (patch.title !== undefined) a.title = String(patch.title);
  if (patch.due !== undefined) a.due = patch.due || null;
  if (patch.priority !== undefined) a.priority = priorityById(patch.priority) ? patch.priority : 'none';
  touchMeeting(m); persistQuiet();
}

/** Swipe-left Delete, or ✕ on an added card (its task stays). Returns the
    status it had, so Undo can put it back, or null. */
export function dismissAction(id, actionId) {
  const m = meetingById(id); const a = actionOf(m, actionId);
  if (!a || a.status === 'dismissed') return null;
  const prev = a.status;
  a.status = 'dismissed';
  touchMeeting(m); commit();
  return prev;
}

export function restoreAction(id, actionId, status = 'proposed') {
  const m = meetingById(id); const a = actionOf(m, actionId);
  if (!a || a.status !== 'dismissed') return;
  a.status = status === 'added' && a.taskId ? 'added' : 'proposed';
  touchMeeting(m); commit();
}

/** Save from the prefilled task sheet (AC-08.5): the task is created on the
    chosen board and lane with a pointer back here; the card becomes added. */
export function addActionToBoard(id, actionId, draft) {
  const m = meetingById(id); const a = actionOf(m, actionId);
  if (!a || a.status !== 'proposed' || !listById(draft.listId)) return null;
  a.title = String(draft.title ?? a.title).trim() || a.title;
  const t = addTask({ ...draft, title: a.title, from: { meetingId: id, actionId } });
  a.status = 'added'; a.taskId = t.id;
  a.due = t.due; a.priority = t.priority;
  touchMeeting(m); commit();
  return t;
}

/** Inline edit of one segment's text (AC-06.4); quiet, counts as a transcript edit. */
export function editSegment(id, segmentId, text) {
  const m = meetingById(id); const seg = m?.transcript?.segments.find((s) => s.id === segmentId);
  if (!seg || m.status !== 'active') return;
  const t = String(text ?? '').trim();
  if (!t || t === seg.text) return;
  seg.text = t; m.transcript.updatedAt = Date.now();
  touchMeeting(m); persistQuiet();
}

export function setMeetingsSort(sort) {
  if (!MEETINGS_SORTS.some(([v]) => v === sort) || S.meetingsSort === sort) return;
  S.meetingsSort = sort; commit();
}

export function archiveMeeting(id) {
  const m = meetingById(id); if (!m || m.status !== 'active') return;
  m.status = 'archived'; m.archivedAt = Date.now();
  leaveMeeting(id); commit();
}

/** Returns the status and archivedAt it had, so Undo can put it back. */
export function softDeleteMeeting(id) {
  const m = meetingById(id); if (!m || m.status === 'deleted') return null;
  const prev = { status: m.status, archivedAt: m.archivedAt };
  m.status = 'deleted'; m.deletedAt = Date.now(); m.archivedAt = null;
  leaveMeeting(id); commit();
  return prev;
}

export function returnMeetingToArchive(id, archivedAt) {
  const m = meetingById(id); if (!m || m.status !== 'deleted') return;
  m.status = 'archived'; m.archivedAt = archivedAt; m.deletedAt = null;
  commit();
}

export function restoreMeeting(id) {
  const m = meetingById(id); if (!m || m.status === 'active') return;
  m.status = 'active'; m.archivedAt = null; m.deletedAt = null;
  commit();
}

export function deleteMeetingForever(id) {
  dropMedia(S.meetings.filter((m) => m.id === id));
  S.meetings = S.meetings.filter((m) => m.id !== id);
  commit();
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

/** Arm a task's reminder: null while its moment is still ahead, or "used"
    (now) when that moment has already passed — so saving, restoring or
    reopening a task never fires a stale reminder on the spot. */
export function armReminder(t, now = Date.now()) {
  const at = reminderInstant(t.due, t.dueTime, t.reminder);
  t.reminderFiredAt = at !== null && at <= now ? now : null;
}

/** Record that a reminder fired. Updates this tab's state and the stored
    document in place (read-modify-write), and does NOT save this tab's whole
    state: a background tab must never overwrite edits another tab made. */
export function markReminderFired(id, at = Date.now()) {
  const t = taskById(id);
  if (t) t.reminderFiredAt = at;
  try {
    const doc = JSON.parse(localStorage.getItem(STORE_KEY));
    const stored = doc?.tasks?.find((x) => x.id === id);
    if (stored && stored.reminderFiredAt !== at) {
      stored.reminderFiredAt = at;
      localStorage.setItem(STORE_KEY, JSON.stringify(doc));
    }
  } catch { /* storage unavailable: notify.js keeps its own per-tab record, so it still won't repeat */ }
}

/** Normalise and store the five schedule fields in one go. Repeat and
    reminder need a due date; a start date after the due date is dropped. */
export function setSchedule(id, { start = null, due = null, dueTime = null, recur = 'none', reminder = null }) {
  const t = taskById(id); if (!t) return;
  const before = reminderKey(t);
  t.due = due || null;
  t.dueTime = t.due ? (dueTime || null) : null;
  t.start = start && (!t.due || start <= t.due) ? start : null;
  t.recur = t.due ? recur : 'none';
  t.reminder = t.due ? reminder : null;
  /* saving unchanged dates must not re-fire a reminder that already went off */
  if (reminderKey(t) !== before) armReminder(t);
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
  armReminder(t);
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
  lane = validLane(listId, lane);
  if (lane === DONE_LANE && t.recur !== 'none' && t.due) lane = validLane(listId, t.lane);
  if (t.listId === listId && t.lane === lane) return;
  const wasDone = t.done;
  t.listId = listId; t.lane = lane; t.order = nextOrder();
  t.done = lane === 'done';
  if (wasDone && !t.done) armReminder(t);
  S.currentList = listId;
  touch(t); commit();
}

/** Duplicate into a board/lane: same fields and schedule, subtasks reset,
    fresh ids and timestamps. Returns the copy. */
export function copyTask(id, listId, lane) {
  const t = taskById(id); if (!t || !listById(listId)) return null;
  lane = validLane(listId, lane);
  const copy = blankTask(listId, t.title, {
    lane, done: lane === DONE_LANE, order: nextOrder(),
    priority: t.priority, tags: [...t.tags],
    subtasks: t.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
    start: t.start, due: t.due, dueTime: t.dueTime, recur: t.recur, reminder: t.reminder,
  });
  armReminder(copy);
  S.tasks.push(copy);
  commit();
  return copy;
}

export function newList() {
  const name = prompt('New board name');
  if (!name || !name.trim()) return;
  const list = { id: uid(), name: name.trim(), lanes: defaultLanes() };
  S.lists.push(list);
  S.currentList = list.id;
  UI.screen = 'list';
  commit();
}

/* — lanes (1.4.3) — */

/** A new lane goes just before Done. Returns the lane, or null for an empty name. */
export function addLane(listId, name) {
  const list = listById(listId); const n = (name || '').trim();
  if (!list || !n) return null;
  const lane = { id: uid(), name: n };
  const i = list.lanes.findIndex((l) => l.id === DONE_LANE);
  list.lanes.splice(i === -1 ? list.lanes.length : i, 0, lane);
  commit();
  return lane;
}

export function renameLane(listId, laneId, name) {
  const lane = listById(listId)?.lanes.find((l) => l.id === laneId); const n = (name || '').trim();
  if (!lane || !n || lane.name === n) return;
  lane.name = n; commit();
}

/** dir -1 moves the lane one column left, +1 one right. */
export function moveLane(listId, laneId, dir) {
  const lanes = listById(listId)?.lanes; if (!lanes) return;
  const i = lanes.findIndex((l) => l.id === laneId), j = i + dir;
  if (i === -1 || j < 0 || j >= lanes.length) return;
  [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  commit();
}

/** Can the lane go? Never Done, never the board's last other lane. */
export const canDeleteLane = (listId, laneId) =>
  laneId !== DONE_LANE && lanesOf(listId).filter((l) => l.id !== DONE_LANE && l.id !== laneId).length > 0;

/** Removes a lane. Its tasks of every status move to the board's first
    lane, and so do archive / delete origins that point at it, so Restore
    still has somewhere to go. Returns the number of active tasks moved,
    or null when the lane cannot be deleted. */
export function deleteLane(listId, laneId) {
  const list = listById(listId);
  if (!list || !canDeleteLane(listId, laneId)) return null;
  list.lanes = list.lanes.filter((l) => l.id !== laneId);
  const to = firstLane(listId);
  let moved = 0;
  S.tasks.forEach((t) => {
    if (t.listId === listId && t.lane === laneId) { t.lane = to; if (t.status === 'active') moved += 1; }
    if (t.origin?.listId === listId && t.origin.lane === laneId) t.origin.lane = to;
  });
  commit();
  return moved;
}

/* — settings: theme, priority levels, labels — */

export function setTheme(theme) {
  if (!THEMES.includes(theme) || S.theme === theme) return;
  S.theme = theme; commit();
}

/** Settings › Dates (PRD-notes US-09): app-wide, re-renders at once. */
export function setDateFormat(format) {
  if (!isDateFormat(format) || S.dateFormat === format) return;
  S.dateFormat = format; setDefaultDateFormat(format); commit();
}

export function addPriority(name) {
  name = name.trim(); if (!name) return;
  S.priorities.push({ id: uid(), name, color: 'gray' });
  commit();
}

export function updatePriority(id, { name, color }) {
  const p = priorityById(id); if (!p) return;
  if (name !== undefined && name.trim()) p.name = name.trim();
  if (color !== undefined && PRIORITY_COLORS.includes(color)) p.color = color;
  commit();
}

/** dir -1 = up (higher), +1 = down (lower). */
export function movePriority(id, dir) {
  const i = S.priorities.findIndex((p) => p.id === id), j = i + dir;
  if (i === -1 || j < 0 || j >= S.priorities.length) return;
  [S.priorities[i], S.priorities[j]] = [S.priorities[j], S.priorities[i]];
  commit();
}

/** Tasks at this level (any status) drop to no priority. */
export function deletePriority(id) {
  S.priorities = S.priorities.filter((p) => p.id !== id);
  S.tasks.forEach((t) => { if (t.priority === id) { t.priority = 'none'; touch(t); } });
  commit();
}

export function addLabel(name) {
  const [label] = normalizeTags([name]);
  if (!label || allTags().some((x) => sameTag(x, label))) return;
  S.labels.push(label);
  commit();
}

/** Renames the tag on every task (any status); renaming onto an existing
    label merges the two. */
export function renameLabel(from, to) {
  const [label] = normalizeTags([to]);
  if (!label || label === from) return;
  const swap = (tags) => normalizeTags(tags.map((x) => (sameTag(x, from) ? label : x)));
  S.labels = swap(S.labels);
  [...S.tasks, ...S.notes].forEach((t) => {
    if (t.tags.some((x) => sameTag(x, from))) { t.tags = swap(t.tags); touch(t); }
  });
  commit();
}

export function deleteLabel(name) {
  S.labels = S.labels.filter((x) => !sameTag(x, name));
  [...S.tasks, ...S.notes].forEach((t) => {
    if (t.tags.some((x) => sameTag(x, name))) { t.tags = t.tags.filter((x) => !sameTag(x, name)); touch(t); }
  });
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
  t.lane = fellBack ? firstLane(t.listId) : validLane(t.listId, o.lane);   // a deleted lane falls back too
  t.order = keepPosition ? o.order : nextOrder();
  t.done = t.lane === DONE_LANE;
  t.status = 'active'; t.archivedAt = null; t.deletedAt = null; t.origin = null;
  armReminder(t);
  touch(t); commit();
  return { listId: t.listId, lane: t.lane, fellBack };
}

export function deleteForever(id) {
  S.tasks = S.tasks.filter((t) => t.id !== id);
  commit();
}

/** Tasks, notes and meetings alike. */
export function emptyDeleted() {
  S.tasks = S.tasks.filter((t) => t.status !== 'deleted');
  S.notes = S.notes.filter((n) => n.status !== 'deleted');
  dropMedia(S.meetings.filter((m) => m.status === 'deleted'));
  S.meetings = S.meetings.filter((m) => m.status !== 'deleted');
  commit();
}

/** Drops deleted tasks, notes and meetings older than RETENTION_DAYS. Returns how many went. */
export function purgeDeleted(now = Date.now()) {
  const keep = (x) => x.status !== 'deleted' || now - x.deletedAt < RETENTION_MS;
  const before = S.tasks.length + S.notes.length + S.meetings.length;
  S.tasks = S.tasks.filter(keep);
  S.notes = S.notes.filter(keep);
  dropMedia(S.meetings.filter((m) => !keep(m)));
  S.meetings = S.meetings.filter(keep);
  const removed = before - S.tasks.length - S.notes.length - S.meetings.length;
  if (removed) save();
  return removed;
}
