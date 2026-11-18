/* One board: list rows (mobile) / table (desktop), kanban, shared partials,
   row and card gestures. Gestures: double-tap complete, long-press or
   swipe-left delete, drag to reorder (manual sort), hold-and-drag kanban
   cards between lanes. */

import {
  S, UI, isDesktop, DONE_LANE, RETENTION_DAYS, TASK_SORTS, isManualSort, priorityById,
  listById, taskById, tasksOf, openCount, sortedTasks, lanesOf, laneName, laneTaskCount, canDeleteLane, laneHeir,
  reorderTask, moveToLane, addLane, renameLane, reorderLane, deleteLane, commit, rerender,
} from '../store.js';
import { bindHold } from './gestures.js';
import { sharedChipHTML, bindSharedChip } from './sharing.js';
import { fmtDue, fmtTime } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { openSheet } from './addsheet.js';
import { deleteWithUndo, completeTask } from './actions.js';
import { buzz } from '../haptics.js';
import { openSettings } from './settings.js';
import { confirmDialog, promptDialog, toast } from './primitives.js';
import { filterTasks } from '../search.js';
import { queryFor, searchToggleHTML, searchFieldHTML, bindSearch } from './search.js';

/** The board's tasks after sort and search (PRD-notes AC-08.2). */
export const visibleTasks = (listId) => filterTasks(sortedTasks(listId), UI.query);
/** Call before rendering a board's header: resets the query when the board changed. */
export const boardKey = () => queryFor(`list:${S.currentList}`);

/* — shared partials — */

/** The title of a top-level page. On mobile it is also the way out: the
    same chevron as on a board, and pressing it opens the main menu
    (PRD-improvements AC-06.1). Desktop has the sidebar, so a plain title. */
export function pageTitleHTML(label, aria = `${label}. Open the menu`) {
  return isDesktop.matches
    ? `<h1 class="page-title-text">${esc(label)}</h1>`
    : `<h1 class="page-title-h"><button class="page-title" data-lists aria-label="${esc(aria)}"><span>${esc(label)}</span>${icon('chevronDown')}</button></h1>`;
}
export function bindPageTitle() {
  app.querySelector('[data-lists]')?.addEventListener('click', () => { UI.screen = 'lists'; rerender(); });
}

export function viewbarHTML() {
  const short = TASK_SORTS.find(([v]) => v === S.sort)?.[2] || 'Sort';
  return `
  <div class="viewbar">
    <div class="segmented" role="tablist">
      <button class="seg ${S.view === 'list' ? 'active' : ''}" data-view="list">List</button>
      <button class="seg ${S.view === 'kanban' ? 'active' : ''}" data-view="kanban">Kanban</button>
    </div>
    <span class="sortwrap">
      <button class="sortbtn ${isManualSort() ? '' : 'on'}" data-sortbtn aria-haspopup="menu" aria-expanded="${!!UI.sortMenu}">${icon('sort')}${esc(short)}</button>
      ${UI.sortMenu ? `
      <div class="sortmenu" role="menu">
        ${TASK_SORTS.map(([v, label]) => `<button role="menuitemradio" aria-checked="${S.sort === v}" data-sort="${v}" class="${S.sort === v ? 'active' : ''}">${label}</button>`).join('')}
      </div>` : ''}
    </span>
  </div>`;
}

/** Rows and cards can be dragged into a new order only in manual sort on the full board. */
const canReorder = () => isManualSort() && !UI.query;

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
  const all = sortedTasks(S.currentList);    // the sort applies inside each lane
  const ts = filterTasks(all, UI.query);
  const lanes = lanesOf(S.currentList).map((lane) => {
    const cards = ts.filter((t) => t.lane === lane.id);
    const inLane = all.filter((t) => t.lane === lane.id).length;
    const isDone = lane.id === DONE_LANE;
    /* Done is fixed (PRD-improvements US-02): its name is text and it is
       neither dragged nor removed. The other lanes: tap the name to rename,
       hold the lane outside its cards to drag it, hold longer for the X. */
    return `
    <div class="lane ${isDone ? 'lane-fixed' : ''}" data-lane="${lane.id}">
      <div class="lane-head">
        ${isDone
          ? `<span class="lane-name">${esc(lane.name)}</span>`
          : `<button class="lane-name" data-lane-rename="${lane.id}" title="Rename" aria-label="Rename lane ${esc(lane.name)}" aria-keyshortcuts="Delete">${esc(lane.name)}</button>`}
        <span class="lane-count num">${UI.query ? `${cards.length} of ${inLane}` : cards.length}</span>
      </div>
      <div class="lane-cards">
        ${cards.map((t) => `
          <div class="kcard ${t.done ? 'done-card' : ''}" data-id="${t.id}" tabindex="0" role="group" aria-label="${esc(t.title)}" aria-keyshortcuts="Enter Delete">
            <div class="kcard-line">
              <input type="checkbox" aria-label="Toggle complete" class="check sm" ${t.done ? 'checked' : ''} data-id="${t.id}">
              <span class="t-title">${esc(t.title)}</span>
              ${t.done || !canReorder() ? '' : `<span class="grip" aria-hidden="true">${icon('grip')}</span>`}
            </div>
            ${t.done ? '' : taskMetaHTML(t)}
          </div>`).join('')}
        ${lane.id === DONE_LANE && S.lastAuto
          ? `<span class="lane-note">Moved here automatically · ${fmtTime(S.lastAuto)}</span>`
          : `<button class="addcard" data-lane-add="${lane.id}">+ Add card</button>`}
      </div>
    </div>`;
  }).join('');
  return `
  <div class="autoline">
    <span class="dot"></span>
    <span class="txt">Automation${desktop ? ':' : ' on —'} ${desktop ? 'marking a task complete moves its card' : 'completed tasks move'} to <strong>${esc(laneName(S.currentList, DONE_LANE))}</strong></span>
    ${desktop ? '<button class="edit" data-editrules>Edit rules</button>' : ''}
  </div>
  ${desktop ? '' : '<span class="hint board-hint">Hold a card to move it · keep holding to delete</span>'}
  <div class="board ${desktop ? 'cols3' : ''}">${lanes}
    <button class="lane-add" data-lane-new>${icon('plus', 18)}<span>Add lane</span></button>
  </div>`;
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
          ${t.done || !canReorder() ? '' : `<span class="grip" aria-hidden="true">${icon('grip')}</span>`}
          <button class="swipe-del" data-del aria-label="Delete" tabindex="-1">${icon('trash', 20)}</button>
        </div>`).join('')}
      </div>`
      : UI.query ? '' : '<p class="empty">No tasks yet. Tap + to add one.</p>'}
    </div>`;
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        <span class="title-with-chip">${pageTitleHTML(list.name, `${list.name}. Switch board`)}${sharedChipHTML(list)}</span>
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
  bindPageTitle();
  bindSharedChip(app);
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
  enabled: () => canReorder() && !t.done,
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
  app.querySelectorAll('.kcard').forEach((card) => {
    const t = taskById(card.dataset.id);
    bindCard(card, t);
    const grip = card.querySelector('.grip');
    if (grip) bindReorder(grip, card, {
      ...taskReorder(t, '.kcard'),
      /* only a card in the same lane is a drop target; the board order is shared across lanes */
      onDrop: (beforeId) => { if (taskById(beforeId)?.lane === t.lane) reorderTask(t.id, beforeId); },
    });
  });
  app.querySelectorAll('[data-lane-add]').forEach((b) =>
    b.addEventListener('click', () => openSheet({ lane: b.dataset.laneAdd })));
  app.querySelectorAll('[data-lane-rename]').forEach((b) => {
    b.addEventListener('click', () => editLaneName(b.dataset.laneRename));
    /* the keyboard way to remove a lane: Delete on its focused name */
    b.addEventListener('keydown', (e) => { if (e.key === 'Delete') { e.preventDefault(); confirmDeleteLane(b.dataset.laneRename); } });
  });
  app.querySelectorAll('.lane:not(.lane-fixed)').forEach(bindLane);
  app.querySelector('[data-lane-new]')?.addEventListener('click', async () => {
    const name = await promptDialog('New lane', { placeholder: 'Lane name', confirmLabel: 'Add' });
    if (name) addLane(S.currentList, name);
  });
  app.querySelector('[data-editrules]')?.addEventListener('click', () => openSettings('automations'));
}

/* Rename a lane in place: its name becomes a field. Enter or leaving the
   field saves, Esc cancels, an empty name keeps the old one. The board stays
   scrolled where it was, so a far lane does not jump out of view on save. */
function editLaneName(laneId) {
  const listId = S.currentList;
  const lane = lanesOf(listId).find((l) => l.id === laneId);
  const btn = [...app.querySelectorAll('[data-lane-rename]')].find((b) => b.dataset.laneRename === laneId);
  if (!lane || !btn || laneId === DONE_LANE) return;
  const input = document.createElement('input');
  input.className = 'lane-name lane-name-input';
  input.value = lane.name;
  input.autocomplete = 'off';
  input.enterKeyHint = 'done';
  input.setAttribute('aria-label', 'Lane name');
  btn.replaceWith(input);
  let closed = false;
  const finish = (save) => {
    if (closed) return;
    closed = true;
    const name = input.value.trim();
    if (!save || !name || name === lane.name) { input.replaceWith(btn); return; }
    const x = app.querySelector('.board')?.scrollLeft || 0;
    renameLane(listId, laneId, name);
    const board = app.querySelector('.board');
    if (board) board.scrollLeft = x;
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.focus(); input.select();
}

/* Lanes (PRD-improvements US-02, owner's review 2026-11-17). Hold a lane
   outside its cards to lift it and drop it between two others; Done stays
   last. Hold longer without moving and an X appears in its top right.
   Removing asks first: the lane's cards go to the leftmost other lane, or
   to Deleted when only Done would be left. */
function bindLane(lane) {
  const board = lane.closest('.board');
  const laneId = lane.dataset.lane;
  let target = null;           // the lane the dragged one goes in front of (Done for "at the end")
  const mark = (el) => {
    if (target === el) return;
    target?.classList.remove('lane-drop');
    target = el; target?.classList.add('lane-drop');
  };
  bindHold(lane, {
    ignore: '.kcard,.addcard,.lane-note,.lane-name-input',
    ghostClass: 'lane',
    canDrag: () => !UI.query,
    scroller: () => board,
    axis: 'x',
    onDragMove: (ev) => {
      const others = [...board.querySelectorAll('.lane')].filter((l) => l !== lane);
      mark(others.find((l) => { const r = l.getBoundingClientRect(); return ev.clientX < r.left + r.width / 2; })
        || others.find((l) => l.classList.contains('lane-fixed')) || null);
    },
    onDragEnd: () => { lane.dataset.dropBefore = target?.dataset.lane || ''; mark(null); },
    onDrop: () => {
      const before = lane.dataset.dropBefore; delete lane.dataset.dropBefore;
      const rest = lanesOf(S.currentList).filter((l) => l.id !== laneId && l.id !== DONE_LANE);
      const i = rest.findIndex((l) => l.id === before);
      reorderLane(S.currentList, laneId, i === -1 ? rest.length : i);
    },
    armButtons: () => [{ icon: 'x', label: `Remove lane ${laneName(S.currentList, laneId)}`, onClick: () => confirmDeleteLane(laneId) }],
  });
}

async function confirmDeleteLane(laneId) {
  const listId = S.currentList;
  if (!canDeleteLane(listId, laneId)) return;
  const name = laneName(listId, laneId);
  const n = laneTaskCount(listId, laneId);
  const heir = laneHeir(listId, laneId);
  const cards = `${n} card${n === 1 ? '' : 's'}`;
  const body = !n ? `${name} is empty.`
    : heir ? `Its ${cards} move to ${laneName(listId, heir)}.`
      : `Its ${cards} move to Deleted, where they stay for ${RETENTION_DAYS} days. Done is the only lane left on this board.`;
  if (!await confirmDialog(`Remove ${name}?`, body, { confirmLabel: 'Remove', danger: true })) return;
  buzz('MEDIUM');
  const r = deleteLane(listId, laneId);
  if (!r) return;
  toast(r.moved ? `Lane removed · ${r.moved} moved to ${laneName(listId, r.to)}` : r.binned ? `Lane removed · ${r.binned} moved to Deleted` : 'Lane removed');
}

/* ── Gestures ────────────────────────────────────────────────────────── */

/* The one row currently slid open to show a side button, and which side. */
let openRow = null, openSide = null;
const slideRow = (row, x) => { row.style.transform = x ? `translateX(${x}px)` : ''; };
function closeOpenRow() {
  if (!openRow) return;
  openRow.classList.remove('open');
  slideRow(openRow, 0);
  openRow = null; openSide = null;
}
document.addEventListener('pointerdown', (e) => {
  if (openRow && !openRow.contains(e.target)) closeOpenRow();
});

/* Where a pointer-down must not start a gesture: the row's own controls. */
const CONTROLS = '.check,.grip,.swipe-del,.swipe-add,input,textarea,select,.ac-hover,[contenteditable="true"]';

/** One swipe implementation for task rows and action cards (architecture
    §22). left / right: { sel, onAct } — the side button revealed by a swipe
    that way (its width sets the slide); tap / double tap / long-press are
    optional. A horizontal pull of more than 12 px starts the slide; past
    half the button it stays open; a tap on the open row closes it. */
export function bindSwipe(el, { left = null, right = null, onTap = null, onDoubleTap = null, onLongPress = null } = {}) {
  const leftEl = left ? el.querySelector(left.sel) : null;
  const rightEl = right ? el.querySelector(right.sel) : null;
  const wl = () => leftEl?.offsetWidth || 0, wr = () => rightEl?.offsetWidth || 0;
  const clamp = (x) => Math.max(-wl(), Math.min(wr(), x));
  let clickTimer = null, lpTimer = null, lpFired = false, sx = 0, sy = 0;
  let pressed = false, swiping = false, startX = 0; // pressed: the pointer went down on the row itself

  el.addEventListener('click', (e) => {
    if (e.target.closest(CONTROLS) || el.dataset.dragged) { delete el.dataset.dragged; return; }
    if (lpFired) { lpFired = false; return; }
    if (openRow === el) { closeOpenRow(); return; }
    if (!onDoubleTap) { onTap?.(e); return; }
    if (clickTimer) {
      clearTimeout(clickTimer); clickTimer = null;
      onDoubleTap();
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; onTap?.(e); }, 260);
    }
  });
  leftEl?.addEventListener('click', (e) => { e.stopPropagation(); closeOpenRow(); left.onAct(); });
  rightEl?.addEventListener('click', (e) => { e.stopPropagation(); closeOpenRow(); right.onAct(); });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest(CONTROLS)) return;
    sx = e.clientX; sy = e.clientY;
    pressed = true; swiping = false;
    startX = openRow === el ? (openSide === 'left' ? -wl() : wr()) : 0;
    if (onLongPress) {
      lpTimer = setTimeout(() => { lpTimer = null; lpFired = true; onLongPress(); }, 550);
    }
  });
  const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  const endSwipe = (e) => {
    cancelLp();
    pressed = false;
    if (!swiping) return;
    swiping = false;
    el.classList.remove('swiping');
    el.dataset.dragged = '1'; // the click that follows is not a tap
    const x = clamp(startX + e.clientX - sx);
    const side = x < -wl() / 2 && wl() ? 'left' : x > wr() / 2 && wr() ? 'right' : null;
    if (side) {
      if (openRow && openRow !== el) closeOpenRow();
      openRow = el; openSide = side; el.classList.add('open');
      slideRow(el, side === 'left' ? -wl() : wr());
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
      /* a clearly horizontal pull towards a side that has a button (or back from an open one) starts the swipe */
      const towards = dx < 0 ? leftEl : rightEl;
      if ((towards || openRow === el) && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiping = true;
        cancelLp();
        try { el.setPointerCapture(e.pointerId); } catch {}
        el.classList.add('swiping');
      }
      if (!swiping) return;
    }
    slideRow(el, clamp(startX + dx));
  });
}

/* Task rows: single tap → detail, double tap → complete, long-press → delete
   (soft, with Undo, with a haptic tick), swipe left → reveal a Delete button */
export function bindRowGestures(el, task) {
  bindSwipe(el, {
    left: { sel: '.swipe-del', onAct: () => { buzz('MEDIUM'); deleteWithUndo(task.id); } },
    onTap: () => openDetail(task.id),
    onDoubleTap: () => completeTask(task.id, el),
    onLongPress: () => { buzz('MEDIUM'); deleteWithUndo(task.id); },
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

/* kanban card (PRD-improvements US-03, US-04): tap → detail; mouse-drag or
   touch hold-drag → move lane; hold longer without moving → the delete
   badge, which asks before deleting. The press timing, the copy that follows
   the pointer and the sideways auto-scroll live in gestures.js. A focused
   card opens with Enter and asks to delete with Delete or Backspace. */
export function bindCard(card, task) {
  const board = card.closest('.board');
  let overLane = null, dropLane = null;
  bindHold(card, {
    ignore: '.check,.grip',
    ghostClass: 'kcard',
    canDrag: () => !UI.query,       // a filtered board does not lift cards (AC-08.2)
    scroller: () => board,
    axis: 'x',
    onTap: () => openDetail(task.id),
    onDragMove: (ev) => {
      const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lane') || null;
      if (overLane && overLane !== lane) overLane.classList.remove('dropover');
      overLane = lane;
      lane?.classList.add('dropover');
    },
    onDragEnd: () => { overLane?.classList.remove('dropover'); dropLane = overLane; overLane = null; },
    onDrop: () => {
      const to = dropLane?.dataset.lane;
      dropLane = null;
      if (!to || to === task.lane) return;
      /* a recurring card dropped on Done rolls forward and stays in its lane */
      if (to === DONE_LANE && task.recur !== 'none' && task.due) completeTask(task.id);
      else moveToLane(task.id, to);
    },
    armButtons: () => [{ icon: 'x', label: `Delete card: ${task.title}`, onClick: () => confirmDeleteCard(task) }],
  });
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter') openDetail(task.id);
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); confirmDeleteCard(task); }
  });
}

async function confirmDeleteCard(task) {
  const ok = await confirmDialog(`Delete “${task.title}”?`,
    `It moves to Deleted and is removed for good after ${RETENTION_DAYS} days.`, { confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  buzz('MEDIUM');
  deleteWithUndo(task.id);
}
