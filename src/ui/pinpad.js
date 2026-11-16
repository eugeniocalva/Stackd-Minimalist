/* The four-dot PIN pad (architecture §33): sign-in, the lock screen,
   Change PIN, Delete account. Digit keys are buttons ≥ 56 px; the physical
   keyboard works too. The dots say how many digits are in, never which
   (PRD-accounts AC-07.8). */

import { icon } from './icons.js';
import { esc } from '../util.js';

export const PIN_LENGTH = 4;

export function pinpadHTML({ label = 'Enter your PIN', error = '', disabled = false } = {}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return `
  <div class="pinpad ${disabled ? 'is-disabled' : ''}" data-pinpad>
    <p class="pin-label" data-pin-label>${esc(label)}</p>
    <div class="pin-dots" role="status" aria-live="polite" aria-label="0 of ${PIN_LENGTH} digits entered" data-pin-dots>
      ${Array.from({ length: PIN_LENGTH }, () => '<span class="pin-dot"></span>').join('')}
    </div>
    <p class="pin-error" role="alert" data-pin-error>${esc(error)}</p>
    <div class="pin-keys">
      ${keys.map((k) => (k === '' ? '<span></span>'
        : k === 'del' ? `<button type="button" class="pin-key pin-del" data-key="del" aria-label="Delete last digit" ${disabled ? 'disabled' : ''}>${icon('chevronLeft', 22)}</button>`
        : `<button type="button" class="pin-key" data-key="${k}" aria-label="${k}" ${disabled ? 'disabled' : ''}>${k}</button>`)).join('')}
    </div>
  </div>`;
}

/** onComplete(pin) runs when the fourth digit is in. Returns controls. */
export function bindPinpad(root, { onComplete, onChange = null } = {}) {
  const pad = root.querySelector('[data-pinpad]');
  const dots = pad.querySelectorAll('.pin-dot');
  const live = pad.querySelector('[data-pin-dots]');
  let pin = '';
  let busy = false;
  const show = () => {
    dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    live.setAttribute('aria-label', `${pin.length} of ${PIN_LENGTH} digits entered`);
    onChange?.(pin.length);
  };
  const press = (k) => {
    if (busy || pad.classList.contains('is-disabled')) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (/^\d$/.test(k) && pin.length < PIN_LENGTH) pin += k;
    show();
    if (pin.length === PIN_LENGTH) {
      const done = pin;
      busy = true;
      Promise.resolve(onComplete(done)).finally(() => { busy = false; });
    }
  };
  pad.addEventListener('click', (e) => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
  const onKey = (e) => {
    if (!pad.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, textarea, select')) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  };
  document.addEventListener('keydown', onKey);
  return {
    clear() { pin = ''; show(); },
    error(msg) { pad.querySelector('[data-pin-error]').textContent = msg || ''; if (msg) { pad.classList.remove('shake'); void pad.offsetWidth; pad.classList.add('shake'); } pin = ''; show(); },
    label(text) { pad.querySelector('[data-pin-label]').textContent = text; },
    disable(on) { pad.classList.toggle('is-disabled', on); pad.querySelectorAll('.pin-key').forEach((b) => { b.disabled = on; }); },
    focus() { pad.querySelector('.pin-key')?.focus(); },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}
