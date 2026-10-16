/* App chrome: onboarding (1a), mobile lists menu (2b), desktop shell with
   sidebar (2g / 2h). */

import { S, UI, listById, taskById, openCount, addTask, newList, commit } from '../store.js';
import { esc, app } from '../util.js';
import {
  viewbarHTML, kanbanHTML, desktopTableHTML,
  bindViewbar, bindChecks, bindKanban, bindRowGestures, bindReorder,
} from './board.js';
import { detailHTML, bindDetail } from './detail.js';
import { openSheet } from './addsheet.js';

/* — onboarding (1a) — */

export function onboardingHTML() {
  return `
  <div class="screen">
    <div class="onboarding">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <div class="onboarding-hero">
        <h1><span>Simplify.</span><span>Focus.</span><span class="accent">Achieve.</span></h1>
        <div class="onboarding-points">
          <div><span class="point-square"></span><span>One list, nothing else on screen.</span></div>
          <div><span class="point-square"></span><span>Drag to prioritize. Double-tap to finish.</span></div>
          <div><span class="point-square"></span><span>Lists and boards, synced everywhere.</span></div>
        </div>
      </div>
      <div class="onboarding-actions">
        <button class="btn btn-primary btn-block" style="min-height:52px;font-size:16px" data-go>Get started</button>
        <button class="btn btn-ghost btn-block" style="min-height:48px;justify-content:center" data-go>I have an account</button>
      </div>
    </div>
  </div>`;
}

export function bindOnboarding() {
  app.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { S.onboarded = true; commit(); }));
}

/* — mobile: lists menu (2b) — */

export function listsMenuHTML() {
  return `
  <div class="screen">
    <div class="lists-head">
      <span class="kicker">Stack'd</span>
      <h2>Lists</h2>
    </div>
    <div class="seam head-seam"></div>
    <div style="flex:1;display:flex;flex-direction:column;gap:4px;padding-top:10px;overflow-y:auto">
      ${S.lists.map((l) => `
      <div class="lrow" data-id="${l.id}">
        <span class="ldot ${l.id === S.currentList ? 'accent' : ''}"></span>
        <span class="lname ${l.id === S.currentList ? 'current' : ''}">${esc(l.name)}</span>
        <span class="lcount num">${openCount(l.id)}</span>
      </div>`).join('')}
      <div class="lrow newlist" data-newlist>
        <span class="ldot new"></span>
        <span class="lname">New list…</span>
      </div>
    </div>
    <div style="padding:14px 20px 26px">
      <span class="hint">Synced 2 min ago · free account</span>
    </div>
  </div>`;
}

export function bindListsMenu() {
  app.querySelectorAll('.lrow[data-id]').forEach((row) =>
    row.addEventListener('click', () => {
      S.currentList = row.dataset.id; UI.screen = 'list'; commit();
    }));
  app.querySelector('[data-newlist]').addEventListener('click', newList);
}

/* — desktop shell (2g / 2h) — */

export function desktopHTML() {
  const list = listById(S.currentList);
  const main = UI.screen === 'detail' ? detailHTML() : `
    <div class="main-head">
      <h1>${S.view === 'kanban' ? '<span class="list-square"></span>' : ''}${esc(list.name)}</h1>
      ${viewbarHTML({ desktop: true })}
      ${S.view === 'kanban' ? '<button class="btn btn-primary" style="margin:0" data-add>+ Add task</button>' : ''}
    </div>
    ${S.view === 'kanban' ? kanbanHTML({ desktop: true }) : desktopTableHTML()}`;
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark"></div><div class="brand-name">STACK'D</div></div>
      <div style="display:flex;flex-direction:column">
        <span class="side-label">Lists</span>
        ${S.lists.map((l) => `
        <div class="side-item ${l.id === S.currentList ? 'active' : ''}" data-id="${l.id}">
          <span class="name">${esc(l.name)}</span>
          <span class="count num">${openCount(l.id)}</span>
        </div>`).join('')}
        <div class="side-newlist"><button class="btn btn-secondary" data-newlist>+ New list</button></div>
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
