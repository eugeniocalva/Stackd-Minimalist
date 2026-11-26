/* Stack'd — minimalist todo. Vanilla JS ES modules, no build step,
   localStorage persistence. This is the entry point: it owns render() and
   the global listeners; state lives in src/store.js, screens in src/ui/. */

import './src/boot.js'; // first: tells index.html's file:// fallback the modules started
import {
  S, UI, isDesktop, setRenderer, setAfterCommit, setSaveFailed, rerender, commit, purgeDeleted, taskById,
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
import { bindSwipeRight, bindSwipeLeft, slideTo } from './src/ui/gestures.js';
import * as agesignal from './src/agesignal.js';
import { approvalHTML, bindApproval } from './src/ui/approval.js';

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
/** Puts offsets read by readScroll() back, in #app or in a layer drawn from the same screen. */
function putScroll(root, was) {
  const put = (sel, prop, v) => { const el = root.querySelector(sel); if (el && v) el[prop] = v; };
  put('.board', 'scrollLeft', was.board); put('.scroll-area', 'scrollTop', was.area);
  put('.main', 'scrollTop', was.main); put('.sidebar', 'scrollTop', was.side);
  was.lanes.forEach(([id, top]) => {
    const el = top && [...root.querySelectorAll('.lane')].find((l) => l.dataset.lane === id)?.querySelector('.lane-cards');
    if (el) el.scrollTop = top;
  });
}
function keepScroll(was) {
  shownKey = S.onboarded ? screenKey() : null;
  if (!shownKey || was.key !== shownKey) return;
  putScroll(app, was);
}

/* The pages the main menu opens over, and the one it was last opened from
   (PRD 1.7.0 §03, A-1): whichever way the menu was opened (the swipe to the
   right, the Boards tab, the board's own button), the render that shows it
   notes the page it replaces, with its scroll offsets. A swipe to the left
   on the menu puts that page back. Kept until the app is closed; a menu
   that opens cold has nowhere to go back to. */
const TOP_LEVEL = ['list', 'notes', 'meetings', 'folders', 'settings'];
let shownScreen = null;  // the mobile screen on show, null on wide screens and before the app proper
let cameFrom = null;     // { screen, key, scroll }

function render() {
  const was = readScroll(), from = shownScreen;
  draw();
  keepScroll(was);
  shownScreen = S.onboarded && !isDesktop.matches && !lock.locked() && !agesignal.waiting() ? UI.screen : null;
  if (shownScreen === 'lists' && TOP_LEVEL.includes(from)) cameFrom = { screen: from, key: was.key, scroll: was };
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
  dropWaiting();                 // a layer built ahead for a swipe shows the screen as it was
  /* a running recording pins the app to its meeting (AC-04.2): stop it first */
  if (isRecording() && !(UI.screen === 'meeting' && UI.detailId === recordingMeetingId())) {
    UI.screen = 'meeting'; UI.detailId = recordingMeetingId();
    toast('Stop the recording first');
  }
  const focusAddsub = document.activeElement?.classList?.contains('addsub-input');
  const banner = moveBannerHTML();   // '' except on the old address
  /* a minor whose parent has not approved the app (docs/prd-age-signals.md §04, 4):
     before onboarding too */
  if (agesignal.waiting()) { document.querySelectorAll('.overlay').forEach((o) => o.remove()); app.innerHTML = approvalHTML(); bindApproval(); return; }
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
setSaveFailed(() => toast("Stack'd has run out of space on this device. Empty Deleted or remove old tasks; new changes are not saved until then.", { ms: 12000 }));

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
/* the store's age signal: at launch and whenever the app comes back
   (California AB 1043); a change redraws (docs/prd-age-signals.md §04, 1) */
agesignal.onChange(() => render());
agesignal.check();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') agesignal.check(); });
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
const ITEMS = '.row, .kcard, .lane, .board, .card, .set-row, .lrow, .chip-row, .search-row, .invite-card, .notice';
const FIELDS = 'input, textarea, select, [contenteditable="true"], [data-editor]';

/** Another screen's markup, drawn as it would be, without changing where we are. */
function asScreen(screen, build) {
  const was = { screen: UI.screen, slide: UI.menuSlide };
  UI.screen = screen; UI.menuSlide = false;
  try { return build(); } finally { UI.screen = was.screen; UI.menuSlide = was.slide; }
}
/* An inert layer on <body>, drawn from a screen's own markup. */
function peekLayer(html, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

/* What a swipe reveals is built when the finger lands (bindSwipeRight's
   prepare), hidden, so nothing is built or laid out while the finger moves:
   that showed as a hitch (owner's review of build 11). It lives for that
   touch only, and the next draw drops it too. Nothing in a layer that moves
   is frosted, and what fades is a layer of its own (screens.css), so a
   frame of the swipe moves and fades layers and repaints nothing. */
let waiting = null;      // { kind, els, … } built and hidden
let peeking = false;     // a swipe is running or settling
function dropWaiting() { waiting?.els.forEach((el) => el.remove()); waiting = null; }

/* the menu comes in from the left over the page, which dims; the bottom bar
   and its "+" stay where they are, above both */
function buildMenuPeek() {
  const dim = peekLayer('', 'peek-dim');
  const layer = peekLayer(asScreen('lists', listsMenuHTML), 'peek peek-over');
  return { kind: 'menu', layer, dim, els: [dim, layer] };
}
/* the card goes right; its board waits underneath, a little to the left and
   shaded, with its bottom bar already in place */
function buildBackPeek() {
  const t = taskById(UI.detailId);
  const to = t && t.status !== 'active' ? 'folders' : 'list';
  const under = peekLayer(asScreen(to, screenHTML), 'peek peek-under');
  const nav = peekLayer(asScreen(to, mobileNavHTML), 'peek-nav');
  const shade = peekLayer('', 'peek-shade');
  return { kind: 'back', to, under, shade, els: [under, nav, shade] };
}
/* the way back from the menu (PRD 1.7.0 §03): the page it was opened from
   waits under it, as it was left and dimmed, and the menu goes off to the
   left. If that page is no longer the same one (its board was removed from
   the menu), it is drawn from the top. */
const sameAsLeft = () => asScreen(cameFrom.screen, screenKey) === cameFrom.key;
function buildReturnPeek() {
  const under = peekLayer(asScreen(cameFrom.screen, screenHTML), 'peek peek-under');
  if (sameAsLeft()) putScroll(under, cameFrom.scroll);
  const dim = peekLayer('', 'peek-dim peek-dim-under');
  return { kind: 'return', to: cameFrom.screen, under, dim, els: [under, dim] };
}
const peekKind = () => (UI.screen === 'detail' ? 'back' : UI.screen === 'lists' ? 'return' : 'menu');
function preparePeek() {
  const kind = peekKind();
  if (waiting?.kind === kind) return;
  dropWaiting();
  waiting = kind === 'back' ? buildBackPeek() : kind === 'return' ? buildReturnPeek() : buildMenuPeek();
  waiting.els.forEach((el) => el.classList.add('peek-waiting'));
}
function takePeek() {
  preparePeek();
  const peek = waiting;
  waiting = null;
  peek.els.forEach((el) => el.classList.remove('peek-waiting'));
  peeking = true;
  return peek;
}
const endPeek = (peek) => { peek.els.forEach((el) => el.remove()); peeking = false; };
const shift = (px) => `translate3d(${px.toFixed(1)}px, 0, 0)`;

function peekMenu() {
  const peek = takePeek();
  const { layer, dim } = peek;
  const w = window.innerWidth;
  const at = (p) => shift((p - 1) * w);
  layer.style.transform = at(0);
  return {
    move: (p) => { layer.style.transform = at(p); dim.style.opacity = String(p); },
    settle: (open) => {
      /* the bar's Boards tab lights up as the menu arrives, not after */
      if (open) app.querySelectorAll('.bottom-nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === 'lists'));
      dim.style.transition = 'opacity 220ms ease';
      dim.style.opacity = open ? '1' : '0';
      slideTo(layer, at(open ? 1 : 0), () => {
        if (open) { UI.menuSlide = false; UI.screen = 'lists'; rerender(); }
        endPeek(peek);
      });
    },
  };
}

function peekBack() {
  const peek = takePeek();
  const { to, under, shade } = peek;
  const w = window.innerWidth;
  const at = (p) => shift(p * w);
  const behind = (p) => shift((p - 1) * 0.24 * w);
  app.classList.add('is-peeking');
  under.style.transform = behind(0);
  return {
    move: (p) => { app.style.transform = at(p); under.style.transform = behind(p); shade.style.opacity = String(1 - p); },
    settle: (open) => {
      under.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      under.style.transform = behind(open ? 1 : 0);
      shade.style.transition = 'opacity 220ms ease';
      shade.style.opacity = open ? '0' : '1';
      slideTo(app, at(open ? 1 : 0), () => {
        app.style.transform = '';
        app.classList.remove('is-peeking');
        if (open) { if (to === 'folders') UI.detailId = null; UI.screen = to; rerender(); }
        endPeek(peek);
      });
    },
  };
}

/* The mirror of peekMenu: the menu is the screen in #app this time, so it is
   the menu that moves and the page that waits in a layer. A redraw of the
   menu under the finger (sync finishing) gives a new element: looked up on
   every frame. */
function peekReturn() {
  const peek = takePeek();
  const { to, dim } = peek;
  const menu = () => app.querySelector('.menu-screen');
  const w = window.innerWidth;
  const at = (p) => shift(-p * w);
  app.classList.add('is-leaving');
  dim.style.opacity = '1';
  return {
    move: (p) => { const m = menu(); if (m) m.style.transform = at(p); dim.style.opacity = String(1 - p); },
    settle: (open) => {
      if (open) app.querySelectorAll('.bottom-nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === to));
      dim.style.transition = 'opacity 220ms ease';
      dim.style.opacity = open ? '0' : '1';
      const done = () => {
        app.classList.remove('is-leaving');
        if (open && UI.screen === 'lists') {
          UI.screen = to; rerender();
          if (sameAsLeft()) putScroll(app, cameFrom.scroll);
        } else { const m = menu(); if (m) m.style.transform = ''; }
        endPeek(peek);
      };
      const m = menu();
      if (m) slideTo(m, at(open ? 1 : 0), done); else done();
    },
  };
}

/* On the menu, a swipe to the left that starts anywhere, rows included
   (PRD 1.7.0 §03, A-2; decision 11): a row's tap, hold and drag are its
   own, and the swipe code tells them apart. */
bindSwipeLeft(app, {
  canStart: (target) => {
    if (isDesktop.matches || !S.onboarded || lock.locked() || isRecording()) return false;
    if (peeking || document.querySelector('.overlay') || target.closest(`.bottom-nav, .hold-bar, ${FIELDS}`)) return false;
    return UI.screen === 'lists' && !!cameFrom;
  },
  prepare: preparePeek,
  discard: dropWaiting,
  start: () => (UI.screen === 'lists' && cameFrom ? peekReturn() : null),
});
bindSwipeRight(app, {
  canStart: (target, x, edge) => {
    if (isDesktop.matches || !S.onboarded || lock.locked() || isRecording()) return false;
    if (peeking || document.querySelector('.overlay') || target.closest(`.bottom-nav, ${FIELDS}`)) return false;
    if (UI.screen === 'detail') return edge || !target.closest('.subrow, .chip-row');
    if (!TOP_LEVEL.includes(UI.screen) || (UI.screen === 'notes' && UI.composer.expanded)) return false;
    return edge || !target.closest(ITEMS);
  },
  prepare: preparePeek,
  discard: dropWaiting,
  start: () => (UI.screen === 'detail' ? peekBack() : peekMenu()),
});
isDesktop.addEventListener('change', render);
systemDark.addEventListener('change', render); // theme 'system' follows the OS live
render();
initReminders({ openTask });
