/* Tag picker sheet: type a new tag or toggle one already used anywhere in
   the app. Every change is saved immediately through onChange(tags). */

import { allTags, normalizeTags } from '../store.js';
import { esc } from '../util.js';
import { icon } from './icons.js';

export function openTagPicker({ tags, onChange }) {
  let selected = [...tags];
  const pool = normalizeTags([...selected, ...allTags()]);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet" role="dialog" aria-label="Tags">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">Tags</span>
      <button class="icon-btn" data-close aria-label="Done">${icon('x')}</button>
    </div>
    <div class="quickadd">
      <input class="input" placeholder="New tag" data-tag-input autocapitalize="none">
      <button class="btn btn-primary" data-tag-add>Add</button>
    </div>
    <div class="chip-group">
      <span class="microlabel">${pool.length ? 'Tap to toggle' : 'No tags yet'}</span>
      <div class="chip-row" data-pool>
        ${pool.map((t) => chipHTML(t, selected.some((s) => s.toLowerCase() === t.toLowerCase()))).join('')}
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);
  const input = q('[data-tag-input]');
  input.focus();

  const emit = () => { selected = normalizeTags(selected); onChange(selected); };
  const has = (name) => selected.some((s) => s.toLowerCase() === name.toLowerCase());

  q('[data-pool]').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    const name = chip.dataset.val;
    if (has(name)) selected = selected.filter((s) => s.toLowerCase() !== name.toLowerCase());
    else selected.push(name);
    chip.classList.toggle('on', has(name));
    emit();
  });
  const add = () => {
    const [name] = normalizeTags([input.value]);
    input.value = '';
    if (!name) return;
    if (!has(name)) { selected.push(name); emit(); }
    const existing = [...ov.querySelectorAll('[data-pool] .chip')].find((c) => c.dataset.val.toLowerCase() === name.toLowerCase());
    if (existing) existing.classList.add('on');
    else q('[data-pool]').insertAdjacentHTML('afterbegin', chipHTML(name, true));
    input.focus();
  };
  q('[data-tag-add]').addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

const chipHTML = (name, on) => `<button class="chip ${on ? 'on' : ''}" data-val="${esc(name)}">#${esc(name)}</button>`;
