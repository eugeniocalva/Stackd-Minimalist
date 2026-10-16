/* Task detail: editable title, field rows (due, priority, tags, move,
   reminder), subtasks with progress, ⋯ actions menu. Archived and deleted
   tasks open read-only with Restore and Delete only (PRD AC-05.6). */

import {
  S, UI, PRIORITIES, RETENTION_DAYS, reminderLabel, laneName,
  taskById, listById, setPriority, setTags, setTitle, setSchedule, clearSchedule,
  copyTask, deleteForever, commit, rerender,
} from '../store.js';
import { fmtDue, fmtDateLong, fmtRelative, daysLeft, recurLabel } from '../dates.js';
import { esc, app, uid } from '../util.js';
import { icon } from './icons.js';
import { mobileListHTML, bindScrollShadow, openDetail, taskMetaHTML } from './board.js';
import { openMenu, toast, confirmDialog } from './primitives.js';
import { archiveWithUndo, deleteWithUndo, restoreWithToast, moveWithFeedback, completeTask } from './actions.js';
import { openSchedule } from './schedule.js';
import { openMoveCopy } from './movecopy.js';
import { openTagPicker } from './tagpicker.js';

const PRIORITY_NAME = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' };

function scheduleNote(t) {
  return [
    t.start ? `Starts ${fmtDateLong(t.start)}` : '',
    t.recur !== 'none' ? `Repeats ${recurLabel(t.recur).toLowerCase()}${t.completedCount ? ` · done ${t.completedCount}×` : ''}` : '',
  ].filter(Boolean).join(' · ');
}

function subtasksHTML(t, { readOnly = false } = {}) {
  const done = t.subtasks.filter((s) => s.done).length;
  const pct = t.subtasks.length ? (done / t.subtasks.length) * 100 : 0;
  return `
      <div class="card">
        <div class="subhead">
          <span class="section-title">Subtasks</span>
          <span class="count num">${done} / ${t.subtasks.length}</span>
        </div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="subrows">
          ${t.subtasks.map((s) => `
          <div class="subrow ${s.done ? 'done' : ''}">
            <input type="checkbox" aria-label="Toggle complete" class="check sm" ${s.done ? 'checked' : ''} ${readOnly ? 'disabled' : `data-sub="${s.id}"`}>
            <span class="s-title">${esc(s.title)}</span>
            ${readOnly ? '' : `<button class="s-del" data-subdel="${s.id}" aria-label="Delete subtask">${icon('x', 16)}</button>`}
          </div>`).join('')}
          ${readOnly ? '' : `
          <div class="subrow">
            <span class="addsub-dot"></span>
            <input class="addsub-input" placeholder="Add subtask…">
          </div>`}
        </div>
      </div>`;
}

export function detailHTML() {
  const t = taskById(UI.detailId);
  if (!t) { UI.screen = 'list'; return mobileListHTML(); }
  if (t.status !== 'active') return readOnlyHTML(t);
  const list = listById(t.listId);
  const dueTone = t.due ? fmtDue(t.due, { dueTime: t.dueTime }).cls : '';
  const note = scheduleNote(t);
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
        ${note ? `<div class="kv-note">${esc(note)}</div>` : ''}
        <div class="kv-row kv-stack">
          <span class="kv-label">Priority</span>
          <div class="chip-row" data-priority>
            ${[...PRIORITIES].reverse().map((p) => `<button class="chip sm ${t.priority === p ? 'on' : ''} ${p !== 'none' && t.priority === p ? `chip-${p}` : ''}" data-val="${p}" aria-pressed="${t.priority === p}">${PRIORITY_NAME[p]}</button>`).join('')}
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
      ${subtasksHTML(t)}
    </div>
  </div>`;
}

export function bindDetail() {
  const t = taskById(UI.detailId);
  if (!t) { rerender(); return; }
  if (t.status !== 'active') { bindReadOnly(t); return; }
  bindScrollShadow();
  app.querySelector('[data-back]').addEventListener('click', () => { UI.screen = 'list'; rerender(); });
  app.querySelector('.detail-title-row .check').addEventListener('change', () => completeTask(t.id, app.querySelector('.detail-title-row')));

  /* ⋯ menu */
  const where = (listId, lane) => `${listById(listId).name} · ${laneName(lane)}`;
  const move = () => openMoveCopy({ mode: 'move', task: t, onConfirm: (listId, lane) => moveWithFeedback(t.id, listId, lane) });
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
    done: t.done,
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

/* ── Read-only view for archived / deleted tasks ─────────────────────── */

function readOnlyHTML(t) {
  const archived = t.status === 'archived';
  const o = t.origin || t;
  const from = `${listById(o.listId)?.name || 'Deleted board'} · ${laneName(o.lane)}`;
  const left = archived ? 0 : daysLeft(t.deletedAt, RETENTION_DAYS);
  const status = archived ? `Archived ${fmtRelative(t.archivedAt)}`
    : left === 0 ? 'Removed today' : `Removed in ${left} day${left === 1 ? '' : 's'}`;
  const note = scheduleNote(t);
  const row = (label, value) => `
        <div class="kv-row">
          <span class="kv-label">${label}</span>
          <span class="kv-val static">${value}</span>
        </div>`;
  return `
  <div class="screen detail-screen is-readonly">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to ${archived ? 'Archived' : 'Deleted'}">${icon('chevronLeft')}</button>
      <span class="kicker">${archived ? 'Archived' : 'Deleted'}</span>
      <span class="icon-btn-spacer" aria-hidden="true"></span>
    </header>
    <div class="scroll-area">
      <div class="notice ${archived ? 'notice-neutral' : ''}">
        ${icon(archived ? 'archive' : 'trash', 18)}
        <span>${status} · from ${esc(from)}. Restore it to edit.</span>
      </div>
      <div class="detail-head">
        <div class="detail-title-row">
          <input type="checkbox" class="check" disabled ${t.done ? 'checked' : ''} aria-label="${t.done ? 'Completed' : 'Not completed'}">
          <h1 class="detail-title">${esc(t.title)}</h1>
        </div>
        ${taskMetaHTML(t)}
      </div>
      <div class="card">
        ${row(`${icon('calendar', 16)}Due date`, t.due ? esc(fmtDateLong(t.due, t.dueTime)) : '—')}
        ${note ? `<div class="kv-note">${esc(note)}</div>` : ''}
        ${row('Priority', PRIORITY_NAME[t.priority])}
        ${row(`${icon('tag', 16)}Tags`, t.tags.length ? t.tags.map((x) => `#${esc(x)}`).join(' ') : '—')}
        ${row(`${icon('move', 16)}From`, esc(from))}
        ${row('Reminder', esc(reminderLabel(t.reminder)))}
      </div>
      ${t.subtasks.length ? subtasksHTML(t, { readOnly: true }) : ''}
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-ro-restore>${icon('undo', 18)}Restore</button>
        <button class="btn btn-ghost danger" data-ro-delete>${archived ? 'Delete' : 'Delete forever'}</button>
      </div>
    </div>
  </div>`;
}

function bindReadOnly(t) {
  bindScrollShadow();
  /* leave the detail before acting, so the folder list is what re-renders */
  const toFolder = () => { UI.detailId = null; UI.screen = 'folders'; };
  app.querySelector('[data-back]').addEventListener('click', () => { toFolder(); rerender(); });
  app.querySelector('[data-ro-restore]').addEventListener('click', () => { toFolder(); restoreWithToast(t.id); });
  app.querySelector('[data-ro-delete]').addEventListener('click', async () => {
    if (t.status === 'archived') { toFolder(); deleteWithUndo(t.id); return; }
    if (await confirmDialog('Delete forever?', 'This task cannot be recovered afterwards.', { confirmLabel: 'Delete forever', danger: true })) {
      toFolder(); deleteForever(t.id);
    }
  });
}
