/* The sign-in sheet (PRD-accounts US-02, US-03, US-04, US-06): one sheet,
   one step at a time, Back on each.

   Create an account: Age → Email → Code → Choose a PIN (twice).
   Sign in:           Email → Code → Enter your PIN.
   The server only says whether an email is known after a correct code
   (AC-02.7), so either path can turn into the other there: a new email on
   "Sign in" gets the Age step before its PIN, a known one on "Create" goes
   to "Enter your PIN". Nothing about the age is ever sent but the yes.

   After a session: the first sync decides upload / download, or asks
   Merge / Use my account (AC-06.2 to 06.4). */

import { overlay, choiceDialog, confirmDialog, toast } from './primitives.js';
import { pinpadHTML, bindPinpad } from './pinpad.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import * as account from '../account.js';
import * as sync from '../sync.js';
import { TERMS_URL, PRIVACY_URL } from '../legal.js';
import { rerender } from '../store.js';

const RESEND_S = 60;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const countsLine = (c) => [plural(c.list, 'board'), plural(c.task, 'task'), plural(c.note, 'note'), plural(c.meeting, 'meeting')].join(', ');

/** mode: 'create' | 'signin' */
export function openSignIn({ mode = null } = {}) {
  /* every way in checks first: a device that cannot hold a session (the apps
     until the secure-storage plugin, a file:// copy, the old address) says why */
  const avail = account.availability();
  if (!avail.ok) {
    toast(avail.reason === 'file' ? "Open Stack'd from its website to sign in." : avail.reason === 'legacy' ? 'Sign in at the new address.' : 'Sign-in arrives in the next update of the app.', { ms: 5000 });
    return;
  }
  const st = { mode, step: mode ? (mode === 'create' ? 'age' : 'email') : 'choose', email: '', ticket: null, known: null, first: null, error: '', sentAt: 0 };
  const history = [];
  const { ov, close } = overlay('<div class="sheet steps-sheet" role="dialog" aria-modal="true" aria-labelledby="step-title"></div>');
  const sheet = ov.querySelector('.sheet');
  let pad = null;
  let resendTimer = null;

  const go = (step, { back = false } = {}) => {
    if (!back) history.push(st.step);
    st.step = step; st.error = '';
    draw();
  };
  const back = () => { const prev = history.pop(); if (prev) go(prev, { back: true }); else close(); };
  const busy = (on) => sheet.querySelectorAll('button, input, select').forEach((b) => { if (!b.dataset.keep) b.disabled = on; });

  const stepCount = () => {
    const order = st.mode === 'create' || st.known === false ? ['age', 'email', 'code', 'pin'] : ['email', 'code', 'pin'];
    const i = order.indexOf(st.step.startsWith('pin') ? 'pin' : st.step);
    return i === -1 ? '' : `Step ${i + 1} of ${order.length}`;
  };

  function head(title) {
    return `
      <div class="steps-head">
        <button type="button" class="icon-btn" data-back data-keep aria-label="Back">${icon('chevronLeft')}</button>
        <span class="hint">${stepCount()}</span>
        <button type="button" class="icon-btn" data-close data-keep aria-label="Close">${icon('x')}</button>
      </div>
      <h2 id="step-title" tabindex="-1">${esc(title)}</h2>`;
  }

  function draw() {
    pad?.destroy(); pad = null;
    clearInterval(resendTimer);
    const s = st.step;
    let html = '';
    if (s === 'choose') {
      html = `${head('Sync across your devices')}
        <p class="step-text">An account keeps your boards, tasks, notes and meetings the same on your phone and your computer. Recordings stay on the device that made them.</p>
        <button type="button" class="btn btn-primary btn-block" data-mode="create">Create an account</button>
        <button type="button" class="btn btn-secondary btn-block" data-mode="signin">I have an account</button>`;
    } else if (s === 'age') {
      const until = account.ageRefusedUntil();
      const year = new Date().getFullYear();
      html = until
        ? `${head('Accounts are for adults')}
           <p class="step-text">You can keep using Stack'd on this device without one.</p>
           <button type="button" class="btn btn-secondary btn-block" data-close>Close</button>`
        : `${head('What year were you born?')}
           <label class="sr-only" for="birth-year">Year of birth</label>
           <select class="input" id="birth-year" data-year>
             <option value="" selected disabled>Year</option>
             ${Array.from({ length: 101 }, (_, i) => year - i).map((y) => `<option value="${y}">${y}</option>`).join('')}
           </select>
           <button type="button" class="btn btn-primary btn-block" data-next disabled>Continue</button>`;
    } else if (s === 'email') {
      html = `${head(st.mode === 'create' ? 'Your email' : 'Sign in with your email')}
        <label class="sr-only" for="acct-email">Email</label>
        <input class="input" id="acct-email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com" value="${esc(st.email)}" data-email>
        <p class="hint">By continuing you accept the <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms</a> and the <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy Policy</a>.</p>
        <p class="step-error" role="alert">${esc(st.error)}</p>
        <button type="button" class="btn btn-primary btn-block" data-next>Send a code</button>`;
    } else if (s === 'code') {
      html = `${head('Enter the code')}
        <p class="step-text">We sent a six-digit code to <strong>${esc(st.email)}</strong>. It is valid for 10 minutes.</p>
        <label class="sr-only" for="acct-code">Code</label>
        <input class="input code-input" id="acct-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="000000" data-code>
        <p class="step-error" role="alert">${esc(st.error)}</p>
        <button type="button" class="btn btn-primary btn-block" data-next>Continue</button>
        <button type="button" class="btn btn-ghost btn-block" data-resend>Send a new code</button>`;
    } else if (s === 'pin-new' || s === 'pin-confirm' || s === 'pin-enter' || s === 'pin-reset' || s === 'pin-reset-confirm') {
      const titles = {
        'pin-new': ['Choose a PIN', 'Four digits. The same PIN works on all your devices.'],
        'pin-confirm': ['Enter it again', ''],
        'pin-enter': ['Enter your PIN', ''],
        'pin-reset': ['Choose a new PIN', 'Your other devices will be signed out.'],
        'pin-reset-confirm': ['Enter it again', ''],
      };
      const [title, text] = titles[s];
      html = `${head(title)}
        ${text ? `<p class="step-text">${esc(text)}</p>` : ''}
        ${pinpadHTML({ label: title, error: st.error })}
        ${s === 'pin-enter' ? '<button type="button" class="btn btn-ghost btn-block" data-forgot>Forgot your PIN? Reset it</button>' : ''}`;
    } else if (s === 'locked') {
      html = `${head('Your PIN is locked')}
        <p class="step-text">Five wrong PINs in a row lock it on every device. Choose a new one; your other devices will be signed out.</p>
        <button type="button" class="btn btn-primary btn-block" data-reset>Choose a new PIN</button>`;
    }
    sheet.innerHTML = html;
    bind();
  }

  function bind() {
    const q = (sel) => sheet.querySelector(sel);
    q('[data-back]')?.addEventListener('click', back);
    sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
    sheet.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      st.mode = b.dataset.mode; go(st.mode === 'create' ? 'age' : 'email');
    }));
    const s = st.step;
    if (s === 'age') {
      const sel = q('[data-year]'), next = q('[data-next]');
      sel?.addEventListener('change', () => { next.disabled = !sel.value; });
      next?.addEventListener('click', () => {
        if (!account.checkAge(sel.value)) { draw(); return; }   // the refusal screen, remembered for 24 h
        if (st.known === false) go('pin-new'); else go('email');
      });
      /* the question first: focusing the list would open the iOS wheel over it (owner's review 2026-11-17) */
      q('#step-title')?.focus();
    }
    if (s === 'email') {
      const input = q('[data-email]');
      const send = async () => {
        st.email = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(st.email)) { st.error = 'Enter a valid email address.'; draw(); return; }
        busy(true);
        try { await account.start(st.email); st.sentAt = Date.now(); go('code'); }
        catch (e) { st.error = e.message; busy(false); draw(); }
      };
      q('[data-next]').addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      input.focus();
    }
    if (s === 'code') {
      const input = q('[data-code]'), resend = q('[data-resend]');
      const tickResend = () => {
        const left = Math.ceil((st.sentAt + RESEND_S * 1000 - Date.now()) / 1000);
        resend.disabled = left > 0;
        resend.textContent = left > 0 ? `Send a new code in ${left} s` : 'Send a new code';
      };
      tickResend();
      resendTimer = setInterval(tickResend, 1000);
      const submit = async () => {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { st.error = 'The code is six digits.'; draw(); return; }
        busy(true);
        try {
          const r = await account.verify(st.email, code);
          st.ticket = r.ticket; st.known = r.account === 'existing';
          if (!st.known) go(account.ageRefusedUntil() || st.mode !== 'create' ? 'age' : 'pin-new');
          else go(r.pinLocked ? 'locked' : 'pin-enter');
        } catch (e) { st.error = e.message; draw(); }
      };
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); if (input.value.length === 6) submit(); });
      q('[data-next]').addEventListener('click', submit);
      resend.addEventListener('click', async () => {
        busy(true);
        try { await account.start(st.email); st.sentAt = Date.now(); toast('A new code is on its way'); draw(); }
        catch (e) { st.error = e.message; draw(); }
      });
      input.focus();
    }
    if (s.startsWith('pin-')) {
      pad = bindPinpad(sheet, { onComplete: (pin) => onPin(pin) });
      pad.focus();
      q('[data-forgot]')?.addEventListener('click', () => go('pin-reset'));
    }
    q('[data-reset]')?.addEventListener('click', () => go('pin-reset'));
  }

  let firstPin = null;
  async function onPin(pin) {
    const s = st.step;
    if (s === 'pin-new' || s === 'pin-reset') {
      if (/^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        pad.error('Choose a PIN that is not four of the same digit or a straight run.'); return;
      }
      firstPin = pin; go(s === 'pin-new' ? 'pin-confirm' : 'pin-reset-confirm'); return;
    }
    if ((s === 'pin-confirm' || s === 'pin-reset-confirm') && pin !== firstPin) {
      firstPin = null; st.error = 'The two PINs were different. Choose one again.';
      history.pop(); st.step = s === 'pin-confirm' ? 'pin-new' : 'pin-reset'; draw(); return;
    }
    pad.disable(true);
    try {
      if (s === 'pin-confirm') await account.register(st.email, st.ticket, pin);
      else if (s === 'pin-reset-confirm') await account.resetPin(st.email, st.ticket, pin);
      else await account.signIn(st.email, st.ticket, pin);
    } catch (e) {
      if (e.code === 'pin_locked') { go('locked'); return; }
      if (e.code === 'ticket_expired') { st.error = e.message; history.length = 0; go('email'); return; }
      if (e.code === 'conflict') { st.known = !st.known; go(st.known ? 'pin-enter' : 'age'); return; }
      pad.disable(false); pad.error(e.message); return;
    }
    close();
    toast(s === 'pin-confirm' ? 'Account created' : s === 'pin-reset-confirm' ? 'PIN reset · other devices were signed out' : 'Signed in');
    await startSync();
  }

  draw();
}

/** The first sync on this device, with the one question it may need.
    Once at a time: a focus or a poll while the question is open waits. */
let starting = null;
export function startSync() {
  if (!starting) starting = firstSyncFlow().finally(() => { starting = null; });
  return starting;
}
async function firstSyncFlow() {
  let p;
  try { p = await sync.firstPlan(); } catch (e) { toast(`Signed in. Sync will start when the service answers (${e.message})`, { ms: 8000 }); return; }
  let choice = p.plan;
  if (choice === 'ask') choice = await openMergeDialog(p.local, p.remote);
  if (!choice) choice = 'merge';                     // closing the dialog keeps everything (the default)
  try { await sync.firstSync(choice); } catch (e) { toast(e.message, { ms: 8000 }); }
  rerender();
}

/** AC-06.4: two choices, each with both sides' counts. */
export async function openMergeDialog(local, remote) {
  const r = await choiceDialog('This device and your account both have data',
    `This device: ${countsLine(local)}. Your account: ${countsLine(remote)}. Merge keeps everything from both. Use my account replaces what is on this device. Either way, a copy of this device's data is kept here for 30 days.`,
    [{ id: 'replace', label: 'Use my account' }, { id: 'merge', label: 'Merge' }]);
  return r;
}

/** AC-06.6, AC-06.8. → { keepData } or null. The browser defaults to removing. */
export async function openSignOutDialog({ pending = 0, onlyHere = 0, web = true } = {}) {
  const lost = pending ? ` ${plural(pending, 'change')} on this device ${pending === 1 ? 'has' : 'have'} not synced yet and would be lost if removed.` : '';
  const choices = web
    ? [{ id: 'keep', label: 'Keep a copy' }, { id: 'remove', label: 'Remove from this device', danger: true }]
    : [{ id: 'remove', label: 'Remove from this device', danger: true }, { id: 'keep', label: 'Keep a copy' }];
  const r = await choiceDialog('Sign out of this device?',
    `Keep a copy leaves everything here, signed out. Remove deletes the boards, tasks, notes and meetings from this device; your account keeps them.${lost}`, choices);
  if (!r) return null;
  if (r === 'remove' && onlyHere) {
    const ok = await confirmDialog(`Delete ${plural(onlyHere, 'recording')}?`,
      `${onlyHere === 1 ? 'A recording exists' : 'These recordings exist'} only on this device. Removing this device's data deletes ${onlyHere === 1 ? 'it' : 'them'} for good.`,
      { confirmLabel: 'Delete and sign out', danger: true });
    if (!ok) return null;
  }
  return { keepData: r === 'keep' };
}
