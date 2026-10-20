/* Stack'd — minimalist todo. Vanilla JS ES modules, no build step,
   localStorage persistence. This is the entry point: it owns render() and
   the global listeners; state lives in src/store.js, screens in src/ui/. */

import './src/boot.js'; // first: tells index.html's file:// fallback the modules started
import {
  S, UI, isDesktop, setRenderer, setAfterCommit, rerender, commit, purgeDeleted, taskById,
  setMediaRemover, meetingById, setRecording,
} from './src/store.js';
import { initReminders, syncReminders } from './src/notify.js';
import { applyTheme, systemDark } from './src/theme.js';
import { app } from './src/util.js';
import {
  onboardingHTML, bindOnboarding, listsMenuHTML, bindListsMenu,
  mobileNavHTML, bindMobileNav, desktopHTML, bindDesktop,
} from './src/ui/shell.js';
import { mobileListHTML, bindMobileList } from './src/ui/board.js';
import { detailHTML, bindDetail } from './src/ui/detail.js';
import { foldersHTML, bindFolders } from './src/ui/folders.js';
import { settingsHTML, bindSettings } from './src/ui/settings.js';
import { notesHTML, bindNotes } from './src/ui/notes.js';
import { noteDetailHTML, bindNoteDetail } from './src/ui/notedetail.js';
import { meetingsHTML, bindMeetings } from './src/ui/meetings.js';
import { meetingHTML, bindMeeting } from './src/ui/meeting.js';
import { resumeJobs, setPlanErrorHandler, setTranscribedHandler } from './src/ai.js';
import { fmtBytes } from './src/media.js';
import { configure as configurePurchases } from './src/purchases.js';
import * as media from './src/media.js';
import { isRecording, recordingMeetingId } from './src/ui/recorder.js';
import { toast } from './src/ui/primitives.js';
import { openPlanRequired, openAllowanceUsed } from './src/ui/paywall.js';

function render() {
  applyTheme();
  /* a running recording pins the app to its meeting (AC-04.2): stop it first */
  if (isRecording() && !(UI.screen === 'meeting' && UI.detailId === recordingMeetingId())) {
    UI.screen = 'meeting'; UI.detailId = recordingMeetingId();
    toast('Stop the recording first');
  }
  const focusAddsub = document.activeElement?.classList?.contains('addsub-input');
  if (!S.onboarded) { app.innerHTML = onboardingHTML(); bindOnboarding(); return; }

  if (isDesktop.matches) {
    app.innerHTML = desktopHTML();
    bindDesktop();
  } else {
    const screen = UI.screen === 'lists' ? listsMenuHTML()
      : UI.screen === 'detail' ? detailHTML()
      : UI.screen === 'folders' ? foldersHTML()
      : UI.screen === 'settings' ? settingsHTML()
      : UI.screen === 'notes' ? notesHTML()
      : UI.screen === 'note' ? noteDetailHTML()
      : UI.screen === 'meetings' ? meetingsHTML()
      : UI.screen === 'meeting' ? meetingHTML()
      : mobileListHTML();
    /* no nav on a detail, nor behind an open composer (its toolbar must stay above the keyboard) */
    const withNav = !['detail', 'note', 'meeting'].includes(UI.screen) && !(UI.screen === 'notes' && UI.composer.expanded);
    app.innerHTML = screen + (withNav ? mobileNavHTML() : '');
    if (UI.screen === 'lists') bindListsMenu();
    else if (UI.screen === 'detail') bindDetail();
    else if (UI.screen === 'folders') bindFolders();
    else if (UI.screen === 'settings') bindSettings();
    else if (UI.screen === 'notes') bindNotes();
    else if (UI.screen === 'note') bindNoteDetail();
    else if (UI.screen === 'meetings') bindMeetings();
    else if (UI.screen === 'meeting') bindMeeting();
    else bindMobileList();
    if (withNav) bindMobileNav();
  }
  if (focusAddsub || UI.refocusAddsub) {
    UI.refocusAddsub = false;
    document.querySelector('.addsub-input')?.focus();
  }
}

/* ── Boot ────────────────────────────────────────────────────────────── */

setRenderer(render);
setAfterCommit(syncReminders); // native: keep iOS pending reminders in step
setMediaRemover((keys) => keys.forEach((k) => media.remove(k).catch(() => {})));
purgeDeleted();
/* recordings on disk that no meeting references: a crash mid-recording left
   the chunks without the row in the document → attach them back; anything
   else is cruft → remove (architecture §19) */
if (media.available()) {
  media.orphans(S.meetings.map((m) => m.recording?.key).filter(Boolean)).then((rows) => rows.forEach((row) => {
    const m = meetingById(row.meetingId);
    if (m && m.status === 'active' && !m.recording && row.sizeBytes > 0 && row.durationMs > 0) {
      setRecording(m.id, { key: row.key, mimeType: row.mimeType, durationMs: row.durationMs, sizeBytes: row.sizeBytes, recordedAt: row.updatedAt - row.durationMs });
    } else media.remove(row.key).catch(() => {});
  })).catch(() => {});
}
resumeJobs();                                   // an AI job persisted before a reload was lost with the page
configurePurchases(S.plan.subscriberId);        // native shells only; a no-op on the web
setTranscribedHandler((id) => {           // AC-04.8: offer to free the space once
  const m = meetingById(id);
  if (!m?.recording) return;
  toast(`Transcript ready. Delete the recording to free ${fmtBytes(m.recording.sizeBytes)}?`, { ms: 8000, action: { label: 'Delete', onClick: () => setRecording(id, null) } });
});
setPlanErrorHandler((code, { step, resetsAt }) => {
  if (code === 'plan_required') openPlanRequired({ step });
  else if (code === 'allowance_exhausted') openAllowanceUsed({ step, resetsAt });
});
document.addEventListener('resume', () => resumeJobs());   // Capacitor's foreground event
window.addEventListener('online', () => resumeJobs());

/** Show a task, e.g. from a tapped reminder notification. */
function openTask(id) {
  const t = taskById(id);
  if (!t) return;
  if (t.status === 'active') S.currentList = t.listId;
  UI.detailId = id;
  UI.screen = 'detail';
  commit();
}

document.addEventListener('click', (e) => {
  if (UI.sortMenu && !e.target.closest('.sortwrap')) { UI.sortMenu = false; rerender(); }
});
isDesktop.addEventListener('change', render);
systemDark.addEventListener('change', render); // theme 'system' follows the OS live
render();
initReminders({ openTask });
