/* Task lifecycle actions with their user feedback (toast + Undo), shared by
   the detail screen, row gestures and the folder screens. */

import {
  RETENTION_DAYS, taskById, listById, laneName, archiveTask, softDelete, returnToArchive, restoreTask,
  moveTask, toggleDone, rollForward, undoRollForward,
  archiveNote, softDeleteNote, returnNoteToArchive, restoreNote,
  archiveMeeting, softDeleteMeeting, returnMeetingToArchive, restoreMeeting,
  archiveList, softDeleteList, restoreList, canRemoveList, boardCardCount,
} from '../store.js';
import { fmtDateLong } from '../dates.js';
import { toast, choiceDialog } from './primitives.js';
import { askRemoveShared } from './sharing.js';

const where = (listId, lane) => `${listById(listId).name} · ${laneName(listId, lane)}`;
const isRecurring = (t) => t.recur !== 'none' && !!t.due;

export function archiveWithUndo(id) {
  archiveTask(id);
  toast('Archived', { action: { label: 'Undo', onClick: () => restoreTask(id, { keepPosition: true }) } });
}

/** Soft delete from anywhere. Undo returns the task where it came from: its
    board position, or the Archived folder when it was deleted from there. */
export function deleteWithUndo(id) {
  const prev = softDelete(id);
  if (!prev) return;
  const onClick = prev.status === 'archived'
    ? () => returnToArchive(id, prev.archivedAt)
    : () => restoreTask(id, { keepPosition: true });
  toast('Deleted', { action: { label: 'Undo', onClick } });
}

export function restoreWithToast(id) {
  const r = restoreTask(id);
  if (!r) return;
  toast(r.fellBack ? `Board no longer exists — restored to ${where(r.listId, r.lane)}` : `Restored to ${where(r.listId, r.lane)}`);
}

/** Move from the Move sheet. Choosing Done for a recurring task completes it
    instead (it rolls forward in its lane), after changing board if asked. */
export function moveWithFeedback(id, listId, lane) {
  const t = taskById(id); if (!t) return;
  if (lane === 'done' && isRecurring(t) && !t.done) {
    if (listId !== t.listId) moveTask(id, listId, t.lane);
    completeTask(id);
    return;
  }
  moveTask(id, listId, lane);
  toast(`Moved to ${where(listId, lane)}`);
}

/* — notes (same feedback as tasks; a note restores to its list position) — */

export function archiveNoteWithUndo(id) {
  archiveNote(id);
  toast('Archived', { action: { label: 'Undo', onClick: () => restoreNote(id) } });
}

export function deleteNoteWithUndo(id) {
  const prev = softDeleteNote(id);
  if (!prev) return;
  const onClick = prev.status === 'archived'
    ? () => returnNoteToArchive(id, prev.archivedAt)
    : () => restoreNote(id);
  toast('Deleted', { action: { label: 'Undo', onClick } });
}

export function restoreNoteWithToast(id) {
  restoreNote(id);
  toast('Restored to Notes');
}

/* — meetings (same feedback again) — */

export function archiveMeetingWithUndo(id) {
  archiveMeeting(id);
  toast('Archived', { action: { label: 'Undo', onClick: () => restoreMeeting(id) } });
}

export function deleteMeetingWithUndo(id) {
  const prev = softDeleteMeeting(id);
  if (!prev) return;
  const onClick = prev.status === 'archived'
    ? () => returnMeetingToArchive(id, prev.archivedAt)
    : () => restoreMeeting(id);
  toast('Deleted', { action: { label: 'Undo', onClick } });
}

export function restoreMeetingWithToast(id) {
  restoreMeeting(id);
  toast('Restored to Meetings');
}

/* — boards (PRD-improvements US-10): a board goes with every card on it — */

/** how: 'archive' | 'delete'. Undo puts the board back where it was: among
    the boards, or in Archived when it was deleted from there. */
export function removeBoardWithUndo(id, how) {
  const prev = how === 'archive' ? archiveList(id) : softDeleteList(id);
  if (!prev) return;
  const onClick = prev.status === 'archived'
    ? () => restoreList(id, { toArchive: prev.archivedAt })
    : () => restoreList(id);
  toast(how === 'archive' ? 'Board archived' : 'Board deleted', { action: { label: 'Undo', onClick } });
}

export function restoreBoardWithToast(id) {
  const name = listById(id)?.name;
  restoreList(id);
  toast(`${name} is back in Boards`);
}

/** The delete badge on a board row: confirm, and choose Archive or Delete
    (AC-10.3). The last board stays, and the app says why (AC-10.6). */
export async function askRemoveBoard(id) {
  const l = listById(id); if (!l) return;
  if (l.share) { await askRemoveShared(id); return; }   // shared: delete for everyone, or leave (AC-12.5)
  if (!canRemoveList(id)) { toast('This is your only board. Add another one before removing it.'); return; }
  const n = boardCardCount(id);
  const cards = n === 0 ? 'It has no cards.' : n === 1 ? 'Its 1 card goes with it.' : `Its ${n} cards go with it.`;
  const how = await choiceDialog(`Remove “${l.name}”?`,
    `${cards} Archive keeps the board until you restore it. Delete removes it for good after ${RETENTION_DAYS} days.`,
    [{ id: 'archive', label: 'Archive' }, { id: 'delete', label: 'Delete', danger: true }]);
  if (how) removeBoardWithUndo(id, how);
}

const rolling = new Set(); // ids waiting out the completion flash

/** Every "mark complete" path goes through here. A recurring task is not
    marked done: the row flashes complete for a moment, then rolls forward to
    its next date in place, with Undo. Repeat taps during the flash are
    ignored so one completion never skips two periods. */
export function completeTask(id, el = null) {
  const t = taskById(id); if (!t || rolling.has(id)) return;
  if (t.done || !isRecurring(t)) { toggleDone(id); return; }
  rolling.add(id);
  el?.classList.add('done');
  const check = el?.querySelector('.check'); if (check) check.checked = true;
  setTimeout(() => {
    rolling.delete(id);
    const r = rollForward(id);
    if (!r) return;
    toast(`Done · next ${fmtDateLong(r.next.due)}`, { action: { label: 'Undo', onClick: () => undoRollForward(id, r.prev) } });
  }, 400);
}
