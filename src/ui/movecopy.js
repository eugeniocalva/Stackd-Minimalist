/* Board + Lane picker sheet shared by Move and Copy. */

import { S, lanesOf, validLane } from '../store.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

/** openMoveCopy({ mode: 'move'|'copy', task, onConfirm(listId, lane) }) */
export function openMoveCopy({ mode, task, onConfirm }) {
  const pick = { listId: task.listId, lane: task.lane };
  const isMove = mode === 'move';
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet" role="dialog" aria-label="${isMove ? 'Move to' : 'Copy to'}">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">${isMove ? 'Move to' : 'Copy to'}</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="chip-group">
      <span class="microlabel">Board</span>
      <div class="chip-row" data-board>
        ${S.lists.map((l) => `<button class="chip ${l.id === pick.listId ? 'on' : ''}" data-val="${l.id}">${esc(l.name)}</button>`).join('')}
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Lane</span>
      <div class="chip-row" data-lane></div>
    </div>
    <button class="btn btn-primary btn-block" data-confirm>${isMove ? 'Move' : 'Copy'}</button>
  </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);

  const confirmBtn = q('[data-confirm]');
  const refresh = () => {
    if (isMove) confirmBtn.disabled = pick.listId === task.listId && pick.lane === task.lane;
  };
  /* the lanes are the picked board's; a lane the new board lacks falls back to its first */
  const renderLanes = () => {
    pick.lane = validLane(pick.listId, pick.lane);
    q('[data-lane]').innerHTML = lanesOf(pick.listId)
      .map((l) => `<button class="chip ${l.id === pick.lane ? 'on' : ''}" data-val="${l.id}">${esc(l.name)}</button>`).join('');
  };
  const group = (sel, key, after) => q(sel).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    pick[key] = chip.dataset.val;
    q(sel).querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === chip));
    after?.();
    refresh();
  });
  group('[data-board]', 'listId', renderLanes);
  group('[data-lane]', 'lane');
  renderLanes();
  refresh();
  confirmBtn.addEventListener('click', () => { close(); onConfirm(pick.listId, pick.lane); });
}
