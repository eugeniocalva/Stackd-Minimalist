/* Task lifecycle actions with their user feedback (toast + Undo), shared by
   the detail screen, row gestures and the folder screens. */

import {
  taskById, listById, laneName, archiveTask, softDelete, returnToArchive, restoreTask,
  moveTask, toggleDone, rollForward, undoRollForward,
  archiveNote, softDeleteNote, returnNoteToArchive, restoreNote,
} from '../store.js';
import { fmtDateLong } from '../dates.js';
import { toast } from './primitives.js';

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
