/* Checks for the pure reminder engine (src/reminders.js) — `npm run check`. */
import assert from 'node:assert/strict';
import {
  nid, reminderText, planReminders, dueForWeb, ledgerKey, summaryText, pruneLedger, reminderKey,
  nativePlan, diffNative, nativeNotification, pastUnfired, deliveredSince, heldRequests, WEB_GRACE_MS, MAX_NATIVE, NATIVE_LEAD_MS,
} from '../src/reminders.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 16, 12, 0); // Fri 16 Oct 2026, 12:00 local
const lists = [{ id: 'work', name: 'Work' }];
const task = (id, extra = {}) => ({
  id, listId: 'work', title: `Task ${id}`, status: 'active', done: false,
  due: '2026-10-20', dueTime: '09:00', reminder: 0, reminderFiredAt: null, ...extra,
});

// ids: stable, positive, 31-bit
assert.equal(nid('abc123'), nid('abc123'));
assert.notEqual(nid('abc123'), nid('abc124'));
for (const s of ['a', 'zzzzzzzz', '42wo28ep', '']) assert.ok(nid(s) >= 0 && nid(s) <= 0x7fffffff);

// text is phrased for the moment it is read
assert.deepEqual(reminderText(task('a', { due: '2026-10-17' }), 'Work', at(2026, 10, 16, 9)),
  { title: 'Task a', body: 'Due tomorrow at 09:00 · Work' });
assert.equal(reminderText(task('a', { due: '2026-10-16' }), null, at(2026, 10, 16, 9)).body, 'Due today at 09:00');
assert.equal(reminderText(task('a', { dueTime: null }), 'Work', at(2026, 10, 18, 9)).body, 'Due Tue, Oct 20 · Work');
assert.equal(reminderText(task('a', { due: '2026-10-15' }), null, at(2026, 10, 16, 9)).body, 'Overdue, was due yesterday at 09:00');
assert.equal(reminderText(task('a', { due: '2026-10-12' }), null, at(2026, 10, 16, 9)).body, 'Overdue, was due Mon, Oct 12 at 09:00');

// plan: only active, open, dated tasks with a reminder; soonest first
const plan = planReminders([
  task('late', { due: '2026-10-25' }),
  task('soon', { due: '2026-10-17', reminder: 60 }),
  task('arch', { status: 'archived' }),
  task('del', { status: 'deleted' }),
  task('done', { done: true }),
  task('nodue', { due: null }),
  task('norem', { reminder: null }),
  task('fired', { reminderFiredAt: 123 }),
], lists);
assert.deepEqual(plan.map((e) => e.taskId), ['soon', 'fired', 'late']);
assert.equal(plan[0].fireAt, at(2026, 10, 17, 8));
assert.equal(plan[0].body, 'Due today at 09:00 · Work');
assert.equal(plan[1].firedAt, 123);

// web: timely ones fire, stale ones lapse, handled ones are skipped
const web = (t, now = NOW, ledger = {}) => dueForWeb(planReminders([t], lists), now, ledger);
const ids = (r) => ({ fire: r.fire.map((e) => e.taskId), lapse: r.lapse.map((e) => e.taskId) });
assert.deepEqual(ids(web(task('future', { due: '2026-10-16', dueTime: '13:00' }))), { fire: [], lapse: [] });
assert.deepEqual(ids(web(task('just', { due: '2026-10-16', dueTime: '12:05', reminder: 10 }))), { fire: ['just'], lapse: [] });
// two hours late, but the task is not due until this evening: still useful
assert.deepEqual(ids(web(task('lateok', { due: '2026-10-16', dueTime: '20:00', reminder: 600 }))), { fire: ['lateok'], lapse: [] });
// reminder at due time, 10 minutes ago: overdue, but inside the grace window
assert.deepEqual(ids(web(task('grace', { due: '2026-10-16', dueTime: '11:50' }))), { fire: ['grace'], lapse: [] });
// overdue and past the grace window: too late to be useful
assert.deepEqual(ids(web(task('stale', { due: '2026-10-16', dueTime: '11:00' }))), { fire: [], lapse: ['stale'] });
assert.ok(NOW - at(2026, 10, 16, 11) > WEB_GRACE_MS);
assert.deepEqual(ids(web(task('used', { due: '2026-10-16', dueTime: '12:00', reminderFiredAt: NOW - 1 }))), { fire: [], lapse: [] });
const ledgered = task('led', { due: '2026-10-16', dueTime: '12:00' });
const key = ledgerKey(planReminders([ledgered], lists)[0]);
assert.deepEqual(ids(web(ledgered, NOW, { [key]: NOW - 5 })), { fire: [], lapse: [] });
assert.deepEqual(ids(web(ledgered, NOW, { 'led:1': NOW - 5 })), { fire: ['led'], lapse: [] }); // old occurrence doesn't block

// late web fires are phrased for the moment they are shown, not the fire time
const lateText = (t, now) => web(t, now).fire.map((e) => e.body)[0];
assert.equal(lateText(task('d1', { due: '2026-10-16', dueTime: '15:00', reminder: 1440 })), 'Due today at 15:00 · Work');  // fired yesterday 15:00, seen today
assert.equal(lateText(task('d2', { due: '2026-10-16', dueTime: null, reminder: 1440 })), 'Due today · Work');
assert.equal(lateText(task('d3', { due: '2026-10-16', dueTime: '11:50' })), 'Overdue, was due today at 11:50 · Work');    // inside the grace window
assert.equal(planReminders([task('d1', { due: '2026-10-16', dueTime: '15:00', reminder: 1440 })], lists)[0].body, 'Due tomorrow at 15:00 · Work'); // native text stays at fire time
assert.equal(reminderKey(task('k', { due: '2026-10-20', dueTime: null, reminder: 60 })), '2026-10-20|null|60');

// summary + ledger pruning
assert.deepEqual(summaryText([{ title: 'A' }, { title: 'B' }, { title: 'C' }]), { title: '3 reminders', body: 'A, B, C' });
assert.equal(summaryText(['A', 'B', 'C', 'D', 'E'].map((title) => ({ title }))).body, 'A, B, C and 2 more');
assert.deepEqual(pruneLedger({ old: NOW - 31 * 86400000, recent: NOW - 86400000 }, NOW), { recent: NOW - 86400000 });

// native: future only, never already fired, capped at the soonest MAX_NATIVE
const many = Array.from({ length: MAX_NATIVE + 10 }, (_, i) => task(`t${String(i).padStart(3, '0')}`, { due: '2026-11-01', dueTime: `${String(8 + (i % 12)).padStart(2, '0')}:00` }));
const desired = nativePlan(planReminders([
  ...many,
  task('past', { due: '2026-10-16', dueTime: '11:00' }),
  task('fired', { reminderFiredAt: NOW }),
], lists), NOW);
assert.equal(desired.length, MAX_NATIVE);
assert.ok(desired.every((e) => e.fireAt > NOW));
assert.ok(!desired.some((e) => ['past', 'fired'].includes(e.taskId)));
// a reminder 3 s away stays wanted (a pending one is not cancelled) and is clamped, never handed over as past
const close = nativePlan(planReminders([task('lead', { due: '2026-10-16', dueTime: '12:00' })], lists), at(2026, 10, 16, 11, 59) + 57000);
assert.equal(close.length, 1);
assert.deepEqual(diffNative(close, [{ id: close[0].id, extra: { sig: close[0].sig } }]), { cancel: [], schedule: [] });
const nowClose = at(2026, 10, 16, 11, 59) + 57000;
assert.equal(nativeNotification(close[0], nowClose).schedule.at.getTime(), nowClose + NATIVE_LEAD_MS);
assert.equal(new Set(desired.map((e) => e.id)).size, desired.length);
assert.ok(desired.every((e, i) => i === 0 || desired[i - 1].fireAt <= e.fireAt));

// ids survive time changes and resolve collisions deterministically
const byTask = (list) => Object.fromEntries(list.map((e) => [e.taskId, e.id]));
const two = [task('x1', { due: '2026-10-20' }), task('x2', { due: '2026-10-21' })];
const ids1 = byTask(nativePlan(planReminders(two, lists), NOW));
const ids2 = byTask(nativePlan(planReminders([{ ...two[0], due: '2026-10-25' }, two[1]], lists), NOW));
assert.deepEqual(ids1, ids2);
const seen = new Map(); let clash = null;
for (let i = 0; i < 300000 && !clash; i++) { const s = `k${i}`; const h = nid(s); if (seen.has(h)) clash = [seen.get(h), s]; else seen.set(h, s); }
assert.ok(clash, 'expected to find an FNV collision to exercise the resolver');
const clashed = nativePlan(planReminders(clash.map((id) => task(id)), lists), NOW);
assert.equal(clashed.length, 2);
assert.notEqual(clashed[0].id, clashed[1].id);
assert.deepEqual(byTask(clashed), byTask(nativePlan(planReminders(clash.reverse().map((id) => task(id)), lists), NOW)));

// diff against pending: keep matches, cancel stale or changed, schedule new or changed
const trio = nativePlan(planReminders([task('a'), task('b', { reminder: 60 }), task('c', { reminder: 10 })], lists), NOW);
const [d1, d2, d3] = ['a', 'b', 'c'].map((id) => trio.find((e) => e.taskId === id));
const pending = [
  { id: d1.id, extra: { sig: d1.sig } },          // unchanged
  { id: String(d2.id), extra: { sig: 'old' } },   // changed (id comes back as a string)
  { id: 999, extra: { sig: 'gone' } },            // no longer wanted
];
const diff = diffNative([d1, d2, d3], pending);
assert.deepEqual(diff.cancel.sort(), [999, d2.id].sort());
assert.deepEqual(diff.schedule.map((e) => e.taskId), ['b', 'c']);
assert.deepEqual(diffNative([d1], [{ id: d1.id, extra: { sig: d1.sig } }]), { cancel: [], schedule: [] });
// without permission: still cancel stale requests, schedule nothing
const noPerm = diffNative([d1, d2, d3], pending, { allowSchedule: false });
assert.deepEqual(noPerm.cancel.sort(), [999, d2.id].sort());
assert.deepEqual(noPerm.schedule, []);

// armed reminders whose moment passed are retired
assert.deepEqual(pastUnfired(planReminders([
  task('p1', { due: '2026-10-16', dueTime: '11:00' }), task('p2', { due: '2026-10-16', dueTime: '13:00' }), task('p3', { due: '2026-10-16', dueTime: '10:00', reminderFiredAt: 1 }),
], lists), NOW).map((e) => e.taskId), ['p1']);

// deliveries are found from the absolute record, even after a time-zone shift
const tz = task('tz1', { due: '2026-10-16', dueTime: '09:00' });
const rec = { tz1: { fireAt: at(2026, 10, 16, 9), key: reminderKey(tz) } };
assert.deepEqual(deliveredSince(rec, new Set(), [tz], NOW), [{ taskId: 'tz1', fireAt: at(2026, 10, 16, 9) }]);
assert.deepEqual(deliveredSince(rec, new Set(['tz1']), [tz], NOW), []);                                   // still pending
assert.deepEqual(deliveredSince(rec, new Set(), [{ ...tz, dueTime: '18:00' }], NOW), []);                  // user changed it
assert.deepEqual(deliveredSince(rec, new Set(), [{ ...tz, reminderFiredAt: 5 }], NOW), []);                // already recorded
assert.deepEqual(deliveredSince({ tz1: { ...rec.tz1, fireAt: NOW + 60000 } }, new Set(), [tz], NOW), []);  // not yet due
assert.deepEqual(deliveredSince(rec, new Set(), [], NOW), []);                                             // task gone

// an on-time check keeps the fire-time wording: "At time of due" seen 30 s later is not "Overdue"
const onTime = dueForWeb(planReminders([task('ot', { due: '2026-10-16', dueTime: '12:00' })], lists), NOW + 30000);
assert.equal(onTime.fire[0].body, 'Due today at 12:00 · Work');

// requests iOS still holds for the same reminder are kept exactly as pending
const heldTask = task('h1', { due: '2026-10-16', dueTime: '11:59' });           // moment looks past now
const heldPlan = planReminders([heldTask], lists);
const pendingH = new Map([['h1', { id: 4242, extra: { taskId: 'h1', sig: 'as-scheduled' } }]]);
const heldMap = heldRequests(heldPlan, pendingH, { h1: { fireAt: at(2026, 10, 16, 11, 59), key: reminderKey(heldTask) } });
assert.deepEqual([...heldMap], [['h1', { id: 4242, sig: 'as-scheduled' }]]);
const keptPlan = nativePlan(heldPlan, NOW, heldMap);
assert.deepEqual(keptPlan.map((e) => [e.id, e.sig, e.held]), [[4242, 'as-scheduled', true]]);
assert.deepEqual(diffNative(keptPlan, [{ id: 4242, extra: { sig: 'as-scheduled' } }]), { cancel: [], schedule: [] });
assert.equal(heldRequests(heldPlan, pendingH, { h1: { fireAt: 1, key: 'other|key|0' } }).size, 0); // reminder changed since
assert.equal(heldRequests(heldPlan, pendingH, {}).size, 0);                                        // no record

// a reminder never delivered but still timely is delivered now, phrased for now
const lateNative = nativePlan(planReminders([task('ln', { due: '2026-10-16', dueTime: '13:00', reminder: 65 })], lists), NOW);
assert.equal(lateNative.length, 1);
assert.equal(lateNative[0].body, 'Due today at 13:00 · Work');
assert.equal(nativeNotification(lateNative[0], NOW).schedule.at.getTime(), NOW + NATIVE_LEAD_MS);
// …but one too late to help is not
assert.equal(nativePlan(planReminders([task('old', { due: '2026-10-16', dueTime: '11:00' })], lists), NOW).length, 0);

// payload: a real Date, the task id in extra
const n = nativeNotification(d1, NOW);
assert.equal(nativeNotification(d1).schedule.at.getTime(), d1.fireAt); // no NaN without a clock
assert.ok(n.schedule.at instanceof Date);
assert.equal(n.schedule.at.getTime(), d1.fireAt);
assert.deepEqual(n.extra, { taskId: 'a', sig: d1.sig });
assert.ok(Number.isInteger(n.id));

console.log('check-reminders: all assertions passed');
