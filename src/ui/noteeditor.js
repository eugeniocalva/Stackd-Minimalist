/* Note editor: title, body (contenteditable holding the sanitised HTML
   subset from src/richtext.js), checklist, tag chips, colour and the
   toolbar. One component in two modes: 'composer' (Notes screen: collapsed
   ↔ expanded, Add button; PRD-notes US-02) and 'detail' (Phase 8). The
   value lives with the caller (get / set); the editor re-renders itself
   only on structural changes (checklist items, tags, colour) and leaves the
   caret alone while typing. */

import { NOTE_COLORS, noteIsEmpty } from '../store.js';
import { sanitize, fromPlain, firstLine, FORMATS, SHORTCUTS, exec, stateAt } from '../richtext.js';
import { esc, uid } from '../util.js';
import { icon } from './icons.js';
import { openMenu, confirmDialog } from './primitives.js';
import { openTagPicker } from './tagpicker.js';

const COLOR_NAME = { red: 'Red', amber: 'Amber', green: 'Green', blue: 'Blue', violet: 'Violet', gray: 'Gray' };
export const colorName = (c) => (c ? COLOR_NAME[c] : 'No colour');

/** The 3 px accent bar on a row / card's left edge (PRD-notes AC-06.2). */
export const colorBarHTML = (color) => (color ? `<span class="cbar pc-${color}" aria-hidden="true"></span>` : '');

/** 'Draft: …' for the collapsed composer; '' when there is nothing in it. */
export function draftPreview(d) {
  if (noteIsEmpty(d)) return '';
  const text = d.title.trim() || firstLine(d.body)
    || (d.checklist || []).map((c) => c.text.trim()).find(Boolean) || '';
  return `Draft: ${text}`;
}

/* ── Markup ──────────────────────────────────────────────────────────── */

function collapsedHTML(d) {
  const preview = draftPreview(d);
  return `
  <div class="composer-collapsed">
    <button type="button" class="composer-placeholder ${preview ? 'has-draft' : ''}" data-expand="body">${preview ? esc(preview) : 'Take a note…'}</button>
    <button type="button" class="ne-tool" data-expand="checklist" aria-label="New checklist" title="New checklist">${icon('checklist')}</button>
  </div>`;
}

function checklistHTML(items) {
  return `
  <div class="ne-checks" role="group" aria-label="Checklist">
    ${items.map((c) => `
    <div class="ne-ci-row ${c.done ? 'done' : ''}" data-ci-row="${c.id}">
      <input type="checkbox" class="check sm" data-ci-done="${c.id}" ${c.done ? 'checked' : ''} aria-label="Done">
      <input class="ne-ci" data-ci="${c.id}" value="${esc(c.text)}" placeholder="List item" autocomplete="off" aria-label="List item">
      <button type="button" class="s-del" data-ci-del="${c.id}" aria-label="Remove item" tabindex="-1">${icon('x', 16)}</button>
    </div>`).join('')}
  </div>`;
}

/** The second toolbar row (AC-02.4): one toggle per inline style. */
function formatRowHTML() {
  return `
    <div class="ne-format" role="toolbar" aria-label="Text formatting">
      ${FORMATS.map(([cmd, label, glyph]) =>
        `<button type="button" class="ne-tool ne-fmt" data-fmt="${cmd}" aria-pressed="false" aria-label="${label}" title="${label}"><span class="fmt-glyph fmt-${cmd}">${glyph}</span></button>`).join('')}
    </div>`;
}

/** v: NoteDraft | Note (body already sanitised). */
export function editorHTML(v, { mode = 'composer', expanded = true, formatOpen = false } = {}) {
  const wrap = (inner, cls) =>
    `<form class="composer card ${cls} mode-${mode}" data-editor data-mode="${mode}" aria-label="${mode === 'detail' ? 'Note' : 'New note'}">${colorBarHTML(v.color)}${inner}</form>`;
  if (mode === 'composer' && !expanded) return wrap(collapsedHTML(v), '');
  const inner = `
  <div class="ne">
    <input class="ne-title" data-f="title" value="${esc(v.title)}" placeholder="Title" maxlength="200" autocomplete="off" aria-label="Title">
    <div class="ne-body" data-f="body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-placeholder="Take a note…">${v.body}</div>
    ${v.checklist ? checklistHTML(v.checklist) : ''}
    ${v.tags.length ? `
    <div class="ne-chips">${v.tags.map((t) =>
      `<button type="button" class="chip sm removable" data-tag-remove="${esc(t)}" aria-label="Remove tag ${esc(t)}">#${esc(t)}${icon('x', 14)}</button>`).join('')}</div>` : ''}
    ${formatOpen ? formatRowHTML() : ''}
    <div class="ne-toolbar" role="toolbar" aria-label="Note tools">
      <button type="button" class="ne-tool" data-tool="format" aria-pressed="${formatOpen}" aria-label="Formatting" title="Formatting">${icon('text')}</button>
      <button type="button" class="ne-tool ${v.tags.length ? 'on' : ''}" data-tool="tags" aria-label="Tags" title="Tags">${icon('tag')}</button>
      <button type="button" class="ne-tool ${v.color ? 'on' : ''} ${mode === 'detail' && v.color ? 'ne-tool-wide' : ''}" data-tool="color" aria-label="Colour: ${colorName(v.color)}" title="Colour">${icon('palette')}${v.color ? `<span class="swatch tool-swatch pc-${v.color}"></span>` : ''}${mode === 'detail' && v.color ? `<span class="ne-tool-text">${colorName(v.color)}</span>` : ''}</button>
      <button type="button" class="ne-tool" data-tool="checklist" aria-pressed="${!!v.checklist}" aria-label="Checklist" title="Checklist">${icon('checklist')}</button>
      <span class="spacer"></span>
      ${mode === 'composer' ? `<button type="submit" class="btn btn-primary btn-sm" data-add ${noteIsEmpty(v) ? 'disabled' : ''}>Add</button>` : ''}
    </div>
  </div>`;
  return wrap(inner, 'expanded');
}

/* ── Behaviour ───────────────────────────────────────────────────────── */

const newItem = () => ({ id: uid(), text: '', done: false });

/* Chrome leaves "<br>" or "<div><br></div>" behind when the last character is
   deleted; clear it so the :empty placeholder shows again. */
const emptyBody = (el) => /^(?:<div>)?(?:<br>)?(?:<\/div>)?$/i.test(el.innerHTML.trim());

function caretToEnd(el) {
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function focusField(root, key) {
  if (!key || !root) return;
  let el = null;
  if (key === 'title') el = root.querySelector('[data-f="title"]');
  else if (key === 'body') el = root.querySelector('[data-f="body"]');
  else if (key.startsWith('ci:')) el = root.querySelector(`[data-ci="${key.slice(3)}"]`);
  if (!el) return;
  el.focus();
  if (el.isContentEditable) caretToEnd(el);
  else if (el.value) el.setSelectionRange(el.value.length, el.value.length);
}

/**
 * host: the element whose innerHTML is editorHTML(). Binds the markup that is
 * already there; `render(focus)` re-renders inside host and rebinds.
 * opts: { get(), set(patch), mode, expanded(), onAdd(), onCollapse(), onExpand(target) }
 */
export function bindEditor(host, opts) {
  const { get, set, mode = 'composer' } = opts;
  const expanded = () => (opts.expanded ? opts.expanded() : true);
  let formatOpen = opts.formatOpen ? opts.formatOpen() : false;
  const setFormatOpen = (v) => { formatOpen = v; opts.onFormatToggle?.(v); };

  const render = (focus) => {
    host.innerHTML = editorHTML(get(), { mode, expanded: expanded(), formatOpen });
    bind();
    focusField(host.querySelector('[data-editor]'), focus);
  };

  function bind() {
    const root = host.querySelector('[data-editor]');
    if (!root) return;
    const q = (s) => root.querySelector(s);
    const qa = (s) => [...root.querySelectorAll(s)];
    const updateAdd = () => { const b = q('[data-add]'); if (b) b.disabled = noteIsEmpty(get()); };

    root.addEventListener('submit', (e) => { e.preventDefault(); if (!noteIsEmpty(get())) opts.onAdd?.(); });

    /* collapsed composer */
    qa('[data-expand]').forEach((b) => {
      b.addEventListener('click', () => opts.onExpand?.(b.dataset.expand));
      if (b.dataset.expand === 'body') b.addEventListener('focus', () => opts.onExpand?.('body'));
    });
    if (!expanded() && mode === 'composer') return;

    root.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!noteIsEmpty(get())) opts.onAdd?.(); }
      else if (e.key === 'Escape') { e.preventDefault(); opts.onCollapse?.(); }
    });

    /* title */
    const title = q('[data-f="title"]');
    title.addEventListener('input', () => { set({ title: title.value }); updateAdd(); });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); focusField(root, 'body'); }
    });

    /* body */
    const body = q('[data-f="body"]');
    body.addEventListener('input', () => {
      if (emptyBody(body)) body.innerHTML = '';
      set({ body: sanitize(body.innerHTML) });
      updateAdd();
    });
    /* inline styles: shortcuts on the body, buttons on the Format row (AC-02.4) */
    const applyFormat = (cmd) => {
      if (document.activeElement !== body) focusField(root, 'body');
      exec(cmd);
      reflectFormat(root);
    };
    body.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = `${e.shiftKey ? 'shift+' : ''}${e.key.toLowerCase()}`;
      const cmd = SHORTCUTS[key];
      if (!cmd) return;
      e.preventDefault(); applyFormat(cmd);
    });
    q('[data-tool="format"]').addEventListener('click', () => {
      setFormatOpen(!formatOpen);
      render(document.activeElement === body || !formatOpen ? 'body' : null);
    });
    qa('[data-fmt]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the body's selection
      b.addEventListener('click', () => applyFormat(b.dataset.fmt));
    });
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      const ins = html ? sanitize(html) : fromPlain(text);
      if (!document.execCommand('insertHTML', false, ins)) document.execCommand('insertText', false, text);
    });

    /* checklist */
    const items = () => get().checklist || [];
    const setItems = (list) => set({ checklist: list });
    qa('[data-ci]').forEach((input) => {
      const id = input.dataset.ci;
      const item = () => items().find((c) => c.id === id);
      input.addEventListener('input', () => { const c = item(); if (c) c.text = input.value; setItems(items()); updateAdd(); });
      input.addEventListener('keydown', (e) => {
        const list = items(), i = list.findIndex((c) => c.id === id);
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const n = newItem(); list.splice(i + 1, 0, n); setItems(list); render(`ci:${n.id}`);
        } else if (e.key === 'Backspace' && input.value === '' && list.length) {
          e.preventDefault();
          list.splice(i, 1); setItems(list.length ? list : list);
          render(i > 0 ? `ci:${list[i - 1].id}` : 'body');
        }
      });
    });
    qa('[data-ci-done]').forEach((cb) => cb.addEventListener('change', () => {
      const c = items().find((x) => x.id === cb.dataset.ciDone); if (!c) return;
      c.done = cb.checked; setItems(items());
      if (opts.resortOnToggle) { render(null); return; }   // detail: ticked items sink (AC-04.3)
      cb.closest('.ne-ci-row').classList.toggle('done', cb.checked);
    }));
    qa('[data-ci-del]').forEach((b) => b.addEventListener('click', () => {
      const list = items(), i = list.findIndex((c) => c.id === b.dataset.ciDel);
      list.splice(i, 1); setItems(list);
      render(list[i] ? `ci:${list[i].id}` : list[i - 1] ? `ci:${list[i - 1].id}` : 'body');
    }));

    /* tags */
    qa('[data-tag-remove]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.tagRemove.toLowerCase();
      set({ tags: get().tags.filter((t) => t.toLowerCase() !== name) });
      render(null);
    }));
    q('[data-tool="tags"]').addEventListener('click', () => {
      openTagPicker({ tags: get().tags, onChange: (tags) => { set({ tags }); render(null); } });
    });

    /* colour */
    q('[data-tool="color"]').addEventListener('click', (e) => {
      const current = get().color;
      const pick = (color) => { set({ color }); render('body'); };
      openMenu(e.currentTarget, [
        { label: 'None', swatch: 'none', checked: !current, onClick: () => pick(null) },
        ...NOTE_COLORS.map((c) => ({ label: COLOR_NAME[c], swatch: c, checked: current === c, onClick: () => pick(c) })),
      ]);
    });

    /* checklist section */
    q('[data-tool="checklist"]').addEventListener('click', async () => {
      const list = get().checklist;
      if (!list) { const n = newItem(); setItems([n]); render(`ci:${n.id}`); return; }
      if (list.some((c) => c.text.trim())) {
        const ok = await confirmDialog('Remove checklist?', 'Its items are removed from this note.', { confirmLabel: 'Remove', danger: true });
        if (!ok) return;
      }
      setItems(null); render('body');
    });
  }

  bind();
  return { render, focus: (key) => focusField(host.querySelector('[data-editor]'), key) };
}

/* Format-row buttons mirror the style at the caret. One listener for every
   editor on the page: it finds the body that has focus. */
function reflectFormat(root) {
  const state = stateAt();
  root.querySelectorAll('[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', String(!!state[b.dataset.fmt])));
}
document.addEventListener('selectionchange', () => {
  const body = document.activeElement;
  if (!body?.matches?.('.ne-body')) return;
  reflectFormat(body.closest('[data-editor]'));
});
