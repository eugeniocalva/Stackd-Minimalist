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
  mobileNavHTML, bindMobileNav, desktopHTML, bindDesktop, moveBannerHTML, bindMoveBanner,
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
import { configure as configurePurchases, identify as identifyPurchases, anonymous as anonymousPurchases } from './src/purchases.js';
import * as account from './src/account.js';
import * as sync from './src/sync.js';
import * as lock from './src/lock.js';
import { lockHTML, bindLock } from './src/ui/lockscreen.js';
import { startSync } from './src/ui/signin.js';
import { purgeOld as purgeOldBackup } from './src/backup.js';
import * as media from './src/media.js';
import { isRecording, recordingMeetingId } from './src/ui/recorder.js';
import { toast } from './src/ui/primitives.js';
import { openPlanRequired, openAllowanceUsed } from './src/ui/paywall.js';
import { bindSwipeRight, slideTo } from './src/ui/gestures.js';

/* Every render replaces the whole screen, which would send each scroller
   back to its start: tick a card in the third lane and the board jumps to
   the first (PRD-improvements AC-01.1). So the offsets of the screen being
   replaced are put back when the new one is the same screen. */
const screenKey = () => [isDesktop.matches, UI.screen, S.currentList, S.view, UI.folder, UI.folderKind, UI.detailId].join('|');
let shownKey = null;
function readScroll() {
  const one = (sel, prop) => app.querySelector(sel)?.[prop] || 0;
  return {
    key: shownKey,
    board: one('.board', 'scrollLeft'), area: one('.scroll-area', 'scrollTop'),
    main: one('.main', 'scrollTop'), side: one('.sidebar', 'scrollTop'),
    lanes: [...app.querySelectorAll('.lane')].map((l) => [l.dataset.lane, l.querySelector('.lane-cards')?.scrollTop || 0]),
  };
}
function keepScroll(was) {
  shownKey = S.onboarded ? screenKey() : null;
  if (!shownKey || was.key !== shownKey) return;
  const put = (sel, prop, v) => { const el = app.querySelector(sel); if (el && v) el[prop] = v; };
  put('.board', 'scrollLeft', was.board); put('.scroll-area', 'scrollTop', was.area);
  put('.main', 'scrollTop', was.main); put('.sidebar', 'scrollTop', was.side);
  was.lanes.forEach(([id, top]) => {
    const el = top && [...app.querySelectorAll('.lane')].find((l) => l.dataset.lane === id)?.querySelector('.lane-cards');
    if (el) el.scrollTop = top;
  });
}

function render() {
  const was = readScroll();
  draw();
  keepScroll(was);
}

/** The markup of the current mobile screen, not yet bound. */
function screenHTML() {
  return UI.screen === 'lists' ? listsMenuHTML()
    : UI.screen === 'detail' ? detailHTML()
    : UI.screen === 'folders' ? foldersHTML()
    : UI.screen === 'settings' ? settingsHTML()
    : UI.screen === 'notes' ? notesHTML()
    : UI.screen === 'note' ? noteDetailHTML()
    : UI.screen === 'meeting' ? meetingHTML()
    : UI.screen === 'meetings' ? meetingsHTML()
    : mobileListHTML();
}
/* no nav on a detail, nor behind an open composer (its toolbar must stay above the keyboard) */
const withNav = () => !['detail', 'note', 'meeting'].includes(UI.screen) && !(UI.screen === 'notes' && UI.composer.expanded);

function draw() {
  applyTheme();
  /* a running recording pins the app to its meeting (AC-04.2): stop it first */
  if (isRecording() && !(UI.screen === 'meeting' && UI.detailId === recordingMeetingId())) {
    UI.screen = 'meeting'; UI.detailId = recordingMeetingId();
    toast('Stop the recording first');
  }
  const focusAddsub = document.activeElement?.classList?.contains('addsub-input');
  const banner = moveBannerHTML();   // '' except on the old address
  if (!S.onboarded) { app.innerHTML = banner + onboardingHTML(); bindOnboarding(); bindMoveBanner(); return; }
  /* a locked app shows the lock screen and nothing else (PRD-accounts AC-07.1) */
  if (lock.locked()) { app.innerHTML = lockHTML(); bindLock(); return; }

  if (isDesktop.matches) {
    app.innerHTML = banner + desktopHTML();
    bindDesktop();
  } else {
    const screen = screenHTML();
    const nav = withNav();
    app.innerHTML = banner + screen + (nav ? mobileNavHTML() : '');
    if (UI.screen === 'lists') bindListsMenu();
    else if (UI.screen === 'detail') bindDetail();
    else if (UI.screen === 'folders') bindFolders();
    else if (UI.screen === 'settings') bindSettings();
    else if (UI.screen === 'notes') bindNotes();
    else if (UI.screen === 'note') bindNoteDetail();
    else if (UI.screen === 'meetings') bindMeetings();
    else if (UI.screen === 'meeting') bindMeeting();
    else bindMobileList();
    if (nav) bindMobileNav();
  }
  bindMoveBanner();
  if (focusAddsub || UI.refocusAddsub) {
    UI.refocusAddsub = false;
    document.querySelector('.addsub-input')?.focus();
  }
}

/* ── Boot ────────────────────────────────────────────────────────────── */

setRenderer(render);
/* after every commit: native reminders in step, and sync within 2 s of an edit (AC-05.4) */
setAfterCommit(() => { syncReminders(); sync.request('edit'); });

/* Accounts (1.6.0). Signed out, none of this sends anything (AC-01.2). */
account.init();
lock.init();
sync.setBlocked(() => lock.locked());
purgeOldBackup();
let wasLocked = lock.locked();
lock.onLockChange((on) => {
  document.querySelectorAll('.overlay').forEach((o) => { if (on) o.remove(); });   // open sheets close on lock
  render();
  if (wasLocked && !on) sync.request('unlock');
  wasLocked = on;
});
sync.onPinRequired(() => lock.lock('pin_required'));
/* shared boards (PRD-improvements US-12): a board that left this device says so once;
   a new invitation redraws the menu and the dot */
sync.onGone((name) => toast(`You are no longer on “${name}”`, { ms: 6000 }));
let shownInvites = '';
sync.onShared((sh) => {
  const key = sh.invites.map((i) => i.id).join(',');
  if (key === shownInvites) return;
  shownInvites = key;
  rerender();
});
/* the status line and dot follow sync, but a poll that changes nothing redraws nothing */
let shownSync = '';
sync.onState((s) => {
  const key = s.state === 'syncing' && UI.screen !== 'settings' ? shownSync : `${s.state}|${s.pending}|${s.paused?.code || ''}`;
  if (key === shownSync) return;
  shownSync = key;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
  if (UI.screen === 'settings' || UI.screen === 'lists' || isDesktop.matches) rerender();
});
let signedInAs = account.current()?.userId || null;
account.onChange((a) => {
  const id = a?.userId || null;
  if (id !== signedInAs) {
    if (id) identifyPurchases(id); else anonymousPurchases(S.plan.subscriberId);
    signedInAs = id;
  }
  rerender();
});
function syncSoon(reason) {
  if (!account.signedIn()) return;
  if (!sync.started()) { if (!lock.locked()) startSync(); return; }   // a first sync that never finished
  sync.request(reason);
}
account.ready.then(() => syncSoon('boot'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSoon('focus'); });
window.addEventListener('online', () => syncSoon('online'));
setInterval(() => { if (document.visibilityState === 'visible') syncSoon('poll'); }, sync.POLL_MS);   // PRD-improvements AC-11.1
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => lock.touch(), { passive: true, capture: true }));
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
configurePurchases(account.current()?.userId || S.plan.subscriberId);   // native shells only; a no-op on the web
setTranscribedHandler((id) => {           // AC-04.8: offer to free the space once
  const m = meetingById(id);
  if (!m?.recording) return;
  toast(`Transcript ready. Delete the recording to free ${fmtBytes(m.recording.sizeBytes)}?`, { ms: 8000, action: { label: 'Delete', onClick: () => setRecording(id, null) } });
});
setPlanErrorHandler((code, { step, resetsAt }) => {
  if (code === 'plan_required') openPlanRequired({ step });
  else if (code === 'allowance_exhausted') openAllowanceUsed({ step, resetsAt });
});
document.addEventListener('resume', () => { resumeJobs(); syncSoon('resume'); });   // Capacitor's foreground event
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
/* Mobile: a swipe to the right that follows the finger (PRD-improvements
   AC-07.1 to 07.3, US-04; owner's review 2026-11-17). On a top-level page
   the main menu slides in over it; on an open card the card slides off and
   its board (or folder) shows underneath. A swipe that starts on a row, a
   card, a lane or a field does nothing (they have gestures of their own);
   from the left edge it always works. */
const TOP_LEVEL = ['list', 'notes', 'meetings', 'folders', 'settings'];
const ITEMS = '.row, .kcard, .lane, .board, .card, .set-row, .lrow, .chip-row, .search-row, .invite-card, .notice';
const FIELDS = 'input, textarea, select, [contenteditable="true"], [data-editor]';

/** Another screen's markup, drawn as it would be, without changing where we are. */
function asScreen(screen, build) {
  const was = { screen: UI.screen, slide: UI.menuSlide };
  UI.screen = screen; UI.menuSlide = false;
  try { return build(); } finally { UI.screen = was.screen; UI.menuSlide = was.slide; }
}
function peekLayer(html, cls) {
  const el = document.createElement('div');
  el.className = `peek ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/* the menu comes in from the left, over the page, with the page dimmed */
function peekMenu() {
  const layer = peekLayer(asScreen('lists', () => listsMenuHTML() + mobileNavHTML()), 'peek-over');
  const dim = document.createElement('div');
  dim.className = 'peek-dim';
  document.body.insertBefore(dim, layer);
  const at = (p) => `translateX(${(p - 1) * 100}%)`;
  layer.style.transform = at(0);
  return {
    move: (p) => { layer.style.transform = at(p); dim.style.opacity = String(p); },
    settle: (open) => {
      dim.style.transition = 'opacity 220ms ease';
      dim.style.opacity = open ? '1' : '0';
      slideTo(layer, at(open ? 1 : 0), () => {
        if (open) { UI.menuSlide = false; UI.screen = 'lists'; rerender(); }
        layer.remove(); dim.remove();
      });
    },
  };
}

/* the card goes right, its board comes from a little to the left */
function peekBack() {
  const t = taskById(UI.detailId);
  const to = t && t.status !== 'active' ? 'folders' : 'list';
  const under = peekLayer(asScreen(to, () => screenHTML() + mobileNavHTML()), 'peek-under');
  const at = (p) => `translateX(${p * 100}%)`;
  const behind = (p) => `translateX(${(p - 1) * 24}%)`;
  app.classList.add('is-peeking');
  under.style.transform = behind(0);
  return {
    move: (p) => { app.style.transform = at(p); under.style.transform = behind(p); under.style.setProperty('--peek-dim', String(1 - p)); },
    settle: (open) => {
      under.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      under.style.transform = behind(open ? 1 : 0);
      slideTo(app, at(open ? 1 : 0), () => {
        app.style.transform = '';
        app.classList.remove('is-peeking');
        if (open) { if (to === 'folders') UI.detailId = null; UI.screen = to; rerender(); }
        under.remove();
      });
    },
  };
}

bindSwipeRight(app, {
  canStart: (target, x, edge) => {
    if (isDesktop.matches || !S.onboarded || lock.locked() || isRecording()) return false;
    if (document.querySelector('.peek, .overlay') || target.closest(`.bottom-nav, ${FIELDS}`)) return false;
    if (UI.screen === 'detail') return edge || !target.closest('.subrow, .chip-row');
    if (!TOP_LEVEL.includes(UI.screen) || (UI.screen === 'notes' && UI.composer.expanded)) return false;
    return edge || !target.closest(ITEMS);
  },
  start: () => (UI.screen === 'detail' ? peekBack() : peekMenu()),
});
isDesktop.addEventListener('change', render);
systemDark.addEventListener('change', render); // theme 'system' follows the OS live
render();
initReminders({ openTask });
