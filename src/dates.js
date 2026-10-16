/* Local-time date helpers. Never use toISOString() for calendar dates: it is
   UTC, so after ~22:00 in a UTC+ timezone "today" became tomorrow. */

const pad = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' in local time. */
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

/** 'YYYY-MM-DD' of today + n days (local). */
export const daysFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toISO(d); };

export function fmtDue(due, { full = false } = {}) {
  const d = new Date(due + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  /* semantic chip tone: red = overdue, amber = due within 3 days */
  const cls = days < 0 ? 'tag-overdue' : days <= 3 ? 'tag-soon' : 'tag-neutral';
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
  return { label, cls, days };
}

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
