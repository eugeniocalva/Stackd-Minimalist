/* Stack'd — minimalist todo. Vanilla JS ES modules, no build step,
   localStorage persistence. This is the entry point: it owns render() and
   the global listeners; state lives in src/store.js, screens in src/ui/. */

import './src/boot.js'; // first: tells index.html's file:// fallback the modules started
import {
  S, UI, isDesktop, setRenderer, setAfterCommit, rerender, commit, purgeDeleted, taskById,
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

function render() {
  applyTheme();
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
      : mobileListHTML();
    /* no nav on the detail, nor behind an open composer (its toolbar must stay above the keyboard) */
    const withNav = UI.screen !== 'detail' && !(UI.screen === 'notes' && UI.composer.expanded);
    app.innerHTML = screen + (withNav ? mobileNavHTML() : '');
    if (UI.screen === 'lists') bindListsMenu();
    else if (UI.screen === 'detail') bindDetail();
    else if (UI.screen === 'folders') bindFolders();
    else if (UI.screen === 'settings') bindSettings();
    else if (UI.screen === 'notes') bindNotes();
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
purgeDeleted();

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
