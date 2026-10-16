/* Task lifecycle actions with their user feedback (toast + Undo), shared by
   the detail menu, row gestures and the folder screens. */

import { taskById, listById, laneName, archiveTask, softDelete, restoreTask, toggleDone, rollForward, undoRollForward } from '../store.js';
import { fmtDateLong } from '../dates.js';
import { toast } from './primitives.js';

const undo = (id) => ({ label: 'Undo', onClick: () => restoreTask(id, { keepPosition: true }) });

export function archiveWithUndo(id) {
  archiveTask(id);
  toast('Archived', { action: undo(id) });
}

export function deleteWithUndo(id) {
  softDelete(id);
  toast('Deleted', { action: undo(id) });
}

export function restoreWithToast(id) {
  const r = restoreTask(id);
  if (!r) return;
  const where = `${listById(r.listId).name} · ${laneName(r.lane)}`;
  toast(r.fellBack ? `Board no longer exists — restored to ${where}` : `Restored to ${where}`);
}

/** Every "mark complete" path goes through here. A recurring task is not
    marked done: the row flashes complete for a moment, then rolls forward to
    its next date in place, with Undo. */
export function completeTask(id, el = null) {
  const t = taskById(id); if (!t) return;
  if (t.done || t.recur === 'none' || !t.due) { toggleDone(id); return; }
  el?.classList.add('done');
  const check = el?.querySelector('.check'); if (check) check.checked = true;
  setTimeout(() => {
    const r = rollForward(id);
    if (!r) return;
    toast(`Done · next ${fmtDateLong(r.next.due)}`, { action: { label: 'Undo', onClick: () => undoRollForward(id, r.prev) } });
  }, 400);
}
