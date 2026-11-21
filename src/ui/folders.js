/* Archive & Bin (PRD-improvements US-06, US-10): two pages, Archived and
   Deleted, each with a Tasks ∕ Notes ∕ Meetings ∕ Boards switch (PRD-notes
   AC-05.2, PRD-meetings AC-10.2). Like every top-level page, the title
   carries the chevron that opens the main menu. Deleted keeps items for
   RETENTION_DAYS, then purgeDeleted() drops them (run on boot and whenever
   that page opens). Tapping a row opens the item read-only; a board has no
   read-only view, it is restored to be looked at. */

import {
  UI, RETENTION_DAYS, listById, laneName, noteTitle, meetingTitle, folderTasks, folderNotes, folderMeetings, folderBoards,
  boardCardCount, purgeDeleted, deleteForever, deleteNoteForever, deleteMeetingForever, deleteListForever, emptyDeleted, rerender,
} from '../store.js';
import { fmtRelative, daysLeft } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { taskMetaHTML, bindScrollShadow, openDetail, pageTitleHTML, bindPageTitle } from './board.js';
import { confirmDialog } from './primitives.js';
import {
  restoreWithToast, deleteWithUndo, restoreNoteWithToast, deleteNoteWithUndo,
  restoreMeetingWithToast, deleteMeetingWithUndo, restoreBoardWithToast, removeBoardWithUndo,
} from './actions.js';
import { noteMetaHTML } from './notes.js';
import { openNote } from './notedetail.js';
import { colorBarHTML } from './noteeditor.js';
import { meetingChipsHTML } from './meetings.js';
import { fmtBytes } from '../media.js';
import { openMeeting } from './meeting.js';

/** tab: 'archived' | 'deleted' (the page); kind (optional): 'tasks' | 'notes' | 'meetings' | 'boards' */
export function openFolder(tab, kind) {
  if (tab === 'deleted') purgeDeleted();
  UI.screen = 'folders';
  UI.folder = tab;
  if (kind) UI.folderKind = kind;
  rerender();
}

function originLabel(t) {
  const o = t.origin || t;
  const board = listById(o.listId);
  const name = !board ? 'Deleted board' : board.status === 'active' ? board.name : `${board.name} (${board.status})`;
  return `${name} · ${laneName(o.listId, o.lane)}`;
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
      <span class="frow-origin">Meeting${m.recording ? ` · recording ${fmtBytes(m.recording.sizeBytes)}` : ''} · ${whenLabel(m, tab)}</span>
      ${actionsHTML('meeting', m.id, tab)}
    </div>
  </div>`;
}

/** A board that was put away with its cards inside (AC-10.4). */
function boardRowHTML(l, tab) {
  const n = boardCardCount(l.id);
  return `
  <div class="row frow brow" data-board="${l.id}">
    <div class="t-main">
      <span class="t-title">${esc(l.name)}</span>
      <span class="frow-origin">Board · ${n} card${n === 1 ? '' : 's'} inside · ${whenLabel(l, tab)}</span>
      ${actionsHTML('board', l.id, tab)}
    </div>
  </div>`;
}

const KINDS = { tasks: 'tasks', notes: 'notes', meetings: 'meetings', boards: 'boards' };

export function foldersHTML() {
  const tab = UI.folder, kind = KINDS[UI.folderKind] || 'tasks';
  const tasks = folderTasks(tab), notes = folderNotes(tab), meetings = folderMeetings(tab), boards = folderBoards(tab);
  const total = tasks.length + notes.length + meetings.length + boards.length;
  const rows = kind === 'notes' ? notes.map((n) => noteRowHTML(n, tab))
    : kind === 'meetings' ? meetings.map((m) => meetingRowHTML(m, tab))
    : kind === 'boards' ? boards.map((l) => boardRowHTML(l, tab))
    : tasks.map((t) => taskRowHTML(t, tab));
  const disclaimer = `Tasks, notes, meetings and boards stay here for ${RETENTION_DAYS} days, then they are removed permanently.`;
  const empty = tab === 'archived'
    ? `Nothing archived yet. Archive ${kind} you are done with but want to keep.`
    : (kind === 'tasks' ? 'Nothing in Deleted.' : `No deleted ${kind}.`);
  const seg = (k, label, n) =>
    `<button class="seg ${kind === k ? 'active' : ''}" data-kind="${k}" role="tab" aria-selected="${kind === k}">${label} · ${n}</button>`;
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        ${pageTitleHTML(tab === 'archived' ? 'Archived' : 'Deleted')}
        <span class="kicker">${rows.length} ${rows.length === 1 ? kind.slice(0, -1) : kind}</span>
      </div>
      <div class="segmented solid folder-kind" role="tablist" aria-label="Kind">
        ${seg('tasks', 'Tasks', tasks.length)}
        ${seg('notes', 'Notes', notes.length)}
        ${seg('meetings', 'Meetings', meetings.length)}
        ${seg('boards', 'Boards', boards.length)}
      </div>
    </header>
    <div class="scroll-area">
      ${tab === 'deleted' ? `
      <div class="notice">
        ${icon('trash', 18)}
        <span>${disclaimer}</span>
        ${total ? '<button class="btn btn-sm btn-ghost danger" data-empty>Empty Deleted</button>' : ''}
      </div>` : ''}
      ${rows.length ? `<div class="card list-card">${rows.join('')}</div>` : `<p class="empty">${empty}</p>`}
    </div>
  </div>`;
}

export function bindFolders() {
  bindScrollShadow();
  bindPageTitle();
  app.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => { UI.folderKind = b.dataset.kind; rerender(); }));
  /* the title is the keyboard target; a tap anywhere else on the row works too */
  app.querySelectorAll('.frow').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('.frow-actions') || row.dataset.board) return;
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
  app.querySelectorAll('[data-restore-board]').forEach((b) =>
    b.addEventListener('click', () => restoreBoardWithToast(b.dataset.restoreBoard)));
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
  app.querySelectorAll('[data-delete-board]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.deleteBoard;
      if (UI.folder === 'archived') { removeBoardWithUndo(id, 'delete'); return; }
      const n = boardCardCount(id);
      if (await confirmForever(n ? `board and its ${n} card${n === 1 ? '' : 's'}` : 'board')) deleteListForever(id);
    }));
  app.querySelector('[data-empty]')?.addEventListener('click', async () => {
    if (await confirmDialog('Empty Deleted?', 'Every task, note, meeting and board in it is removed permanently.', { confirmLabel: 'Empty Deleted', danger: true })) {
      emptyDeleted();
    }
  });
}
