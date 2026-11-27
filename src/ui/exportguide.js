/* Export (PRD 1.7.0 §06.2): three pages under Settings, as the import
   guide is: Boards and tasks, Fields, Type of file, then the file is made
   on the device and handed over (src/files.js). It changes nothing.

   The choices live here while the pages are open, and are kept for the
   next export until the app is closed. In the iPhone and Android apps the
   file goes to the system's share sheet (src/files.js). Every name on these pages is the
   person's own, but a board or a label may have come from an imported
   file: all of it is escaped. */

import { S, UI, activeLists, rerender } from '../store.js';
import { EXPORT_FIELDS, DEFAULT_FIELDS, FORMATS, selectTasks, taskValues, documentModel, makeExport, pdfMisses } from '../exporter.js';
import { saveFile } from '../files.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { noticeDialog, toast } from './primitives.js';
import { bindScrollShadow } from './board.js';

const plural = (n, word) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

let X = null;      // the choices, while the pages are open
let last = null;   // the choices of the last export, for the next one
export const exportOpen = () => !!X;

const boards = () => activeLists();
const options = () => ({ boardIds: [...X.boardIds], done: X.done, archived: X.archived, fields: [...X.fields], format: X.format, byList: X.byList, boxes: X.boxes, dateFormat: S.dateFormat });
const chosenTasks = () => selectTasks(S, options());
const countFor = (id) => selectTasks(S, { ...options(), boardIds: [id] }).length;

/** Opens the first page. Called from the Import and export sheet. */
export function startExport() {
  const live = new Set(boards().map((l) => l.id));
  /* own boards are ticked at first; a board shared with the person is offered, not ticked (decision 54) */
  const ticked = last ? last.boardIds.filter((id) => live.has(id)) : boards().filter((l) => !l.share).map((l) => l.id);
  X = {
    step: 0, boardIds: new Set(ticked),
    done: last?.done ?? true, archived: last?.archived ?? false,
    fields: new Set(last?.fields ?? DEFAULT_FIELDS),
    format: last?.format ?? 'xlsx', byList: last?.byList ?? true, boxes: last?.boxes ?? true,
  };
  UI.settingsScroll = UI.settingsPage ? UI.settingsScroll : { area: app.querySelector('.scroll-area')?.scrollTop || 0, main: app.querySelector('.main')?.scrollTop || 0 };
  UI.screen = 'settings'; UI.settingsPage = 'export';
  show();
}

/* ── Markup ──────────────────────────────────────────────────────────── */

const STEPS = ['boards', 'fields', 'type'];

const chrome = (title, lead, body, foot, primary, { disabled = false } = {}) => `
  <div class="screen settings-screen set-page guide">
    <header class="page-head detail-top">
      <button class="icon-btn" data-export-back aria-label="${X.step === 0 ? 'Close the export' : 'Back to the step before'}">${icon('chevronLeft')}</button>
      <span class="kicker">Export</span>
      <button class="icon-btn" data-export-close aria-label="Close the export">${icon('x')}</button>
    </header>
    <div class="scroll-area">
      <p class="guide-step">Step ${X.step + 1} of ${STEPS.length}</p>
      <h1 class="sub-title" tabindex="-1">${title}</h1>
      ${lead ? `<p class="guide-lead">${lead}</p>` : ''}
      ${body}
    </div>
    <div class="guide-foot">
      ${foot ? `<p class="guide-foot-note" aria-live="polite">${foot}</p>` : ''}
      <button type="button" class="btn btn-primary btn-block" data-export-next ${disabled ? 'disabled' : ''}>${primary}</button>
    </div>
  </div>`;

const checkRow = (title, sub, checked, attrs, { disabled = false } = {}) => `
        <label class="guide-row guide-check">
          <input type="checkbox" class="check sm" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${attrs}>
          <span class="guide-left"><span class="set-title">${esc(title)}</span>${sub ? `<span class="guide-sample">${esc(sub)}</span>` : ''}</span>
        </label>`;

/* two choices side by side, as the toggles in Settings (decision 9) */
const toggleRow = (title, sub, name, value, choices) => `
        <div class="set-row set-wrap">
          <div class="set-text"><span class="set-title">${title}</span>${sub ? `<span class="set-sub">${sub}</span>` : ''}</div>
          <div class="segmented solid" role="radiogroup" aria-label="${title}">
            ${choices.map(([v, label]) => `<button type="button" class="seg ${value === v ? 'active' : ''}" role="radio" aria-checked="${value === v}" data-${name}="${v}">${label}</button>`).join('')}
          </div>
        </div>`;

function boardsHTML() {
  const n = chosenTasks().length;
  const list = boards();
  return chrome('Boards and tasks', 'Choose the boards whose tasks go in the file. Nothing in Stack\'d changes.', `
      ${list.length ? `<div class="card list-card">
        ${list.map((l) => checkRow(l.name, [plural(countFor(l.id), 'task'), l.share ? 'shared with you' : ''].filter(Boolean).join(' · '), X.boardIds.has(l.id), `data-board="${esc(l.id)}"`)).join('')}
      </div>` : '<p class="sub-empty">You have no boards to export.</p>'}
      <div class="card list-card">
        ${toggleRow('Done tasks', '', 'done', X.done ? 'in' : 'out', [['in', 'Include'], ['out', 'Leave out']])}
        ${toggleRow('Archived tasks', '', 'archived', X.archived ? 'in' : 'out', [['in', 'Include'], ['out', 'Leave out']])}
      </div>
      <p class="hint set-hint">Deleted tasks are never in the file. Notes and meetings are not exported; Backup keeps everything.</p>`,
  `${plural(n, 'task')} selected`, 'Continue', { disabled: !n });
}

function fieldsHTML() {
  const n = EXPORT_FIELDS.filter(([k]) => k === 'title' || X.fields.has(k)).length;
  const same = DEFAULT_FIELDS.length === X.fields.size && DEFAULT_FIELDS.every((k) => X.fields.has(k));
  return chrome('Fields', 'Choose what each task brings with it.', `
      <div class="card list-card">
        ${EXPORT_FIELDS.map(([k, label]) => checkRow(label, k === 'title' ? 'Always in the file' : '', k === 'title' || X.fields.has(k), `data-field="${k}"`, { disabled: k === 'title' })).join('')}
      </div>
      <div class="guide-actions"><button type="button" class="btn btn-sm btn-secondary" data-fields-reset ${same ? 'disabled' : ''}>Reset</button></div>`,
  `${plural(n, 'field')} in each row`, 'Continue');
}

const ABOUT = {
  xlsx: 'A sheet for Excel, Numbers or Google Sheets, with real dates.',
  csv: 'Plain rows any spreadsheet or app can read.',
  pdf: 'A document to read, print or send.',
  docx: 'A document to read or change in Word, Pages or Google Docs.',
  json: 'Data for other apps and scripts.',
  xml: 'Data for other apps.',
};

function typeHTML() {
  const tasks = chosenTasks();
  const n = tasks.length;
  const doc = X.format === 'pdf' || X.format === 'docx';
  const misses = X.format === 'pdf' ? pdfMisses(S, options()) : 0;
  /* the first three as they will look: a line of what each brings */
  const fields = new Set(X.fields);
  const model = documentModel(tasks.slice(0, 3).map((t) => taskValues(S, t)), [...fields, 'title'], { byList: false, format: S.dateFormat });
  const first = model.flatMap((b) => b.groups.flatMap((g) => g.tasks.map((t) => ({ ...t, board: b.board }))));
  const names = [...new Set(tasks.map((t) => t.listId))].map((id) => boards().find((l) => l.id === id)?.name).filter(Boolean);
  const from = names.length === 1 ? `from ${names[0]}` : `from ${plural(names.length, 'board')}`;
  return chrome('Type of file', `${esc(plural(n, 'task'))} ${esc(from)}.`, `
      <div class="card list-card" role="radiogroup" aria-label="Type of file">
        ${FORMATS.map(([k, label]) => `
        <button type="button" class="guide-row guide-choice" role="radio" aria-checked="${X.format === k}" data-format="${k}">
          <span class="guide-radio" aria-hidden="true"></span>
          <span class="guide-left"><span class="set-title">${label}</span><span class="guide-sample wrap">${ABOUT[k]}</span></span>
        </button>`).join('')}
      </div>
      ${doc ? `<div class="card list-card">
        ${toggleRow('Group by list', 'A heading for each list, as on the board.', 'bylist', X.byList ? 'on' : 'off', [['on', 'By list'], ['off', 'One list']])}
        ${toggleRow('Subtasks', '', 'boxes', X.boxes ? 'on' : 'off', [['on', 'As boxes'], ['off', 'As a list']])}
      </div>` : ''}
      ${misses ? `<p class="hint set-hint">${esc(plural(misses, 'task'))} ${misses === 1 ? 'has' : 'have'} letters a PDF made here cannot show, such as those of Greek, Russian or Chinese; they print as "?". Word shows them.</p>` : ''}
      ${first.length ? `
      <span class="section-title list-label">${n === 1 ? 'The task' : n === 2 ? 'The two tasks' : 'The first three'}</span>
      <div class="card list-card">
        ${first.map((t) => `
        <div class="guide-row"><div class="guide-left"><span class="set-title">${esc(t.title)}</span><span class="guide-sample wrap">${esc([fields.has('board') ? t.board : '', ...t.meta, t.lines.length ? 'description' : '', t.subtasks.length ? plural(t.subtasks.length, 'subtask') : ''].filter(Boolean).join(' · '))}</span></div></div>`).join('')}
      </div>` : ''}`,
  '', n ? `Export ${plural(n, 'task')}` : 'Nothing to export', { disabled: !n });
}

const PAGES = { boards: boardsHTML, fields: fieldsHTML, type: typeHTML };

/** The page on show, or null when no export is open. */
export function exportHTML() {
  return X ? PAGES[STEPS[X.step]]() : null;
}

/* ── Behaviour ───────────────────────────────────────────────────────── */

function show() {
  rerender();
  const top = (sel) => { const el = app.querySelector(sel); if (el) el.scrollTop = 0; };
  top('.scroll-area'); top('.main');
  app.querySelector('.sub-title')?.focus({ preventScroll: true });
}
const redraw = (refocus) => { rerender(); if (refocus) app.querySelector(refocus)?.focus({ preventScroll: true }); };

function leave() {
  const at = UI.settingsScroll;
  X = null;
  UI.settingsPage = null; UI.settingsScroll = null;
  rerender();
  const put = (sel, v) => { const el = app.querySelector(sel); if (el && v) el.scrollTop = v; };
  put('.scroll-area', at?.area); put('.main', at?.main);
  app.querySelector('[data-open-transfer]')?.focus({ preventScroll: true });
}

async function finish() {
  let made;
  try { made = makeExport(S, { ...options(), now: new Date() }); } catch {
    await noticeDialog('No file was made', 'Something went wrong while making the file. Nothing was changed.');
    return;
  }
  if (!made.count) return;
  /* closing the share sheet without choosing leaves the pages as they are, with nothing said */
  let saved;
  try { saved = await saveFile(new Blob([made.bytes], { type: made.type }), made.name); } catch { saved = 'failed'; }
  if (saved === 'cancelled') return;
  if (saved !== 'handed') {
    await noticeDialog('No file was made', saved === 'failed' ? 'The file could not be written on this device. Nothing was changed.' : "This device cannot save files from Stack'd. Nothing was changed.");
    return;
  }
  last = options();
  leave();
  toast(`Exported ${plural(made.count, 'task')} as ${FORMATS.find(([k]) => k === last.format)?.[1] || 'a file'}`);
}

export function bindExport() {
  if (!X) return;
  bindScrollShadow();
  const q = (s) => app.querySelector(s);
  const qa = (s) => [...app.querySelectorAll(s)];
  q('[data-export-close]').addEventListener('click', leave);
  q('[data-export-back]').addEventListener('click', () => { if (X.step === 0) leave(); else { X.step -= 1; show(); } });
  q('[data-export-next]').addEventListener('click', () => { if (X.step === STEPS.length - 1) finish(); else { X.step += 1; show(); } });

  qa('[data-board]').forEach((b) => b.addEventListener('change', () => {
    if (b.checked) X.boardIds.add(b.dataset.board); else X.boardIds.delete(b.dataset.board);
    redraw(`[data-board="${CSS.escape(b.dataset.board)}"]`);
  }));
  qa('[data-done]').forEach((b) => b.addEventListener('click', () => { X.done = b.dataset.done === 'in'; redraw(`[data-done="${b.dataset.done}"]`); }));
  qa('[data-archived]').forEach((b) => b.addEventListener('click', () => { X.archived = b.dataset.archived === 'in'; redraw(`[data-archived="${b.dataset.archived}"]`); }));

  qa('[data-field]').forEach((b) => b.addEventListener('change', () => {
    if (b.checked) X.fields.add(b.dataset.field); else X.fields.delete(b.dataset.field);
    redraw(`[data-field="${b.dataset.field}"]`);
  }));
  q('[data-fields-reset]')?.addEventListener('click', () => { X.fields = new Set(DEFAULT_FIELDS); redraw('[data-field]:not(:disabled)'); });

  qa('[data-format]').forEach((b) => b.addEventListener('click', () => { X.format = b.dataset.format; redraw(`[data-format="${b.dataset.format}"]`); }));
  qa('[data-bylist]').forEach((b) => b.addEventListener('click', () => { X.byList = b.dataset.bylist === 'on'; redraw(`[data-bylist="${b.dataset.bylist}"]`); }));
  qa('[data-boxes]').forEach((b) => b.addEventListener('click', () => { X.boxes = b.dataset.boxes === 'on'; redraw(`[data-boxes="${b.dataset.boxes}"]`); }));
}
