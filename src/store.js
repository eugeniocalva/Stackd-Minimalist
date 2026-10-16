/* State, persistence, selectors and mutations. Every mutation ends in
   commit() (save + re-render); UI-only changes use rerender(). The renderer
   is injected by app.js so this module never imports the view layer. */

import { uid } from './util.js';
import { daysFrom } from './dates.js';

export const STORE_KEY = 'stackd-v1';
export const LANES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'inprogress', name: 'In Progress' },
  { id: 'done', name: 'Done' },
];
export const PRIORITIES = ['high', 'medium', 'low', 'none'];
export const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
export const REMINDERS = ['None', 'Morning · 9:00 AM', 'Noon · 12:00 PM', 'Evening · 6:00 PM'];

/* ── State ───────────────────────────────────────────────────────────── */

export let S = load() || seed();

/* transient UI state (not persisted) */
export const UI = {
  screen: 'list',        // mobile: 'lists' | 'list' | 'detail'
  detailId: null,
  sortMenu: false,
  refocusAddsub: false,
};
export const isDesktop = window.matchMedia('(min-width: 900px)');

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
export function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }
export function rerender() { renderer(); }
export function commit() { save(); renderer(); }

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

/* ── Selectors ───────────────────────────────────────────────────────── */

export const listById = (id) => S.lists.find((l) => l.id === id);
export const taskById = (id) => S.tasks.find((t) => t.id === id);
export const tasksOf = (listId) => S.tasks.filter((t) => t.listId === listId);
export const openCount = (listId) => tasksOf(listId).filter((t) => !t.done).length;

export function sortedTasks(listId) {
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

/* ── Mutations ───────────────────────────────────────────────────────── */

export function toggleDone(id) {
  const t = taskById(id); if (!t) return;
  t.done = !t.done;
  if (t.done) { t.lane = 'done'; S.lastAuto = Date.now(); }
  else if (t.lane === 'done') t.lane = 'backlog';
  commit();
}

export function deleteTask(id) {
  S.tasks = S.tasks.filter((t) => t.id !== id);
  if (UI.detailId === id) { UI.detailId = null; UI.screen = 'list'; }
  commit();
}

export function reorderTask(id, beforeId) {
  const ordered = sortedTasks(taskById(id).listId).filter((t) => t.id !== id);
  const idx = ordered.findIndex((t) => t.id === beforeId);
  ordered.splice(idx === -1 ? ordered.length : idx, 0, taskById(id));
  ordered.forEach((t, i) => { t.order = i; });
  commit();
}

export function moveToLane(id, lane) {
  const t = taskById(id); if (!t || !lane) return;
  t.lane = lane;
  t.done = lane === 'done';
  commit();
}

export function addTask(draft) {
  S.tasks.push({
    id: uid(), listId: draft.listId, title: draft.title, due: draft.due,
    priority: draft.priority, tags: draft.tags, subtasks: [], done: false,
    lane: draft.lane || 'backlog',
    order: Math.max(0, ...S.tasks.map((t) => t.order + 1)), reminder: 'None',
  });
  commit();
}

export function newList() {
  const name = prompt('New list name');
  if (!name || !name.trim()) return;
  const list = { id: uid(), name: name.trim() };
  S.lists.push(list);
  S.currentList = list.id;
  UI.screen = 'list';
  commit();
}
