/* Task detail: subtasks with progress, reminder preset, delete. */

import {
  S, UI, REMINDERS, taskById, listById, toggleDone, deleteTask, commit, rerender,
} from '../store.js';
import { fmtDue } from '../dates.js';
import { esc, app, uid } from '../util.js';
import { icon } from './icons.js';
import { mobileListHTML, bindScrollShadow } from './board.js';

export function detailHTML() {
  const t = taskById(UI.detailId);
  if (!t) { UI.screen = 'list'; return mobileListHTML(); }
  const list = listById(t.listId);
  const done = t.subtasks.filter((s) => s.done).length;
  const pct = t.subtasks.length ? (done / t.subtasks.length) * 100 : 0;
  const tags = [];
  if (t.due) tags.push(`<span class="tag ${fmtDue(t.due).cls}">${esc(fmtDue(t.due, { full: true }).label)}</span>`);
  if (t.priority !== 'none') tags.push(`<span class="tag tag-${t.priority}">${{ high: 'High', medium: 'Medium', low: 'Low' }[t.priority]} priority</span>`);
  tags.push(`<span class="tag">${esc(list.name)}</span>`);
  t.tags.forEach((tag) => tags.push(`<span class="tag">#${esc(tag)}</span>`));
  return `
  <div class="screen detail-screen">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to ${esc(list.name)}">${icon('chevronLeft')}</button>
      <span class="kicker">${esc(list.name)}</span>
      <button class="icon-btn" data-more aria-label="More actions">${icon('more')}</button>
    </header>
    <div class="scroll-area">
      <div class="detail-head">
        <div class="detail-title-row">
          <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
          <h1 class="detail-title">${esc(t.title)}</h1>
        </div>
        <div class="detail-tags">${tags.join('')}</div>
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
      <div class="card">
        <div class="kv-row">
          <span class="kv-label">Reminder</span>
          <button class="kv-val" data-reminder>${esc(t.reminder)}${icon('chevronDown', 16)}</button>
        </div>
      </div>
      <button class="btn btn-ghost btn-block danger" data-del>Delete task</button>
    </div>
  </div>`;
}

export function bindDetail() {
  const t = taskById(UI.detailId);
  if (!t) { rerender(); return; }
  bindScrollShadow();
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
