/* Add-task sheet. Rendered outside #app so re-renders never remove it. */

import { S, PRIORITIES, addTask, allTags as tagPool } from '../store.js';
import { daysFrom, fmtDue } from '../dates.js';
import { openSchedule } from './schedule.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

export function openSheet({ lane } = {}) {
  const draft = {
    listId: S.currentList, title: '', due: null, priority: 'none', tags: [], lane,
    start: null, dueTime: null, recur: 'none', reminder: null,
  };
  const allTags = tagPool();
  const dueOpts = [
    { label: 'Today', value: daysFrom(0) },
    { label: 'Tomorrow', value: daysFrom(1) },
    { label: 'Next week', value: daysFrom(7) },
  ];
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet" role="dialog" aria-label="New task">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">New task</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <input class="input sheet-title" placeholder="What needs doing?" autofocus>
    <div class="chip-group">
      <span class="microlabel">Due</span>
      <div class="chip-row" data-due>
        ${dueOpts.map((o) => `<button class="chip" data-val="${o.value}">${o.label}</button>`).join('')}
        <button class="chip" data-pick>Pick date…</button>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Priority</span>
      <div class="chip-row" data-priority>
        ${PRIORITIES.map((p) => `<button class="chip ${p === 'none' ? 'on' : ''}" data-val="${p}">${p === 'none' ? 'None' : { high: 'High', medium: 'Medium', low: 'Low' }[p]}</button>`).join('')}
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Tags</span>
      <div class="chip-row" data-tags>
        ${allTags.map((t) => `<button class="chip" data-val="${esc(t)}">#${esc(t)}</button>`).join('')}
        <button class="chip" data-addtag>+ Add tag</button>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Board</span>
      <div class="chip-row" data-list>
        ${S.lists.map((l) => `<button class="chip ${l.id === draft.listId ? 'on' : ''}" data-val="${l.id}">${esc(l.name)}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" data-submit>Add task</button>
  </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);
  q('.sheet-title').focus();

  const selectOne = (rowSel, chip) => {
    ov.querySelectorAll(`${rowSel} .chip`).forEach((c) => c.classList.remove('on'));
    chip?.classList.add('on');
  };
  q('[data-due]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    const resetSchedule = () => Object.assign(draft, { start: null, dueTime: null, recur: 'none', reminder: null });
    const pickChip = q('[data-pick]');
    if (chip.dataset.pick !== undefined) {
      openSchedule({
        schedule: draft,
        onSave: (sch) => {
          Object.assign(draft, sch);
          selectOne('[data-due]', draft.due ? chip : null);
          chip.textContent = draft.due
            ? fmtDue(draft.due, { dueTime: draft.dueTime }).label + (draft.recur !== 'none' ? ' ↻' : '')
            : 'Pick date…';
        },
        onRemove: () => { draft.due = null; resetSchedule(); selectOne('[data-due]', null); chip.textContent = 'Pick date…'; },
      });
      return;
    }
    resetSchedule();
    pickChip.textContent = 'Pick date…';
    if (chip.classList.contains('on')) { draft.due = null; selectOne('[data-due]', null); }
    else { draft.due = chip.dataset.val; selectOne('[data-due]', chip); }
  });
  q('[data-priority]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    draft.priority = chip.dataset.val;
    selectOne('[data-priority]', chip);
  });
  q('[data-tags]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    if (chip.dataset.addtag !== undefined) {
      const name = prompt('Tag name')?.trim().replace(/^#/, '');
      if (!name) return;
      draft.tags.push(name);
      const nc = document.createElement('button');
      nc.className = 'chip on';
      nc.dataset.val = name;
      nc.textContent = '#' + name;
      chip.before(nc);
      return;
    }
    chip.classList.toggle('on');
    const v = chip.dataset.val;
    draft.tags = chip.classList.contains('on')
      ? [...draft.tags, v] : draft.tags.filter((t) => t !== v);
  });
  q('[data-list]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    draft.listId = chip.dataset.val;
    selectOne('[data-list]', chip);
  });
  const submit = () => {
    draft.title = q('.sheet-title').value.trim();
    if (!draft.title) { q('.sheet-title').focus(); return; }
    close();
    S.currentList = draft.listId;
    addTask(draft);
  };
  q('[data-submit]').addEventListener('click', submit);
  q('.sheet-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
