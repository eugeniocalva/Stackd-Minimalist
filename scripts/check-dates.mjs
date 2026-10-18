/* Sanity checks for src/dates.js — run with `npm run check`. No framework;
   each line is one assertion, the script exits non-zero on the first miss. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  toISO, addDays, addMonths, addYears, daysBetween, nextOccurrence, isOverdue, fmtDue, monthGrid, reminderInstant,
  defaultDateFormat, fmtDate, fmtDateOrRelative, fmtDateLong, fmtRelative, setDefaultDateFormat, getDefaultDateFormat,
} from '../src/dates.js';

// app-wide format (Settings → Dates): explicit parameter, else the module default set by the store
assert.equal(getDefaultDateFormat(), 'dmy');
assert.equal(fmtDateLong('2026-10-23'), 'Fri · 23/10/2026');
assert.equal(fmtDateLong('2026-10-23', '09:00', 'mdy'), 'Fri · 10/23/2026 · 09:00');
assert.equal(fmtDateLong('2026-10-23', null, 'ymd'), 'Fri · 2026-10-23');
{
  const now = new Date(2026, 9, 16, 12).getTime();
  const ago = (d) => now - d * 86400000;
  assert.equal(fmtRelative(ago(0), now), 'today');
  assert.equal(fmtRelative(ago(1), now), 'yesterday');
  assert.equal(fmtRelative(ago(6), now), '6 days ago');
  assert.equal(fmtRelative(ago(7), now), '09/10/2026', 'a week out becomes a date');
  assert.equal(fmtRelative(ago(7), now, 'mdy'), '10/09/2026');
  const at = (h) => new Date(2026, 9, 16, h);
  assert.equal(fmtDue('2026-10-19', { now: at(10) }).label, 'Mon', 'within a week: weekday');
  assert.equal(fmtDue('2026-10-23', { now: at(10) }).label, '23/10/2026', 'a week out: numeric');
  assert.equal(fmtDue('2026-10-23', { now: at(10), format: 'mdy' }).label, '10/23/2026');
  assert.equal(fmtDue('2026-10-23', { now: at(10), full: true, format: 'ymd' }).label, 'Due 2026-10-23');
  assert.equal(fmtDue('2026-10-19', { now: at(10), full: true }).label, 'Due Mon 19/10/2026');
  setDefaultDateFormat('ymd');
  assert.equal(fmtDateLong('2026-10-23'), 'Fri · 2026-10-23', 'the store-set default applies when no format is passed');
  assert.equal(fmtDue('2026-10-23', { now: at(10) }).label, '2026-10-23');
  assert.equal(fmtRelative(ago(8), now), '2026-10-08');
  setDefaultDateFormat('nope');
  assert.equal(getDefaultDateFormat(), 'ymd', 'unknown formats are ignored');
  setDefaultDateFormat('dmy');
}

// numeric dates (Settings → Dates): three formats, four-digit years, locale default
assert.equal(fmtDate('2026-10-16', 'dmy'), '16/10/2026');
assert.equal(fmtDate('2026-10-16', 'mdy'), '10/16/2026');
assert.equal(fmtDate('2026-10-16', 'ymd'), '2026-10-16');
assert.equal(fmtDate('2026-01-05'), '05/01/2026');                                // dmy is the fallback
assert.equal(fmtDate(new Date(2026, 9, 16, 23, 30).getTime(), 'dmy'), '16/10/2026'); // epoch ms, local day
assert.equal(defaultDateFormat('en-US'), 'mdy');
assert.equal(defaultDateFormat('en'), 'mdy');
assert.equal(defaultDateFormat('en-GB'), 'dmy');
assert.equal(defaultDateFormat('pt-PT'), 'dmy');
assert.equal(defaultDateFormat('sv-SE'), 'ymd');
assert.equal(defaultDateFormat('ja-JP'), 'ymd');
assert.equal(defaultDateFormat(''), 'dmy');   // empty = unknown locale; undefined would read the machine's own language
{
  const now = new Date(2026, 9, 16, 9, 0).getTime();
  const at = (d, h) => new Date(2026, 9, d, h).getTime();
  assert.equal(fmtDateOrRelative(at(16, 0), 'dmy', now), 'Today');
  assert.equal(fmtDateOrRelative(at(15, 23), 'dmy', now), 'Yesterday');
  assert.equal(fmtDateOrRelative(at(14, 23), 'mdy', now), '10/14/2026');
  assert.equal(fmtDateOrRelative(at(17, 1), 'ymd', now), '2026-10-17');        // a future day is just a date
}

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

// reminder instant: due + time − minutes, on local wall-clock fields
const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
assert.equal(reminderInstant('2026-10-23', '09:00', 0), local(2026, 10, 23, 9));
assert.equal(reminderInstant('2026-10-23', '09:00', 10), local(2026, 10, 23, 8, 50));
assert.equal(reminderInstant('2026-10-23', '00:30', 60), local(2026, 10, 22, 23, 30)); // crosses midnight
assert.equal(reminderInstant('2026-10-23', null, 1440), local(2026, 10, 22, 9));      // no time → 09:00
assert.equal(reminderInstant('2026-03-30', '09:00', 2880), local(2026, 3, 28, 9));    // across the EU DST switch
// sub-day offsets are real elapsed time, so they always land before the due
// moment, even when the due time sits right after a spring-forward gap
for (const [due, time] of [['2026-03-29', '02:05'], ['2026-03-08', '03:05'], ['2026-10-25', '01:30']]) {
  const at = new Date(`${due}T${time}:00`).getTime();
  assert.equal(at - reminderInstant(due, time, 10), 10 * 60000);
  assert.equal(at - reminderInstant(due, time, 60), 60 * 60000);
}
assert.equal(reminderInstant('2026-10-23', '09:00', null), null);
assert.equal(reminderInstant(null, '09:00', 0), null);

// DST pinned to real zones. Everything above compares against the same local
// constructor, so it only proves DST handling where the machine's zone has
// DST on those dates. Here this file re-runs itself per zone (TZ passed
// straight to the child) and checks absolute UTC instants.
const ZONE_CASES = {
  'Europe/Lisbon': [
    ['2026-03-29', '09:00', 1440, Date.UTC(2026, 2, 28, 9, 0)],  // 1 day before, across spring-forward: 09:00 WET
    ['2026-03-29', '02:05', 10, Date.UTC(2026, 2, 29, 0, 55)],   // just after the gap: 10 real minutes earlier
    ['2026-10-25', '09:00', 1440, Date.UTC(2026, 9, 24, 8, 0)],  // across fall-back: 09:00 WEST
  ],
  'America/New_York': [
    ['2026-03-08', '09:00', 1440, Date.UTC(2026, 2, 7, 14, 0)],
    ['2026-03-08', '03:05', 10, Date.UTC(2026, 2, 8, 6, 55)],
    ['2026-11-01', '09:00', 2880, Date.UTC(2026, 9, 30, 13, 0)],
  ],
  'Australia/Sydney': [
    ['2026-04-05', '09:00', 1440, Date.UTC(2026, 3, 3, 22, 0)],
  ],
  'Asia/Tokyo': [
    ['2026-03-29', '09:00', 1440, Date.UTC(2026, 2, 28, 0, 0)],
  ],
};
const zoneArg = process.argv.indexOf('--zone');
const zone = zoneArg > 0 ? process.argv[zoneArg + 1] : null;
if (zone) {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== zone) {
    console.log(`check-dates: time zone ${zone} not available here, skipped`);
    process.exit(3);
  }
  for (const [due, time, offset, utc] of ZONE_CASES[zone]) {
    assert.equal(reminderInstant(due, time, offset), utc, `${zone}: ${due} ${time} minus ${offset} min`);
  }
  process.exit(0);
}
/* A zone that cannot be applied fails the run: skipping it silently would
   turn these checks off (set STACKD_ALLOW_TZ_SKIP=1 to allow it). */
const zones = Object.keys(ZONE_CASES);
let ran = 0;
for (const z of zones) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--zone', z], { env: { ...process.env, TZ: z }, encoding: 'utf8' });
  if (r.status === 3 && process.env.STACKD_ALLOW_TZ_SKIP === '1') { console.log(r.stdout.trim()); continue; }
  assert.equal(r.status, 0, `date checks failed in ${z}: ${r.stdout}${r.stderr}`);
  ran++;
}

console.log(`check-dates: all assertions passed (local zone + ${ran} pinned zones)`);
