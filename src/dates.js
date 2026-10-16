/* Local-time date helpers. Calendar dates are 'YYYY-MM-DD' strings in local
   time (they compare lexicographically); times are 'HH:MM' 24 h. Never use
   toISOString() here: it is UTC, so after ~22:00 in a UTC+ timezone "today"
   became tomorrow. Pure module (no DOM) so scripts/check-dates.mjs can run
   it under node. */

const pad = (n) => String(n).padStart(2, '0');
const parse = (iso) => new Date(iso + 'T00:00:00');

/** Date → 'YYYY-MM-DD' in local time. */
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

/** 'YYYY-MM-DD' of today + n days (local). */
export const daysFrom = (n) => addDays(todayISO(), n);

export function addDays(iso, n) {
  const d = parse(iso); d.setDate(d.getDate() + n); return toISO(d);
}

/** Same day n months later, clamped to the last day of a shorter month
    (Jan 31 + 1 → Feb 28/29). */
export function addMonths(iso, n) {
  const [y, m, day] = iso.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return toISO(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last)));
}

export const addYears = (iso, n) => addMonths(iso, 12 * n);

/** Whole days from a to b (both 'YYYY-MM-DD'); DST-safe via rounding. */
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

export const RECUR_OPTIONS = [
  ['none', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'],
];
export const recurLabel = (r) => (RECUR_OPTIONS.find(([v]) => v === r) || RECUR_OPTIONS[0])[1];

const STEP = {
  daily: (d) => addDays(d, 1),
  weekly: (d) => addDays(d, 7),
  monthly: (d) => addMonths(d, 1),
  yearly: (d) => addYears(d, 1),
};

/** Next due date after completing a recurring task: one period from the
    current due date, repeated until it lands strictly after today, so an
    overdue weekly task jumps to the next future week (PRD Q6). */
export function nextOccurrence(due, recur, today = todayISO()) {
  const step = STEP[recur];
  if (!step || !due) return due;
  let next = step(due);
  while (next <= today) next = step(next);
  return next;
}

/** Past the due date, or past the due time when one is set. */
export function isOverdue(due, dueTime = null, now = new Date()) {
  if (!due) return false;
  const end = dueTime ? new Date(`${due}T${dueTime}:00`) : new Date(`${due}T23:59:59`);
  return now > end;
}

/** Chip label + tone. Tone: overdue (red), soon (amber, ≤ 3 days), neutral. */
export function fmtDue(due, { full = false, dueTime = null, now = new Date() } = {}) {
  const d = parse(due);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const overdue = days < 0 || (days === 0 && isOverdue(due, dueTime, now));
  const cls = overdue ? 'tag-overdue' : days <= 3 ? 'tag-soon' : 'tag-neutral';
  let label;
  if (days < 0) label = 'Overdue';
  else if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days < 7) label = d.toLocaleDateString('en-US', { weekday: 'short' });
  else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (full) {
    label = 'Due ' + (days >= 0 && days < 7 && days > 1
      ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : days === 0 ? 'today' : days === 1 ? 'tomorrow'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  if (dueTime && days >= 0) label += ` ${dueTime}`;
  return { label, cls, days };
}

/** 'Fri, Oct 23' (+ ' · 09:00' when a time is set) */
export function fmtDateLong(due, dueTime = null) {
  const label = parse(due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return dueTime ? `${label} · ${dueTime}` : label;
}

export const fmtMonth = (year, month) =>
  new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "today" · "yesterday" · "3 days ago" · "Oct 2" */
export function fmtRelative(ts, now = Date.now()) {
  const days = Math.floor((now - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Whole days left before a deleted task is purged (0 = today). */
export function daysLeft(deletedAt, retentionDays, now = Date.now()) {
  return Math.max(0, Math.ceil((deletedAt + retentionDays * 86400000 - now) / 86400000));
}

/** 42 cells (6 weeks, Monday first) for a month grid. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { iso: toISO(d), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}
