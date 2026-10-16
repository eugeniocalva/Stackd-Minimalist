/* App chrome: onboarding, mobile Boards menu, mobile bottom nav + FAB,
   desktop shell with sidebar. */

import { S, UI, listById, taskById, openCount, addTask, newList, commit, rerender } from '../store.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import {
  viewbarHTML, kanbanHTML, desktopTableHTML,
  bindViewbar, bindChecks, bindKanban, bindRowGestures, bindReorder, bindScrollShadow,
} from './board.js';
import { detailHTML, bindDetail } from './detail.js';
import { openSheet } from './addsheet.js';

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
}

/* — mobile: bottom nav pill + FAB (board and Boards screens only) — */

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
    </div>
    <button class="nav-fab" data-add aria-label="Add task">${icon('plus', 28)}</button>
  </nav>`;
}

export function bindMobileNav() {
  app.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      if (UI.screen === b.dataset.nav) return;
      UI.screen = b.dataset.nav; rerender();
    }));
  app.querySelector('.nav-fab')?.addEventListener('click', () => openSheet());
}

/* — desktop shell — */

export function desktopHTML() {
  const list = listById(S.currentList);
  const main = UI.screen === 'detail' ? detailHTML() : `
    <header class="main-head">
      <h1 class="page-title-text">${esc(list.name)}</h1>
      ${viewbarHTML()}
      ${S.view === 'kanban' ? `<button class="btn btn-primary btn-sm" data-add>${icon('plus', 18)}Add task</button>` : ''}
    </header>
    ${S.view === 'kanban' ? kanbanHTML({ desktop: true }) : desktopTableHTML()}`;
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <span class="section-title side-label">Boards</span>
      ${S.lists.map((l) => `
      <div class="side-item ${l.id === S.currentList ? 'active' : ''}" data-id="${l.id}">
        <span class="name">${esc(l.name)}</span>
        <span class="count num">${openCount(l.id)}</span>
      </div>`).join('')}
      <div class="side-newlist"><button class="btn btn-secondary" data-newlist>${icon('plus', 16)}New board</button></div>
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
  if (UI.screen === 'detail') { bindDetail(); return; }
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
    bindReorder(row, row, t, '.tgrid-row');
  });
  bindKanban();
}
