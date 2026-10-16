/* Schedule popover (Trello-style dates dialog): month grid with range
   highlight, start date, due date + time, repeat rule, reminder. Mobile:
   bottom sheet; desktop: centred dialog. Nothing is saved until Save.

   The dialog skeleton renders once; only the grid and the field states
   repaint, so focus and half-typed values are never lost. Keyboard: Tab
   stays inside the dialog; in the grid the arrows move a day or a week,
   PageUp/PageDown a month (with Shift a year), Home/End go to the ends of
   the week, and Enter or Space picks the focused day. Esc closes. */

import { REMINDER_OPTIONS } from '../store.js';
import {
  todayISO, toISO, monthGrid, fmtMonth, fmtDateLong, RECUR_OPTIONS, addDays, addMonths, reminderInstant,
} from '../dates.js';
import { isNative, reminderPermission, requestReminderPermission } from '../notify.js';
import { icon } from './icons.js';
import { toast } from './primitives.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TABBABLE = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled])';
const monthOf = (iso) => ({ year: +iso.slice(0, 4), month: +iso.slice(5, 7) - 1 });
const weekday = (iso) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7; // Monday = 0
const longDate = (iso) => new Date(iso + 'T00:00:00')
  .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
const momentLabel = (ms) => { const t = new Date(ms); return `${fmtDateLong(toISO(t))} at ${pad(t.getHours())}:${pad(t.getMinutes())}`; };

/** The line under the fields: when the reminder will come, and whether this
    device can actually show it (PRD US-10). */
function reminderHint(d, done) {
  const at = d.due ? reminderInstant(d.due, d.dueTime, d.reminder) : null;
  if (at === null) return 'No reminder set.';
  if (at <= Date.now()) return `That reminder time (${momentLabel(at)}) has already passed.`;
  if (done) return 'Reminders are off while the task is done. Reopen it to get this one.';
  const when = `Reminder on ${momentLabel(at)}`;
  switch (reminderPermission()) {
    case 'granted': return isNative() ? `${when}.` : `${when}, while Stack'd is open.`;
    case 'default': return `${when}. Saving asks to allow notifications.`;
    case 'denied': return "Notifications are blocked for Stack'd. Allow them in settings to get this reminder.";
    case 'install': return "Reminders need Stack'd on your Home Screen (iOS 16.4 or later). Tasks in this Safari tab don't move there.";
    case 'file': return "Reminders don't work when index.html is opened from disk. Open Stack'd from the website or a local web server instead (tasks made here don't move there).";
    default: return "This browser can't show reminder notifications.";
  }
}

/** openSchedule({ schedule, done, onSave(schedule), onRemove() }) — `done`
    says the task is completed, so a reminder would not fire. */
export function openSchedule({ schedule, done = false, onSave, onRemove }) {
  const d = {
    start: schedule.start || null, due: schedule.due || null, dueTime: schedule.dueTime || null,
    recur: schedule.recur || 'none', reminder: schedule.reminder ?? null,
  };
  const today = todayISO();
  let cursor = d.due || d.start || today; // the one grid day reachable with Tab
  let armed = 'due';                       // which date a pick in the grid fills
  const opener = document.activeElement;

  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet schedule" role="dialog" aria-modal="true" aria-labelledby="sch-title">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title" id="sch-title">Dates</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="cal-nav">
      <button class="cal-btn" data-nav="-12" aria-label="Previous year">${icon('chevronsLeft', 18)}</button>
      <button class="cal-btn" data-nav="-1" aria-label="Previous month">${icon('chevronLeft', 18)}</button>
      <span class="cal-title" data-month aria-live="polite"></span>
      <button class="cal-btn" data-nav="1" aria-label="Next month">${icon('chevronRight', 18)}</button>
      <button class="cal-btn" data-nav="12" aria-label="Next year">${icon('chevronsRight', 18)}</button>
    </div>
    <div class="cal">
      <div class="cal-grid" aria-hidden="true">${WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('')}</div>
      <div class="cal-grid" data-days></div>
    </div>
    <div class="sched-fields">
      <div class="sched-row" data-row="start">
        <input type="checkbox" id="sch-start-on" data-on="start">
        <label for="sch-start-on">Start date</label>
        <input type="date" class="input" data-f="start" aria-label="Start date">
      </div>
      <div class="sched-row" data-row="due">
        <input type="checkbox" id="sch-due-on" data-on="due">
        <label for="sch-due-on">Due date</label>
        <input type="date" class="input" data-f="due" aria-label="Due date">
        <input type="time" class="input sched-time" data-f="dueTime" aria-label="Due time">
      </div>
      <div class="sched-row">
        <label for="sch-recur">Repeat</label>
        <select id="sch-recur" class="input" data-f="recur">
          ${RECUR_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div class="sched-row">
        <label for="sch-rem">Reminder</label>
        <select id="sch-rem" class="input" data-f="reminder">
          ${REMINDER_OPTIONS.map(([v, l]) => `<option value="${v === null ? '' : v}">${l}</option>`).join('')}
        </select>
      </div>
      <p class="hint" data-hint aria-live="polite"></p>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" data-sched-remove>Remove</button>
      <button class="btn btn-primary" data-sched-save>Save</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const sheet = ov.firstElementChild;
  const q = (s) => sheet.querySelector(s);
  const invalid = () => !!(d.start && d.due && d.start > d.due);

  function renderGrid() {
    const view = monthOf(cursor);
    q('[data-month]').textContent = fmtMonth(view.year, view.month);
    q('[data-days]').innerHTML = monthGrid(view.year, view.month).map((c) => {
      const cls = ['cal-day'];
      if (!c.inMonth) cls.push('dim');
      if (c.iso === today) cls.push('today');
      if (c.iso === d.due) cls.push('sel');
      if (c.iso === d.start) cls.push('sel-start');
      if (d.start && d.due && c.iso > d.start && c.iso < d.due) cls.push('in-range');
      if (d.start && d.due && d.start < d.due) {
        if (c.iso === d.start) cls.push('range-start');
        if (c.iso === d.due) cls.push('range-end');
      }
      const marks = [c.iso === today && 'today', c.iso === d.start && 'start date', c.iso === d.due && 'due date'].filter(Boolean);
      const label = longDate(c.iso) + (marks.length ? `, ${marks.join(', ')}` : '');
      return `<button class="${cls.join(' ')}" data-day="${c.iso}" tabindex="${c.iso === cursor ? 0 : -1}" aria-label="${label}">${c.day}</button>`;
    }).join('');
  }

  /* Reflect d into the controls. Never rewrite the value of the control
     being typed in, or a half-entered date would snap back. */
  function syncFields() {
    const set = (sel, prop, val) => {
      const el = q(sel);
      if (prop === 'value' && el === document.activeElement) return;
      if (el[prop] !== val) el[prop] = val;
    };
    set('[data-on="start"]', 'checked', !!d.start);
    set('[data-on="due"]', 'checked', !!d.due);
    set('[data-f="start"]', 'value', d.start || '');
    set('[data-f="due"]', 'value', d.due || '');
    set('[data-f="dueTime"]', 'value', d.dueTime || '');
    set('[data-f="recur"]', 'value', d.recur);
    set('[data-f="reminder"]', 'value', d.reminder === null ? '' : String(d.reminder));
    set('[data-f="start"]', 'disabled', !d.start);
    for (const f of ['due', 'dueTime', 'recur', 'reminder']) set(`[data-f="${f}"]`, 'disabled', !d.due);
    sheet.querySelectorAll('[data-row]').forEach((r) => r.classList.toggle('armed', r.dataset.row === armed));
    if (invalid()) q('[data-hint]').innerHTML = '<span class="error">Start must be on or before the due date</span>';
    else q('[data-hint]').textContent = reminderHint(d, done);
    q('[data-sched-save]').disabled = invalid();
  }

  const paint = () => { renderGrid(); syncFields(); };
  const focusDay = () => q(`[data-day="${cursor}"]`)?.focus();

  const close = () => {
    ov.remove();
    document.removeEventListener('keydown', onKey, true);
    if (opener?.isConnected) opener.focus?.();
  };
  /* capture phase: Esc must close only this dialog, not a sheet beneath it */
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...sheet.querySelectorAll(TABBABLE)];
    const first = items[0], last = items[items.length - 1];
    if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-close],[data-nav],[data-day],[data-sched-remove],[data-sched-save]');
    if (!el) return;
    if (el.dataset.close !== undefined) { close(); return; }
    if (el.dataset.nav) { cursor = addMonths(cursor, Number(el.dataset.nav)); renderGrid(); return; }
    if (el.dataset.day) {
      cursor = el.dataset.day;
      d[armed] = cursor;
      if (armed === 'start' && !d.due) armed = 'due';
      paint();
      focusDay();
      return;
    }
    if (el.dataset.schedRemove !== undefined) { close(); onRemove(); return; }
    if (el.dataset.schedSave !== undefined && !invalid()) {
      /* the permission prompt needs this tap, so ask before anything awaits */
      const at = d.due ? reminderInstant(d.due, d.dueTime, d.reminder) : null;
      const willFire = at !== null && at > Date.now() && !done;
      if (willFire && reminderPermission() === 'default') {
        requestReminderPermission().then((state) => {
          if (state === 'denied') toast('Notifications are blocked, so this reminder will not show');
        });
      }
      close();
      onSave({ ...d });
    }
  });

  q('[data-days]').addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    let next = null;
    if (step) next = addDays(cursor, step);
    else if (e.key === 'PageUp') next = addMonths(cursor, e.shiftKey ? -12 : -1);
    else if (e.key === 'PageDown') next = addMonths(cursor, e.shiftKey ? 12 : 1);
    else if (e.key === 'Home') next = addDays(cursor, -weekday(cursor));
    else if (e.key === 'End') next = addDays(cursor, 6 - weekday(cursor));
    if (!next) return;
    e.preventDefault();
    cursor = next;
    renderGrid();
    focusDay();
  });

  sheet.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.on) {
      const key = el.dataset.on;
      if (el.checked) {
        d[key] = d[key] || (key === 'start'
          ? (d.due && d.due < today ? d.due : today)
          : (d.start && d.start > today ? d.start : today));
        armed = key;
        cursor = d[key];
      } else {
        d[key] = null;
        if (key === 'due') Object.assign(d, { dueTime: null, recur: 'none', reminder: null });
        if (armed === key) armed = 'due';
      }
      paint();
      return;
    }
    const f = el.dataset.f;
    if (!f) return;
    if (f === 'reminder') d.reminder = el.value === '' ? null : Number(el.value);
    else if (f === 'dueTime') d.dueTime = el.value || null;
    else if (f === 'recur') d.recur = el.value;
    else if (el.value) { d[f] = el.value; cursor = el.value; }
    paint();
  });
  sheet.addEventListener('focusin', (e) => {
    const f = e.target.dataset?.f;
    if ((f === 'start' || f === 'due') && armed !== f) { armed = f; syncFields(); }
  });

  paint();
  focusDay();
}
