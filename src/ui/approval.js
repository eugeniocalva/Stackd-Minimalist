/* "Waiting for a parent's approval" (docs/prd-age-signals.md §04, 4, AC-05):
   the store says the user is under 18 and a parent has not approved the
   app, or declined it. Nothing else is drawn until the store says approved;
   the data on the phone stays as it is. The app asks the store again each
   time it comes back to the front, and "Check again" asks now. */

import { app } from '../util.js';
import { icon } from './icons.js';
import { toast } from './primitives.js';
import * as agesignal from '../agesignal.js';

const store = () => (globalThis.Capacitor?.getPlatform?.() === 'ios' ? 'Screen Time' : 'Google Family Link');

export function approvalHTML() {
  return `
  <main class="screen lock-screen" role="main" aria-labelledby="approval-title">
    <div class="lock-card">
      <span class="lock-icon" aria-hidden="true">${icon('lock', 22)}</span>
      <h1 class="lock-title" id="approval-title" tabindex="-1">Waiting for a parent</h1>
      <p class="hint">A parent or guardian needs to approve Stack'd for your account in ${store()}. Your boards, notes and meetings stay on this device.</p>
      <button type="button" class="btn btn-secondary btn-block" data-approval-check>Check again</button>
    </div>
  </main>`;
}

export function bindApproval() {
  app.querySelector('#approval-title')?.focus();
  app.querySelector('[data-approval-check]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await agesignal.check();
    if (agesignal.waiting()) { b.disabled = false; toast('Not approved yet'); }   // approved: the app redraws on its own
  });
}
