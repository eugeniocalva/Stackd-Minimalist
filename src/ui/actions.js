/* Task lifecycle actions with their user feedback (toast + Undo), shared by
   the detail menu, row gestures and the folder screens. */

import { listById, laneName, archiveTask, softDelete, restoreTask } from '../store.js';
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
