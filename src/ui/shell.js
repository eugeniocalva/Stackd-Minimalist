/* App chrome: onboarding, mobile Boards menu, mobile bottom nav + FAB,
   desktop shell with sidebar. */

import { S, UI, listById, taskById, noteById, openCount, folderCount, activeNotes, addTask, newList, commit, rerender } from '../store.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import {
  viewbarHTML, kanbanHTML, desktopTableHTML,
  bindViewbar, bindChecks, bindKanban, bindRowGestures, bindReorder, taskReorder, bindScrollShadow,
} from './board.js';
import { detailHTML, bindDetail } from './detail.js';
import { foldersHTML, bindFolders, openFolder } from './folders.js';
import { openSheet } from './addsheet.js';
import { settingsHTML, bindSettings, openSettings } from './settings.js';
import { notesHTML, bindNotes, openNotes, focusComposer } from './notes.js';
import { noteDetailHTML, bindNoteDetail } from './notedetail.js';

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

/* — folders entries (shared by Boards menu and sidebar) — */

const folderEntries = () => [
  { tab: 'archived', label: 'Archived', icon: 'archive', count: folderCount('archived') },
  { tab: 'deleted', label: 'Deleted', icon: 'trash', count: folderCount('deleted') },
];

function bindFolderLinks() {
  app.querySelectorAll('[data-open-folder]').forEach((el) =>
    el.addEventListener('click', () => openFolder(el.dataset.openFolder)));
  app.querySelector('[data-open-settings]')?.addEventListener('click', () => openSettings());
  app.querySelector('[data-open-notes]')?.addEventListener('click', () => openNotes());
}

/* — mobile: Boards menu — */

export function listsMenuHTML() {
  return `
  <div class="screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Boards</h1>
        <span class="kicker">Stack'd</span>
      </div>
    </header>
    <div class="scroll-area">
      <div class="card list-card">
        ${S.lists.map((l) => `
        <div class="lrow ${l.id === S.currentList ? 'current' : ''}" data-id="${l.id}">
          <span class="lrow-icon">${icon('board', 18)}</span>
          <span class="lname">${esc(l.name)}</span>
          <span class="lcount num">${openCount(l.id)}</span>
        </div>`).join('')}
        <div class="lrow newlist" data-newlist>
          <span class="lrow-icon">${icon('plus', 18)}</span>
          <span class="lname">New board…</span>
        </div>
      </div>
      <span class="section-title list-label">Notes</span>
      <div class="card list-card">
        <div class="lrow" data-open-notes>
          <span class="lrow-icon">${icon('note', 18)}</span>
          <span class="lname">Notes</span>
          <span class="lcount num">${activeNotes().length}</span>
        </div>
      </div>
      <span class="section-title list-label">Folders</span>
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
  bindScrollShadow();
  app.querySelectorAll('.lrow[data-id]').forEach((row) =>
    row.addEventListener('click', () => {
      S.currentList = row.dataset.id; UI.screen = 'list'; commit();
    }));
  app.querySelector('[data-newlist]').addEventListener('click', newList);
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
      ${item('folders', 'Folders', 'folder')}
    </div>
    <button class="nav-fab" data-add aria-label="${UI.screen === 'notes' ? 'New note' : 'Add task'}">${icon('plus', 28)}</button>
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
  app.querySelector('.nav-fab')?.addEventListener('click', () => (UI.screen === 'notes' ? focusComposer() : openSheet()));
}

/* — desktop shell — */

export function desktopHTML() {
  const list = listById(S.currentList);
  const main = UI.screen === 'detail' ? detailHTML()
    : UI.screen === 'folders' ? foldersHTML()
    : UI.screen === 'settings' ? settingsHTML()
    : UI.screen === 'notes' ? notesHTML()
    : UI.screen === 'note' ? noteDetailHTML()
    : `
    <header class="main-head">
      <h1 class="page-title-text">${esc(list.name)}</h1>
      ${viewbarHTML()}
      ${S.view === 'kanban' ? `<button class="btn btn-primary btn-sm" data-add>${icon('plus', 18)}Add task</button>` : ''}
    </header>
    ${S.view === 'kanban' ? kanbanHTML({ desktop: true }) : desktopTableHTML()}`;
  /* a read-only (archived / deleted) detail belongs to the Folders section */
  const inFolders = UI.screen === 'folders'
    || (UI.screen === 'detail' && taskById(UI.detailId)?.status !== 'active')
    || (UI.screen === 'note' && noteById(UI.detailId)?.status !== 'active');
  const onNotes = UI.screen === 'notes' || (UI.screen === 'note' && !inFolders);
  const onBoard = !inFolders && !onNotes && UI.screen !== 'settings';
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <span class="section-title side-label">Boards</span>
      ${S.lists.map((l) => `
      <div class="side-item ${onBoard && l.id === S.currentList ? 'active' : ''}" data-id="${l.id}">
        <span class="name">${esc(l.name)}</span>
        <span class="count num">${openCount(l.id)}</span>
      </div>`).join('')}
      <div class="side-newlist"><button class="btn btn-secondary" data-newlist>${icon('plus', 16)}New board</button></div>
      <div class="side-item side-notes ${onNotes ? 'active' : ''}" data-open-notes>
        ${icon('note', 16)}
        <span class="name">Notes</span>
        <span class="count num">${activeNotes().length}</span>
      </div>
      <span class="section-title side-label">Folders</span>
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
  app.querySelectorAll('.side-item[data-id]').forEach((el) =>
    el.addEventListener('click', () => {
      S.currentList = el.dataset.id; UI.screen = 'list'; commit();
    }));
  app.querySelector('[data-newlist]').addEventListener('click', newList);
  bindFolderLinks();
  if (UI.screen === 'detail') { bindDetail(); return; }
  if (UI.screen === 'folders') { bindFolders(); return; }
  if (UI.screen === 'settings') { bindSettings(); return; }
  if (UI.screen === 'notes') { bindNotes(); return; }
  if (UI.screen === 'note') { bindNoteDetail(); return; }
  bindViewbar();
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
