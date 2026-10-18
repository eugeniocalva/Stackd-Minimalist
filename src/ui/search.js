/* Search field (PRD-notes US-08): inline on desktop, an icon that expands to
   a full-width field on mobile. The query is per screen (UI.query, keyed by
   UI.queryKey) and transient: switching board or area clears it, coming back
   from a detail keeps it. Typing re-renders after 150 ms and the field gets
   its focus and caret back. Esc clears; `/` focuses it on desktop. */

import { UI, isDesktop, rerender } from '../store.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

/** Resets the query when the screen (or board) it belongs to changes. */
export function queryFor(key) {
  if (UI.queryKey !== key) {
    UI.queryKey = key; UI.query = ''; UI.searchOpen = false; UI.tagFilter = null;
  }
  return UI.query;
}

export const searchOpen = () => isDesktop.matches || UI.searchOpen || !!UI.query;

/** Mobile: the icon that opens the field (nothing on desktop or while open). */
export const searchToggleHTML = () => (searchOpen() ? ''
  : `<button class="icon-btn search-toggle" data-search-open aria-label="Search">${icon('search', 20)}</button>`);

/** The field; '' while collapsed on mobile. */
export function searchFieldHTML({ placeholder }) {
  if (!searchOpen()) return '';
  const v = UI.query;
  return `
  <div class="search-field" role="search">
    <span class="search-ico" aria-hidden="true">${icon('search', 16)}</span>
    <input class="input search-input" type="search" data-search value="${esc(v)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off" enterkeyhint="search">
    <button class="search-clear ${v || !isDesktop.matches ? '' : 'hidden'}" data-search-clear aria-label="${v ? 'Clear search' : 'Close search'}">${icon('x', 16)}</button>
  </div>`;
}

export function bindSearch(root) {
  root.querySelector('[data-search-open]')?.addEventListener('click', () => {
    UI.searchOpen = true; UI.searchFocus = true; rerender();
  });
  const input = root.querySelector('[data-search]');
  if (!input) return;
  const clearBtn = root.querySelector('[data-search-clear]');
  let timer = null;
  const apply = (value) => {
    clearTimeout(timer); timer = null;
    if (value === UI.query) return;
    UI.query = value; UI.searchFocus = true;
    UI.searchCaret = [input.selectionStart, input.selectionEnd];
    rerender();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer); timer = setTimeout(() => apply(input.value), 150);
    clearBtn?.classList.toggle('hidden', !input.value && isDesktop.matches);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (input.value) { input.value = ''; apply(''); return; }
    if (!isDesktop.matches) { UI.searchOpen = false; rerender(); } else input.blur();
  });
  clearBtn?.addEventListener('click', () => {
    if (!isDesktop.matches) UI.searchOpen = false;
    input.value = '';
    if (UI.query) { UI.query = ''; UI.searchFocus = isDesktop.matches; rerender(); }
    else if (!isDesktop.matches) rerender();
  });
  if (UI.searchFocus) {
    UI.searchFocus = false;
    input.focus();
    const [s, e] = UI.searchCaret || [input.value.length, input.value.length];
    try { input.setSelectionRange(s, e); } catch { /* not all inputs allow it */ }
    UI.searchCaret = null;
  }
}

/* `/` focuses the field when the user is not typing somewhere else */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const input = document.querySelector('[data-search]');
  if (!input) return;
  e.preventDefault();
  input.focus(); input.select();
});
