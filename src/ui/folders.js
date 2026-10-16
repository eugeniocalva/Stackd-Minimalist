/* Folders screen: Archived and Deleted tabs. Deleted keeps tasks for
   RETENTION_DAYS, then purgeDeleted() drops them (run on boot and whenever
   this tab opens). Tapping a row opens the task read-only. */

import {
  UI, RETENTION_DAYS, listById, laneName, folderTasks, purgeDeleted,
  deleteForever, emptyDeleted, rerender,
} from '../store.js';
import { fmtRelative, daysLeft } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { taskMetaHTML, bindScrollShadow, openDetail } from './board.js';
import { confirmDialog } from './primitives.js';
import { restoreWithToast, deleteWithUndo } from './actions.js';

export function openFolder(tab) {
  if (tab === 'deleted') purgeDeleted();
  UI.screen = 'folders';
  UI.folder = tab;
  rerender();
}

function originLabel(t) {
  const o = t.origin || t;
  const board = listById(o.listId)?.name || 'Deleted board';
  return `${board} · ${laneName(o.lane)}`;
}

function whenLabel(t, tab) {
  if (tab === 'archived') return `Archived ${fmtRelative(t.archivedAt)}`;
  const left = daysLeft(t.deletedAt, RETENTION_DAYS);
  return left === 0 ? 'Removed today' : `Removed in ${left} day${left === 1 ? '' : 's'}`;
}

function rowHTML(t, tab) {
  return `
  <div class="row frow" data-id="${t.id}">
    <div class="t-main">
      <button class="t-title frow-open" data-open="${t.id}">${esc(t.title)}</button>
      ${taskMetaHTML(t)}
      <span class="frow-origin">${esc(originLabel(t))} · ${whenLabel(t, tab)}</span>
      <div class="frow-actions">
        <button class="btn btn-sm btn-secondary" data-restore="${t.id}">${icon('undo', 16)}Restore</button>
        <button class="btn btn-sm btn-ghost danger" data-delete="${t.id}">${tab === 'archived' ? 'Delete' : 'Delete forever'}</button>
      </div>
    </div>
  </div>`;
}

export function foldersHTML() {
  const tab = UI.folder;
  const archived = folderTasks('archived'), deleted = folderTasks('deleted');
  const ts = tab === 'archived' ? archived : deleted;
  const disclaimer = `Tasks stay here for ${RETENTION_DAYS} days, then they are removed permanently.`;
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Folders</h1>
        <span class="kicker">${ts.length} ${tab}</span>
      </div>
      <div class="segmented" role="tablist">
        <button class="seg ${tab === 'archived' ? 'active' : ''}" data-tab="archived" role="tab" aria-selected="${tab === 'archived'}">Archived · ${archived.length}</button>
        <button class="seg ${tab === 'deleted' ? 'active' : ''}" data-tab="deleted" role="tab" aria-selected="${tab === 'deleted'}">Deleted · ${deleted.length}</button>
      </div>
    </header>
    <div class="scroll-area">
      ${tab === 'deleted' ? `
      <div class="notice">
        ${icon('trash', 18)}
        <span>${disclaimer}</span>
        ${deleted.length ? '<button class="btn btn-sm btn-ghost danger" data-empty>Empty folder</button>' : ''}
      </div>` : ''}
      ${ts.length
        ? `<div class="card list-card">${ts.map((t) => rowHTML(t, tab)).join('')}</div>`
        : `<p class="empty">${tab === 'archived'
            ? 'Nothing archived yet. Archive tasks you are done with but want to keep.'
            : 'Nothing in Deleted.'}</p>`}
    </div>
  </div>`;
}

export function bindFolders() {
  bindScrollShadow();
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => openFolder(b.dataset.tab)));
  /* the title is the keyboard target; a tap anywhere else on the row works too */
  app.querySelectorAll('.frow').forEach((row) =>
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-restore],[data-delete]')) return;
      openDetail(row.dataset.id);
    }));
  app.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => restoreWithToast(b.dataset.restore)));
  app.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.delete;
      if (UI.folder === 'archived') { deleteWithUndo(id); return; }
      if (await confirmDialog('Delete forever?', 'This task cannot be recovered afterwards.', { confirmLabel: 'Delete forever', danger: true })) {
        deleteForever(id);
      }
    }));
  app.querySelector('[data-empty]')?.addEventListener('click', async () => {
    if (await confirmDialog('Empty the Deleted folder?', 'Every task in it is removed permanently.', { confirmLabel: 'Empty folder', danger: true })) {
      emptyDeleted();
    }
  });
}
