/* App chrome: onboarding, mobile Boards menu, mobile bottom nav + FAB,
   desktop shell with sidebar. */

import {
  S, UI, listById, taskById, noteById, meetingById, openCount, folderCount, activeNotes, activeMeetings, activeLists,
  addTask, addList, reorderList, commit, rerender,
} from '../store.js';
import { bindHold } from './gestures.js';
import { openAddMenu } from './addmenu.js';
import { askRemoveBoard } from './actions.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import {
  viewbarHTML, kanbanHTML, desktopTableHTML,
  bindViewbar, bindChecks, bindKanban, bindRowGestures, bindReorder, taskReorder, bindScrollShadow, boardKey,
} from './board.js';
import { detailHTML, bindDetail } from './detail.js';
import { foldersHTML, bindFolders, openFolder } from './folders.js';
import { openSheet } from './addsheet.js';
import { settingsHTML, bindSettings, openSettings } from './settings.js';
import { notesHTML, bindNotes, openNotes } from './notes.js';
import { noteDetailHTML, bindNoteDetail } from './notedetail.js';
import { searchFieldHTML, bindSearch } from './search.js';
import { meetingsHTML, bindMeetings, openMeetings } from './meetings.js';
import { meetingHTML, bindMeeting } from './meeting.js';
import { toast, downloadFile, promptDialog } from './primitives.js';
import { APP_ORIGIN, APP_HOST, isLegacyOrigin } from '../legal.js';
import { exportFile, exportFileName } from '../backup.js';

/* — the old address (PRD-accounts AC-12.2, AC-12.3) — */

/** On github.io only: the app has moved, and the data stored under this
    address can only leave as a file. Shown above every screen, installed
    PWA included; it cannot be dismissed, the address goes away. */
export function moveBannerHTML() {
  if (!isLegacyOrigin()) return '';
  return `
  <div class="notice move-banner" role="region" aria-label="Stack'd has moved">
    ${icon('move', 18)}
    <span><strong>Stack'd has moved to <a href="${APP_ORIGIN}" target="_blank" rel="noopener">${APP_HOST}</a>.</strong>
      Download your data here, then import it there in Settings. Recordings cannot travel in the file; their transcripts and minutes do.</span>
    <button class="btn btn-sm btn-secondary" data-download-data>${icon('download', 16)}Download my data</button>
  </div>`;
}

export function bindMoveBanner() {
  app.querySelector('[data-download-data]')?.addEventListener('click', () => {
    const name = exportFileName();
    downloadFile(exportFile(), name);
    toast(`Saved ${name}. Open ${APP_HOST}, then Settings › Import a Stack'd file.`, { ms: 10000 });
  });
}

/* — onboarding — */

export function onboardingHTML() {
  return `
  <div class="screen">
    <div class="onboarding">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <div class="onboarding-hero">
        <h1><span>Simplify.</span><span>Focus.</span><span class="accent">Achieve.</span></h1>
        <div class="onboarding-points">
          <div><span class="point-dot"></span><span>One board, nothing else on screen.</span></div>
          <div><span class="point-dot"></span><span>Drag to prioritize. Double-tap to finish.</span></div>
          <div><span class="point-dot"></span><span>Lists and kanban, side by side.</span></div>
        </div>
      </div>
      <div class="onboarding-actions">
        <button class="btn btn-primary btn-block" style="min-height:52px" data-go>Get started</button>
        <button class="btn btn-ghost btn-block" data-go>I have an account</button>
      </div>
    </div>
  </div>`;
}

export function bindOnboarding() {
  app.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { S.onboarded = true; commit(); }));
}

/* — boards in the menu and the sidebar (PRD-improvements US-10) — */

function openBoard(id) { S.currentList = id; UI.screen = 'list'; commit(); }

async function newBoard() {
  const name = await promptDialog('New board', { placeholder: 'Board name', confirmLabel: 'Create' });
  if (name) addList(name);
}

/* A div that acts as a button: Enter and Space press it. */
function pressable(el, onPress) {
  if (!el) return;
  el.addEventListener('click', onPress);
  el.addEventListener('keydown', (e) => {
    if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPress(); }
  });
}

/* Board rows: tap opens; hold (touch) or drag (mouse) moves the board up
   and down; hold longer shows the buttons that move it one step or remove
   it. Keyboard: Enter opens, Alt+↑ / Alt+↓ moves, Delete asks to remove. */
function bindBoardRows(rowSel) {
  const rows = [...app.querySelectorAll(rowSel)];
  const ids = rows.map((r) => r.dataset.id);
  /* the board lands before `ids[at]`, counted without itself; past the end = last */
  const moveTo = (id, at) => reorderList(id, ids.filter((x) => x !== id)[at] ?? null);
  const step = (id, dir) => {
    const to = ids.indexOf(id) + dir;
    if (to >= 0 && to < ids.length) moveTo(id, to);
  };
  rows.forEach((row) => {
    const id = row.dataset.id, i = ids.indexOf(id);
    const name = () => listById(id)?.name || 'board';
    let over = null, after = false, drop = null;
    const clear = () => over?.classList.remove('dropover', 'dropover-after');
    bindHold(row, {
      ghostClass: row.classList.contains('side-item') ? 'side-item' : 'lrow',
      scroller: () => row.closest('.scroll-area, .sidebar'),
      axis: 'y',
      onTap: () => openBoard(id),
      onDragMove: (ev) => {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(rowSel);
        clear();
        over = target && target !== row ? target : null;
        if (!over) return;
        const r = over.getBoundingClientRect();
        after = ev.clientY > r.top + r.height / 2;
        over.classList.add(after ? 'dropover-after' : 'dropover');
      },
      onDragEnd: () => { clear(); drop = over ? { id: over.dataset.id, after } : null; over = null; },
      onDrop: () => {
        if (!drop) return;
        const rest = ids.filter((x) => x !== id);
        moveTo(id, rest.indexOf(drop.id) + (drop.after ? 1 : 0));
        drop = null;
      },
      armButtons: () => [
        ...(i > 0 ? [{ icon: 'chevronUp', label: `Move ${name()} up`, onClick: () => step(id, -1) }] : []),
        ...(i < ids.length - 1 ? [{ icon: 'chevronDown', label: `Move ${name()} down`, onClick: () => step(id, 1) }] : []),
        { icon: 'x', label: `Remove board: ${name()}`, onClick: () => askRemoveBoard(id) },
      ],
    });
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBoard(id); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); step(id, -1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); step(id, 1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); askRemoveBoard(id); }
    });
  });
}

/* — Archive & Bin entries (shared by the main menu and the sidebar) — */

const folderEntries = () => [
  { tab: 'archived', label: 'Archived', icon: 'archive', count: folderCount('archived') },
  { tab: 'deleted', label: 'Deleted', icon: 'trash', count: folderCount('deleted') },
];

function bindFolderLinks() {
  app.querySelectorAll('[data-open-folder]').forEach((el) =>
    el.addEventListener('click', () => openFolder(el.dataset.openFolder)));
  app.querySelector('[data-open-settings]')?.addEventListener('click', () => openSettings());
  app.querySelector('[data-open-notes]')?.addEventListener('click', () => openNotes());
  app.querySelector('[data-open-meetings]')?.addEventListener('click', () => openMeetings());
}

/* — mobile: the main menu (PRD-improvements US-08). Only the app name is
   anchored at the top; "Boards" is a section title like the others and
   scrolls with the list. — */

export function listsMenuHTML() {
  return `
  <div class="screen menu-screen ${UI.menuSlide ? 'slide-in' : ''}">
    <header class="page-head">
      <div class="page-title-row menu-brand-row">
        <h1 class="kicker menu-brand">Stack'd Minimalist</h1>
      </div>
    </header>
    <div class="scroll-area">
      <h2 class="menu-title">Boards</h2>
      <div class="card list-card">
        ${activeLists().map((l) => `
        <div class="lrow ${l.id === S.currentList ? 'current' : ''}" data-id="${l.id}" role="button" tabindex="0" aria-label="${esc(l.name)}, ${openCount(l.id)} open" aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Delete">
          <span class="lrow-icon">${icon('board', 18)}</span>
          <span class="lname">${esc(l.name)}</span>
          <span class="lcount num">${openCount(l.id)}</span>
        </div>`).join('')}
        <div class="lrow newlist" data-newlist role="button" tabindex="0">
          <span class="lrow-icon">${icon('plus', 18)}</span>
          <span class="lname">New board…</span>
        </div>
      </div>
      <span class="hint menu-hint">Hold a board to move it · keep holding to remove</span>
      <h2 class="menu-title">Notes</h2>
      <div class="card list-card">
        <div class="lrow" data-open-notes>
          <span class="lrow-icon">${icon('note', 18)}</span>
          <span class="lname">Notes</span>
          <span class="lcount num">${activeNotes().length}</span>
        </div>
        <div class="lrow" data-open-meetings>
          <span class="lrow-icon">${icon('meeting', 18)}</span>
          <span class="lname">Meetings</span>
          <span class="lcount num">${activeMeetings().length}</span>
        </div>
      </div>
      <h2 class="menu-title">Archive &amp; Bin</h2>
      <div class="card list-card">
        ${folderEntries().map((f) => `
        <div class="lrow" data-open-folder="${f.tab}">
          <span class="lrow-icon">${icon(f.icon, 18)}</span>
          <span class="lname">${f.label}</span>
          <span class="lcount num">${f.count}</span>
        </div>`).join('')}
      </div>
      <div class="card list-card">
        <div class="lrow" data-open-settings>
          <span class="lrow-icon">${icon('settings', 18)}</span>
          <span class="lname">Settings</span>
          ${icon('chevronRight', 18)}
        </div>
      </div>
      <span class="hint">Synced 2 min ago · free account</span>
    </div>
  </div>`;
}

export function bindListsMenu() {
  UI.menuSlide = false;            // the slide belongs to the render that opened the menu
  bindScrollShadow();
  bindBoardRows('.lrow[data-id]');
  pressable(app.querySelector('[data-newlist]'), newBoard);
  bindFolderLinks();
}

/* — mobile: bottom nav pill + FAB (hidden on the detail screen) — */

export function mobileNavHTML() {
  const item = (screen, label, name) => `
    <button class="nav-item ${UI.screen === screen ? 'active' : ''}" data-nav="${screen}" aria-label="${label}">
      <span class="nav-icon">${icon(name, 24)}</span>
      <span class="nav-item-indicator"></span>
    </button>`;
  return `
  <nav class="bottom-nav">
    <div class="nav-pill">
      ${item('lists', 'Boards', 'grid')}
      ${item('list', 'Tasks', 'tasks')}
      ${item('notes', 'Notes', 'note')}
      ${item('folders', 'Archive & Bin', 'archive')}
    </div>
    <button class="nav-fab" data-add aria-label="Add" aria-haspopup="dialog">${icon('plus', 28)}</button>
  </nav>`;
}

export function bindMobileNav() {
  app.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      const target = b.dataset.nav;
      if (UI.screen === target) return;
      if (target === 'folders') { openFolder(UI.folder); return; }
      if (target === 'notes') { openNotes(); return; }
      UI.screen = target; rerender();
    }));
  /* one "+" everywhere: it opens the Add menu (PRD-improvements US-09) */
  app.querySelector('.nav-fab')?.addEventListener('click', openAddMenu);
}

/* — desktop shell — */

export function desktopHTML() {
  const list = listById(S.currentList);
  if (!['detail', 'folders', 'settings', 'notes', 'note', 'meetings', 'meeting'].includes(UI.screen)) boardKey();
  const main = UI.screen === 'detail' ? detailHTML()
    : UI.screen === 'folders' ? foldersHTML()
    : UI.screen === 'settings' ? settingsHTML()
    : UI.screen === 'notes' ? notesHTML()
    : UI.screen === 'note' ? noteDetailHTML()
    : UI.screen === 'meetings' ? meetingsHTML()
    : UI.screen === 'meeting' ? meetingHTML()
    : `
    <header class="main-head">
      <h1 class="page-title-text">${esc(list.name)}</h1>
      ${searchFieldHTML({ placeholder: 'Search tasks' })}
      ${viewbarHTML()}
      ${S.view === 'kanban' ? `<button class="btn btn-primary btn-sm" data-add>${icon('plus', 18)}Add task</button>` : ''}
    </header>
    ${S.view === 'kanban' ? kanbanHTML({ desktop: true }) : desktopTableHTML()}`;
  /* a read-only (archived / deleted) detail belongs to the Folders section */
  const inFolders = UI.screen === 'folders'
    || (UI.screen === 'detail' && taskById(UI.detailId)?.status !== 'active')
    || (UI.screen === 'note' && noteById(UI.detailId)?.status !== 'active')
    || (UI.screen === 'meeting' && meetingById(UI.detailId)?.status !== 'active');
  const onNotes = UI.screen === 'notes' || (UI.screen === 'note' && !inFolders);
  const onMeetings = UI.screen === 'meetings' || (UI.screen === 'meeting' && !inFolders);
  const onBoard = !inFolders && !onNotes && !onMeetings && UI.screen !== 'settings';
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <span class="section-title side-label">Boards</span>
      ${activeLists().map((l) => `
      <div class="side-item ${onBoard && l.id === S.currentList ? 'active' : ''}" data-id="${l.id}" role="button" tabindex="0" aria-label="${esc(l.name)}, ${openCount(l.id)} open" aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown Delete">
        <span class="name">${esc(l.name)}</span>
        <span class="count num">${openCount(l.id)}</span>
      </div>`).join('')}
      <div class="side-newlist"><button class="btn btn-secondary" data-newlist>${icon('plus', 16)}New board</button></div>
      <div class="side-item side-notes ${onNotes ? 'active' : ''}" data-open-notes>
        ${icon('note', 16)}
        <span class="name">Notes</span>
        <span class="count num">${activeNotes().length}</span>
      </div>
      <div class="side-item side-notes ${onMeetings ? 'active' : ''}" data-open-meetings>
        ${icon('meeting', 16)}
        <span class="name">Meetings</span>
        <span class="count num">${activeMeetings().length}</span>
      </div>
      <span class="section-title side-label">Archive &amp; Bin</span>
      ${folderEntries().map((f) => `
      <div class="side-item ${inFolders && UI.folder === f.tab ? 'active' : ''}" data-open-folder="${f.tab}">
        ${icon(f.icon, 16)}
        <span class="name">${f.label}</span>
        <span class="count num">${f.count}</span>
      </div>`).join('')}
      <div class="side-item side-settings ${UI.screen === 'settings' ? 'active' : ''}" data-open-settings>
        ${icon('settings', 16)}
        <span class="name">Settings</span>
      </div>
      <div class="side-user">
        <span class="who">Alex Rivera</span>
        <span class="sub">Synced across 3 devices</span>
      </div>
    </aside>
    <main class="main">${main}</main>
  </div>`;
}

export function bindDesktop() {
  bindBoardRows('.side-item[data-id]');
  app.querySelector('[data-newlist]').addEventListener('click', newBoard);
  bindFolderLinks();
  if (UI.screen === 'detail') { bindDetail(); return; }
  if (UI.screen === 'folders') { bindFolders(); return; }
  if (UI.screen === 'settings') { bindSettings(); return; }
  if (UI.screen === 'notes') { bindNotes(); return; }
  if (UI.screen === 'note') { bindNoteDetail(); return; }
  if (UI.screen === 'meetings') { bindMeetings(); return; }
  if (UI.screen === 'meeting') { bindMeeting(); return; }
  bindViewbar();
  bindSearch(app);
  bindChecks();
  app.querySelector('[data-add]')?.addEventListener('click', () => openSheet());
  const qa = app.querySelector('[data-quickadd]');
  if (qa) {
    const commitAdd = () => {
      if (!qa.value.trim()) return;
      addTask({ listId: S.currentList, title: qa.value.trim(), due: null, priority: 'none', tags: [] });
    };
    qa.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitAdd(); });
    app.querySelector('[data-quickadd-btn]').addEventListener('click', commitAdd);
  }
  app.querySelectorAll('.tgrid-row').forEach((row) => {
    const t = taskById(row.dataset.id);
    bindRowGestures(row, t);
    bindReorder(row, row, taskReorder(t, '.tgrid-row'));
  });
  bindKanban();
}
