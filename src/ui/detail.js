/* Task detail (2d): subtasks with progress, reminder preset, delete. */

import {
  S, UI, REMINDERS, taskById, listById, toggleDone, deleteTask, commit, rerender,
} from '../store.js';
import { fmtDue } from '../dates.js';
import { esc, app, uid } from '../util.js';
import { mobileListHTML } from './board.js';

export function detailHTML() {
  const t = taskById(UI.detailId);
  if (!t) { UI.screen = 'list'; return mobileListHTML(); }
  const list = listById(t.listId);
  const done = t.subtasks.filter((s) => s.done).length;
  const pct = t.subtasks.length ? (done / t.subtasks.length) * 100 : 0;
  const tags = [];
  if (t.due) tags.push(`<span class="tag ${fmtDue(t.due).cls}">${esc(fmtDue(t.due, { full: true }).label)}</span>`);
  if (t.priority !== 'none') tags.push(`<span class="tag tag-outline">${{ high: 'High', medium: 'Medium', low: 'Low' }[t.priority]} priority</span>`);
  tags.push(`<span class="tag tag-neutral">${esc(list.name)}</span>`);
  t.tags.forEach((tag) => tags.push(`<span class="tag tag-neutral">#${esc(tag)}</span>`));
  return `
  <div class="screen detail-screen">
    <div class="detail-top">
      <button class="backlink" data-back>‹ ${esc(list.name)}</button>
      <span style="font-size:14px;color:var(--ink-55)">···</span>
    </div>
    <div class="detail-head">
      <div class="detail-title-row">
        <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
        <h2>${esc(t.title)}</h2>
      </div>
      <div class="detail-tags">${tags.join('')}</div>
    </div>
    <div class="seam head-seam"></div>
    <div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
      <div class="subhead">
        <span class="label">Subtasks</span>
        <span class="count num">${done} / ${t.subtasks.length}</span>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="subrows">
        ${t.subtasks.map((s) => `
        <div class="subrow ${s.done ? 'done' : ''}">
          <input type="checkbox" aria-label="Toggle complete" class="check sm" ${s.done ? 'checked' : ''} data-sub="${s.id}">
          <span class="s-title">${esc(s.title)}</span>
          <button class="s-del" data-subdel="${s.id}" aria-label="Delete subtask">✕</button>
        </div>`).join('')}
        <div class="subrow">
          <span class="addsub-dot"></span>
          <input class="addsub-input" placeholder="Add subtask…">
        </div>
      </div>
      <div class="seam" style="margin:8px 20px 0"></div>
      <div class="kv-row">
        <span>Reminder</span>
        <button class="val" data-reminder>${esc(t.reminder)} ▾</button>
      </div>
    </div>
    <div class="detail-footer">
      <button class="btn btn-ghost btn-block danger" data-del>Delete task</button>
    </div>
  </div>`;
}

export function bindDetail() {
  const t = taskById(UI.detailId);
  if (!t) { rerender(); return; }
  app.querySelector('[data-back]').addEventListener('click', () => { UI.screen = 'list'; rerender(); });
  app.querySelector('.detail-title-row .check').addEventListener('change', () => toggleDone(t.id));
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
  app.querySelector('[data-reminder]').addEventListener('click', () => {
    t.reminder = REMINDERS[(REMINDERS.indexOf(t.reminder) + 1) % REMINDERS.length];
    commit();
  });
  app.querySelector('[data-del]').addEventListener('click', () => {
    if (confirm(`Delete "${t.title}"?`)) deleteTask(t.id);
  });
}
