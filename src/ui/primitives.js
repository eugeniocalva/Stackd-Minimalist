/* Overlay primitives rendered outside #app: toast with an action, confirm
   dialog, context menu (popover on desktop, action sheet on mobile). */

import { isDesktop } from '../store.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

/* ── Toast ───────────────────────────────────────────────────────────── */

let toastEl = null, toastTimer = null;

export function dismissToast() {
  clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = null;
}

/** toast('Archived', { action: { label: 'Undo', onClick } }) — one at a time;
    the countdown pauses while the toast is pressed. */
export function toast(message, { action = null, ms = 5000 } = {}) {
  dismissToast();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${
    action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  document.body.appendChild(el);
  toastEl = el;

  let remaining = ms, started = Date.now();
  const start = () => { started = Date.now(); toastTimer = setTimeout(dismissToast, remaining); };
  const pause = () => { clearTimeout(toastTimer); remaining = Math.max(1500, remaining - (Date.now() - started)); };
  el.addEventListener('pointerdown', pause);
  el.addEventListener('pointerup', start);
  el.addEventListener('pointercancel', start);
  if (action) el.querySelector('.toast-action').addEventListener('click', () => { dismissToast(); action.onClick(); });
  start();
}

/* ── Overlay helper ──────────────────────────────────────────────────── */

/** When the on-screen keyboard opens, WebKit scrolls the page to reveal the
    focused field and drags a fixed overlay (and its sheet) up with it. Pin the
    overlay to the visual viewport instead: it shrinks to the space above the
    keyboard, the page stays put, and the sheet scrolls inside itself. Inside
    the iOS app the Keyboard plugin (resize: native) shrinks the web view, so
    the viewport never changes and this does nothing. Returns a cleanup. */
export function pinToViewport(ov) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const fit = () => {
    const shrunk = vv.height < window.innerHeight - 1;
    ov.style.height = shrunk ? `${vv.height}px` : '';
    ov.style.top = shrunk ? `${vv.offsetTop}px` : '';
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
  return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
}

function overlay(innerHTML, { onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = innerHTML;
  document.body.appendChild(ov);
  const unpin = pinToViewport(ov);
  const close = (result) => { unpin(); ov.remove(); document.removeEventListener('keydown', onKey); onClose?.(result); };
  const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(undefined); });
  document.addEventListener('keydown', onKey);
  return { ov, close };
}

/* ── Confirm dialog ──────────────────────────────────────────────────── */

export function confirmDialog(title, body, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const { ov, close } = overlay(`
      <div class="sheet dialog" role="alertdialog" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${esc(title)}</h2>
        <p>${esc(body)}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" data-cancel>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
        </div>
      </div>`, { onClose: (r) => resolve(r === true) });
    ov.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    ov.querySelector('[data-ok]').addEventListener('click', () => close(true));
    ov.querySelector('[data-ok]').focus();
  });
}

/** One text field with Cancel / confirm. Resolves with the trimmed value,
    or null when cancelled or left empty; with allowEmpty an empty field
    resolves with '' (used to clear a name) and only Cancel gives null. */
export function promptDialog(title, { value = '', placeholder = '', confirmLabel = 'Save', allowEmpty = false } = {}) {
  return new Promise((resolve) => {
    const { ov, close } = overlay(`
      <div class="sheet dialog" role="dialog" aria-labelledby="dlg-title">
        <h2 id="dlg-title">${esc(title)}</h2>
        <input class="input" data-field value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" autocomplete="off">
        <div class="dialog-actions">
          <button class="btn btn-secondary" data-cancel>Cancel</button>
          <button class="btn btn-primary" data-ok>${esc(confirmLabel)}</button>
        </div>
      </div>`, { onClose: (r) => resolve(typeof r === 'string' && (r.trim() || allowEmpty) ? r.trim() : null) });
    const input = ov.querySelector('[data-field]');
    const ok = () => close(input.value);
    ov.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    ov.querySelector('[data-ok]').addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    input.focus(); input.select();
  });
}

/* ── Context menu ────────────────────────────────────────────────────── */

const itemHTML = (it, i) => it.divider
  ? '<div class="menu-divider"></div>'
  : `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}" role="menuitemradio" aria-checked="${!!it.checked}">${it.icon ? icon(it.icon) : ''}${
    it.swatch ? `<span class="swatch pc-${it.swatch}"></span>` : ''}${
    it.swatch === 'none' ? '<span class="swatch swatch-none"></span>' : ''}<span>${esc(it.label)}</span>${
    it.checked ? `<span class="menu-check">${icon('check')}</span>` : ''}</button>`;

/** items: [{ label, icon?, swatch?, checked?, danger?, onClick }, { divider: true }, …] */
export function openMenu(anchorEl, items) {
  const bind = (root, close) => {
    root.querySelectorAll('.menu-item').forEach((b) =>
      b.addEventListener('click', () => { close(); items[+b.dataset.i].onClick(); }));
  };
  if (!isDesktop.matches) {
    const { ov, close } = overlay(`
      <div class="sheet menu-sheet" role="menu">
        <div class="sheet-handle"></div>
        ${items.map(itemHTML).join('')}
      </div>`);
    bind(ov, close);
    return;
  }
  const back = document.createElement('div');
  back.className = 'menu-backdrop';
  const pop = document.createElement('div');
  pop.className = 'menu-popover';
  pop.setAttribute('role', 'menu');
  pop.innerHTML = items.map(itemHTML).join('');
  document.body.append(back, pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.top = `${r.bottom + 6}px`;
  /* open away from the nearer screen edge */
  if (r.left < window.innerWidth / 2) pop.style.left = `${r.left}px`;
  else pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const close = () => { back.remove(); pop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  bind(pop, close);
}
