/* Notes screen (PRD-notes US-01 – US-03): sticky header, the composer at the
   top, and the flat list of notes under it. The composer draft lives in this
   module and in localStorage under its own key: leaving the screen, the app
   or the composer never adds or discards it (AC-02.10). Sort menu: Phase 9;
   search and tag filter: Phase 10; opening a note: Phase 8. */

import {
  S, UI, NOTES_SORTS, sortedNotes, activeNotes, addNote, loadDraft, saveDraft, blankDraft,
  checklistProgress, noteTitle, setNotesSort, reorderNote, rerender,
} from '../store.js';
import { fmtDateOrRelative } from '../dates.js';
import { firstLine, isEmpty } from '../richtext.js';
import { esc, app, uid } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow, bindReorder } from './board.js';
import { toast } from './primitives.js';
import { editorHTML, bindEditor, colorBarHTML, colorName } from './noteeditor.js';
import { openNote } from './notedetail.js';
import { filterNotes } from '../search.js';
import { queryFor, searchOpen, searchToggleHTML, searchFieldHTML, bindSearch } from './search.js';

let draft = loadDraft() || blankDraft();
let saveTimer = null;
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveDraft(draft), 300); };
const persistNow = () => { clearTimeout(saveTimer); saveDraft(draft); };
let editor = null;

export function openNotes() {
  UI.screen = 'notes'; UI.query = ''; UI.tagFilter = null; UI.sortMenu = false;
  UI.composer.expanded = false;     // coming back shows the draft collapsed (AC-02.10)
  rerender();
}

/* ── Composer state ──────────────────────────────────────────────────── */

/** target: 'body' | 'title' | 'checklist' */
function expand(target = 'body') {
  if (target === 'checklist') {
    if (!draft.checklist) { draft.checklist = [{ id: uid(), text: '', done: false }]; persist(); }
    target = `ci:${draft.checklist[0].id}`;
  }
  if (UI.composer.expanded) { editor?.focus(target); return; }
  UI.composer.expanded = true;
  UI.composer.focus = target;
  rerender();                       // the mobile nav hides while the composer is open
}

function collapse() {
  if (!UI.composer.expanded) return;
  UI.composer.expanded = false;
  persistNow();
  if (UI.screen === 'notes') rerender();
}

/** FAB on the Notes screen (AC-01.3). */
export function focusComposer() {
  expand('body');
  app.querySelector('[data-editor]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function add() {
  const d = draft;
  draft = blankDraft();
  UI.composer.expanded = false;
  const n = addNote(d);             // commits → full render with the composer collapsed and empty
  if (!n) { draft = d; UI.composer.expanded = true; rerender(); return; }
  toast('Note added', { action: { label: 'Open', onClick: () => openNote(n.id) } });
}

/* Click anywhere outside the composer keeps the draft and collapses it. Uses
   click (not pointerdown) so the control that was clicked still gets its
   event before the re-render replaces it. */
document.addEventListener('click', (e) => {
  if (!UI.composer.expanded) return;
  /* a control whose own handler already re-rendered (the FAB, the placeholder)
     is detached by the time the event reaches here: it was not "outside" */
  if (!e.target.isConnected) return;
  if (e.target.closest('[data-editor], .overlay, .menu-popover, .menu-backdrop, .toast')) return;
  collapse();
});

/* ── Markup ──────────────────────────────────────────────────────────── */

const MAX_CHIPS = 3;

/** Tag chips (max 3 + "+n") and the checklist progress; shared with the
    folders. links: chips are buttons that filter the list (AC-03.6). */
export function noteMetaHTML(n, { links = false } = {}) {
  const chips = n.tags.slice(0, MAX_CHIPS).map((t) => (links
    ? `<button type="button" class="tag tag-btn" data-tagfilter="${esc(t)}" aria-label="Show notes tagged ${esc(t)}">#${esc(t)}</button>`
    : `<span class="tag">#${esc(t)}</span>`));
  if (n.tags.length > MAX_CHIPS) chips.push(`<span class="tag">+${n.tags.length - MAX_CHIPS}</span>`);
  const p = checklistProgress(n);
  if (p) chips.push(`<span class="t-sub num" aria-label="Checklist, ${p.done} of ${p.total} done">${icon('checklist', 12)}${p.done}/${p.total}</span>`);
  return chips.length ? `<div class="t-meta">${chips.join('')}</div>` : '';
}

/** One list row. dateLabel follows the sort; a grip appears when the list can be reordered. */
export function noteRowHTML(n, { dateLabel = 'Created', grip = false } = {}) {
  const hasTitle = !!n.title.trim();
  const title = noteTitle(n);
  const preview = hasTitle && !isEmpty(n.body) ? firstLine(n.body) : '';
  const when = fmtDateOrRelative(dateLabel === 'Created' ? n.createdAt : n.updatedAt, S.dateFormat);
  return `
  <div class="row nrow" data-id="${n.id}" role="button" tabindex="0" aria-label="${esc(title)}${n.color ? `, ${colorName(n.color)}` : ''}">
    ${colorBarHTML(n.color)}
    <div class="t-main">
      <div class="nrow-line">
        <span class="t-title ${hasTitle ? '' : 'untitled'}">${esc(title)}</span>
        <span class="nrow-date num">${dateLabel} ${esc(when)}</span>
      </div>
      ${noteMetaHTML(n, { links: true })}
      ${preview ? `<span class="nrow-preview">${esc(preview)}</span>` : ''}
    </div>
    ${grip ? `<span class="grip" aria-hidden="true">${icon('grip')}</span>` : ''}
  </div>`;
}

const dateLabel = () => (S.notesSort.startsWith('created') ? 'Created' : 'Edited');

/* ── Sort (PRD-notes US-07) ──────────────────────────────────────────── */

const DEFAULT_SORT = 'created-desc';
const SHORT = {
  manual: 'Manual', 'created-desc': 'Newest first', 'created-asc': 'Oldest first',
  'updated-desc': 'Recently edited', 'updated-asc': 'Least recently edited',
};
/** Manual drag only in manual sort and on the full list (no search / tag filter). */
const canReorder = () => S.notesSort === 'manual' && !UI.query && !UI.tagFilter;

function sortbarHTML() {
  return `
  <div class="viewbar notes-bar ${searchOpen() ? 'searching' : ''}">
    ${searchFieldHTML({ placeholder: 'Search notes' })}
    <span class="sortwrap">
      <button class="sortbtn ${S.notesSort !== DEFAULT_SORT ? 'on' : ''}" data-sortbtn aria-haspopup="menu" aria-expanded="${UI.sortMenu}">${icon('sort')}${SHORT[S.notesSort]}</button>
      ${UI.sortMenu ? `
      <div class="sortmenu" role="menu">
        ${NOTES_SORTS.map(([v, label]) => `<button role="menuitemradio" aria-checked="${S.notesSort === v}" data-notes-sort="${v}" class="${S.notesSort === v ? 'active' : ''}">${label}</button>`).join('')}
      </div>` : ''}
    </span>
  </div>`;
}

function bindSortbar() {
  app.querySelector('[data-sortbtn]')?.addEventListener('click', () => { UI.sortMenu = !UI.sortMenu; rerender(); });
  app.querySelectorAll('[data-notes-sort]').forEach((b) =>
    b.addEventListener('click', () => { UI.sortMenu = false; setNotesSort(b.dataset.notesSort); rerender(); }));
}

export function notesHTML() {
  queryFor('notes');
  const all = sortedNotes();
  const total = all.length;
  const filtering = !!(UI.query || UI.tagFilter);
  const notes = filtering ? filterNotes(all, UI.query, UI.tagFilter) : all;
  const kicker = !total ? 'No notes'
    : filtering ? `${notes.length} of ${total} note${total === 1 ? '' : 's'}`
    : `${total} note${total === 1 ? '' : 's'}`;
  const empty = !total ? 'No notes yet. Write one above.'
    : UI.query ? `No notes match “${esc(UI.query)}”.`
    : `No notes with #${esc(UI.tagFilter)}.`;
  return `
  <div class="screen notes-screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Notes</h1>
        <span class="head-right"><span class="kicker">${kicker}</span>${searchToggleHTML()}</span>
      </div>
      ${sortbarHTML()}
      ${UI.tagFilter ? `
      <div class="filterline">
        <button type="button" class="chip sm on removable" data-tagfilter-clear aria-label="Remove tag filter ${esc(UI.tagFilter)}">#${esc(UI.tagFilter)}${icon('x', 14)}</button>
      </div>` : ''}
    </header>
    <div class="scroll-area">
      <div data-composer-host>${editorHTML(draft, { mode: 'composer', expanded: UI.composer.expanded })}</div>
      ${notes.length
        ? `<div class="card list-card" role="list">${notes.map((n) => noteRowHTML(n, { dateLabel: dateLabel(), grip: canReorder() })).join('')}</div>`
        : `<p class="empty">${empty}</p>`}
      ${notes.length > 1 && canReorder() ? '<span class="hint">Drag the handle to reorder</span>' : ''}
    </div>
  </div>`;
}

export function bindNotes() {
  bindScrollShadow();
  const host = app.querySelector('[data-composer-host]');
  editor = bindEditor(host, {
    mode: 'composer',
    get: () => draft,
    set: (patch) => { Object.assign(draft, patch); persist(); },
    expanded: () => UI.composer.expanded,
    onAdd: add,
    onCollapse: collapse,
    onExpand: expand,
  });
  if (UI.composer.focus) { editor.focus(UI.composer.focus); UI.composer.focus = null; }
  bindSortbar();
  bindSearch(app);
  app.querySelector('[data-tagfilter-clear]')?.addEventListener('click', () => { UI.tagFilter = null; rerender(); });
  app.querySelectorAll('.nrow').forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener('click', (e) => {
      const tag = e.target.closest('[data-tagfilter]');
      if (tag) { UI.tagFilter = tag.dataset.tagfilter; rerender(); return; }
      if (e.target.closest('.grip') || row.dataset.dragged) { delete row.dataset.dragged; return; }
      openNote(id);
    });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(id); } });
    const grip = row.querySelector('.grip');
    if (grip) bindReorder(grip, row, { rowSel: '.nrow', enabled: canReorder, onDrop: (beforeId) => reorderNote(id, beforeId) });
  });
}
