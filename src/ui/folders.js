/* Folders screen: Archived and Deleted tabs, each with a Tasks ∕ Notes ∕
   Meetings switch (PRD-notes AC-05.2, PRD-meetings AC-10.2). Deleted keeps items for RETENTION_DAYS, then
   purgeDeleted() drops them (run on boot and whenever this tab opens).
   Tapping a row opens the item read-only. */

import {
  UI, RETENTION_DAYS, listById, laneName, noteTitle, meetingTitle, folderTasks, folderNotes, folderMeetings, purgeDeleted,
  deleteForever, deleteNoteForever, deleteMeetingForever, emptyDeleted, rerender,
} from '../store.js';
import { fmtRelative, daysLeft } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { taskMetaHTML, bindScrollShadow, openDetail } from './board.js';
import { confirmDialog } from './primitives.js';
import {
  restoreWithToast, deleteWithUndo, restoreNoteWithToast, deleteNoteWithUndo,
  restoreMeetingWithToast, deleteMeetingWithUndo,
} from './actions.js';
import { noteMetaHTML } from './notes.js';
import { openNote } from './notedetail.js';
import { colorBarHTML } from './noteeditor.js';
import { meetingChipsHTML } from './meetings.js';
import { openMeeting } from './meeting.js';

/** tab: 'archived' | 'deleted'; kind (optional): 'tasks' | 'notes' | 'meetings' */
export function openFolder(tab, kind) {
  if (tab === 'deleted') purgeDeleted();
  UI.screen = 'folders';
  UI.folder = tab;
  if (kind) UI.folderKind = kind;
  rerender();
}

function originLabel(t) {
  const o = t.origin || t;
  const board = listById(o.listId)?.name || 'Deleted board';
  return `${board} · ${laneName(o.listId, o.lane)}`;
}

function whenLabel(x, tab) {
  if (tab === 'archived') return `Archived ${fmtRelative(x.archivedAt)}`;
  const left = daysLeft(x.deletedAt, RETENTION_DAYS);
  return left === 0 ? 'Removed today' : `Removed in ${left} day${left === 1 ? '' : 's'}`;
}

const actionsHTML = (attr, id, tab) => `
      <div class="frow-actions">
        <button class="btn btn-sm btn-secondary" data-restore-${attr}="${id}">${icon('undo', 16)}Restore</button>
        <button class="btn btn-sm btn-ghost danger" data-delete-${attr}="${id}">${tab === 'archived' ? 'Delete' : 'Delete forever'}</button>
      </div>`;

function taskRowHTML(t, tab) {
  return `
  <div class="row frow" data-id="${t.id}">
    <div class="t-main">
      <button class="t-title frow-open" data-open="${t.id}">${esc(t.title)}</button>
      ${taskMetaHTML(t)}
      <span class="frow-origin">${esc(originLabel(t))} · ${whenLabel(t, tab)}</span>
      ${actionsHTML('task', t.id, tab)}
    </div>
  </div>`;
}

function noteRowHTML(n, tab) {
  return `
  <div class="row frow nrow" data-note="${n.id}">
    ${colorBarHTML(n.color)}
    <div class="t-main">
      <button class="t-title frow-open" data-open-note="${n.id}">${esc(noteTitle(n))}</button>
      ${noteMetaHTML(n)}
      <span class="frow-origin">Note · ${whenLabel(n, tab)}</span>
      ${actionsHTML('note', n.id, tab)}
    </div>
  </div>`;
}

function meetingRowHTML(m, tab) {
  return `
  <div class="row frow nrow" data-meeting="${m.id}">
    <div class="t-main">
      <button class="t-title frow-open" data-open-meeting="${m.id}">${esc(meetingTitle(m))}</button>
      ${meetingChipsHTML(m)}
      <span class="frow-origin">Meeting · ${whenLabel(m, tab)}</span>
      ${actionsHTML('meeting', m.id, tab)}
    </div>
  </div>`;
}

export function foldersHTML() {
  const tab = UI.folder, kind = UI.folderKind;
  const tasks = folderTasks(tab), notes = folderNotes(tab), meetings = folderMeetings(tab);
  const total = (t) => folderTasks(t).length + folderNotes(t).length + folderMeetings(t).length;
  const rows = kind === 'notes' ? notes.map((n) => noteRowHTML(n, tab))
    : kind === 'meetings' ? meetings.map((m) => meetingRowHTML(m, tab))
    : tasks.map((t) => taskRowHTML(t, tab));
  const disclaimer = `Tasks, notes and meetings stay here for ${RETENTION_DAYS} days, then they are removed permanently.`;
  const what = kind === 'notes' ? 'notes' : kind === 'meetings' ? 'meetings' : 'tasks';
  const empty = tab === 'archived'
    ? `Nothing archived yet. Archive ${what} you are done with but want to keep.`
    : (kind === 'tasks' ? 'Nothing in Deleted.' : `No deleted ${what}.`);
  const seg = (k, label, n) =>
    `<button class="seg ${kind === k ? 'active' : ''}" data-kind="${k}" role="tab" aria-selected="${kind === k}">${label} · ${n}</button>`;
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Folders</h1>
        <span class="kicker">${rows.length} ${tab}</span>
      </div>
      <div class="segmented" role="tablist" aria-label="Folder">
        <button class="seg ${tab === 'archived' ? 'active' : ''}" data-tab="archived" role="tab" aria-selected="${tab === 'archived'}">Archived · ${total('archived')}</button>
        <button class="seg ${tab === 'deleted' ? 'active' : ''}" data-tab="deleted" role="tab" aria-selected="${tab === 'deleted'}">Deleted · ${total('deleted')}</button>
      </div>
      <div class="segmented solid folder-kind" role="tablist" aria-label="Kind">
        ${seg('tasks', 'Tasks', tasks.length)}
        ${seg('notes', 'Notes', notes.length)}
        ${seg('meetings', 'Meetings', meetings.length)}
      </div>
    </header>
    <div class="scroll-area">
      ${tab === 'deleted' ? `
      <div class="notice">
        ${icon('trash', 18)}
        <span>${disclaimer}</span>
        ${total('deleted') ? '<button class="btn btn-sm btn-ghost danger" data-empty>Empty folder</button>' : ''}
      </div>` : ''}
      ${rows.length ? `<div class="card list-card">${rows.join('')}</div>` : `<p class="empty">${empty}</p>`}
    </div>
  </div>`;
}

export function bindFolders() {
  bindScrollShadow();
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => openFolder(b.dataset.tab)));
  app.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => { UI.folderKind = b.dataset.kind; rerender(); }));
  /* the title is the keyboard target; a tap anywhere else on the row works too */
  app.querySelectorAll('.frow').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('.frow-actions')) return;
      if (row.dataset.note) openNote(row.dataset.note);
      else if (row.dataset.meeting) openMeeting(row.dataset.meeting);
      else openDetail(row.dataset.id);
    }));
  app.querySelectorAll('[data-restore-task]').forEach((b) =>
    b.addEventListener('click', () => restoreWithToast(b.dataset.restoreTask)));
  app.querySelectorAll('[data-restore-note]').forEach((b) =>
    b.addEventListener('click', () => restoreNoteWithToast(b.dataset.restoreNote)));
  app.querySelectorAll('[data-restore-meeting]').forEach((b) =>
    b.addEventListener('click', () => restoreMeetingWithToast(b.dataset.restoreMeeting)));
  const confirmForever = (what) =>
    confirmDialog('Delete forever?', `This ${what} cannot be recovered afterwards.`, { confirmLabel: 'Delete forever', danger: true });
  app.querySelectorAll('[data-delete-task]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.deleteTask;
      if (UI.folder === 'archived') { deleteWithUndo(id); return; }
      if (await confirmForever('task')) deleteForever(id);
    }));
  app.querySelectorAll('[data-delete-note]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.deleteNote;
      if (UI.folder === 'archived') { deleteNoteWithUndo(id); return; }
      if (await confirmForever('note')) deleteNoteForever(id);
    }));
  app.querySelectorAll('[data-delete-meeting]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.deleteMeeting;
      if (UI.folder === 'archived') { deleteMeetingWithUndo(id); return; }
      if (await confirmForever('meeting')) deleteMeetingForever(id);
    }));
  app.querySelector('[data-empty]')?.addEventListener('click', async () => {
    if (await confirmDialog('Empty the Deleted folder?', 'Every task, note and meeting in it is removed permanently.', { confirmLabel: 'Empty folder', danger: true })) {
      emptyDeleted();
    }
  });
}
