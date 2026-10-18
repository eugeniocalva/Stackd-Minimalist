/* Notes screen (PRD-notes US-01 – US-03): sticky header, the composer at the
   top, and the flat list of notes under it. The composer draft lives in this
   module and in localStorage under its own key: leaving the screen, the app
   or the composer never adds or discards it (AC-02.10). Sort menu: Phase 9;
   search and tag filter: Phase 10; opening a note: Phase 8. */

import {
  S, UI, sortedNotes, activeNotes, addNote, loadDraft, saveDraft, blankDraft,
  checklistProgress, noteTitle, rerender,
} from '../store.js';
import { fmtDateOrRelative } from '../dates.js';
import { firstLine, isEmpty } from '../richtext.js';
import { esc, app, uid } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow } from './board.js';
import { toast } from './primitives.js';
import { editorHTML, bindEditor, colorBarHTML, colorName } from './noteeditor.js';
import { openNote } from './notedetail.js';

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

/** Tag chips (max 3 + "+n") and the checklist progress; shared with the folders. */
export function noteMetaHTML(n) {
  const chips = n.tags.slice(0, MAX_CHIPS).map((t) => `<span class="tag">#${esc(t)}</span>`);
  if (n.tags.length > MAX_CHIPS) chips.push(`<span class="tag">+${n.tags.length - MAX_CHIPS}</span>`);
  const p = checklistProgress(n);
  if (p) chips.push(`<span class="t-sub num" aria-label="Checklist, ${p.done} of ${p.total} done">${icon('checklist', 12)}${p.done}/${p.total}</span>`);
  return chips.length ? `<div class="t-meta">${chips.join('')}</div>` : '';
}

/** One list row. dateLabel follows the sort. */
export function noteRowHTML(n, { dateLabel = 'Created' } = {}) {
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
      ${noteMetaHTML(n)}
      ${preview ? `<span class="nrow-preview">${esc(preview)}</span>` : ''}
    </div>
  </div>`;
}

const dateLabel = () => (S.notesSort.startsWith('created') ? 'Created' : 'Edited');

export function notesHTML() {
  const notes = sortedNotes();
  const total = activeNotes().length;
  return `
  <div class="screen notes-screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Notes</h1>
        <span class="kicker">${total ? `${total} note${total === 1 ? '' : 's'}` : 'No notes'}</span>
      </div>
    </header>
    <div class="scroll-area">
      <div data-composer-host>${editorHTML(draft, { mode: 'composer', expanded: UI.composer.expanded })}</div>
      ${notes.length
        ? `<div class="card list-card" role="list">${notes.map((n) => noteRowHTML(n, { dateLabel: dateLabel() })).join('')}</div>`
        : '<p class="empty">No notes yet. Write one above.</p>'}
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
  app.querySelectorAll('.nrow').forEach((row) => {
    row.addEventListener('click', () => openNote(row.dataset.id));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNote(row.dataset.id); } });
  });
}
