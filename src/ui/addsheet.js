/* Add-task sheet. Rendered outside #app so re-renders never remove it. */

import { S, addTask, allTags as tagPool, laneName } from '../store.js';
import { daysFrom, fmtDue, RECUR_OPTIONS } from '../dates.js';
import { openSchedule } from './schedule.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import { pinToViewport } from './primitives.js';

/** openSheet({ lane, initial, fixedList, submitLabel, onSaved })
    initial: title / due / priority / tags to start from (action cards,
    PRD-meetings AC-08.5); fixedList: the board is shown but not changeable;
    onSaved(draft): called instead of addTask when given. */
export function openSheet({ lane, initial = null, fixedList = null, submitLabel = 'Add task', onSaved = null } = {}) {
  const draft = {
    listId: fixedList || S.currentList, title: '', due: null, priority: 'none', tags: [], lane,
    start: null, dueTime: null, recur: 'none', reminder: null,
    ...(initial ? { title: initial.title || '', due: initial.due || null, priority: initial.priority || 'none', tags: [...(initial.tags || [])] } : {}),
  };
  if (!S.priorities.some((p) => p.id === draft.priority)) draft.priority = 'none';
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
    <input class="input sheet-title" placeholder="What needs doing?" value="${esc(draft.title)}" autofocus>
    <div class="chip-group">
      <span class="microlabel">Due</span>
      <div class="chip-row" data-due>
        ${dueOpts.map((o) => `<button class="chip ${draft.due === o.value ? 'on' : ''}" data-val="${o.value}">${o.label}</button>`).join('')}
        <button class="chip ${draft.due && !dueOpts.some((o) => o.value === draft.due) ? 'on' : ''}" data-pick>${draft.due && !dueOpts.some((o) => o.value === draft.due) ? esc(fmtDue(draft.due).label) : 'Other date…'}</button>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Repeat</span>
      <div class="chip-row" data-recur>
        ${RECUR_OPTIONS.map(([v, l]) => `<button class="chip ${v === 'none' ? 'on' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Priority</span>
      <div class="chip-row" data-priority>
        ${[...S.priorities, { id: 'none', name: 'None' }].map((p) => `<button class="chip ${p.id === draft.priority ? 'on' : ''}" data-val="${p.id}">${esc(p.name)}</button>`).join('')}
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Tags</span>
      <div class="chip-row" data-tags>
        ${allTags.map((t) => `<button class="chip ${draft.tags.includes(t) ? 'on' : ''}" data-val="${esc(t)}">#${esc(t)}</button>`).join('')}
        <button class="chip" data-addtag>+ Add tag</button>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Board</span>
      <div class="chip-row" data-list>
        ${(fixedList ? S.lists.filter((l) => l.id === fixedList) : S.lists).map((l) => `<button class="chip ${l.id === draft.listId ? 'on' : ''}" data-val="${l.id}" ${fixedList ? 'disabled aria-disabled="true"' : ''}>${esc(l.name)}${fixedList && lane ? ` · ${esc(laneName(l.id, lane))}` : ''}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" data-submit>${esc(submitLabel)}</button>
  </div>`;
  document.body.appendChild(ov);
  const unpin = pinToViewport(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => { unpin(); ov.remove(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);
  q('.sheet-title').focus();

  const selectOne = (rowSel, chip) => {
    ov.querySelectorAll(`${rowSel} .chip`).forEach((c) => c.classList.remove('on'));
    chip?.classList.add('on');
  };
  const showRecur = () => selectOne('[data-recur]', q(`[data-recur] [data-val="${draft.recur}"]`));
  q('[data-due]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    const resetSchedule = () => Object.assign(draft, { start: null, dueTime: null, recur: 'none', reminder: null });
    const pickChip = q('[data-pick]');
    if (chip.dataset.pick !== undefined) {
      openSchedule({
        schedule: draft,
        done: draft.lane === 'done',
        onSave: (sch) => {
          Object.assign(draft, sch);
          selectOne('[data-due]', draft.due ? chip : null);
          chip.textContent = draft.due ? fmtDue(draft.due, { dueTime: draft.dueTime }).label : 'Other date…';
          showRecur();
        },
        onRemove: () => { draft.due = null; resetSchedule(); selectOne('[data-due]', null); chip.textContent = 'Other date…'; showRecur(); },
      });
      return;
    }
    const recur = draft.recur;           // a quick date keeps the repeat rule, clearing the date drops it
    resetSchedule();
    pickChip.textContent = 'Other date…';
    if (chip.classList.contains('on')) { draft.due = null; selectOne('[data-due]', null); }
    else { draft.due = chip.dataset.val; draft.recur = recur; selectOne('[data-due]', chip); }
    showRecur();
  });
  /* Repeat needs a date to count from: picking one without a due date sets it to today */
  q('[data-recur]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    draft.recur = chip.dataset.val;
    if (draft.recur !== 'none' && !draft.due) {
      draft.due = daysFrom(0);
      selectOne('[data-due]', q('[data-due] .chip'));
    }
    showRecur();
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
    const chip = e.target.closest('.chip'); if (!chip || fixedList) return;
    draft.listId = chip.dataset.val;
    selectOne('[data-list]', chip);
  });
  const submit = () => {
    draft.title = q('.sheet-title').value.trim();
    if (!draft.title) { q('.sheet-title').focus(); return; }
    close();
    if (onSaved) { onSaved(draft); return; }
    S.currentList = draft.listId;
    addTask(draft);
  };
  q('[data-submit]').addEventListener('click', submit);
  q('.sheet-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
