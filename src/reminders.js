/* Pure reminder engine (PRD US-10): which reminders exist, what they say,
   which web reminders are due right now, and how the native pending
   notifications must change. No DOM, no storage, no clock reads — notify.js
   does the side effects, and scripts/check-reminders.mjs tests this in Node.

   A task has a reminder when it is active, not done, has a due date and a
   reminder offset. Its moment is reminderInstant(due, dueTime, reminder).
   task.reminderFiredAt is null while the reminder is armed and holds a time
   once it has fired or lapsed (see armReminder in store.js). */

import { reminderInstant, isOverdue, fmtDateLong, toISO, daysBetween } from './dates.js';

/** A web reminder found late (tab throttled, app just opened) still fires
    within this window — or later, as long as the task is not overdue yet. */
export const WEB_GRACE_MS = 15 * 60000;
/** iOS keeps only the 64 soonest pending requests per app; leave headroom. */
export const MAX_NATIVE = 60;
/** iOS delivers a past `at` immediately, so a time closer than this is
    pushed out to now + NATIVE_LEAD_MS rather than handed over as is. */
export const NATIVE_LEAD_MS = 5000;
/** This many web reminders due at once become one summary notification. */
export const SUMMARY_AT = 3;
/** Text is re-phrased for the moment of showing only when a reminder is
    found this late; an on-time check (up to a poll interval and some timer
    throttling later) keeps the fire-time wording, so "At time of due" never
    reads "Overdue" just because the check ran 30 s after the minute. */
export const LATE_TEXT_MS = 2 * 60000;

/** What decides when a reminder fires; a change here is a new reminder. */
export const reminderKey = (t) => `${t.due}|${t.dueTime}|${t.reminder}`;

/** Stable, positive 31-bit notification id for a task id (FNV-1a). Native
    ids must be 32-bit integers; the real task id travels in `extra`. */
export function nid(taskId) {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}

/** Notification text, phrased for the moment `readAt` it will be read: the
    fire time for native (iOS delivers exactly then), the moment of showing
    for web (which may be hours late). */
export function reminderText(task, boardName, readAt) {
  const at = task.dueTime ? ` at ${task.dueTime}` : '';
  const when = new Date(readAt);
  const days = daysBetween(toISO(when), task.due);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : fmtDateLong(task.due);
  const line = isOverdue(task.due, task.dueTime, when) ? `Overdue, was due ${day}${at}` : `Due ${day}${at}`;
  return { title: task.title, body: boardName ? `${line} · ${boardName}` : line };
}

/** Every reminder the tasks define, soonest first, past ones included.
    Text is phrased for the fire time; dueForWeb re-phrases what it fires. */
export function planReminders(tasks, lists = []) {
  const boards = new Map(lists.map((l) => [l.id, l.name]));
  return tasks
    .filter((t) => t.status === 'active' && !t.done && t.due && t.reminder !== null && t.reminder !== undefined)
    .map((t) => {
      const fireAt = reminderInstant(t.due, t.dueTime, t.reminder);
      if (fireAt === null) return null;
      const board = boards.get(t.listId) || null;
      const { title, body } = reminderText(t, board, fireAt);
      return {
        taskId: t.id, fireAt, title, body, board, key: reminderKey(t),
        due: t.due, dueTime: t.dueTime, firedAt: t.reminderFiredAt ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.fireAt - b.fireAt);
}

/** Still worth showing although its moment passed: inside the grace window,
    or the task is not overdue yet. Same rule for web and native. */
export const isTimely = (e, now) => now - e.fireAt <= WEB_GRACE_MS || !isOverdue(e.due, e.dueTime, new Date(now));

/** The moment a reminder's text should be phrased for when shown at `now`. */
export const phraseAt = (e, now) => (now - e.fireAt > LATE_TEXT_MS ? now : e.fireAt);

/** Key of one occurrence in the cross-tab fired ledger. A changed schedule
    gives a new key, so an old entry never blocks the new reminder. */
export const ledgerKey = (e) => `${e.taskId}:${e.fireAt}`;

/** Web reminders whose moment has come and that nothing has handled yet:
    `fire` ones are still timely (re-phrased when found late, since that can
    be hours), `lapse` ones are too late to be useful and are only marked as
    used. `handled` holds ledger keys (stored ledger and this tab's). */
export function dueForWeb(plan, now, handled = {}) {
  const fire = [], lapse = [];
  for (const e of plan) {
    if (e.fireAt > now || e.firedAt !== null || handled[ledgerKey(e)]) continue;
    if (isTimely(e, now)) fire.push({ ...e, ...reminderText(e, e.board, phraseAt(e, now)) });
    else lapse.push(e);
  }
  return { fire, lapse };
}

/** One notification standing in for several due at once. */
export function summaryText(entries) {
  const names = entries.map((e) => e.title);
  const shown = names.slice(0, 3).join(', ');
  return {
    title: `${entries.length} reminders`,
    body: names.length > 3 ? `${shown} and ${names.length - 3} more` : shown,
  };
}

/** Drop ledger entries older than maxAgeMs. */
export function pruneLedger(ledger, now, maxAgeMs = 30 * 86400000) {
  return Object.fromEntries(Object.entries(ledger).filter(([, at]) => now - at < maxAgeMs));
}

/** Native reminders whose moment has passed while still armed: delivered by
    iOS, or never deliverable (no permission then). Marked used so a later
    time-zone shift cannot make them due again. */
export const pastUnfired = (plan, now) => plan.filter((e) => e.firedAt === null && e.fireAt <= now);

/** Reminders iOS delivered since the last sync, found from the record of
    what was scheduled (taskId → { fireAt, key }, absolute times): the moment
    has passed, the request is no longer pending, and the task still has the
    same reminder. Catches deliveries that a time-zone change would otherwise
    hide (flying west makes the same wall-clock time future again). */
export function deliveredSince(record, pendingTaskIds, tasks, now) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return Object.entries(record)
    .filter(([taskId, r]) => r.fireAt <= now && !pendingTaskIds.has(taskId))
    .filter(([taskId, r]) => {
      const t = byId.get(taskId);
      return t && t.reminderFiredAt == null && reminderKey(t) === r.key;
    })
    .map(([taskId, r]) => ({ taskId, fireAt: r.fireAt }));
}

/** Requests iOS still holds for the same reminder (same reminderKey as when
    it was scheduled): taskId -> { id, sig }. They are left alone even when
    the reminder's moment, recomputed now, looks past (after flying east, or
    inside the lead-time clamp), because iOS will still deliver them. */
export function heldRequests(plan, pendingByTask, record) {
  const held = new Map();
  for (const e of plan) {
    const p = pendingByTask.get(e.taskId);
    const r = record[e.taskId];
    if (p && r && r.key === e.key && e.firedAt === null) held.set(e.taskId, { id: Number(p.id), sig: p.extra?.sig ?? null });
  }
  return held;
}

/** The native notifications that should be pending, soonest MAX_NATIVE:
    future reminders; past ones iOS still holds (kept exactly as pending);
    and past ones never delivered that are still timely (delivered now, text
    phrased for now). Each gets a collision-free id and a signature of what
    it shows. Ids are assigned in task-id order, so a task keeps its id when
    times change; held ones keep the id they have. */
export function nativePlan(plan, now, held = new Map()) {
  const isHeld = (e) => e.fireAt <= now && held.has(e.taskId);
  const wanted = plan.filter((e) => e.firedAt === null
    && (e.fireAt > now || held.has(e.taskId) || isTimely(e, now))).slice(0, MAX_NATIVE);
  const ids = new Map();
  const used = new Set();
  for (const e of wanted) {
    if (isHeld(e)) { const id = held.get(e.taskId).id; ids.set(e.taskId, id); used.add(id); }
  }
  for (const e of [...wanted].sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))) {
    if (ids.has(e.taskId)) continue;
    let id = nid(e.taskId);
    while (used.has(id)) id = (id + 1) & 0x7fffffff;
    used.add(id);
    ids.set(e.taskId, id);
  }
  return wanted.map((e) => {
    if (isHeld(e)) return { ...e, id: ids.get(e.taskId), sig: held.get(e.taskId).sig, held: true };
    const text = e.fireAt <= now ? reminderText(e, e.board, phraseAt(e, now)) : {};
    const out = { ...e, ...text, id: ids.get(e.taskId) };
    return { ...out, sig: `${out.fireAt}|${out.title}|${out.body}` };
  });
}

/** What to cancel and what to (re)schedule so `pending` (from getPending)
    matches `desired` (from nativePlan). Without permission nothing may be
    scheduled, but stale requests are still cancelled. */
export function diffNative(desired, pending, { allowSchedule = true } = {}) {
  const want = new Map(desired.map((e) => [e.id, e]));
  const have = new Map(pending.map((p) => [Number(p.id), p.extra?.sig ?? null]));
  const cancel = [...have].filter(([id, sig]) => want.get(id)?.sig !== sig).map(([id]) => id);
  const schedule = allowSchedule ? desired.filter((e) => have.get(e.id) !== e.sig) : [];
  return { cancel, schedule };
}

/** The LocalNotifications payload for one desired entry. `at` must be a real
    Date (the iOS plugin treats a string or number as "deliver now"), and is
    kept at least NATIVE_LEAD_MS ahead so it is never already past on arrival. */
export function nativeNotification(e, now) {
  const floor = Number.isFinite(now) ? now + NATIVE_LEAD_MS : -Infinity; // never NaN → Invalid Date
  return {
    id: e.id,
    title: e.title,
    body: e.body,
    schedule: { at: new Date(Math.max(e.fireAt, floor)), allowWhileIdle: true },
    extra: { taskId: e.taskId, sig: e.sig },
  };
}
