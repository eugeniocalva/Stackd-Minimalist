/* Task detail: editable title, field rows (due, priority, tags, move,
   reminder), subtasks with progress, ⋯ actions menu. */

import {
  S, UI, PRIORITIES, reminderLabel, laneName,
  taskById, listById, setPriority, setTags, setTitle, setSchedule, clearSchedule,
  moveTask, copyTask, commit, rerender,
} from '../store.js';
import { fmtDue, fmtDateLong, recurLabel } from '../dates.js';
import { esc, app, uid } from '../util.js';
import { icon } from './icons.js';
import { mobileListHTML, bindScrollShadow, openDetail } from './board.js';
import { openMenu, toast } from './primitives.js';
import { archiveWithUndo, deleteWithUndo, completeTask } from './actions.js';
import { openSchedule } from './schedule.js';
import { openMoveCopy } from './movecopy.js';
import { openTagPicker } from './tagpicker.js';

const PRIORITY_NAME = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };

export function detailHTML() {
  const t = taskById(UI.detailId);
  if (!t) { UI.screen = 'list'; return mobileListHTML(); }
  const list = listById(t.listId);
  const done = t.subtasks.filter((s) => s.done).length;
  const pct = t.subtasks.length ? (done / t.subtasks.length) * 100 : 0;
  const dueTone = t.due ? fmtDue(t.due, { dueTime: t.dueTime }).cls : '';
  const scheduleNote = [
    t.start ? `Starts ${fmtDateLong(t.start)}` : '',
    t.recur !== 'none' ? `Repeats ${recurLabel(t.recur).toLowerCase()}${t.completedCount ? ` · done ${t.completedCount}×` : ''}` : '',
  ].filter(Boolean).join(' · ');
  return `
  <div class="screen detail-screen">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to ${esc(list.name)}">${icon('chevronLeft')}</button>
      <span class="kicker">${esc(list.name)}</span>
      <button class="icon-btn" data-more aria-label="More actions" aria-haspopup="menu">${icon('more')}</button>
    </header>
    <div class="scroll-area">
      <div class="detail-head">
        <div class="detail-title-row">
          <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
          <h1 class="detail-title" data-title tabindex="0" title="Tap to edit">${esc(t.title)}</h1>
        </div>
      </div>

      <div class="card">
        <div class="kv-row">
          <span class="kv-label">${icon('calendar', 16)}Due date</span>
          <span class="kv-right">
            <button class="kv-val ${t.due ? dueTone.replace('tag-', 'is-') : 'placeholder'}" data-due>${t.due ? esc(fmtDateLong(t.due, t.dueTime)) : 'Set date'}${t.recur !== 'none' ? icon('repeat', 14) : ''}${icon('chevronDown', 16)}</button>
            ${t.due ? `<button class="kv-clear" data-due-clear aria-label="Clear dates">${icon('x', 14)}</button>` : ''}
          </span>
        </div>
        ${scheduleNote ? `<div class="kv-note">${esc(scheduleNote)}</div>` : ''}
        <div class="kv-row kv-stack">
          <span class="kv-label">Priority</span>
          <div class="chip-row" data-priority>
            ${[...PRIORITIES].reverse().map((p) => `<button class="chip sm ${t.priority === p ? 'on' : ''} ${p !== 'none' && t.priority === p ? `chip-${p}` : ''}" data-val="${p}">${PRIORITY_NAME[p]}</button>`).join('')}
          </div>
        </div>
        <div class="kv-row kv-stack">
          <span class="kv-label">${icon('tag', 16)}Tags</span>
          <div class="chip-row" data-tags>
            ${t.tags.map((tag) => `<button class="chip sm on removable" data-remove="${esc(tag)}" aria-label="Remove tag ${esc(tag)}">#${esc(tag)}${icon('x', 14)}</button>`).join('')}
            <button class="chip sm" data-add-tag>${icon('plus', 14)}${t.tags.length ? 'Add' : 'Add tags…'}</button>
          </div>
        </div>
        <div class="kv-row">
          <span class="kv-label">${icon('move', 16)}Move</span>
          <button class="kv-val" data-move>${esc(list.name)} · ${laneName(t.lane)}${icon('chevronRight', 16)}</button>
        </div>
        <div class="kv-row">
          <span class="kv-label">Reminder</span>
          <button class="kv-val ${t.reminder === null ? 'placeholder' : ''}" data-reminder>${esc(reminderLabel(t.reminder))}${icon('chevronDown', 16)}</button>
        </div>
      </div>

      <div class="card">
        <div class="subhead">
          <span class="section-title">Subtasks</span>
          <span class="count num">${done} / ${t.subtasks.length}</span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="subrows">
          ${t.subtasks.map((s) => `
          <div class="subrow ${s.done ? 'done' : ''}">
            <input type="checkbox" aria-label="Toggle complete" class="check sm" ${s.done ? 'checked' : ''} data-sub="${s.id}">
            <span class="s-title">${esc(s.title)}</span>
            <button class="s-del" data-subdel="${s.id}" aria-label="Delete subtask">${icon('x', 16)}</button>
          </div>`).join('')}
          <div class="subrow">
            <span class="addsub-dot"></span>
            <input class="addsub-input" placeholder="Add subtask…">
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

export function bindDetail() {
  const t = taskById(UI.detailId);
  if (!t) { rerender(); return; }
  bindScrollShadow();
  app.querySelector('[data-back]').addEventListener('click', () => { UI.screen = 'list'; rerender(); });
  app.querySelector('.detail-title-row .check').addEventListener('change', () => completeTask(t.id, app.querySelector('.detail-title-row')));

  /* ⋯ menu */
  const where = (listId, lane) => `${listById(listId).name} · ${laneName(lane)}`;
  const move = () => openMoveCopy({ mode: 'move', task: t, onConfirm: (listId, lane) => {
    moveTask(t.id, listId, lane);
    toast(`Moved to ${where(listId, lane)}`);
  } });
  const copy = () => openMoveCopy({ mode: 'copy', task: t, onConfirm: (listId, lane) => {
    const c = copyTask(t.id, listId, lane);
    toast(`Copied to ${where(listId, lane)}`, { action: { label: 'Open', onClick: () => {
      S.currentList = c.listId; commit(); openDetail(c.id);
    } } });
  } });
  app.querySelector('[data-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Move', icon: 'move', onClick: move },
    { label: 'Copy', icon: 'copy', onClick: copy },
    { label: 'Archive', icon: 'archive', onClick: () => archiveWithUndo(t.id) },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteWithUndo(t.id) },
  ]));
  app.querySelector('[data-move]').addEventListener('click', move);

  /* inline title edit */
  const h1 = app.querySelector('[data-title]');
  const editTitle = () => {
    const input = document.createElement('input');
    input.className = 'detail-title-input';
    input.value = t.title;
    input.setAttribute('aria-label', 'Task title');
    h1.replaceWith(input);
    input.focus(); input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return; finished = true;
      if (save && input.value.trim() && input.value.trim() !== t.title) setTitle(t.id, input.value);
      else rerender();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  };
  h1.addEventListener('click', editTitle);
  h1.addEventListener('keydown', (e) => { if (e.key === 'Enter') editTitle(); });

  /* due date + reminder both open the schedule popover */
  const schedule = () => openSchedule({
    schedule: t,
    onSave: (sch) => setSchedule(t.id, sch),
    onRemove: () => clearSchedule(t.id),
  });
  app.querySelector('[data-due]').addEventListener('click', schedule);
  app.querySelector('[data-reminder]').addEventListener('click', schedule);
  app.querySelector('[data-due-clear]')?.addEventListener('click', () => clearSchedule(t.id));

  /* priority chips */
  app.querySelector('[data-priority]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    if (chip.dataset.val !== t.priority) setPriority(t.id, chip.dataset.val);
  });

  /* tags */
  app.querySelector('[data-tags]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    if (chip.dataset.remove !== undefined) {
      setTags(t.id, t.tags.filter((x) => x !== chip.dataset.remove));
      return;
    }
    openTagPicker({ tags: t.tags, onChange: (tags) => setTags(t.id, tags) });
  });

  /* subtasks */
  app.querySelectorAll('[data-sub]').forEach((c) =>
    c.addEventListener('change', () => {
      const s = t.subtasks.find((s) => s.id === c.dataset.sub);
      s.done = !s.done; commit();
    }));
  app.querySelectorAll('[data-subdel]').forEach((b) =>
    b.addEventListener('click', () => {
      t.subtasks = t.subtasks.filter((s) => s.id !== b.dataset.subdel);
      commit();
    }));
  const input = app.querySelector('.addsub-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      t.subtasks.push({ id: uid(), title: input.value.trim(), done: false });
      UI.refocusAddsub = true;
      commit();
    }
  });

}
