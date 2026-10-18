/* Note detail (PRD-notes US-04 / US-05): the editor in detail mode with
   autosave (500 ms after a change, on blur, on back), the ⋯ menu (Copy ·
   Archive · Delete), and the read-only view for archived / deleted notes with
   Restore and Delete. Edits save quietly (no re-render) so the caret stays. */

import {
  S, UI, RETENTION_DAYS, noteById, noteTitle, sortedChecklist,
  updateNote, finalizeNote, copyNote, deleteNoteForever, rerender,
} from '../store.js';
import { fmtDateOrRelative, fmtRelative, daysLeft } from '../dates.js';
import { isEmpty } from '../richtext.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow } from './board.js';
import { openMenu, toast, confirmDialog } from './primitives.js';
import { archiveNoteWithUndo, deleteNoteWithUndo, restoreNoteWithToast } from './actions.js';
import { editorHTML, bindEditor, colorBarHTML, colorName } from './noteeditor.js';

export function openNote(id) {
  if (!noteById(id)) return;
  UI.detailId = id; UI.screen = 'note';
  rerender();
}

const datesLine = (n) =>
  `Created ${fmtDateOrRelative(n.createdAt, S.dateFormat)} · Edited ${fmtDateOrRelative(n.updatedAt, S.dateFormat)}`;

/* the editor shows ticked items at the bottom (AC-04.3); storage keeps authoring order */
const view = (n) => ({ ...n, checklist: n.checklist ? sortedChecklist(n.checklist) : null });

/** Map the editor's (display-ordered) list back onto authoring order: known
    items keep their stored order, new ones land after their on-screen
    predecessor, removed ones go. */
function authoringOrder(prev, shown) {
  const kept = (prev || []).filter((c) => shown.some((s) => s.id === c.id));
  shown.forEach((s, k) => {
    if (kept.some((c) => c.id === s.id)) return;
    const before = k > 0 ? kept.findIndex((c) => c.id === shown[k - 1].id) : -1;
    kept.splice(before + 1, 0, s);
  });
  return kept;
}

/* one flush hook for the note being edited, so leaving the page saves it */
let flushCurrent = null;
window.addEventListener('pagehide', () => flushCurrent?.());

export function noteDetailHTML() {
  const n = noteById(UI.detailId);
  if (!n) { UI.screen = 'notes'; return '<div class="screen"></div>'; }
  if (n.status !== 'active') return readOnlyHTML(n);
  return `
  <div class="screen detail-screen note-screen">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to Notes">${icon('chevronLeft')}</button>
      <span class="kicker">Note</span>
      <button class="icon-btn" data-more aria-label="More actions" aria-haspopup="menu">${icon('more')}</button>
    </header>
    <div class="scroll-area">
      <div data-editor-host>${editorHTML(view(n), { mode: 'detail' })}</div>
      <span class="hint note-dates" data-dates>${esc(datesLine(n))}</span>
    </div>
  </div>`;
}

export function bindNoteDetail() {
  const n = noteById(UI.detailId);
  if (!n) { rerender(); return; }
  if (n.status !== 'active') { bindReadOnly(n); return; }
  bindScrollShadow();

  /* autosave */
  let timer = null;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer); timer = null;
    updateNote(n.id, { title: n.title, body: n.body, color: n.color, tags: n.tags, checklist: n.checklist });
    const d = app.querySelector('[data-dates]'); if (d) d.textContent = datesLine(n);
  };
  flushCurrent = flush;
  const set = (patch) => {
    if (patch.checklist !== undefined && patch.checklist !== null) patch = { ...patch, checklist: authoringOrder(n.checklist, patch.checklist) };
    Object.assign(n, patch);
    n.updatedAt = Date.now();
    clearTimeout(timer); timer = setTimeout(flush, 500);
  };
  const host = app.querySelector('[data-editor-host]');
  bindEditor(host, { mode: 'detail', get: () => view(n), set, resortOnToggle: true });
  host.addEventListener('focusout', (e) => { if (!host.contains(e.relatedTarget)) flush(); });

  /* back: save, tidy, drop an empty note (AC-04.6) */
  app.querySelector('[data-back]').addEventListener('click', () => {
    flush(); flushCurrent = null;
    UI.detailId = null; UI.screen = 'notes';
    finalizeNote(n.id);
  });

  /* ⋯ menu */
  const leaving = () => { flush(); flushCurrent = null; };
  app.querySelector('[data-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Copy', icon: 'copy', onClick: () => { leaving(); const c = copyNote(n.id); openNote(c.id); toast('Copied'); } },
    { label: 'Archive', icon: 'archive', onClick: () => { leaving(); archiveNoteWithUndo(n.id); } },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { leaving(); deleteNoteWithUndo(n.id); } },
  ]));
}

/* ── Read-only view for archived / deleted notes ─────────────────────── */

function readOnlyHTML(n) {
  const archived = n.status === 'archived';
  const left = archived ? 0 : daysLeft(n.deletedAt, RETENTION_DAYS);
  const status = archived ? `Archived ${fmtRelative(n.archivedAt)}`
    : left === 0 ? 'Removed today' : `Removed in ${left} day${left === 1 ? '' : 's'}`;
  const items = n.checklist ? sortedChecklist(n.checklist) : [];
  const hasTitle = !!n.title.trim();
  return `
  <div class="screen detail-screen is-readonly note-screen">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to ${archived ? 'Archived' : 'Deleted'}">${icon('chevronLeft')}</button>
      <span class="kicker">${archived ? 'Archived' : 'Deleted'} note</span>
      <span class="icon-btn-spacer" aria-hidden="true"></span>
    </header>
    <div class="scroll-area">
      <div class="notice ${archived ? 'notice-neutral' : ''}">
        ${icon(archived ? 'archive' : 'trash', 18)}
        <span>${status}. Restore it to edit.</span>
      </div>
      <div class="card note-ro" aria-label="${esc(noteTitle(n))}${n.color ? `, ${colorName(n.color)}` : ''}">
        ${colorBarHTML(n.color)}
        <h1 class="note-ro-title ${hasTitle ? '' : 'untitled'}">${esc(hasTitle ? n.title : 'Untitled')}</h1>
        ${isEmpty(n.body) ? '' : `<div class="note-ro-body">${n.body}</div>`}
        ${items.length ? `
        <div class="subrows">
          ${items.map((c) => `
          <div class="subrow ${c.done ? 'done' : ''}">
            <input type="checkbox" class="check sm" disabled ${c.done ? 'checked' : ''} aria-label="${c.done ? 'Done' : 'Not done'}">
            <span class="s-title">${esc(c.text)}</span>
          </div>`).join('')}
        </div>` : ''}
        ${n.tags.length || n.color ? `
        <div class="t-meta">
          ${n.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
          ${n.color ? `<span class="tag pc pc-${n.color}">${colorName(n.color)}</span>` : ''}
        </div>` : ''}
      </div>
      <span class="hint note-dates">${esc(datesLine(n))}</span>
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-ro-restore>${icon('undo', 18)}Restore</button>
        <button class="btn btn-ghost danger" data-ro-delete>${archived ? 'Delete' : 'Delete forever'}</button>
      </div>
    </div>
  </div>`;
}

function bindReadOnly(n) {
  bindScrollShadow();
  const archived = n.status === 'archived';
  /* leave the detail before acting, so the folder list is what re-renders */
  const toFolder = () => { UI.detailId = null; UI.screen = 'folders'; UI.folder = archived ? 'archived' : 'deleted'; UI.folderKind = 'notes'; };
  app.querySelector('[data-back]').addEventListener('click', () => { toFolder(); rerender(); });
  app.querySelector('[data-ro-restore]').addEventListener('click', () => { toFolder(); restoreNoteWithToast(n.id); });
  app.querySelector('[data-ro-delete]').addEventListener('click', async () => {
    if (archived) { toFolder(); deleteNoteWithUndo(n.id); return; }
    if (await confirmDialog('Delete forever?', 'This note cannot be recovered afterwards.', { confirmLabel: 'Delete forever', danger: true })) {
      toFolder(); deleteNoteForever(n.id);
    }
  });
}
