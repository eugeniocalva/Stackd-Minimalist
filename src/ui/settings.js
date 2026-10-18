/* Settings: Appearance (theme), Priorities (levels: rename, colour, order,
   add, delete), Labels (rename, merge, add, delete) and Automations (the
   built-in rule; custom rules come later). Names edit in place: Enter or
   leaving the field saves, Esc reverts. */

import {
  S, UI, PRIORITY_COLORS, THEMES, allTags, tagUseCounts, priorityUseCount,
  setTheme, addPriority, updatePriority, movePriority, deletePriority,
  addLabel, renameLabel, deleteLabel, rerender,
} from '../store.js';
import { resolvedTheme } from '../theme.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow } from './board.js';
import { confirmDialog, openMenu } from './primitives.js';

const THEME_LABEL = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_ICON = { light: 'sun', dark: 'moon', system: 'monitor' };
const COLOR_NAME = { red: 'Red', amber: 'Amber', green: 'Green', blue: 'Blue', violet: 'Violet', gray: 'Gray' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();

/** section: 'appearance' | 'priorities' | 'labels' | 'automations' */
export function openSettings(section) {
  UI.screen = 'settings';
  rerender();
  if (section) app.querySelector(`#settings-${section}`)?.scrollIntoView({ block: 'start' });
}

/* — rows — */

const themeSub = () => (S.theme === 'system'
  ? `Following the system · ${resolvedTheme()} now`
  : `${THEME_LABEL[S.theme]} mode on`);

function priorityRowHTML(p, i, n) {
  return `
  <div class="set-row" data-prio="${p.id}">
    <button class="lrow-icon pc pc-${p.color}" data-color aria-label="Colour: ${COLOR_NAME[p.color]}" title="Change colour">${icon('flag', 18)}</button>
    <div class="set-text">
      <input class="set-input" data-name value="${esc(p.name)}" maxlength="24" autocomplete="off" aria-label="Priority name">
      <span class="set-sub">${plural(priorityUseCount(p.id), 'task')}</span>
    </div>
    <div class="set-actions">
      <button class="set-btn" data-move="-1" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 18)}</button>
      <button class="set-btn" data-move="1" aria-label="Move ${esc(p.name)} down" ${i === n - 1 ? 'disabled' : ''}>${icon('chevronDown', 18)}</button>
      <button class="set-btn danger" data-delete aria-label="Delete ${esc(p.name)}">${icon('trash', 18)}</button>
    </div>
  </div>`;
}

function labelRowHTML(name) {
  const use = tagUseCounts(name);
  const sub = use.notes ? `${plural(use.tasks, 'task')} · ${plural(use.notes, 'note')}` : plural(use.tasks, 'task');
  return `
  <div class="set-row" data-label="${esc(name)}">
    <span class="lrow-icon">${icon('tag', 18)}</span>
    <div class="set-text">
      <input class="set-input" data-name value="${esc(name)}" maxlength="32" autocomplete="off" autocapitalize="none" aria-label="Label name">
      <span class="set-sub">${sub}</span>
    </div>
    <div class="set-actions">
      <button class="set-btn danger" data-delete aria-label="Delete label ${esc(name)}">${icon('trash', 18)}</button>
    </div>
  </div>`;
}

const addRowHTML = (attr, label) => `
  <div class="set-row set-add">
    <span class="lrow-icon dashed">${icon('plus', 18)}</span>
    <input class="set-input" ${attr} placeholder="${label}" maxlength="32" autocomplete="off" aria-label="${label}">
  </div>`;

/* — screen — */

export function settingsHTML() {
  const labels = allTags().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const n = S.priorities.length;
  return `
  <div class="screen settings-screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Settings</h1>
        <span class="kicker">Stack'd</span>
      </div>
    </header>
    <div class="scroll-area">
      <span class="section-title list-label" id="settings-appearance">Appearance</span>
      <div class="card list-card">
        <div class="set-row set-wrap">
          <span class="lrow-icon">${icon(THEME_ICON[S.theme], 18)}</span>
          <div class="set-text">
            <span class="set-title">Theme</span>
            <span class="set-sub">${themeSub()}</span>
          </div>
          <div class="segmented solid" role="radiogroup" aria-label="Theme">
            ${THEMES.map((t) => `<button class="seg ${S.theme === t ? 'active' : ''}" role="radio" aria-checked="${S.theme === t}" data-theme-opt="${t}">${THEME_LABEL[t]}</button>`).join('')}
          </div>
        </div>
      </div>

      <span class="section-title list-label" id="settings-priorities">Priorities</span>
      <div class="card list-card" data-priorities>
        ${S.priorities.map((p, i) => priorityRowHTML(p, i, n)).join('')}
        ${addRowHTML('data-add-priority', 'Add priority')}
      </div>
      <p class="hint set-hint">Highest first: Sort by priority follows this order, and tasks with no priority come last.</p>

      <span class="section-title list-label" id="settings-labels">Labels</span>
      <div class="card list-card" data-labels>
        ${labels.map(labelRowHTML).join('')}
        ${addRowHTML('data-add-label', 'Add label')}
      </div>
      <p class="hint set-hint">Renaming a label updates every task and note that has it; renaming it to an existing label merges the two.</p>

      <span class="section-title list-label" id="settings-automations">Automations</span>
      <div class="card list-card">
        <div class="set-row">
          <span class="lrow-icon">${icon('zap', 18)}</span>
          <div class="set-text">
            <span class="set-title">Completed tasks move to Done</span>
            <span class="set-sub">Built in · repeating tasks roll to their next date instead</span>
          </div>
          <span class="tag pc pc-green">On</span>
        </div>
        <div class="set-row is-disabled" aria-disabled="true">
          <span class="lrow-icon dashed">${icon('plus', 18)}</span>
          <div class="set-text">
            <span class="set-title">New automation</span>
            <span class="set-sub">Custom rules are coming soon</span>
          </div>
          <span class="tag">Soon</span>
        </div>
      </div>
    </div>
  </div>`;
}

/** Enter or blur saves through save(value); Esc restores the old name. */
function bindName(input, save) {
  const original = input.value;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = original; input.blur(); }
  });
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (!v || v === original) { input.value = original; return; }
    save(v);
  });
}

/** Enter adds and keeps the field focused for the next one; blur adds too. */
function bindAdd(selector, add) {
  const input = app.querySelector(selector);
  const take = () => { const v = input.value.trim(); input.value = ''; if (v) add(v); };
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    take();
    app.querySelector(selector)?.focus();
  });
  input.addEventListener('change', take);
}

export function bindSettings() {
  bindScrollShadow();

  app.querySelectorAll('[data-theme-opt]').forEach((b) =>
    b.addEventListener('click', () => setTheme(b.dataset.themeOpt)));

  /* priorities */
  app.querySelectorAll('[data-prio]').forEach((row) => {
    const id = row.dataset.prio;
    const p = S.priorities.find((x) => x.id === id);
    bindName(row.querySelector('[data-name]'), (name) => updatePriority(id, { name }));
    row.querySelector('[data-color]').addEventListener('click', (e) =>
      openMenu(e.currentTarget, PRIORITY_COLORS.map((c) => ({
        label: COLOR_NAME[c] + (c === p.color ? ' ✓' : ''), swatch: c,
        onClick: () => updatePriority(id, { color: c }),
      }))));
    row.querySelectorAll('[data-move]').forEach((b) =>
      b.addEventListener('click', () => movePriority(id, +b.dataset.move)));
    row.querySelector('[data-delete]').addEventListener('click', async () => {
      const used = priorityUseCount(id);
      if (used && !await confirmDialog(`Delete “${p.name}”?`, `${plural(used, 'task')} will have no priority.`, { confirmLabel: 'Delete', danger: true })) return;
      deletePriority(id);
    });
  });
  bindAdd('[data-add-priority]', addPriority);

  /* labels */
  app.querySelectorAll('[data-label]').forEach((row) => {
    const name = row.dataset.label;
    bindName(row.querySelector('[data-name]'), async (next) => {
      const target = allTags().find((x) => sameTag(x, next) && !sameTag(x, name));
      if (target && !await confirmDialog(`Merge #${name} into #${target}?`, `Every task with #${name} gets #${target} instead.`, { confirmLabel: 'Merge' })) {
        rerender(); return;
      }
      renameLabel(name, target || next);
    });
    row.querySelector('[data-delete]').addEventListener('click', async () => {
      const used = tagUseCount(name);
      if (used && !await confirmDialog(`Delete #${name}?`, `It is removed from ${plural(used, 'task')}.`, { confirmLabel: 'Delete', danger: true })) return;
      deleteLabel(name);
    });
  });
  bindAdd('[data-add-label]', addLabel);
}
