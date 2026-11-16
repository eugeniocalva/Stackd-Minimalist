/* The Stack'd export file (PRD-accounts AC-12.2, architecture §32): a JSON
   file with everything a person made, written by "Download my data" on the
   old address and read by Settings › "Import a Stack'd file".

   An imported file is untrusted input. Nothing in it is copied as it is:
   cleanRecords() rebuilds every record from the fields the app knows, with
   the type each one must have, so a field the views print without escaping
   (an id, a colour, a status, a number) can only hold what the app itself
   would have written. Text goes through the same sanitising as typed text.

   Recordings are not in the file: they are binary, large, and live in
   IndexedDB. Transcripts, minutes and actions are.

   The pre-sign-in backup slot (keep, info, restore…) arrives with sync. */

import {
  S, DONE_LANE, PRIORITY_COLORS, NOTE_COLORS, REMINDER_OPTIONS,
  defaultLanes, normalizeTags, exportRecords, replaceRecords,
} from './store.js';
import { RECUR_OPTIONS, isDateFormat, toISO } from './dates.js';
import { sanitize } from './richtext.js';

export const FILE_APP = 'stackd';
export const FILE_FORMAT = 1;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;   // well above what localStorage can hold
export const MAX_RECORDS = 20000;                 // tasks + notes + meetings; the sync quota (§32 LIMITS)

/* Owned by src/account.js once sign-in exists; absent ⇔ signed out. */
const ACCOUNT_KEY = 'stackd-account';

/** code: 'signed_in' | 'too_large' | 'not_stackd' | 'newer' | 'bad_file' | 'storage' */
export class ImportError extends Error {
  constructor(code, message) { super(message); this.name = 'ImportError'; this.code = code; }
}

/** Import is for a signed-out device: with an account, the account is the copy. */
export function canImport() {
  try { return localStorage.getItem(ACCOUNT_KEY) === null; } catch { return true; }
}

export const countsOf = (r) => ({ boards: r.lists.length, tasks: r.tasks.length, notes: r.notes.length, meetings: r.meetings.length });

/* ── Export ──────────────────────────────────────────────────────────── */

/** The records as they go into the file: a meeting leaves its recording,
    open jobs and last error behind, they belong to the device. */
export function exportDocument(now = Date.now()) {
  const records = exportRecords();
  records.meetings = records.meetings.map(({ recording, jobs, lastError, ...m }) => m);
  return { app: FILE_APP, format: FILE_FORMAT, exportedAt: now, records };
}

/** How many meetings have a recording that the file cannot carry. */
export const recordingsLeftBehind = () => S.meetings.filter((m) => m.recording).length;

export const exportFileName = (now = Date.now()) => `stackd-export-${toISO(new Date(now))}.json`;

/** The old-address "Download my data". */
export function exportFile(now = Date.now()) {
  return new Blob([JSON.stringify(exportDocument(now))], { type: 'application/json' });
}

/* ── Validation ──────────────────────────────────────────────────────── */

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SPEAKER = /^[A-Za-z0-9][\w .-]{0,39}$/;       // 'S1'; never '__proto__'
const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['active', 'archived', 'deleted'];
const RECURS = RECUR_OPTIONS.map(([v]) => v);
const REMINDERS = REMINDER_OPTIONS.map(([v]) => v);
const SOURCES = ['recording', 'pasted', 'file'];
const ACTION_STATUSES = ['proposed', 'added', 'dismissed'];
const LONG = 2_000_000;                             // a transcript or a note body

const bad = (what) => { throw new ImportError('bad_file', `This file is damaged (${what}).`); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const obj = (v, what) => (isObj(v) ? v : bad(what));
const list = (v, what) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : bad(what));
const idOf = (v, what) => (typeof v === 'string' && ID.test(v) ? v : bad(`${what} without a valid id`));
const text = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const flag = (v) => v === true;
const time = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const date = (v) => (typeof v === 'string' && ISO_DATE.test(v) ? v : null);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const tagsOf = (v) => normalizeTags(list(v, 'labels that are not a list').filter((x) => typeof x === 'string').map((x) => x.slice(0, 64)));
function unique(items, what) {
  const seen = new Set();
  items.forEach((x) => { if (seen.has(x.id)) bad(`two ${what} with the same id`); seen.add(x.id); });
  return items;
}

/** status, archivedAt, deletedAt in the combinations the store writes. */
function lifecycle(r, now) {
  const status = pick(r.status, STATUSES, 'active');
  return {
    status,
    archivedAt: status === 'archived' ? time(r.archivedAt) ?? now : null,
    deletedAt: status === 'deleted' ? time(r.deletedAt) ?? now : null,   // never null: purgeDeleted() would drop it at once
  };
}

function stamps(r, now) {
  const createdAt = time(r.createdAt) ?? now;
  return { createdAt, updatedAt: Math.max(createdAt, time(r.updatedAt) ?? createdAt) };
}

const checkItems = (v, field, what) => list(v, what).map((c) => {
  obj(c, what);
  return { id: idOf(c.id, what), [field]: text(c[field]), done: flag(c.done) };
});

function cleanBoard(r, now) {
  obj(r, 'a board that is not a record');
  let lanes = unique(list(r.lanes, 'lanes that are not a list').map((l) => {
    obj(l, 'a lane that is not a record');
    return { id: idOf(l.id, 'a lane'), name: text(l.name, 80).trim() || 'Lane' };
  }), 'lanes');
  if (!lanes.length) lanes = defaultLanes();
  if (!lanes.some((l) => l.id === DONE_LANE)) lanes.push({ id: DONE_LANE, name: 'Done' });
  if (lanes.length === 1) lanes.unshift({ id: 'backlog', name: 'Backlog' });   // a board always has a lane beside Done
  lanes = [...lanes.filter((l) => l.id !== DONE_LANE), lanes.find((l) => l.id === DONE_LANE)];   // Done is always last
  return { id: idOf(r.id, 'a board'), name: text(r.name, 80).trim() || 'Board', lanes, ...lifecycle(r, now) };
}

function cleanPriority(r) {
  obj(r, 'a priority that is not a record');
  const id = idOf(r.id, 'a priority');
  if (id === 'none') bad('a priority called none');
  return { id, name: text(r.name, 24).trim() || 'Priority', color: pick(r.color, PRIORITY_COLORS, 'gray') };
}

function cleanTask(r, i, ctx) {
  obj(r, 'a task that is not a record');
  const board = ctx.boards.get(r.listId) || ctx.firstBoard;
  const lane = board.lanes.some((l) => l.id === r.lane) ? r.lane : (board.lanes.find((l) => l.id !== DONE_LANE) || board.lanes[0]).id;
  const due = date(r.due);
  const start = date(r.start);
  const o = r.origin;
  const origin = isObj(o) && typeof o.listId === 'string' && ID.test(o.listId)
    ? { listId: o.listId, lane: typeof o.lane === 'string' && ID.test(o.lane) ? o.lane : lane, order: num(o.order, 0) }
    : null;
  const f = r.from;
  const from = isObj(f) && typeof f.meetingId === 'string' && ID.test(f.meetingId) && typeof f.actionId === 'string' && ID.test(f.actionId)
    ? { meetingId: f.meetingId, actionId: f.actionId }
    : null;
  const life = lifecycle(r, ctx.now);
  return {
    id: idOf(r.id, 'a task'), listId: board.id, lane,
    title: text(r.title).trim() || 'Untitled', done: flag(r.done), order: num(r.order, i),
    priority: ctx.priorities.has(r.priority) ? r.priority : 'none',
    tags: tagsOf(r.tags), subtasks: checkItems(r.subtasks, 'title', 'a subtask'),
    start: start && (!due || start <= due) ? start : null, due,
    dueTime: due && typeof r.dueTime === 'string' && HHMM.test(r.dueTime) ? r.dueTime : null,
    recur: due ? pick(r.recur, RECURS, 'none') : 'none',
    reminder: due ? pick(r.reminder, REMINDERS, null) : null,
    reminderFiredAt: time(r.reminderFiredAt),
    completedCount: count(r.completedCount), lastCompletedAt: time(r.lastCompletedAt),
    ...life, origin: life.status === 'active' ? null : origin, from,
    ...stamps(r, ctx.now),
  };
}

function cleanNote(r, i, ctx) {
  obj(r, 'a note that is not a record');
  return {
    id: idOf(r.id, 'a note'), order: num(r.order, i),
    title: text(r.title), body: sanitize(text(r.body, LONG)),
    color: pick(r.color, NOTE_COLORS, null), tags: tagsOf(r.tags),
    checklist: r.checklist === null || r.checklist === undefined ? null : checkItems(r.checklist, 'text', 'a checklist item'),
    ...lifecycle(r, ctx.now), ...stamps(r, ctx.now),
  };
}

function cleanTranscript(r, now) {
  const speakers = {};
  Object.entries(isObj(r.speakers) ? r.speakers : {}).forEach(([label, name]) => {
    if (!SPEAKER.test(label)) bad('a speaker label');
    speakers[label] = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null;
  });
  const segments = list(r.segments, 'a transcript that is not a list').map((s) => {
    obj(s, 'a transcript line that is not a record');
    if (typeof s.speaker !== 'string' || !SPEAKER.test(s.speaker)) bad('a speaker label');
    if (!Object.hasOwn(speakers, s.speaker)) speakers[s.speaker] = null;
    return { id: idOf(s.id, 'a transcript line'), speaker: s.speaker, startMs: Number.isFinite(s.startMs) && s.startMs >= 0 ? s.startMs : null, text: text(s.text, LONG).trim() };
  }).filter((s) => s.text);
  return {
    source: pick(r.source, SOURCES, 'pasted'),
    fileName: typeof r.fileName === 'string' && r.fileName ? r.fileName.slice(0, 200) : null,
    segments, speakers, ...stamps(r, now),
  };
}

const lines = (v) => list(v, 'minutes that are not a list').filter((x) => typeof x === 'string').map((x) => x.slice(0, 4000));

function cleanMeeting(r, i, ctx) {
  obj(r, 'a meeting that is not a record');
  const transcript = isObj(r.transcript) ? cleanTranscript(r.transcript, ctx.now) : null;
  const m = r.minutes;
  const minutes = transcript && isObj(m) ? {
    summary: text(m.summary, 20000), decisions: lines(m.decisions), openQuestions: lines(m.openQuestions),
    generatedAt: time(m.generatedAt) ?? ctx.now,
    transcriptUpdatedAt: time(m.transcriptUpdatedAt) ?? 0,   // unknown ⇒ shown as out of date
  } : null;
  const actions = unique(list(r.actions, 'actions that are not a list').map((a) => {
    obj(a, 'an action that is not a record');
    return {
      id: idOf(a.id, 'an action'), title: text(a.title).trim(), due: date(a.due),
      priority: ctx.priorities.has(a.priority) ? a.priority : 'none',
      excerpt: text(a.excerpt, 4000), status: pick(a.status, ACTION_STATUSES, 'proposed'),
      taskId: typeof a.taskId === 'string' && ID.test(a.taskId) ? a.taskId : null,
    };
  }).filter((a) => a.title), 'actions');
  return {
    id: idOf(r.id, 'a meeting'), title: text(r.title), ...stamps(r, ctx.now),
    recording: null, transcript, minutes, actions,
    jobs: { transcribe: null, summarise: null }, lastError: null,
    ...lifecycle(r, ctx.now),
  };
}

/** Untrusted → { lists, tasks, notes, meetings, settings } in the store's
    shape, or an ImportError('bad_file'). Pure: reads nothing, changes nothing. */
export function cleanRecords(raw, now = Date.now()) {
  obj(raw, 'no records');
  const settings = obj(raw.settings, 'no settings');
  const lists = unique(list(raw.lists, 'boards that are not a list').map((r) => cleanBoard(r, now)), 'boards');
  if (!lists.some((l) => l.status === 'active')) bad('no boards');   // archived and deleted ones do not count
  const rawTasks = list(raw.tasks, 'tasks that are not a list');
  const rawNotes = list(raw.notes, 'notes that are not a list');
  const rawMeetings = list(raw.meetings, 'meetings that are not a list');
  if (rawTasks.length + rawNotes.length + rawMeetings.length > MAX_RECORDS) bad('too many records');
  const priorities = unique(list(settings.priorities, 'priorities that are not a list').map(cleanPriority), 'priorities');
  const ctx = {
    now, firstBoard: lists.find((l) => l.status === 'active'),
    boards: new Map(lists.map((l) => [l.id, l])),
    priorities: new Set(priorities.map((p) => p.id)),
  };
  return {
    lists,
    tasks: unique(rawTasks.map((r, i) => cleanTask(r, i, ctx)), 'tasks'),
    notes: unique(rawNotes.map((r, i) => cleanNote(r, i, ctx)), 'notes'),
    meetings: unique(rawMeetings.map((r, i) => cleanMeeting(r, i, ctx)), 'meetings'),
    settings: {
      dateFormat: isDateFormat(settings.dateFormat) ? settings.dateFormat : null,   // null: keep this device's
      priorities,
      labels: tagsOf(settings.labels),
    },
  };
}

/** The parsed file → clean records, or an ImportError. */
export function readDocument(doc, now = Date.now()) {
  if (!isObj(doc) || doc.app !== FILE_APP || !Number.isInteger(doc.format)) {
    throw new ImportError('not_stackd', "This is not a Stack'd file.");
  }
  if (doc.format > FILE_FORMAT) {
    throw new ImportError('newer', "This file comes from a newer version of Stack'd. Update the app, then import it.");
  }
  return cleanRecords(doc.records, now);
}

/* ── Import ──────────────────────────────────────────────────────────── */

/** Reads, validates and installs a Stack'd file in place of what is on
    this device. `confirm`, when given, is asked first with what would
    happen and may resolve false to stop: nothing changes then and the
    result is null.
    @param {Blob} file
    @param {{ confirm?: (info: { counts, current, recordingsLost: number, exportedAt: number|null }) => boolean|Promise<boolean> }} [options]
    @returns {Promise<{ counts: { boards, tasks, notes, meetings } } | null>} */
export async function importFile(file, { confirm } = {}) {
  if (!canImport()) throw new ImportError('signed_in', 'Sign out on this device before importing a file.');
  if (file.size > MAX_FILE_BYTES) throw new ImportError('too_large', 'This file is too large to import.');
  let doc;
  try { doc = JSON.parse(await file.text()); } catch { throw new ImportError('not_stackd', "This is not a Stack'd file."); }
  const records = readDocument(doc);
  const counts = countsOf(records);
  if (confirm) {
    const incoming = new Set(records.meetings.map((m) => m.id));
    const ok = await confirm({
      counts,
      current: countsOf(S),
      recordingsLost: S.meetings.filter((m) => m.recording && !incoming.has(m.id)).length,
      exportedAt: time(doc.exportedAt),
    });
    if (!ok) return null;
  }
  try { replaceRecords(records); } catch {
    throw new ImportError('storage', 'There is not enough room on this device for the file. Nothing was changed.');
  }
  return { counts };
}
