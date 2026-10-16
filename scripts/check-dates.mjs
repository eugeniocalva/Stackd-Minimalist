/* Sanity checks for src/dates.js — run with `npm run check`. No framework;
   each line is one assertion, the script exits non-zero on the first miss. */
import assert from 'node:assert/strict';
import {
  toISO, addDays, addMonths, addYears, daysBetween, nextOccurrence, isOverdue, fmtDue, monthGrid,
} from '../src/dates.js';

// local-time ISO, never UTC
assert.equal(toISO(new Date(2026, 9, 16, 23, 30)), '2026-10-16');
assert.equal(toISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');

// day / month / year arithmetic with month-end clamping
assert.equal(addDays('2026-10-31', 1), '2026-11-01');
assert.equal(addDays('2026-03-28', 2), '2026-03-30');           // across the EU DST switch
assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
assert.equal(addMonths('2028-01-31', 1), '2028-02-29');         // leap year
assert.equal(addMonths('2026-10-31', 1), '2026-11-30');
assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
assert.equal(addYears('2028-02-29', 1), '2029-02-28');
assert.equal(daysBetween('2026-10-16', '2026-10-23'), 7);
assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);

// next occurrence: one period from the due date, skipping into the future
assert.equal(nextOccurrence('2026-10-16', 'daily', '2026-10-16'), '2026-10-17');
assert.equal(nextOccurrence('2026-10-16', 'weekly', '2026-10-16'), '2026-10-23');
assert.equal(nextOccurrence('2026-09-25', 'weekly', '2026-10-16'), '2026-10-23'); // 3 weeks overdue → next future Friday
assert.equal(nextOccurrence('2026-10-16', 'monthly', '2026-10-16'), '2026-11-16');
assert.equal(nextOccurrence('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
assert.equal(nextOccurrence('2026-10-16', 'yearly', '2026-10-16'), '2027-10-16');
assert.equal(nextOccurrence('2026-10-20', 'daily', '2026-10-16'), '2026-10-21');  // future due: just one step
assert.equal(nextOccurrence('2026-10-16', 'none', '2026-10-16'), '2026-10-16');

// overdue with and without a time
const at = (h, m = 0) => new Date(2026, 9, 16, h, m);
assert.equal(isOverdue('2026-10-16', null, at(23, 59)), false);
assert.equal(isOverdue('2026-10-15', null, at(0, 1)), true);
assert.equal(isOverdue('2026-10-16', '23:30', at(23, 29)), false);
assert.equal(isOverdue('2026-10-16', '23:30', at(23, 31)), true);

// chip labels
assert.deepEqual(fmtDue('2026-10-16', { now: at(9) }).label, 'Today');
assert.deepEqual(fmtDue('2026-10-16', { dueTime: '23:30', now: at(9) }).label, 'Today 23:30');
assert.equal(fmtDue('2026-10-16', { dueTime: '09:00', now: at(10) }).cls, 'tag-overdue');
assert.equal(fmtDue('2026-10-15', { now: at(10) }).label, 'Overdue');
assert.equal(fmtDue('2026-10-19', { now: at(10) }).cls, 'tag-soon');
assert.equal(fmtDue('2026-10-30', { now: at(10) }).cls, 'tag-neutral');

// month grid: 42 cells, Monday first
const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
assert.equal(g.length, 42);
assert.equal(g[0].iso, '2026-09-28');
assert.equal(g[3].iso, '2026-10-01');
assert.equal(g.filter((c) => c.inMonth).length, 31);

console.log('check-dates: all assertions passed');
