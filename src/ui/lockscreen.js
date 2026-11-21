/* "Stack'd is locked" (PRD-accounts AC-07.1, AC-07.8): nothing else is
   drawn while the app is locked. PIN pad, the biometric prompt where the
   device has one, and a way out when the PIN is forgotten. */

import { app } from '../util.js';
import { pinpadHTML, bindPinpad } from './pinpad.js';
import { icon } from './icons.js';
import { esc } from '../util.js';
import * as lock from '../lock.js';
import * as account from '../account.js';
import { openSignIn } from './signin.js';
import { confirmDialog } from './primitives.js';

export function lockHTML() {
  const a = account.current();
  const changed = lock.lockReason() === 'pin_required';
  return `
  <main class="screen lock-screen" role="main" aria-label="Stack'd is locked">
    <div class="lock-card">
      <span class="lock-icon" aria-hidden="true">${icon('lock', 22)}</span>
      <h1 class="lock-title">Stack'd is locked</h1>
      <p class="hint">${changed ? 'Your PIN was changed on another device. Enter the new PIN.' : esc(a?.email || '')}</p>
      ${pinpadHTML({ label: changed ? 'Enter the new PIN' : 'Enter your PIN' })}
      <button type="button" class="btn btn-ghost btn-block" data-bio hidden>${icon('lock', 16)}Use Face ID or fingerprint</button>
      <button type="button" class="btn btn-ghost btn-block" data-forgot>Forgot your PIN?</button>
    </div>
  </main>`;
}

let waitTimer = null;
export function bindLock() {
  const pad = bindPinpad(app, {
    onComplete: async (pin) => {
      const r = await lock.unlockWithPin(pin);
      if (r.ok) return;
      if (r.code === 'wait' && r.waitMs) {
        pad.error(r.message); pad.disable(true);
        clearTimeout(waitTimer);
        waitTimer = setTimeout(() => { pad.disable(false); pad.error(''); }, r.waitMs);
        return;
      }
      pad.error(r.message);
      if (r.code === 'pin_locked') app.querySelector('[data-forgot]').textContent = 'Reset your PIN with an email code';
    },
  });
  pad.focus();
  app.querySelector('[data-forgot]').addEventListener('click', async () => {
    /* a reset needs the mailbox; it signs this device in again with the new PIN */
    const ok = await confirmDialog('Reset your PIN?', 'We send a code to your email. After the reset, your other devices are signed out.', { confirmLabel: 'Send a code' });
    if (ok) openSignIn({ mode: 'signin' });
  });
  lock.biometricsAvailable().then((kind) => {
    if (!kind || !lock.settings().biometrics) return;
    const b = app.querySelector('[data-bio]');
    if (!b) return;
    b.hidden = false;
    b.addEventListener('click', () => lock.unlockWithBiometrics());
    lock.unlockWithBiometrics();     // the system prompt at once (AC-07.1)
  });
}
