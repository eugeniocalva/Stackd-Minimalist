/* The import guide (PRD 1.7.0 §06.1): pages under Settings, one question
   per page (decision 45). A file is read on the device into a table; the
   guide asks where its columns, lists and labels go, shows what would
   happen, and only then adds the tasks. Nothing that exists is changed, and
   the import can be undone.

   All the reading and deciding is in src/importer.js, which touches neither
   the page nor the store. This module holds the answers while the guide is
   open (G) and draws the step on show; the store adds the tasks
   (importTasks) and remembers the answers for the next file with the same
   columns (rememberImport, §06.4).

   Everything from a file is printed with esc(): a column name or a cell is
   text, never markup. */

import {
  S, UI, activeLists, listById, lanesOf, DONE_LANE, nameTaken, priorityById,
  importTasks, undoImport, rememberImport, importRoom, rerender,
} from '../store.js';
import {
  FIELDS, readUpload, tableOfPart, partName, guessMapping, signature, analyse, plan, defaultListChoice, parseDate, GuideError,
} from '../importer.js';
import { fmtDate } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { openMenu, noticeDialog, toast } from './primitives.js';
import { bindScrollShadow } from './board.js';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const plural = (n, word) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;
const refuse = (message) => noticeDialog('The file was not imported', `${message} Nothing was changed.`);

/* The answers so far; null when no guide is open. Lists and labels are
   kept in objects that inherit nothing: a list called "constructor" or
   "__proto__" is a list like any other. */
let G = null;
const bare = (entries = []) => Object.assign(Object.create(null), Object.fromEntries(entries));

export const guideOpen = () => !!G;

/* ── Starting: the file ──────────────────────────────────────────────── */

/** Opens the system's file picker. Called inside a tap, or the picker stays shut. */
export function startImport() {
  document.querySelectorAll('input[data-import-pick]').forEach((el) => el.remove());
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.json,.xml,text/csv,application/json,application/xml,text/xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.dataset.importPick = '';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => { const file = input.files?.[0]; input.remove(); if (file) open(file); });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

async function open(file) {
  if (file.size > MAX_FILE_BYTES) { refuse('This file is too large to import.'); return; }
  let read;
  try { read = await readUpload(file.name, await file.arrayBuffer()); } catch (e) {
    refuse(e instanceof GuideError ? e.message : 'This file could not be read.');
    return;
  }
  const settingsScroll = UI.settingsPage ? UI.settingsScroll : { area: app.querySelector('.scroll-area')?.scrollTop || 0, main: app.querySelector('.main')?.scrollTop || 0 };
  G = {
    fileName: file.name, read: null, parts: null, part: null, table: null, mapping: null, facts: null, layout: null, trusted: false,
    where: { mode: 'new', name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 80) || 'Imported', boardId: null },
    lists: bare(), labels: bare(), dateOrder: null, archived: 'leave', repeats: 'skip', step: 0,
  };
  try {
    if (read.kind === 'parts') {
      G.read = read; G.parts = read.parts;
      if (typeof read.doc?.name === 'string' && read.doc.name.trim()) G.where.name = read.doc.name.trim().slice(0, 80);
      /* open on the part suggested, or on the first one that can be read: one sheet too long does not refuse the file */
      let first = null, why = null;
      for (const p of [read.suggested, ...read.parts.filter((x) => x !== read.suggested)]) {
        try { usePart(p); first = p; break; } catch (e) { why ??= e; }
      }
      if (!first) throw why;
      /* a part (a sheet) imported before, with answers remembered, is the one to open on */
      if (!G.trusted && S.importLayouts.length && read.parts.length <= 12) {
        const known = read.parts.find((p) => { try { return p !== first && S.importLayouts.some((l) => l.signature === signature(tableOfPart(read, p).columns)); } catch { return false; } });
        if (known) { usePart(known); if (!G.trusted) usePart(first); }
      }
    } else useTable(read.table);
  } catch (e) {
    G = null;
    refuse(e instanceof GuideError ? e.message : 'This file could not be read.');
    return;
  }
  UI.settingsScroll = settingsScroll;
  UI.screen = 'settings'; UI.settingsPage = 'import';
  show();
}

/* part: one of G.parts, a sheet of an Excel file or a list of records inside a document */
function usePart(part) {
  useTable(tableOfPart(G.read, part));   // throws for a part that cannot be read: the one on show stays
  G.part = part.path;
}

/* A table is in: place its columns, and take the answers remembered for a
   file with the same columns, if there are any that still fit. */
function useTable(table) {
  G.table = table;
  const layout = S.importLayouts.find((l) => l.signature === signature(table.columns)) || null;
  const guess = guessMapping(table);
  const fits = !!layout && Object.values(layout.mapping).every((c) => !c || table.columns.includes(c)) && !!layout.mapping.title;
  G.layout = fits ? layout : null;
  G.trusted = fits;
  G.mapping = fits ? { ...guess, ...layout.mapping } : guess;
  G.labels = bare(fits ? layout.labels : []);
  G.archived = fits ? layout.archived : 'leave';
  G.repeats = fits ? layout.repeats : 'skip';
  G.dateOrder = fits ? layout.dateOrder : null;
  G.lists = bare();
  G.facts = analyse(table, G.mapping);
}

/* ── The steps that apply ────────────────────────────────────────────── */

const boards = () => activeLists().filter((l) => !l.share);
const targetLanes = () => (G.where.mode === 'board' ? lanesOf(G.where.boardId) : []);
const targetName = () => (G.where.mode === 'board' ? listById(G.where.boardId)?.name || '' : G.where.name.trim());
const remembered = (name) => G.layout?.lists.find(([n]) => n === name)?.[1] || null;

/* The lane each list of the file goes to on the board chosen: what was
   chosen in this guide, else what was remembered, else by its name. */
function listChoice(name) {
  if (G.lists[name]) return G.lists[name];
  const lanes = targetLanes();
  const was = remembered(name);
  if (was?.kind === 'done') return { kind: 'done' };
  if (was?.kind === 'lane') { const lane = lanes.find((l) => l.name.trim().toLowerCase() === was.name.toLowerCase()); return lane ? { kind: 'lane', id: lane.id } : { kind: 'new', name: was.name }; }
  if (was?.kind === 'new') { const lane = lanes.find((l) => l.name.trim().toLowerCase() === was.name.toLowerCase()); return lane ? { kind: 'lane', id: lane.id } : { kind: 'new', name: was.name }; }
  return defaultListChoice(name, lanes);
}
const dateOrder = () => G.dateOrder || (G.facts.dates === 'mdy' ? 'mdy' : 'dmy');

function steps() {
  const all = !G.trusted;
  const s = [];
  if (G.parts && all) s.push('part');
  if (all) s.push('columns');
  s.push('where');
  if (G.facts.lists.length && (all || G.facts.lists.some((l) => !remembered(l.name)))) s.push('lists');
  if (G.facts.labels.length && (all || G.facts.labels.some((l) => !(l.name in G.labels) && !G.layout))) s.push('labels');
  if (G.facts.dates === 'ambiguous' && (all || !G.layout?.dateOrder)) s.push('dates');
  s.push('review');
  return s;
}

function answers() {
  return {
    mapping: G.mapping,
    lists: Object.fromEntries(G.facts.lists.map((l) => [l.name, listChoice(l.name)])),
    labels: G.labels, dateOrder: dateOrder(), archived: G.archived, repeats: G.repeats,
  };
}
/* a link or number is kept with the layout it came from: 1, 2, 3 in one kind of file are not those of another */
const keyPrefix = () => signature(G.table.columns);
function makePlan(overrides = {}) {
  const boardId = G.where.mode === 'board' ? G.where.boardId : null;
  return plan(G.table, { ...answers(), ...overrides }, {
    lanes: targetLanes(), keyPrefix: keyPrefix(),
    /* a link or number is looked for on every task; a title only on the board the tasks go to */
    existing: S.tasks.filter((t) => t.status !== 'deleted' && (t.importKey || (boardId && t.listId === boardId && t.status === 'active')))
      .map((t) => ({ title: t.listId === boardId ? t.title : '', lane: t.lane, importKey: t.importKey || null })),
    priorities: S.priorities,
  });
}

/* ── Markup ──────────────────────────────────────────────────────────── */

const chrome = (title, lead, body, primary, { disabled = false } = {}) => {
  const all = steps();
  return `
  <div class="screen settings-screen set-page guide">
    <header class="page-head detail-top">
      <button class="icon-btn" data-guide-back aria-label="${G.step === 0 ? 'Close the import' : 'Back to the step before'}">${icon('chevronLeft')}</button>
      <span class="kicker">Import</span>
      <button class="icon-btn" data-guide-close aria-label="Close the import">${icon('x')}</button>
    </header>
    <div class="scroll-area">
      <p class="guide-step">Step ${G.step + 1} of ${all.length}</p>
      <h1 class="sub-title" tabindex="-1">${title}</h1>
      ${lead ? `<p class="guide-lead">${lead}</p>` : ''}
      ${body}
    </div>
    <div class="guide-foot"><button type="button" class="btn btn-primary btn-block" data-guide-next ${disabled ? 'disabled' : ''}>${primary}</button></div>
  </div>`;
};

const pickRow = (name, sample, value, attrs, { none = false } = {}) => `
        <div class="guide-row">
          <div class="guide-left"><span class="set-title">${esc(name)}</span>${sample ? `<span class="guide-sample">${esc(sample)}</span>` : ''}</div>
          <button type="button" class="guide-pick ${none ? 'none' : ''}" ${attrs} aria-haspopup="menu" aria-label="${esc(name)}: ${esc(value)}"><span>${esc(value)}</span>${icon('chevronDown', 16)}</button>
        </div>`;

const sampleOf = (columnName) => {
  const i = G.table.columns.indexOf(columnName);
  const v = i === -1 ? '' : (G.table.rows.find((r) => r[i] !== '')?.[i] || '');
  return v.replace(/\s+/g, ' ').slice(0, 60);
};

function partHTML() {
  const sheets = G.read.what === 'sheets';
  const lead = sheets
    ? `${esc(G.fileName)} has ${plural(G.parts.length, 'sheet')} with rows. Choose the one that holds your tasks.`
    : `${esc(G.fileName)} holds several lists of things. Choose the one that holds your tasks; the others are used to fill in names.`;
  return chrome(sheets ? 'Which sheet' : 'Which part', lead, `
      <div class="card list-card" role="radiogroup" aria-label="The ${sheets ? 'sheet' : 'part'} that holds the tasks">
        ${G.parts.map((p, i) => `
        <button type="button" class="guide-row guide-choice" role="radio" aria-checked="${p.path.join('/') === G.part.join('/')}" data-part="${i}">
          <span class="guide-radio" aria-hidden="true"></span>
          <span class="guide-left"><span class="set-title">${esc(partName(p))}</span><span class="guide-sample">${plural(p.count, sheets ? 'row' : 'item')} · ${esc(p.keys.slice(0, 4).join(', '))}</span></span>
        </button>`).join('')}
      </div>`, 'Continue');
}

function columnsHTML() {
  const unused = G.table.columns.length - new Set(Object.values(G.mapping).filter(Boolean)).size;
  return chrome('Columns', `${esc(G.fileName)} has ${plural(G.table.columns.length, 'column')} and ${plural(G.table.rows.length, 'row')}. Stack'd placed these by their names. Change any that are wrong.`, `
      <div class="card list-card">
        ${FIELDS.map(([key, label]) => pickRow(label, G.mapping[key] ? sampleOf(G.mapping[key]) : '', G.mapping[key] || 'Not in this file', `data-field="${key}"`, { none: !G.mapping[key] })).join('')}
      </div>
      <p class="hint set-hint">${unused > 0 ? `${plural(unused, 'other column')} ${unused === 1 ? 'is' : 'are'} not imported. ` : ''}Link or number is used to skip a card you imported before.</p>`,
  'Continue', { disabled: !G.mapping.title });
}

function whereHTML() {
  const mine = boards();
  const chosen = listById(G.where.boardId);
  return chrome('Where', 'The tasks are added to a board. Nothing you already have changes.', `
      <div class="card list-card" role="radiogroup" aria-label="Where the tasks go">
        <div class="guide-row">
          <button type="button" class="guide-radio-btn" role="radio" aria-checked="${G.where.mode === 'new'}" data-where="new" aria-label="A new board"><span class="guide-radio" aria-hidden="true"></span></button>
          <div class="guide-left">
            <label class="set-title" for="guide-board-name">A new board</label>
            <input class="input" id="guide-board-name" data-board-name value="${esc(G.where.name)}" maxlength="80" autocomplete="off" placeholder="Board name">
          </div>
        </div>
        ${mine.length ? `
        <div class="guide-row">
          <button type="button" class="guide-radio-btn" role="radio" aria-checked="${G.where.mode === 'board'}" data-where="board" aria-label="One of my boards"><span class="guide-radio" aria-hidden="true"></span></button>
          <div class="guide-left"><span class="set-title">One of my boards</span></div>
          <button type="button" class="guide-pick ${chosen ? '' : 'none'}" data-board-pick aria-haspopup="menu"><span>${esc(chosen ? chosen.name : 'Choose')}</span>${icon('chevronDown', 16)}</button>
        </div>` : ''}
      </div>
      ${G.trusted ? `
      <p class="hint set-hint">Stack'd remembers a file with these columns: the columns, lists and labels are filled in as last time.</p>
      <button type="button" class="btn btn-ghost btn-block set-under" data-guide-check>Check the answers</button>` : ''}`,
  'Continue');
}

const choiceLabel = (c) => (c.kind === 'done' ? 'Done' : c.kind === 'lane' ? (targetLanes().find((l) => l.id === c.id)?.name || 'New lane') : 'New lane');

function listsHTML() {
  const n = G.facts.lists.length;
  return chrome('Lists', `The file has ${plural(n, 'list')}. Choose the lane each one goes to on the board ${esc(targetName())}.`, `
      <div class="card list-card">
        ${G.facts.lists.map((l, i) => pickRow(l.name, plural(l.count, 'task'), choiceLabel(listChoice(l.name)), `data-list="${i}"`)).join('')}
      </div>
      <p class="hint set-hint">A new lane takes the list's name. Tasks sent to Done are marked complete.</p>`, 'Continue');
}

const labelValue = (name) => {
  const c = G.labels[name] ?? 'keep';
  return c === 'drop' ? 'Leave out' : c === 'keep' ? 'Keep as label' : `Priority: ${priorityById(c.priority)?.name || 'none'}`;
};

function labelsHTML() {
  const n = G.facts.labels.length;
  return chrome('Labels', `The file has ${plural(n, 'label')}. Each one stays a label unless you choose otherwise.`, `
      <div class="card list-card">
        ${G.facts.labels.map((l, i) => pickRow(l.name, plural(l.count, 'task'), labelValue(l.name), `data-label-pick="${i}"`)).join('')}
      </div>`, 'Continue');
}

function datesHTML() {
  const cols = [G.mapping.due, G.mapping.start].filter(Boolean).map((c) => G.table.columns.indexOf(c));
  const sample = G.table.rows.map((r) => cols.map((i) => r[i]).find((v) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(v || ''))).find(Boolean) || '';
  const read = (order) => { const d = parseDate(sample, order); return d ? fmtDate(d.date, 'ymd') : ''; };
  const option = (order, label) => `
        <button type="button" class="guide-row guide-choice" role="radio" aria-checked="${G.dateOrder === order}" data-date-order="${order}">
          <span class="guide-radio" aria-hidden="true"></span>
          <span class="guide-left"><span class="set-title">${label}</span><span class="guide-sample">${esc(sample)} is ${esc(read(order))}</span></span>
        </button>`;
  return chrome('Dates', 'The dates in this file can be read two ways. Which comes first, the day or the month?', `
      <div class="card list-card" role="radiogroup" aria-label="How dates are written">
        ${option('dmy', 'The day comes first')}
        ${option('mdy', 'The month comes first')}
      </div>
      <p class="hint set-hint">The second line shows the date as year, month, day.</p>`, 'Continue', { disabled: !G.dateOrder });
}

function reviewHTML() {
  const p = makePlan();
  const repeats = G.repeats === 'import' ? makePlan({ repeats: 'skip' }).skipped : p.skipped;
  const n = p.items.length;
  const laneOf = (it) => (it.lane.name || targetLanes().find((l) => l.id === it.lane.id)?.name || (it.lane.id === DONE_LANE ? 'Done' : ''));
  const bits = [
    G.where.mode === 'new' ? 'a new board' : '',
    G.where.mode === 'board' && p.counts.lanes ? plural(p.counts.lanes, 'new lane') : '',
    p.counts.labels ? plural(p.counts.labels, 'label') : '',
    p.counts.done ? `${p.counts.done.toLocaleString('en-GB')} marked complete` : '',
  ].filter(Boolean).join(' · ');
  const about = (it) => [
    laneOf(it), ...it.tags.map((t) => `#${t}`), it.priority !== 'none' ? priorityById(it.priority)?.name : '',
    it.due ? `due ${fmtDate(it.due, S.dateFormat)}` : '', it.description ? 'description' : '', it.subtasks.length ? plural(it.subtasks.length, 'subtask') : '',
  ].filter(Boolean).join(' · ');
  const unused = G.facts.unused.sort((a, b) => b.rows - a.rows);
  const notIn = [
    unused.length ? `Not imported: ${unused.slice(0, 4).map((u) => `${u.column} (${plural(u.rows, 'row')})`).join(', ')}${unused.length > 4 ? ` and ${plural(unused.length - 4, 'more column')}` : ''}.` : '',
    G.mapping.labels ? 'Colours of labels are not imported.' : '',
    p.leftOut.untitled ? `${plural(p.leftOut.untitled, 'row')} with no title ${p.leftOut.untitled === 1 ? 'is' : 'are'} left out.` : '',
    p.leftOut.priority ? `${plural(p.leftOut.priority, 'task')} ${p.leftOut.priority === 1 ? 'has' : 'have'} a priority Stack'd does not have, and get none.` : '',
    n > importRoom() ? `There is room for ${plural(importRoom(), 'more task')} in Stack'd: this import does not fit.` : '',
  ].filter(Boolean).join(' ');
  return chrome('Review', 'Nothing has changed yet.', `
      <div class="card list-card">
        <div class="guide-row">
          <div class="guide-left"><span class="set-title">${plural(n, 'task')} into ${esc(targetName())}</span>${bits ? `<span class="guide-sample wrap">${esc(bits)}</span>` : ''}</div>
        </div>
        ${repeats ? pickRow(`${repeats.toLocaleString('en-GB')} imported before`, G.mapping.key ? 'Same link or number as a task you have.' : 'Same lane and title as a task you have.', G.repeats === 'import' ? 'Import anyway' : 'Skip', 'data-repeats') : ''}
        ${G.facts.archived ? pickRow(`${G.facts.archived.toLocaleString('en-GB')} archived in the file`, '', G.archived === 'archive' ? 'Import as archived' : G.archived === 'active' ? 'Import as open' : 'Leave out', 'data-archived') : ''}
      </div>
      ${n ? `
      <span class="section-title list-label">${n === 1 ? 'The task' : n === 2 ? 'The two tasks' : 'The first three'}</span>
      <div class="card list-card">
        ${p.items.slice(0, 3).map((it) => `
        <div class="guide-row"><div class="guide-left"><span class="set-title">${esc(it.title)}</span><span class="guide-sample wrap">${esc(about(it))}</span></div></div>`).join('')}
      </div>` : ''}
      ${notIn ? `<p class="hint set-hint">${esc(notIn)}</p>` : ''}`,
  n ? `Import ${plural(n, 'task')}` : 'Nothing to import', { disabled: !n || n > importRoom() });
}

const PAGES = { part: partHTML, columns: columnsHTML, where: whereHTML, lists: listsHTML, labels: labelsHTML, dates: datesHTML, review: reviewHTML };
const current = () => { const all = steps(); G.step = Math.min(G.step, all.length - 1); return all[G.step]; };

/** The step on show, or null when no guide is open. */
export function guideHTML() {
  return G ? PAGES[current()]() : null;
}

/* ── Behaviour ───────────────────────────────────────────────────────── */

/* A new step starts at its top, with the keyboard's place on its title. */
function show() {
  rerender();
  const top = (sel) => { const el = app.querySelector(sel); if (el) el.scrollTop = 0; };
  top('.scroll-area'); top('.main');
  app.querySelector('.sub-title')?.focus({ preventScroll: true });
}
/* The same step again after an answer: the page stays where it is. */
const redraw = (refocus) => { rerender(); if (refocus) app.querySelector(refocus)?.focus({ preventScroll: true }); };

function leave() {
  const at = UI.settingsScroll;
  G = null;
  UI.settingsPage = null; UI.settingsScroll = null;
  rerender();
  const put = (sel, v) => { const el = app.querySelector(sel); if (el && v) el.scrollTop = v; };
  put('.scroll-area', at?.area); put('.main', at?.main);
  app.querySelector('[data-open-transfer]')?.focus({ preventScroll: true });
}

async function next() {
  const step = current();
  if (step === 'where') {
    if (G.where.mode === 'new') {
      const name = G.where.name.trim();
      if (!name) { await noticeDialog('The board needs a name', 'Type a name for the new board, or choose one of your boards.'); return; }
      if (nameTaken('board', name)) { await noticeDialog('That name is taken', `You already have a board called ${name}. Choose another name, or add the tasks to that board.`); return; }
    } else if (!boards().some((l) => l.id === G.where.boardId)) { await noticeDialog('Choose a board', 'Choose the board the tasks go to.'); return; }
  }
  if (step === 'review') { finish(); return; }
  G.step += 1;
  show();
}

function finish() {
  const p = makePlan();
  if (!p.items.length) return;
  const name = targetName();
  const lanes = targetLanes();
  const a = answers();
  /* remembered by name, so it fits another board next time */
  const layout = {
    name: G.layout?.name || `${plural(G.table.columns.length, 'column')}: ${G.table.columns.slice(0, 3).join(', ')}${G.table.columns.length > 3 ? '…' : ''}`.slice(0, 80),
    signature: signature(G.table.columns), columns: G.table.columns.length, part: G.part ? G.part.join('/') : null,
    mapping: G.mapping,
    lists: Object.entries(a.lists).map(([n, c]) => [n, c.kind === 'lane' ? { kind: 'lane', name: lanes.find((l) => l.id === c.id)?.name || n } : c.kind === 'new' ? { kind: 'new', name: c.name } : { kind: 'done' }]),
    labels: Object.keys(G.labels).map((k) => [k, G.labels[k]]).filter(([, c]) => c !== 'keep'),
    dateOrder: G.facts.dates === 'ambiguous' ? G.dateOrder : null, archived: G.archived, repeats: G.repeats,
  };
  const boardId = G.where.mode === 'board' ? G.where.boardId : null;
  const made = importTasks({ boardId, newBoard: name, items: p.items, show: true });
  if (made.error) {
    /* nothing was added and the guide stays open, with every answer in it */
    refuse(made.error === 'storage' ? 'There is not enough room on this device for these tasks. Empty Deleted or remove old tasks, then try again.'
      : made.error === 'too_many' ? `Stack'd holds up to 20,000 tasks, notes and meetings, and there is room for ${plural(importRoom(), 'more')}.`
      : 'That board can no longer take them. Go back and choose another.');
    return;
  }
  G = null;
  UI.settingsScroll = null;
  rememberImport(layout);
  toast(`Imported ${plural(made.taskIds.length, 'task')} into ${name}`, { ms: 12000, action: { label: 'Undo', onClick: () => { undoImport(made); toast('Import undone'); } } });
}

export function bindGuide() {
  if (!G) return;
  bindScrollShadow();
  const q = (s) => app.querySelector(s);
  const qa = (s) => [...app.querySelectorAll(s)];
  q('[data-guide-close]').addEventListener('click', leave);
  q('[data-guide-back]').addEventListener('click', () => { if (G.step === 0) leave(); else { G.step -= 1; show(); } });
  q('[data-guide-next]').addEventListener('click', next);

  /* which part */
  qa('[data-part]').forEach((b) => b.addEventListener('click', () => {
    try { usePart(G.parts[+b.dataset.part]); } catch (e) { refuse(e instanceof GuideError ? e.message : 'That part could not be read.'); return; }
    G.trusted = false;   // the question was asked: go through the columns too
    redraw(`[data-part="${b.dataset.part}"]`);
  }));

  /* columns: a column serves one field */
  qa('[data-field]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.field;
    const set = (name) => {
      if (name) Object.keys(G.mapping).forEach((k) => { if (G.mapping[k] === name) G.mapping[k] = null; });
      G.mapping[key] = name;
      G.facts = analyse(G.table, G.mapping);
      redraw(`[data-field="${key}"]`);
    };
    openMenu(b, [
      { label: 'Not in this file', checked: !G.mapping[key], onClick: () => set(null) },
      ...G.table.columns.map((c) => ({ label: c, checked: G.mapping[key] === c, onClick: () => set(c) })),
    ]);
  }));

  /* where */
  const name = q('[data-board-name]');
  if (name) {
    name.addEventListener('input', () => { G.where.name = name.value; });
    name.addEventListener('focus', () => { if (G.where.mode !== 'new') { G.where.mode = 'new'; G.lists = bare(); qa('[data-where]').forEach((r) => r.setAttribute('aria-checked', String(r.dataset.where === 'new'))); } });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); next(); } });
  }
  const pickBoard = (anchor) => openMenu(anchor, boards().map((l) => ({
    label: l.name, checked: G.where.boardId === l.id,
    onClick: () => { G.where.mode = 'board'; G.where.boardId = l.id; G.lists = bare(); redraw('[data-board-pick]'); },
  })));
  qa('[data-where]').forEach((r) => r.addEventListener('click', () => {
    if (r.dataset.where === 'board' && !G.where.boardId) { pickBoard(q('[data-board-pick]')); return; }
    G.where.mode = r.dataset.where; G.lists = bare();
    redraw(`[data-where="${r.dataset.where}"]`);
  }));
  q('[data-board-pick]')?.addEventListener('click', (e) => pickBoard(e.currentTarget));
  q('[data-guide-check]')?.addEventListener('click', () => { G.trusted = false; G.step = 0; show(); });

  /* lists → lanes */
  qa('[data-list]').forEach((b) => b.addEventListener('click', () => {
    const list = G.facts.lists[+b.dataset.list].name;
    const now = listChoice(list);
    const set = (c) => { G.lists[list] = c; redraw(`[data-list="${b.dataset.list}"]`); };
    openMenu(b, [
      { label: `A new lane called ${list}`, checked: now.kind === 'new', onClick: () => set({ kind: 'new', name: list.slice(0, 80) }) },
      ...targetLanes().filter((l) => l.id !== DONE_LANE).map((l) => ({ label: l.name, checked: now.kind === 'lane' && now.id === l.id, onClick: () => set({ kind: 'lane', id: l.id }) })),
      { label: 'Done', checked: now.kind === 'done', onClick: () => set({ kind: 'done' }) },
    ]);
  }));

  /* labels */
  qa('[data-label-pick]').forEach((b) => b.addEventListener('click', () => {
    const label = G.facts.labels[+b.dataset.labelPick].name;
    const now = G.labels[label] ?? 'keep';
    const set = (c) => { G.labels[label] = c; redraw(`[data-label-pick="${b.dataset.labelPick}"]`); };
    openMenu(b, [
      { label: 'Keep as label', checked: now === 'keep', onClick: () => set('keep') },
      ...S.priorities.map((p) => ({ label: `Priority: ${p.name}`, checked: now?.priority === p.id, onClick: () => set({ priority: p.id }) })),
      { label: 'Leave out', checked: now === 'drop', onClick: () => set('drop') },
    ]);
  }));

  /* dates */
  qa('[data-date-order]').forEach((b) => b.addEventListener('click', () => { G.dateOrder = b.dataset.dateOrder; redraw(`[data-date-order="${b.dataset.dateOrder}"]`); }));

  /* review */
  q('[data-repeats]')?.addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Skip', checked: G.repeats !== 'import', onClick: () => { G.repeats = 'skip'; redraw('[data-repeats]'); } },
    { label: 'Import anyway', checked: G.repeats === 'import', onClick: () => { G.repeats = 'import'; redraw('[data-repeats]'); } },
  ]));
  q('[data-archived]')?.addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Leave out', checked: G.archived === 'leave', onClick: () => { G.archived = 'leave'; redraw('[data-archived]'); } },
    { label: 'Import as archived', checked: G.archived === 'archive', onClick: () => { G.archived = 'archive'; redraw('[data-archived]'); } },
    { label: 'Import as open', checked: G.archived === 'active', onClick: () => { G.archived = 'active'; redraw('[data-archived]'); } },
  ]));
}
