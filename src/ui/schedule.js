/* Schedule popover (Trello-style dates dialog): month grid with range
   highlight, start date, due date + time, repeat rule, reminder. Mobile:
   bottom sheet; desktop: centred dialog. Nothing is saved until Save. */

import { REMINDER_OPTIONS } from '../store.js';
import { todayISO, monthGrid, fmtMonth, RECUR_OPTIONS } from '../dates.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** openSchedule({ schedule, onSave(schedule), onRemove() }) */
export function openSchedule({ schedule, onSave, onRemove }) {
  const d = {
    start: schedule.start || null, due: schedule.due || null, dueTime: schedule.dueTime || null,
    recur: schedule.recur || 'none', reminder: schedule.reminder ?? null,
  };
  const today = todayISO();
  const anchor = d.due || d.start || today;
  let view = { year: +anchor.slice(0, 4), month: +anchor.slice(5, 7) - 1 };
  let armed = 'due'; // which date field a tap on the grid fills

  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="sheet schedule" role="dialog" aria-label="Dates"></div>';
  document.body.appendChild(ov);
  const sheet = ov.firstElementChild;

  const invalid = () => !!(d.start && d.due && d.start > d.due);

  function paint() {
    const cells = monthGrid(view.year, view.month).map((c) => {
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
      return `<button class="${cls.join(' ')}" data-day="${c.iso}" aria-label="${c.iso}">${c.day}</button>`;
    }).join('');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <span class="section-title">Dates</span>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="cal-nav">
        <button class="cal-btn" data-nav="-12" aria-label="Previous year">${icon('chevronsLeft', 18)}</button>
        <button class="cal-btn" data-nav="-1" aria-label="Previous month">${icon('chevronLeft', 18)}</button>
        <span class="cal-title">${fmtMonth(view.year, view.month)}</span>
        <button class="cal-btn" data-nav="1" aria-label="Next month">${icon('chevronRight', 18)}</button>
        <button class="cal-btn" data-nav="12" aria-label="Next year">${icon('chevronsRight', 18)}</button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('')}
        ${cells}
      </div>
      <div class="sched-fields">
        <div class="sched-row ${armed === 'start' ? 'armed' : ''}">
          <input type="checkbox" id="sch-start-on" data-on="start" ${d.start ? 'checked' : ''}>
          <label for="sch-start-on">Start date</label>
          <input type="date" class="input" data-f="start" value="${d.start || ''}" ${d.start ? '' : 'disabled'}>
        </div>
        <div class="sched-row ${armed === 'due' ? 'armed' : ''}">
          <input type="checkbox" id="sch-due-on" data-on="due" ${d.due ? 'checked' : ''}>
          <label for="sch-due-on">Due date</label>
          <input type="date" class="input" data-f="due" value="${d.due || ''}" ${d.due ? '' : 'disabled'}>
          <input type="time" class="input sched-time" data-f="dueTime" value="${d.dueTime || ''}" ${d.due ? '' : 'disabled'} aria-label="Due time">
        </div>
        <div class="sched-row">
          <label for="sch-recur">Repeat</label>
          <select id="sch-recur" class="input" data-f="recur" ${d.due ? '' : 'disabled'}>
            ${RECUR_OPTIONS.map(([v, l]) => `<option value="${v}" ${d.recur === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="sched-row">
          <label for="sch-rem">Reminder</label>
          <select id="sch-rem" class="input" data-f="reminder" ${d.due ? '' : 'disabled'}>
            ${REMINDER_OPTIONS.map(([v, l]) => `<option value="${v === null ? '' : v}" ${d.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <p class="hint">${invalid() ? '<span class="error">Start must be on or before the due date</span>' : 'You will be reminded on this device.'}</p>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-sched-remove>Remove</button>
        <button class="btn btn-primary" data-sched-save ${invalid() ? 'disabled' : ''}>Save</button>
      </div>`;
  }

  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  sheet.addEventListener('click', (e) => {
    const el = e.target.closest('[data-close],[data-nav],[data-day],[data-sched-remove],[data-sched-save]');
    if (!el) return;
    if (el.dataset.close !== undefined) return close();
    if (el.dataset.nav) {
      const m = view.month + Number(el.dataset.nav);
      view = { year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
      return paint();
    }
    if (el.dataset.day) {
      d[armed] = el.dataset.day;
      if (armed === 'start' && !d.due) armed = 'due';
      return paint();
    }
    if (el.dataset.schedRemove !== undefined) { close(); return onRemove(); }
    if (el.dataset.schedSave !== undefined && !invalid()) { close(); return onSave({ ...d }); }
  });

  sheet.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.on) {
      const key = el.dataset.on;
      if (el.checked) { d[key] = d[key] || (key === 'start' ? (d.due || today) : (d.start && d.start > today ? d.start : today)); armed = key; }
      else { d[key] = null; if (key === 'due') { d.dueTime = null; d.recur = 'none'; d.reminder = null; } }
      return paint();
    }
    const f = el.dataset.f;
    if (!f) return;
    if (f === 'reminder') d.reminder = el.value === '' ? null : Number(el.value);
    else if (f === 'dueTime') d.dueTime = el.value || null;
    else if (f === 'start' || f === 'due') { if (el.value) { d[f] = el.value; view = { year: +el.value.slice(0, 4), month: +el.value.slice(5, 7) - 1 }; } }
    else d[f] = el.value;
    paint();
  });
  sheet.addEventListener('focusin', (e) => {
    const f = e.target.dataset?.f;
    if (f === 'start' || f === 'due') { armed = f; sheet.querySelectorAll('.sched-row').forEach((r) => r.classList.toggle('armed', r.contains(e.target))); }
  });

  paint();
}
