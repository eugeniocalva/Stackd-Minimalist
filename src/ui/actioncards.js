/* Action cards (PRD-meetings US-08): the actions the minutes proposed, one
   card each with an editable title, due and priority chips and the
   transcript excerpt they came from. Swipe left → Delete (Undo); swipe
   right → the board icon → the board + lane picker → the task sheet,
   prefilled → Save. An added card stays, muted, with a link to its task.
   On desktop the same two actions sit in a hover row. */

import {
  S, listById, laneName, taskById, firstLane, meetingById, actionCounts,
  editAction, dismissAction, restoreAction, addActionToBoard, commit,
} from '../store.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import { bindSwipe, dueChipHTML, priorityTagHTML, openDetail } from './board.js';
import { openMoveCopy } from './movecopy.js';
import { openSheet } from './addsheet.js';
import { toast } from './primitives.js';
import { buzz } from '../haptics.js';

const where = (t) => `${listById(t.listId)?.name || 'Deleted board'} · ${laneName(t.listId, t.lane)}`;

function cardHTML(a) {
  if (a.status === 'added') {
    const t = taskById(a.taskId);
    return `
    <div class="row acard is-added" data-action="${a.id}" role="listitem">
      <span class="ac-check" aria-hidden="true">${icon('check', 16)}</span>
      <div class="t-main">
        <span class="t-title">${esc(a.title)}</span>
        ${t ? `<button type="button" class="ac-where" data-open-task="${t.id}">Added to ${esc(where(t))}${icon('chevronRight', 14)}</button>`
          : '<span class="ac-where muted">Task removed</span>'}
      </div>
      <button type="button" class="icon-btn ac-x" data-remove aria-label="Remove this card (the task stays)">${icon('x', 18)}</button>
    </div>`;
  }
  const chips = [
    a.due ? dueChipHTML({ due: a.due, dueTime: null, recur: 'none' }, { prefix: true }) : '',
    a.priority !== 'none' ? priorityTagHTML({ priority: a.priority }) : '',
  ].filter(Boolean).join('');
  return `
  <div class="row acard" data-action="${a.id}" role="listitem">
    <button type="button" class="swipe-add" data-add aria-label="Add to a board">${icon('board', 22)}</button>
    <div class="t-main">
      <input class="ac-title" data-title value="${esc(a.title)}" aria-label="Action" maxlength="200" autocomplete="off">
      ${chips ? `<div class="t-meta">${chips}</div>` : ''}
      ${a.excerpt ? `<p class="ac-excerpt">“${esc(a.excerpt)}”</p>` : ''}
    </div>
    <div class="ac-hover">
      <button type="button" class="icon-btn" data-add-btn aria-label="Add to a board" title="Add to a board">${icon('board', 18)}</button>
      <button type="button" class="icon-btn danger" data-del-btn aria-label="Delete this action" title="Delete">${icon('x', 18)}</button>
    </div>
    <button type="button" class="swipe-del" data-del aria-label="Delete" tabindex="-1">${icon('trash', 20)}</button>
  </div>`;
}

export function actionsHTML(m) {
  if (!m.minutes) return '';
  const shown = m.actions.filter((a) => a.status !== 'dismissed');
  const { proposed, added } = actionCounts(m);
  const head = proposed + added
    ? `${proposed + added} action${proposed + added === 1 ? '' : 's'}${added ? ` · ${added} added` : ''}`
    : 'No actions found';
  return `
  <section class="mblock" data-block="actions" aria-label="Actions">
    <div class="mblock-head">
      <span class="section-title">Actions</span>
      <span class="hint">${head}</span>
    </div>
    ${shown.length
      ? `<div class="card list-card acards" role="list">${shown.map(cardHTML).join('')}</div>
         <span class="hint acards-hint">Swipe right to add to a board · swipe left to delete</span>`
      : '<p class="empty">No actions found.</p>'}
  </section>`;
}

/* ── Flows ───────────────────────────────────────────────────────────── */

function del(m, a) {
  const prev = dismissAction(m.id, a.id);
  if (!prev) return;
  toast('Action removed', { action: { label: 'Undo', onClick: () => restoreAction(m.id, a.id, prev) } });
}

/** Swipe right / board icon: picker → prefilled task sheet → Save (AC-08.4 – 08.6). */
function toBoard(m, a) {
  openMoveCopy({
    mode: 'add', title: 'Add to board', listId: S.currentList, lane: firstLane(S.currentList),
    onConfirm: (listId, lane) => openSheet({
      initial: { title: a.title, due: a.due, priority: a.priority },
      fixedList: listId, lane, submitLabel: 'Save',
      onSaved: (draft) => {
        const t = addActionToBoard(m.id, a.id, draft);
        if (t) toast(`Added to ${where(t)}`, { action: { label: 'Open', onClick: () => { S.currentList = t.listId; commit(); openDetail(t.id); } } });
      },
    }),
  });
}

export function bindActions(root, meetingId) {
  const m = meetingById(meetingId);
  if (!m) return;
  root.querySelectorAll('.acard').forEach((el) => {
    const a = m.actions.find((x) => x.id === el.dataset.action);
    if (!a) return;
    if (a.status === 'added') {
      el.querySelector('[data-open-task]')?.addEventListener('click', () => {
        const t = taskById(a.taskId); if (!t) return;
        if (t.status === 'active') S.currentList = t.listId;
        commit(); openDetail(t.id);
      });
      el.querySelector('[data-remove]').addEventListener('click', () => del(m, a));
      return;
    }
    const title = el.querySelector('[data-title]');
    let timer = null;
    const flush = () => { if (!timer) return; clearTimeout(timer); timer = null; editAction(m.id, a.id, { title: title.value }); };
    title.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(flush, 500); });
    title.addEventListener('blur', flush);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    el.querySelector('[data-del-btn]').addEventListener('click', () => { flush(); del(m, a); });
    el.querySelector('[data-add-btn]').addEventListener('click', () => { flush(); toBoard(m, a); });
    bindSwipe(el, {
      left: { sel: '.swipe-del', onAct: () => { buzz('MEDIUM'); flush(); del(m, a); } },
      right: { sel: '.swipe-add', onAct: () => { flush(); toBoard(m, a); } },
      onTap: () => title.focus(),
    });
  });
}
