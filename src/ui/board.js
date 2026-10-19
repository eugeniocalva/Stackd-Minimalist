/* One board: list rows (mobile) / table (desktop), kanban, shared partials,
   row and card gestures. Gestures: double-tap complete, long-press or
   swipe-left delete, drag to reorder (manual sort), hold-and-drag kanban
   cards between lanes. */

import {
  S, UI, LANES, priorityById,
  listById, taskById, tasksOf, openCount, sortedTasks,
  reorderTask, moveToLane, commit, rerender,
} from '../store.js';
import { fmtDue, fmtTime } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { openSheet } from './addsheet.js';
import { deleteWithUndo, completeTask } from './actions.js';
import { buzz } from '../haptics.js';
import { openSettings } from './settings.js';
import { filterTasks } from '../search.js';
import { queryFor, searchToggleHTML, searchFieldHTML, bindSearch } from './search.js';

/** The board's tasks after sort and search (PRD-notes AC-08.2). */
export const visibleTasks = (listId) => filterTasks(sortedTasks(listId), UI.query);
/** Call before rendering a board's header: resets the query when the board changed. */
export const boardKey = () => queryFor(`list:${S.currentList}`);

/* — shared partials — */

export function viewbarHTML() {
  const sortLabels = { manual: 'Sort', due: 'Due date', priority: 'Priority' };
  return `
  <div class="viewbar">
    <div class="segmented" role="tablist">
      <button class="seg ${S.view === 'list' ? 'active' : ''}" data-view="list">List</button>
      <button class="seg ${S.view === 'kanban' ? 'active' : ''}" data-view="kanban">Kanban</button>
    </div>
    <span class="sortwrap">
      <button class="sortbtn ${S.sort !== 'manual' ? 'on' : ''}" data-sortbtn>${icon('sort')}${esc(sortLabels[S.sort])}</button>
      ${UI.sortMenu ? `
      <div class="sortmenu">
        <button data-sort="manual" class="${S.sort === 'manual' ? 'active' : ''}">Manual</button>
        <button data-sort="due" class="${S.sort === 'due' ? 'active' : ''}">Due date</button>
        <button data-sort="priority" class="${S.sort === 'priority' ? 'active' : ''}">Priority</button>
      </div>` : ''}
    </span>
  </div>`;
}

/** Priority chip in the level's colour; '' for none or a deleted level. */
export function priorityTagHTML(t) {
  const p = priorityById(t.priority);
  return p ? `<span class="tag pc pc-${p.color}">${esc(p.name)}</span>` : '';
}

export function taskMetaHTML(t) {
  const bits = [];
  if (t.due) bits.push(dueChipHTML(t, { prefix: true }));
  if (priorityById(t.priority)) bits.push(priorityTagHTML(t));
  t.tags.forEach((tag) => bits.push(`<span class="tag">#${esc(tag)}</span>`));
  if (t.subtasks.length) {
    const done = t.subtasks.filter((s) => s.done).length;
    bits.push(`<span class="t-sub num">${done}/${t.subtasks.length} subtasks</span>`);
  }
  return bits.length ? `<div class="t-meta">${bits.join('')}</div>` : '';
}

/** Due chip: label (+ time), tone, and a repeat glyph for recurring tasks. */
export function dueChipHTML(t, { prefix = false } = {}) {
  const d = fmtDue(t.due, { dueTime: t.dueTime });
  const lead = prefix && d.days <= 3 && d.days >= 2 ? 'Due ' : '';
  const rep = t.recur !== 'none' ? `<span class="repeat" aria-label="Repeats ${t.recur}">${icon('repeat', 11)}</span>` : '';
  return `<span class="tag ${d.cls}">${lead}${esc(d.label)}${rep}</span>`;
}

export function kanbanHTML({ desktop = false } = {}) {
  boardKey();
  const all = tasksOf(S.currentList);
  const ts = filterTasks(all, UI.query);
  const lanes = LANES.map((lane) => {
    const cards = ts.filter((t) => t.lane === lane.id);
    const inLane = all.filter((t) => t.lane === lane.id).length;
    const headCls = lane.id === 'inprogress' ? 'active' : lane.id === 'done' ? 'muted' : '';
    return `
    <div class="lane" data-lane="${lane.id}">
      <div class="lane-head ${headCls}">
        <span class="lane-name">${lane.name}</span>
        <span class="lane-count num">${UI.query ? `${cards.length} of ${inLane}` : cards.length}</span>
      </div>
      <div class="lane-cards">
        ${cards.map((t) => `
          <div class="kcard ${t.done ? 'done-card' : ''}" data-id="${t.id}">
            <div class="kcard-line">
              <input type="checkbox" aria-label="Toggle complete" class="check sm" ${t.done ? 'checked' : ''} data-id="${t.id}">
              <span class="t-title">${esc(t.title)}</span>
            </div>
            ${t.done ? '' : taskMetaHTML(t)}
          </div>`).join('')}
        ${lane.id === 'done' && S.lastAuto
          ? `<span class="lane-note">Moved here automatically · ${fmtTime(S.lastAuto)}</span>`
          : `<button class="addcard" data-lane-add="${lane.id}">+ Add card</button>`}
      </div>
    </div>`;
  }).join('');
  return `
  <div class="autoline">
    <span class="dot"></span>
    <span class="txt">Automation${desktop ? ':' : ' on —'} ${desktop ? 'marking a task complete moves its card' : 'completed tasks move'} to <strong>Done</strong></span>
    ${desktop ? '<button class="edit" data-editrules>Edit rules</button>' : ''}
  </div>
  ${desktop ? '' : '<span class="hint board-hint">Swipe for more lanes · hold a card to move it</span>'}
  <div class="board ${desktop ? 'cols3' : ''}">${lanes}</div>`;
}

/* — mobile: board screen — */

export function mobileListHTML() {
  boardKey();
  const list = listById(S.currentList);
  const ts = visibleTasks(S.currentList);
  const total = tasksOf(S.currentList).length;
  const headCount = UI.query ? `${ts.length} of ${total} task${total === 1 ? '' : 's'}`
    : S.view === 'kanban' ? `${total} tasks` : `${openCount(S.currentList)} open`;
  const field = searchFieldHTML({ placeholder: 'Search tasks' });
  const body = S.view === 'kanban' ? kanbanHTML() : `
    <div class="scroll-area">
      ${!ts.length && UI.query ? `<p class="empty">No tasks match “${esc(UI.query)}”.</p>` : ''}
      ${ts.length ? `
      <span class="hint list-hint">Double-tap to complete · long-press or swipe left to delete</span>
      <div class="card list-card">
        ${ts.map((t) => `
        <div class="row trow ${t.done ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
          <div class="t-main">
            <span class="t-title">${esc(t.title)}</span>
            ${t.done ? '' : taskMetaHTML(t)}
          </div>
          ${t.done || UI.query ? '' : `<span class="grip" aria-hidden="true">${icon('grip')}</span>`}
          <button class="swipe-del" data-del aria-label="Delete" tabindex="-1">${icon('trash', 20)}</button>
        </div>`).join('')}
      </div>`
      : UI.query ? '' : '<p class="empty">No tasks yet. Tap + to add one.</p>'}
    </div>`;
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        <button class="page-title" data-lists aria-label="Switch board"><span>${esc(list.name)}</span>${icon('chevronDown')}</button>
        <span class="head-right"><span class="kicker">${headCount}</span>${searchToggleHTML()}</span>
      </div>
      ${viewbarHTML()}
      ${field ? `<div class="search-row">${field}</div>` : ''}
    </header>
    ${body}
  </div>`;
}

export function bindMobileList() {
  bindViewbar();
  bindSearch(app);
  bindScrollShadow();
  app.querySelector('[data-lists]').addEventListener('click', () => { UI.screen = 'lists'; rerender(); });
  bindChecks();
  app.querySelectorAll('.trow').forEach((row) => {
    const t = taskById(row.dataset.id);
    bindRowGestures(row, t);
    const grip = row.querySelector('.grip');
    if (grip) bindReorder(grip, row, taskReorder(t, '.trow'));
  });
  bindKanban();
}

/* — desktop: table — */

export function desktopTableHTML() {
  boardKey();
  const ts = visibleTasks(S.currentList);
  return `
  <div class="quickadd">
    <input class="input" placeholder="Add a task — press Enter" data-quickadd>
    <button class="btn btn-primary" data-quickadd-btn>Add</button>
  </div>
  <div class="card table-card">
    <div class="tgrid tgrid-head">
      <span></span><span>Task</span><span>Due</span><span>Priority</span><span>Subtasks</span>
    </div>
    ${ts.map((t) => {
      const sub = t.subtasks.length
        ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : null;
      return `
      <div class="tgrid tgrid-row ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
        <span class="t-title">${esc(t.title)}</span>
        ${t.done ? '<span></span><span></span><span></span>' : `
        ${t.due ? dueChipHTML(t) : '<span class="cell-muted">—</span>'}
        ${priorityTagHTML(t) || '<span class="cell-muted">—</span>'}
        ${sub ? `<span class="cell-num num">${sub}</span>` : '<span class="cell-muted">—</span>'}`}
      </div>`;
    }).join('')}
    ${ts.length ? '' : `<p class="empty">${UI.query ? `No tasks match “${esc(UI.query)}”.` : 'No tasks yet. Add one above.'}</p>`}
  </div>
  <span class="hint">${UI.query ? 'Clear the search to reorder' : 'Drag rows to reprioritize'} · double-click a task to complete</span>`;
}

/** bindReorder options for a task row: manual sort only, never a done task,
    never while a search narrows the list. */
export const taskReorder = (t, rowSel) => ({
  rowSel,
  enabled: () => S.sort === 'manual' && !t.done && !UI.query,
  onDrop: (beforeId) => reorderTask(t.id, beforeId),
});

/* — shared bindings — */

export function bindViewbar() {
  app.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => { S.view = b.dataset.view; commit(); }));
  app.querySelector('[data-sortbtn]')?.addEventListener('click', () => {
    UI.sortMenu = !UI.sortMenu; rerender();
  });
  app.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      S.sort = b.dataset.sort; UI.sortMenu = false; commit();
    }));
}

/* Sticky header gets a hairline + shadow once the content scrolls under it. */
export function bindScrollShadow() {
  const head = app.querySelector('.page-head');
  const area = app.querySelector('.scroll-area');
  if (!head || !area) return;
  area.addEventListener('scroll', () => head.classList.toggle('is-scrolled', area.scrollTop > 2), { passive: true });
}

export function bindChecks() {
  app.querySelectorAll('.check[data-id]').forEach((c) => {
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('change', () => completeTask(c.dataset.id, c.closest('.trow,.tgrid-row,.kcard')));
  });
}

export function bindKanban() {
  app.querySelectorAll('.kcard').forEach((card) => bindCard(card, taskById(card.dataset.id)));
  app.querySelectorAll('[data-lane-add]').forEach((b) =>
    b.addEventListener('click', () => openSheet({ lane: b.dataset.laneAdd })));
  app.querySelector('[data-editrules]')?.addEventListener('click', () => openSettings('automations'));
}

/* ── Gestures ────────────────────────────────────────────────────────── */

/* The one list row currently slid open to show its Delete button. */
let openRow = null;
const slideRow = (row, x) => { row.style.transform = x ? `translateX(${x}px)` : ''; };
function closeOpenRow() {
  if (!openRow) return;
  openRow.classList.remove('open');
  slideRow(openRow, 0);
  openRow = null;
}
document.addEventListener('pointerdown', (e) => {
  if (openRow && !openRow.contains(e.target)) closeOpenRow();
});

/* single tap → detail, double tap → complete, long-press → delete (soft, with
   Undo, with a haptic tick), swipe left → reveal a Delete button */
export function bindRowGestures(el, task) {
  let clickTimer = null, lpTimer = null, lpFired = false, sx = 0, sy = 0;
  const del = el.querySelector('.swipe-del');
  const openWidth = () => del?.offsetWidth || 0; // the button starts at the card's edge; slide it fully in
  let pressed = false, swiping = false, startX = 0; // pressed: the pointer went down on the row itself

  el.addEventListener('click', (e) => {
    if (e.target.closest('.check,.grip,.swipe-del') || el.dataset.dragged) { delete el.dataset.dragged; return; }
    if (lpFired) { lpFired = false; return; }
    if (openRow === el) { closeOpenRow(); return; }
    if (clickTimer) {
      clearTimeout(clickTimer); clickTimer = null;
      completeTask(task.id, el);
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; openDetail(task.id); }, 260);
    }
  });
  del?.addEventListener('click', (e) => {
    e.stopPropagation();
    buzz('MEDIUM');
    closeOpenRow();
    deleteWithUndo(task.id);
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.check,.grip,.swipe-del')) return;
    sx = e.clientX; sy = e.clientY;
    pressed = true; swiping = false; startX = openRow === el ? -openWidth() : 0;
    lpTimer = setTimeout(() => {
      lpTimer = null; lpFired = true;
      buzz('MEDIUM');
      deleteWithUndo(task.id);
    }, 550);
  });
  const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  const endSwipe = (e) => {
    cancelLp();
    pressed = false;
    if (!swiping) return;
    swiping = false;
    el.classList.remove('swiping');
    el.dataset.dragged = '1'; // the click that follows is not a tap
    const w = openWidth();
    const x = Math.max(-w, Math.min(0, startX + e.clientX - sx));
    if (w && x < -w / 2) {
      if (openRow && openRow !== el) closeOpenRow();
      openRow = el; el.classList.add('open'); slideRow(el, -w);
    } else if (openRow === el) closeOpenRow();
    else slideRow(el, 0);
  };
  el.addEventListener('pointerup', endSwipe);
  el.addEventListener('pointercancel', endSwipe);
  el.addEventListener('pointermove', (e) => {
    if (!pressed) return; // a grip drag or checkbox press bubbling through
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!swiping) {
      if (lpTimer && Math.hypot(dx, dy) > 10) cancelLp();
      /* a clearly horizontal pull on a row that can be deleted starts the swipe */
      if (del && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiping = true;
        cancelLp();
        try { el.setPointerCapture(e.pointerId); } catch {}
        el.classList.add('swiping');
      }
      if (!swiping) return;
    }
    const w = openWidth();
    slideRow(el, Math.max(-w, Math.min(0, startX + dx)));
  });
}

export function openDetail(id) {
  if (!taskById(id)) return;
  UI.detailId = id; UI.screen = 'detail'; rerender();
}

/* Drag a row (via a handle or the row itself) to reorder. Shared by task rows
   and note rows: { rowSel, enabled(), onDrop(beforeId) }. */
export function bindReorder(dragEl, rowEl, { rowSel, enabled = () => true, onDrop }) {
  dragEl.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    if (dragEl === rowEl && e.target.closest('.check')) return;
    let dragging = false, over = null;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const threshold = dragEl === rowEl ? 8 : 4;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > threshold) {
        dragging = true;
        try { dragEl.setPointerCapture(pid); } catch {}
        rowEl.classList.add('dragging');
        rowEl.dataset.dragged = '1';
      }
      if (!dragging) return;
      ev.preventDefault();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(rowSel);
      if (over && over !== target) over.classList.remove('dropover');
      over = target && target !== rowEl ? target : null;
      if (over) over.classList.add('dropover');
    };
    const up = () => {
      dragEl.removeEventListener('pointermove', move);
      dragEl.removeEventListener('pointercancel', up);
      rowEl.classList.remove('dragging');
      over?.classList.remove('dropover');
      if (dragging && over) onDrop(over.dataset.id);
    };
    dragEl.addEventListener('pointermove', move);
    dragEl.addEventListener('pointerup', up, { once: true });
    dragEl.addEventListener('pointercancel', up);
    if (dragEl !== rowEl) e.preventDefault(); // grip: don't scroll
  });
  if (dragEl !== rowEl) dragEl.style.touchAction = 'none';
}

/* kanban card: tap → detail; mouse-drag or touch hold-drag → move lane */
export function bindCard(card, task) {
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.check')) return;
    let dragging = false, overLane = null, held = false;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const isTouch = e.pointerType === 'touch';
    const canDrag = !UI.query;      // a filtered board is tap-only (AC-08.2)
    const holdTimer = isTouch && canDrag ? setTimeout(() => { held = true; startDrag(); }, 350) : null;
    const startDrag = () => {
      dragging = true;
      try { card.setPointerCapture(pid); } catch {}
      card.classList.add('dragging');
    };
    const blockScroll = (ev) => { if (dragging) ev.preventDefault(); };
    card.addEventListener('touchmove', blockScroll, { passive: false });
    const move = (ev) => {
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!dragging && !isTouch && dist > 8 && canDrag) startDrag();
      if (!dragging) { if (isTouch && dist > 10 && holdTimer) clearTimeout(holdTimer); return; }
      const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lane');
      if (overLane && overLane !== lane) overLane.classList.remove('dropover');
      overLane = lane;
      lane?.classList.add('dropover');
    };
    const up = () => {
      if (holdTimer) clearTimeout(holdTimer);
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointercancel', up);
      card.removeEventListener('touchmove', blockScroll);
      card.classList.remove('dragging');
      overLane?.classList.remove('dropover');
      if (dragging && overLane && overLane.dataset.lane !== task.lane) {
        /* a recurring card dropped on Done rolls forward and snaps back */
        if (overLane.dataset.lane === 'done' && task.recur !== 'none' && task.due) { rerender(); completeTask(task.id); }
        else moveToLane(task.id, overLane.dataset.lane);
      } else if (!dragging && !held) {
        openDetail(task.id);
      } else if (dragging) rerender();
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up, { once: true });
    card.addEventListener('pointercancel', up);
  });
}
