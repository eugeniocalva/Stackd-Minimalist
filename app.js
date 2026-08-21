/* Stack'd — minimalist todo. Vanilla JS, no build step, localStorage persistence.
   Implements the turn-2 screens of the Claude Design canvas: mobile list /
   lists menu / kanban / detail / add-task sheet / dark mode, desktop sidebar
   list table + kanban. Gestures: double-tap complete, long-press delete,
   drag to reorder (manual sort), hold-and-drag kanban cards between lanes. */

'use strict';

const STORE_KEY = 'stackd-v1';
const LANES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'inprogress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];
const PRIORITIES = ['high', 'medium', 'low', 'none'];
const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
const REMINDERS = ['None', 'Morning · 9:00 AM', 'Noon · 12:00 PM', 'Evening · 6:00 PM'];

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

/* ── State ───────────────────────────────────────────────────────────── */

let S = load() || seed();

/* transient UI state (not persisted) */
const UI = {
  screen: 'list',        // mobile: 'lists' | 'list' | 'detail'
  detailId: null,
  sortMenu: false,
  refocusAddsub: false,
};
const isDesktop = window.matchMedia('(min-width: 900px)');

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

function seed() {
  const work = 'work', personal = 'personal', shopping = 'shopping', family = 'family';
  let o = 0;
  const t = (listId, title, extra = {}) => ({
    id: uid(), listId, title, due: null, priority: 'none', tags: [],
    subtasks: [], done: false, lane: 'backlog', order: o++, reminder: 'None', ...extra,
  });
  return {
    onboarded: false,
    currentList: work,
    view: 'list',
    sort: 'manual',
    lastAuto: null,
    lists: [
      { id: work, name: 'Work' },
      { id: personal, name: 'Personal' },
      { id: shopping, name: 'Shopping' },
      { id: family, name: 'Family' },
    ],
    tasks: [
      t(work, 'Prepare Q3 review deck', {
        due: daysFrom(7), priority: 'high', tags: ['q3'], lane: 'inprogress',
        reminder: 'Morning · 9:00 AM',
        subtasks: [
          { id: uid(), title: 'Pull revenue numbers', done: true },
          { id: uid(), title: 'Outline the narrative', done: true },
          { id: uid(), title: 'Design summary slides', done: false },
          { id: uid(), title: 'Dry-run with team', done: false },
        ],
      }),
      t(work, 'Email vendor about contract renewal', { due: daysFrom(0), tags: ['vendor'], lane: 'inprogress' }),
      t(work, 'Book 1:1s for next sprint', { priority: 'medium', tags: ['team'] }),
      t(work, 'Draft launch announcement', { due: daysFrom(9), tags: ['launch', 'comms'] }),
      t(work, 'Research analytics tools', { priority: 'low', tags: ['tooling'] }),
      t(work, 'Send weekly status update', { done: true, lane: 'done' }),
      t(personal, 'Call the dentist', { due: daysFrom(0), tags: ['health'] }),
      t(personal, 'Pick up dry cleaning', { tags: ['errand'] }),
      t(personal, 'Plan weekend trip', {}),
      t(personal, 'Water the plants', { done: true, lane: 'done' }),
      t(shopping, 'Milk and eggs', {}),
      t(shopping, 'Birthday card for Sam', { due: daysFrom(2) }),
      t(shopping, 'Replace desk lamp', { priority: 'low' }),
      t(family, 'Schedule school pickup rotation', { due: daysFrom(1) }),
      t(family, 'Fix the bike tire', {}),
    ],
  };
}

/* ── Derived helpers ─────────────────────────────────────────────────── */

const listById = (id) => S.lists.find((l) => l.id === id);
const taskById = (id) => S.tasks.find((t) => t.id === id);
const tasksOf = (listId) => S.tasks.filter((t) => t.listId === listId);
const openCount = (listId) => tasksOf(listId).filter((t) => !t.done).length;

function sortedTasks(listId) {
  const rank = { high: 3, medium: 2, low: 1, none: 0 };
  const ts = tasksOf(listId).slice();
  ts.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1; // completed sink to the bottom
    if (S.sort === 'due') {
      if (!!a.due !== !!b.due) return a.due ? -1 : 1;
      if (a.due !== b.due) return (a.due || '') < (b.due || '') ? -1 : 1;
    } else if (S.sort === 'priority') {
      if (rank[a.priority] !== rank[b.priority]) return rank[b.priority] - rank[a.priority];
    }
    return a.order - b.order;
  });
  return ts;
}

function fmtDue(due, { full = false } = {}) {
  const d = new Date(due + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((d - today) / 86400000);
  const accent = days <= 3;
  let label;
  if (days < 0) label = 'Overdue';
  else if (days === 0) label = 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days < 7) label = d.toLocaleDateString('en-US', { weekday: 'short' });
  else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (full) {
    label = 'Due ' + (days >= 0 && days < 7 && days > 1
      ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : days === 0 ? 'today' : days === 1 ? 'tomorrow'
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  return { label, cls: accent ? 'tag-accent' : 'tag-neutral', days };
}

const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/* ── Mutations ───────────────────────────────────────────────────────── */

function toggleDone(id) {
  const t = taskById(id); if (!t) return;
  t.done = !t.done;
  if (t.done) { t.lane = 'done'; S.lastAuto = Date.now(); }
  else if (t.lane === 'done') t.lane = 'backlog';
  save(); render();
}

function deleteTask(id) {
  S.tasks = S.tasks.filter((t) => t.id !== id);
  if (UI.detailId === id) { UI.detailId = null; UI.screen = 'list'; }
  save(); render();
}

function reorderTask(id, beforeId) {
  const ordered = sortedTasks(taskById(id).listId).filter((t) => t.id !== id);
  const idx = ordered.findIndex((t) => t.id === beforeId);
  ordered.splice(idx === -1 ? ordered.length : idx, 0, taskById(id));
  ordered.forEach((t, i) => { t.order = i; });
  save(); render();
}

function moveToLane(id, lane) {
  const t = taskById(id); if (!t || !lane) return;
  t.lane = lane;
  t.done = lane === 'done';
  save(); render();
}

function addTask(draft) {
  S.tasks.push({
    id: uid(), listId: draft.listId, title: draft.title, due: draft.due,
    priority: draft.priority, tags: draft.tags, subtasks: [], done: false,
    lane: draft.lane || 'backlog',
    order: Math.max(0, ...S.tasks.map((t) => t.order + 1)), reminder: 'None',
  });
  save(); render();
}

function newList() {
  const name = prompt('New list name');
  if (!name || !name.trim()) return;
  const list = { id: uid(), name: name.trim() };
  S.lists.push(list);
  S.currentList = list.id;
  UI.screen = 'list';
  save(); render();
}

/* ── Rendering ───────────────────────────────────────────────────────── */

const app = document.getElementById('app');

function render() {
  const focusAddsub = document.activeElement?.classList?.contains('addsub-input');
  if (!S.onboarded) { app.innerHTML = onboardingHTML(); bindOnboarding(); return; }

  if (isDesktop.matches) {
    app.innerHTML = desktopHTML();
    bindDesktop();
  } else {
    app.innerHTML =
      UI.screen === 'lists' ? listsMenuHTML()
      : UI.screen === 'detail' ? detailHTML()
      : mobileListHTML();
    if (UI.screen === 'lists') bindListsMenu();
    else if (UI.screen === 'detail') bindDetail();
    else bindMobileList();
  }
  if (focusAddsub || UI.refocusAddsub) {
    UI.refocusAddsub = false;
    document.querySelector('.addsub-input')?.focus();
  }
}

/* — onboarding (1a) — */

function onboardingHTML() {
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

function bindOnboarding() {
  app.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { S.onboarded = true; save(); render(); }));
}

/* — shared partials — */

function sortIcon(size = 13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`;
}

function viewbarHTML({ desktop = false } = {}) {
  const sortLabels = { manual: 'Sort', due: 'Due date', priority: 'Priority' };
  return `
  <div class="viewbar">
    <button class="vsw ${S.view === 'list' ? 'active' : ''}" data-view="list">List</button>
    <button class="vsw ${S.view === 'kanban' ? 'active' : ''}" data-view="kanban">Kanban</button>
    <span class="sortwrap">
      <button class="sortbtn" data-sortbtn>${sortIcon()}${esc(sortLabels[S.sort])}${desktop ? ' ▾' : ''}</button>
      ${UI.sortMenu ? `
      <div class="sortmenu">
        <button data-sort="manual" class="${S.sort === 'manual' ? 'active' : ''}">Manual</button>
        <button data-sort="due" class="${S.sort === 'due' ? 'active' : ''}">Due date</button>
        <button data-sort="priority" class="${S.sort === 'priority' ? 'active' : ''}">Priority</button>
      </div>` : ''}
    </span>
  </div>`;
}

function taskMetaHTML(t) {
  const bits = [];
  if (t.due) {
    const d = fmtDue(t.due);
    bits.push(`<span class="tag ${d.cls}">${d.days <= 3 && d.days >= 2 ? 'Due ' : ''}${esc(d.label)}</span>`);
  }
  if (t.priority !== 'none') bits.push(`<span class="tag tag-outline">${PRIORITY_LABEL[t.priority]}</span>`);
  t.tags.forEach((tag) => bits.push(`<span class="tag tag-neutral">#${esc(tag)}</span>`));
  if (t.subtasks.length) {
    const done = t.subtasks.filter((s) => s.done).length;
    bits.push(`<span class="t-sub num">${done}/${t.subtasks.length} subtasks</span>`);
  }
  return bits.length ? `<div class="t-meta">${bits.join('')}</div>` : '';
}

function kanbanHTML({ desktop = false } = {}) {
  const ts = tasksOf(S.currentList);
  const lanes = LANES.map((lane) => {
    const cards = ts.filter((t) => t.lane === lane.id);
    const headCls = lane.id === 'inprogress' ? 'active' : lane.id === 'done' ? 'muted' : '';
    return `
    <div class="lane" data-lane="${lane.id}">
      <div class="lane-head ${headCls}">
        <span class="lane-name">${lane.name}</span>
        <span class="lane-count num">${cards.length}</span>
      </div>
      <div class="lane-cards">
        ${cards.map((t) => t.done ? `
          <div class="kcard done-card" data-id="${t.id}">
            <input type="checkbox" aria-label="Toggle complete" class="check sm" checked data-id="${t.id}">
            <span class="t-title">${esc(t.title)}</span>
          </div>` : `
          <div class="kcard" data-id="${t.id}">
            <span class="t-title">${esc(t.title)}</span>
            ${taskMetaHTML(t)}
          </div>`).join('')}
        ${lane.id === 'done' && S.lastAuto
          ? `<span class="lane-note">Moved here automatically · ${fmtTime(S.lastAuto)}</span>`
          : `<button class="addcard" data-lane-add="${lane.id}">+ Add card</button>`}
      </div>
    </div>`;
  }).join('');
  return `
  <div class="autoline">
    <span class="dot"></span>
    <span class="txt">Automation${desktop ? ':' : ' on —'} ${desktop ? 'marking a task complete moves its card' : 'completed tasks move'} to <strong>Done</strong></span>
    ${desktop ? '<button class="edit" data-editrules>Edit rules</button>' : ''}
  </div>
  <div class="board ${desktop ? 'cols3' : ''}">${lanes}</div>
  ${desktop ? '' : '<div style="padding:0 20px 24px" class="mobile-only"><span class="hint">Swipe for more lanes · hold a card to move it</span></div>'}`;
}

/* — mobile: list screen (2a / 2c) — */

function mobileListHTML() {
  const list = listById(S.currentList);
  const ts = sortedTasks(S.currentList);
  const headCount = S.view === 'kanban'
    ? `${tasksOf(S.currentList).length} tasks` : `${openCount(S.currentList)} open`;
  const body = S.view === 'kanban' ? kanbanHTML() : `
    <div class="rows">
      ${ts.map((t) => `
      <div class="trow ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
        <div class="t-main">
          <span class="t-title">${esc(t.title)}</span>
          ${t.done ? '' : taskMetaHTML(t)}
        </div>
        ${t.done ? '' : '<span class="grip">⠿</span>'}
      </div>`).join('')}
    </div>
    <div class="list-footer">
      <span class="hint">Double-tap to complete · long-press to delete</span>
      <button class="fab" data-add>+</button>
    </div>`;
  return `
  <div class="screen">
    <div class="page-head">
      <div class="page-title-row">
        <h2 data-lists>${esc(list.name)} <span class="caret">▾</span></h2>
        <span class="kicker">${headCount}</span>
      </div>
      ${viewbarHTML()}
    </div>
    <div class="seam head-seam"></div>
    ${body}
  </div>`;
}

function bindMobileList() {
  bindViewbar();
  app.querySelector('[data-lists]').addEventListener('click', () => { UI.screen = 'lists'; render(); });
  app.querySelector('[data-add]')?.addEventListener('click', () => openSheet());
  bindChecks();
  app.querySelectorAll('.trow').forEach((row) => {
    const t = taskById(row.dataset.id);
    bindRowGestures(row, t);
    const grip = row.querySelector('.grip');
    if (grip) bindReorder(grip, row, t, '.trow');
  });
  bindKanban();
}

/* — mobile: lists menu (2b) — */

function listsMenuHTML() {
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

function bindListsMenu() {
  app.querySelectorAll('.lrow[data-id]').forEach((row) =>
    row.addEventListener('click', () => {
      S.currentList = row.dataset.id; UI.screen = 'list'; save(); render();
    }));
  app.querySelector('[data-newlist]').addEventListener('click', newList);
}

/* — task detail (2d) — */

function detailHTML() {
  const t = taskById(UI.detailId);
  if (!t) { UI.screen = 'list'; return mobileListHTML(); }
  const list = listById(t.listId);
  const done = t.subtasks.filter((s) => s.done).length;
  const pct = t.subtasks.length ? (done / t.subtasks.length) * 100 : 0;
  const tags = [];
  if (t.due) tags.push(`<span class="tag ${fmtDue(t.due).cls}">${esc(fmtDue(t.due, { full: true }).label)}</span>`);
  if (t.priority !== 'none') tags.push(`<span class="tag tag-outline">${{ high: 'High', medium: 'Medium', low: 'Low' }[t.priority]} priority</span>`);
  tags.push(`<span class="tag tag-neutral">${esc(list.name)}</span>`);
  t.tags.forEach((tag) => tags.push(`<span class="tag tag-neutral">#${esc(tag)}</span>`));
  return `
  <div class="screen detail-screen">
    <div class="detail-top">
      <button class="backlink" data-back>‹ ${esc(list.name)}</button>
      <span style="font-size:14px;color:var(--ink-55)">···</span>
    </div>
    <div class="detail-head">
      <div class="detail-title-row">
        <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
        <h2>${esc(t.title)}</h2>
      </div>
      <div class="detail-tags">${tags.join('')}</div>
    </div>
    <div class="seam head-seam"></div>
    <div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
      <div class="subhead">
        <span class="label">Subtasks</span>
        <span class="count num">${done} / ${t.subtasks.length}</span>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="subrows">
        ${t.subtasks.map((s) => `
        <div class="subrow ${s.done ? 'done' : ''}">
          <input type="checkbox" aria-label="Toggle complete" class="check sm" ${s.done ? 'checked' : ''} data-sub="${s.id}">
          <span class="s-title">${esc(s.title)}</span>
          <button class="s-del" data-subdel="${s.id}" aria-label="Delete subtask">✕</button>
        </div>`).join('')}
        <div class="subrow">
          <span class="addsub-dot"></span>
          <input class="addsub-input" placeholder="Add subtask…">
        </div>
      </div>
      <div class="seam" style="margin:8px 20px 0"></div>
      <div class="kv-row">
        <span>Reminder</span>
        <button class="val" data-reminder>${esc(t.reminder)} ▾</button>
      </div>
    </div>
    <div class="detail-footer">
      <button class="btn btn-ghost btn-block danger" data-del>Delete task</button>
    </div>
  </div>`;
}

function bindDetail() {
  const t = taskById(UI.detailId);
  if (!t) { render(); return; }
  app.querySelector('[data-back]').addEventListener('click', () => { UI.screen = 'list'; render(); });
  app.querySelector('.detail-title-row .check').addEventListener('change', () => toggleDone(t.id));
  app.querySelectorAll('[data-sub]').forEach((c) =>
    c.addEventListener('change', () => {
      const s = t.subtasks.find((s) => s.id === c.dataset.sub);
      s.done = !s.done; save(); render();
    }));
  app.querySelectorAll('[data-subdel]').forEach((b) =>
    b.addEventListener('click', () => {
      t.subtasks = t.subtasks.filter((s) => s.id !== b.dataset.subdel);
      save(); render();
    }));
  const input = app.querySelector('.addsub-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      t.subtasks.push({ id: uid(), title: input.value.trim(), done: false });
      UI.refocusAddsub = true;
      save(); render();
    }
  });
  app.querySelector('[data-reminder]').addEventListener('click', () => {
    t.reminder = REMINDERS[(REMINDERS.indexOf(t.reminder) + 1) % REMINDERS.length];
    save(); render();
  });
  app.querySelector('[data-del]').addEventListener('click', () => {
    if (confirm(`Delete "${t.title}"?`)) deleteTask(t.id);
  });
}

/* — desktop shell (2g / 2h) — */

function desktopHTML() {
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

function desktopTableHTML() {
  const ts = sortedTasks(S.currentList);
  return `
  <div class="quickadd">
    <input class="input" placeholder="Add a task — press Enter" data-quickadd>
    <button class="btn btn-primary" data-quickadd-btn>Add</button>
  </div>
  <div class="tgrid tgrid-head">
    <span></span><span>Task</span><span>Due</span><span>Priority</span><span>Subtasks</span>
  </div>
  <div class="seam"></div>
  <div class="tgrid-rows">
    ${ts.map((t) => {
      const due = t.due ? fmtDue(t.due) : null;
      const sub = t.subtasks.length
        ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : null;
      return `
      <div class="tgrid tgrid-row ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" aria-label="Toggle complete" class="check" ${t.done ? 'checked' : ''} data-id="${t.id}">
        <span class="t-title">${esc(t.title)}</span>
        ${t.done ? '<span></span><span></span><span></span>' : `
        ${due ? `<span class="tag ${due.cls}">${esc(due.label)}</span>` : '<span class="cell-muted">—</span>'}
        ${t.priority !== 'none' ? `<span class="tag tag-outline">${PRIORITY_LABEL[t.priority]}</span>` : '<span class="cell-muted">—</span>'}
        ${sub ? `<span class="cell-num num">${sub}</span>` : '<span class="cell-muted">—</span>'}`}
      </div>`;
    }).join('')}
  </div>
  <span class="hint">Drag rows to reprioritize · double-click a task to complete</span>`;
}

function bindDesktop() {
  app.querySelectorAll('.side-item[data-id]').forEach((el) =>
    el.addEventListener('click', () => {
      S.currentList = el.dataset.id; UI.screen = 'list'; save(); render();
    }));
  app.querySelector('[data-newlist]').addEventListener('click', newList);
  if (UI.screen === 'detail') { bindDetail(); return; }
  bindViewbar();
  bindChecks();
  app.querySelector('[data-add]')?.addEventListener('click', () => openSheet());
  const qa = app.querySelector('[data-quickadd]');
  if (qa) {
    const commit = () => {
      if (!qa.value.trim()) return;
      addTask({ listId: S.currentList, title: qa.value.trim(), due: null, priority: 'none', tags: [] });
    };
    qa.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    app.querySelector('[data-quickadd-btn]').addEventListener('click', commit);
  }
  app.querySelectorAll('.tgrid-row').forEach((row) => {
    const t = taskById(row.dataset.id);
    bindRowGestures(row, t);
    bindReorder(row, row, t, '.tgrid-row');
  });
  bindKanban();
}

/* — shared bindings — */

function bindViewbar() {
  app.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => { S.view = b.dataset.view; save(); render(); }));
  app.querySelector('[data-sortbtn]')?.addEventListener('click', () => {
    UI.sortMenu = !UI.sortMenu; render();
  });
  app.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      S.sort = b.dataset.sort; UI.sortMenu = false; save(); render();
    }));
}

function bindChecks() {
  app.querySelectorAll('.check[data-id]').forEach((c) => {
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('change', () => toggleDone(c.dataset.id));
  });
}

function bindKanban() {
  app.querySelectorAll('.kcard').forEach((card) => bindCard(card, taskById(card.dataset.id)));
  app.querySelectorAll('[data-lane-add]').forEach((b) =>
    b.addEventListener('click', () => openSheet({ lane: b.dataset.laneAdd })));
  app.querySelector('[data-editrules]')?.addEventListener('click', () =>
    alert('One automation is active:\n\nMarking a task complete moves its card to Done.\n\nCustom rules are on the roadmap.'));
}

/* ── Gestures ────────────────────────────────────────────────────────── */

/* single tap → detail, double tap → complete, long-press → delete */
function bindRowGestures(el, task) {
  let clickTimer = null, lpTimer = null, lpFired = false, sx = 0, sy = 0;
  el.addEventListener('click', (e) => {
    if (e.target.closest('.check,.grip') || el.dataset.dragged) { delete el.dataset.dragged; return; }
    if (lpFired) { lpFired = false; return; }
    if (clickTimer) {
      clearTimeout(clickTimer); clickTimer = null;
      toggleDone(task.id);
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; openDetail(task.id); }, 260);
    }
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.check,.grip')) return;
    sx = e.clientX; sy = e.clientY;
    lpTimer = setTimeout(() => {
      lpTimer = null; lpFired = true;
      if (confirm(`Delete "${task.title}"?`)) deleteTask(task.id);
    }, 550);
  });
  const cancelLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
  el.addEventListener('pointerup', cancelLp);
  el.addEventListener('pointercancel', cancelLp);
  el.addEventListener('pointermove', (e) => {
    if (lpTimer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancelLp();
  });
}

function openDetail(id) {
  if (!taskById(id)) return;
  UI.detailId = id; UI.screen = 'detail'; render();
}

/* drag a row (via handle or the row itself) to reorder — manual sort only */
function bindReorder(dragEl, rowEl, task, rowSel) {
  dragEl.addEventListener('pointerdown', (e) => {
    if (S.sort !== 'manual' || task.done) return;
    if (dragEl === rowEl && e.target.closest('.check')) return;
    let dragging = false, over = null;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const threshold = dragEl === rowEl ? 8 : 4;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > threshold) {
        dragging = true;
        try { dragEl.setPointerCapture(pid); } catch {}
        rowEl.classList.add('dragging');
        rowEl.dataset.dragged = '1';
      }
      if (!dragging) return;
      ev.preventDefault();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(rowSel);
      if (over && over !== target) over.classList.remove('dropover');
      over = target && target !== rowEl ? target : null;
      if (over) over.classList.add('dropover');
    };
    const up = () => {
      dragEl.removeEventListener('pointermove', move);
      dragEl.removeEventListener('pointercancel', up);
      rowEl.classList.remove('dragging');
      over?.classList.remove('dropover');
      if (dragging && over) reorderTask(task.id, over.dataset.id);
    };
    dragEl.addEventListener('pointermove', move);
    dragEl.addEventListener('pointerup', up, { once: true });
    dragEl.addEventListener('pointercancel', up);
    if (dragEl !== rowEl) e.preventDefault(); // grip: don't scroll
  });
  if (dragEl !== rowEl) dragEl.style.touchAction = 'none';
}

/* kanban card: tap → detail; mouse-drag or touch hold-drag → move lane */
function bindCard(card, task) {
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.check')) return;
    let dragging = false, overLane = null, held = false;
    const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
    const isTouch = e.pointerType === 'touch';
    const holdTimer = isTouch ? setTimeout(() => { held = true; startDrag(); }, 350) : null;
    const startDrag = () => {
      dragging = true;
      try { card.setPointerCapture(pid); } catch {}
      card.classList.add('dragging');
    };
    const blockScroll = (ev) => { if (dragging) ev.preventDefault(); };
    card.addEventListener('touchmove', blockScroll, { passive: false });
    const move = (ev) => {
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!dragging && !isTouch && dist > 8) startDrag();
      if (!dragging) { if (isTouch && dist > 10 && holdTimer) clearTimeout(holdTimer); return; }
      const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lane');
      if (overLane && overLane !== lane) overLane.classList.remove('dropover');
      overLane = lane;
      lane?.classList.add('dropover');
    };
    const up = () => {
      if (holdTimer) clearTimeout(holdTimer);
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointercancel', up);
      card.removeEventListener('touchmove', blockScroll);
      card.classList.remove('dragging');
      overLane?.classList.remove('dropover');
      if (dragging && overLane && overLane.dataset.lane !== task.lane) {
        moveToLane(task.id, overLane.dataset.lane);
      } else if (!dragging && !held) {
        openDetail(task.id);
      } else if (dragging) render();
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up, { once: true });
    card.addEventListener('pointercancel', up);
  });
}

/* ── Add-task sheet (2e) ─────────────────────────────────────────────── */

function openSheet({ lane } = {}) {
  const draft = {
    listId: S.currentList, title: '', due: null, priority: 'none', tags: [], lane,
  };
  const allTags = [...new Set(S.tasks.flatMap((t) => t.tags))];
  const dueOpts = [
    { label: 'Today', value: daysFrom(0) },
    { label: 'Tomorrow', value: daysFrom(1) },
    { label: 'Next week', value: daysFrom(7) },
  ];
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet">
    <div class="sheet-head">
      <span class="label">New task</span>
      <button class="sheet-close" data-close>✕</button>
    </div>
    <input class="sheet-title" placeholder="What needs doing?" autofocus>
    <div class="chip-group">
      <span class="microlabel">Due</span>
      <div class="chip-row" data-due>
        ${dueOpts.map((o) => `<button class="chip" data-val="${o.value}">${o.label}</button>`).join('')}
        <button class="chip" data-pick>Pick date…</button>
        <input type="date" style="position:absolute;width:0;height:0;opacity:0" data-date>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Priority</span>
      <div class="chip-row" data-priority>
        ${PRIORITIES.map((p) => `<button class="chip ${p === 'none' ? 'on' : ''}" data-val="${p}">${p === 'none' ? 'None' : { high: 'High', medium: 'Medium', low: 'Low' }[p]}</button>`).join('')}
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">Tags</span>
      <div class="chip-row" data-tags>
        ${allTags.map((t) => `<button class="chip neutral" data-val="${esc(t)}">#${esc(t)}</button>`).join('')}
        <button class="chip" data-addtag>+ Add tag</button>
      </div>
    </div>
    <div class="chip-group">
      <span class="microlabel">List</span>
      <div class="chip-row" data-list>
        ${S.lists.map((l) => `<button class="chip ${l.id === draft.listId ? 'on' : ''}" data-val="${l.id}">${esc(l.name)}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-block" data-submit>Add task</button>
  </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);
  q('.sheet-title').focus();

  const selectOne = (rowSel, chip) => {
    ov.querySelectorAll(`${rowSel} .chip`).forEach((c) => c.classList.remove('on'));
    chip?.classList.add('on');
  };
  q('[data-due]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    if (chip.dataset.pick !== undefined) {
      const di = q('[data-date]');
      di.onchange = () => {
        if (!di.value) return;
        draft.due = di.value;
        selectOne('[data-due]', chip);
        chip.textContent = fmtDue(di.value).label;
      };
      di.showPicker ? di.showPicker() : di.click();
      return;
    }
    if (chip.classList.contains('on')) { draft.due = null; selectOne('[data-due]', null); }
    else { draft.due = chip.dataset.val; selectOne('[data-due]', chip); }
  });
  q('[data-priority]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    draft.priority = chip.dataset.val;
    selectOne('[data-priority]', chip);
  });
  q('[data-tags]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    if (chip.dataset.addtag !== undefined) {
      const name = prompt('Tag name')?.trim().replace(/^#/, '');
      if (!name) return;
      draft.tags.push(name);
      const nc = document.createElement('button');
      nc.className = 'chip neutral on';
      nc.dataset.val = name;
      nc.textContent = '#' + name;
      chip.before(nc);
      return;
    }
    chip.classList.toggle('on');
    const v = chip.dataset.val;
    draft.tags = chip.classList.contains('on')
      ? [...draft.tags, v] : draft.tags.filter((t) => t !== v);
  });
  q('[data-list]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    draft.listId = chip.dataset.val;
    selectOne('[data-list]', chip);
  });
  const submit = () => {
    draft.title = q('.sheet-title').value.trim();
    if (!draft.title) { q('.sheet-title').focus(); return; }
    close();
    S.currentList = draft.listId;
    addTask(draft);
  };
  q('[data-submit]').addEventListener('click', submit);
  q('.sheet-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

/* ── Boot ────────────────────────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  if (UI.sortMenu && !e.target.closest('.sortwrap')) { UI.sortMenu = false; render(); }
});
isDesktop.addEventListener('change', render);
render();
