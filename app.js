/* Stack'd — minimalist todo. Vanilla JS ES modules, no build step,
   localStorage persistence. This is the entry point: it owns render() and
   the global listeners; state lives in src/store.js, screens in src/ui/. */

import { S, UI, isDesktop, setRenderer, rerender } from './src/store.js';
import { app } from './src/util.js';
import {
  onboardingHTML, bindOnboarding, listsMenuHTML, bindListsMenu,
  mobileNavHTML, bindMobileNav, desktopHTML, bindDesktop,
} from './src/ui/shell.js';
import { mobileListHTML, bindMobileList } from './src/ui/board.js';
import { detailHTML, bindDetail } from './src/ui/detail.js';

function render() {
  const focusAddsub = document.activeElement?.classList?.contains('addsub-input');
  if (!S.onboarded) { app.innerHTML = onboardingHTML(); bindOnboarding(); return; }

  if (isDesktop.matches) {
    app.innerHTML = desktopHTML();
    bindDesktop();
  } else {
    const screen = UI.screen === 'lists' ? listsMenuHTML()
      : UI.screen === 'detail' ? detailHTML()
      : mobileListHTML();
    const withNav = UI.screen !== 'detail';
    app.innerHTML = screen + (withNav ? mobileNavHTML() : '');
    if (UI.screen === 'lists') bindListsMenu();
    else if (UI.screen === 'detail') bindDetail();
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

document.addEventListener('click', (e) => {
  if (UI.sortMenu && !e.target.closest('.sortwrap')) { UI.sortMenu = false; rerender(); }
});
isDesktop.addEventListener('change', render);
render();
