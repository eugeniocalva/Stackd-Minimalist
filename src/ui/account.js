/* Settings › Account (PRD-accounts US-01, US-04, US-05, US-06, US-07,
   US-10): the signed-out card, or the email, sync status, Devices, App
   lock, Change PIN, export, delete and sign-out. */

import { S, STORE_KEY, NOTE_DRAFT_KEY, rerender } from '../store.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { fmtRelative, fmtDate } from '../dates.js';
import { overlay, toast, confirmDialog, choiceDialog, promptDialog, downloadFile, openMenu } from './primitives.js';
import { pinpadHTML, bindPinpad } from './pinpad.js';
import { openSignIn, openSignOutDialog } from './signin.js';
import * as account from '../account.js';
import * as sync from '../sync.js';
import * as lock from '../lock.js';
import * as backup from '../backup.js';
import * as media from '../media.js';
import { replaceRecords } from '../store.js';
import { client } from '../net.js';
import { APP_HOST, DELETION_URL, PRIVACY_URL, TERMS_URL } from '../legal.js';

/* the same policy the disclosure links to (PRD-accounts AC-11.4) */
const legalLinks = () => `<p class="hint set-hint">What the account stores, where and for how long: <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy Policy</a> · <a href="${TERMS_URL}" target="_blank" rel="noopener">Terms</a></p>`;

const STORE_LINKS = 'Cancel a subscription in the App Store (Settings › your name › Subscriptions) or Google Play (Play Store › Payments & subscriptions) separately.';

/** "just now", "12 min ago", then the app's own relative dates (AC-05.8). */
export function ago(at, now = Date.now()) {
  const m = Math.floor((now - at) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return fmtRelative(at);
}

let devices = null;           // the last answer of GET /v1/account, for the Devices list
let loading = false;

function syncLine() {
  const s = sync.state();
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'offline') return s.pending ? `Offline, ${s.pending} change${s.pending === 1 ? '' : 's'} will sync` : 'Offline';
  if (s.state === 'paused') return `Sync paused: ${s.paused?.message || 'try again'}`;
  return s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : 'Not synced yet';
}

/** The dot on the Settings entry while changes wait (AC-05.8). */
export const syncDot = () => account.signedIn() && ['offline', 'paused'].includes(sync.state().state) && sync.state().pending > 0;

const row = (iconName, title, sub, action = '') => `
  <div class="set-row set-wrap">
    <span class="lrow-icon">${icon(iconName, 18)}</span>
    <div class="set-text"><span class="set-title">${title}</span>${sub ? `<span class="set-sub">${sub}</span>` : ''}</div>
    ${action}
  </div>`;

export function accountSectionHTML() {
  const avail = account.availability();
  if (avail.reason === 'legacy') return '';          // the old address only offers the way out (AC-12.2)
  const a = account.current();
  if (!a) {
    const why = avail.ok ? '' : avail.reason === 'file' ? 'Open Stack\'d from its website to sign in.' : 'Sign-in arrives in the next update of the app.';
    return `
      <span class="section-title list-label" id="settings-account">Account</span>
      <div class="card list-card">
        ${row('lock', 'Sign in to sync across your devices', why || 'Optional. Without an account, everything stays on this device, as now.',
          avail.ok ? '<button class="btn btn-sm btn-primary" data-signin>Sign in</button>' : '')}
      </div>
      ${legalLinks()}`;
  }
  const s = sync.state();
  const info = backup.info();
  const list = devices?.devices || [];
  const lockAfter = lock.AFTER.find(([v]) => v === lock.settings().after)?.[1] || 'After 5 minutes';
  return `
      <span class="section-title list-label" id="settings-account">Account</span>
      ${a.needsAccept ? `
      <div class="notice notice-neutral">${icon('document', 18)}<span>The Terms or the Privacy Policy changed. Sync waits until you read and accept them.</span>
        <button class="btn btn-sm btn-secondary" data-accept>Read and accept</button></div>` : ''}
      <div class="card list-card">
        ${row('note', esc(a.email), 'Signed in on this device')}
        ${row(s.state === 'paused' ? 'x' : 'repeat', 'Sync', esc(syncLine()), `<button class="btn btn-sm btn-secondary" data-sync-now ${s.state === 'syncing' ? 'disabled' : ''}>Sync now</button>`)}
        ${info ? row('undo', 'Restore this device\'s data from before sign-in', `Kept until ${fmtDate(info.savedAt + backup.BACKUP_DAYS * 86400_000, S.dateFormat)}`, '<button class="btn btn-sm btn-secondary" data-restore-backup>Restore</button>') : ''}
      </div>

      <span class="section-title list-label">Devices</span>
      <div class="card list-card" data-devices>
        ${list.length ? list.map((d) => row(d.platform === 'web' ? 'monitor' : 'tasks', esc(d.label) + (d.current ? ' · This device' : ''),
          `Signed in ${fmtDate(d.createdAt, S.dateFormat)} · active ${ago(d.lastSeenAt)}`,
          d.current ? '' : `<button class="btn btn-sm btn-ghost" data-signout-device="${esc(d.id)}">Sign out</button>`)).join('')
          : row('tasks', loading ? 'Loading devices…' : 'Devices', loading ? '' : 'Could not load the list.', loading ? '' : '<button class="btn btn-sm btn-secondary" data-load-devices>Retry</button>')}
      </div>
      ${list.length > 1 ? '<button class="btn btn-ghost btn-block set-under" data-signout-all>Sign out everywhere</button>' : ''}

      <span class="section-title list-label">Security</span>
      <div class="card list-card">
        ${row('lock', 'App lock', `${esc(lockAfter)}. The PIN locks the app; it does not encrypt your data.`, '<button class="btn btn-sm btn-secondary" data-lock-after aria-haspopup="menu">Change</button>')}
        <div class="set-row set-wrap" data-bio-row hidden>
          <span class="lrow-icon">${icon('lock', 18)}</span>
          <div class="set-text"><span class="set-title">Unlock with Face ID or fingerprint</span><span class="set-sub">The PIN always works too.</span></div>
          <div class="segmented solid" role="radiogroup" aria-label="Biometrics">
            <button class="seg ${lock.settings().biometrics ? 'active' : ''}" role="radio" aria-checked="${lock.settings().biometrics}" data-bio="on">On</button>
            <button class="seg ${lock.settings().biometrics ? '' : 'active'}" role="radio" aria-checked="${!lock.settings().biometrics}" data-bio="off">Off</button>
          </div>
        </div>
        ${row('lock', 'Change PIN', 'Your other devices ask for the new one.', '<button class="btn btn-sm btn-secondary" data-change-pin>Change</button>')}
      </div>

      <span class="section-title list-label">Your data</span>
      <div class="card list-card">
        ${row('download', 'Export my data', 'One file with your account details and everything synced to it.', '<button class="btn btn-sm btn-secondary" data-export>Export</button>')}
        ${row('trash', 'Delete account', 'Removes the account and everything synced to it.', '<button class="btn btn-sm btn-ghost danger" data-delete-account>Delete</button>')}
      </div>
      <button class="btn btn-secondary btn-block set-under" data-signout>Sign out of this device</button>
      ${legalLinks()}`;
}

/* — a sheet with the PIN pad that asks once and checks with `check(pin)` —
   check resolves null when accepted or an error message to show. */
export function askPin(title, { text = '', check }) {
  return new Promise((resolve) => {
    let pad;
    const { ov, close } = overlay(`
      <div class="sheet steps-sheet" role="dialog" aria-modal="true" aria-labelledby="pin-title">
        <div class="steps-head"><span></span><span></span><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <h2 id="pin-title">${esc(title)}</h2>
        ${text ? `<p class="step-text">${esc(text)}</p>` : ''}
        ${pinpadHTML({ label: title })}
      </div>`, { onClose: (r) => { pad?.destroy(); resolve(typeof r === 'string' ? r : null); } });
    ov.querySelector('[data-close]').addEventListener('click', () => close(null));
    pad = bindPinpad(ov, {
      onComplete: async (pin) => {
        const err = check ? await check(pin) : null;
        if (err) pad.error(err); else close(pin);
      },
    });
    pad.focus();
  });
}

const serverPin = async (pin) => {
  try { await account.checkPin(pin); return null; } catch (e) { return e.message; }
};

async function loadDevices() {
  loading = true;
  try { devices = await account.refresh(); } catch { devices = null; }
  loading = false;
  if (app.querySelector('[data-devices]')) rerender();
}

/** Signing out, with the two choices and what removing would delete. */
export async function signOutFlow({ everywhere = false } = {}) {
  const onlyHere = S.meetings.filter((m) => m.recording).length;
  const choice = await openSignOutDialog({ pending: sync.pendingCount(), onlyHere, web: client() === 'web' });
  if (!choice) return;
  if (sync.pendingCount() && choice.keepData === false) { try { await sync.now(); } catch { /* counted in the dialog */ } }
  await account.signOut({ everywhere, keepData: choice.keepData });
  devices = null;
  if (!choice.keepData) await removeLocalData();
  toast('Signed out');
  rerender();
}

/** "Remove from this device": everything made here goes, then a fresh start (AC-06.8). */
async function removeLocalData() {
  await Promise.all(S.meetings.filter((m) => m.recording).map((m) => media.remove(m.recording.key).catch(() => {})));
  [STORE_KEY, NOTE_DRAFT_KEY, backup.BACKUP_KEY].forEach((k) => localStorage.removeItem(k));
  globalThis.location?.reload();
}

export function bindAccountSection(root = app) {
  const q = (s) => root.querySelector(s);
  q('[data-signin]')?.addEventListener('click', () => openSignIn());
  if (!account.signedIn()) return;
  if (!devices && !loading) loadDevices();
  q('[data-load-devices]')?.addEventListener('click', loadDevices);
  q('[data-sync-now]')?.addEventListener('click', async () => {
    const s = await sync.now();
    toast(s.state === 'synced' ? 'Synced' : syncLine());
    rerender();
  });
  q('[data-accept]')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Accept the updated documents?', `Read the Terms and the Privacy Policy at ${APP_HOST}/terms.html and ${APP_HOST}/privacy.html. Accepting lets sync continue.`, { confirmLabel: 'I accept' });
    if (!ok) return;
    try { await account.accept(); sync.request('accept'); toast('Accepted'); } catch (e) { toast(e.message); }
    rerender();
  });
  q('[data-restore-backup]')?.addEventListener('click', async () => {
    const info = backup.info(); if (!info) return;
    const ok = await confirmDialog('Restore this device\'s old data?', 'This signs this device out and puts back what was here before sign-in. Your account keeps its data.', { confirmLabel: 'Sign out and restore', danger: true });
    if (!ok) return;
    const records = backup.backupRecords();
    await account.signOut({ keepData: true });
    if (records) replaceRecords(records);
    backup.dropBackup();
    toast('Restored'); rerender();
  });
  root.querySelectorAll('[data-signout-device]').forEach((b) => b.addEventListener('click', async () => {
    const d = devices?.devices.find((x) => x.id === b.dataset.signoutDevice);
    if (!await confirmDialog(`Sign out ${d?.label || 'this device'}?`, 'It signs out at its next contact with Stack\'d.', { confirmLabel: 'Sign out', danger: true })) return;
    try { await account.signOutDevice(b.dataset.signoutDevice); toast('Signed out'); } catch (e) { toast(e.message); }
    loadDevices();
  }));
  q('[data-signout-all]')?.addEventListener('click', () => signOutFlow({ everywhere: true }));
  q('[data-signout]')?.addEventListener('click', () => signOutFlow());
  q('[data-lock-after]')?.addEventListener('click', (e) => openMenu(e.currentTarget, lock.AFTER.map(([v, label]) => ({
    label, checked: lock.settings().after === v,
    onClick: async () => {
      if (v === lock.settings().after) return;
      const pin = await askPin('Enter your PIN', { text: 'Changing the app lock asks for your PIN.', check: serverPin });
      if (!pin) return;
      lock.setLock({ after: v }); rerender();
    },
  }))));
  lock.biometricsAvailable().then((kind) => {
    const r = root.querySelector('[data-bio-row]');
    if (!kind || !r) return;
    r.hidden = false;
    r.querySelectorAll('[data-bio]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.bio === 'on';
      if (on === lock.settings().biometrics) return;
      if (on && !await askPin('Enter your PIN', { text: 'Turning on biometrics asks for your PIN once.', check: serverPin })) return;
      lock.setLock({ biometrics: on }); rerender();
    }));
  });
  q('[data-change-pin]')?.addEventListener('click', async () => {
    const old = await askPin('Your current PIN', {});
    if (!old) return;
    let first = null;
    const next = await askPin('Choose a new PIN', { check: async (p) => (/^(\d)\1{3}$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p) ? 'Choose a PIN that is not four of the same digit or a straight run.' : (first = p, null)) });
    if (!next) return;
    const again = await askPin('Enter it again', { check: async (p) => (p === first ? null : 'The two PINs were different.') });
    if (!again) return;
    try { await account.changePin(old, next); toast('PIN changed'); } catch (e) { toast(e.message, { ms: 6000 }); }
  });
  q('[data-export]')?.addEventListener('click', async () => {
    try { downloadFile(await account.exportData(), 'stackd-account.json'); toast('Saved stackd-account.json'); } catch (e) { toast(e.message); }
  });
  q('[data-delete-account]')?.addEventListener('click', async () => {
    const keep = await choiceDialog('Delete your account?',
      `This removes the account and everything synced to it, on the server and for every device. Recordings stay on the devices that made them. ${STORE_LINKS} The steps are also at ${DELETION_URL}.`,
      [{ id: 'keep', label: 'Keep a copy here' }, { id: 'remove', label: 'Remove from here too', danger: true }]);
    if (!keep) return;
    const pin = await askPin('Enter your PIN', { text: 'To delete the account.' });
    if (!pin) return;
    const typed = await promptDialog('Type DELETE to confirm', { placeholder: 'DELETE', confirmLabel: 'Delete account' });
    if (typed !== 'DELETE') { if (typed !== null) toast('Nothing was deleted.'); return; }
    try {
      await account.deleteAccount({ pin, keepData: keep === 'keep' });
      devices = null;
      if (keep === 'remove') await removeLocalData();
      toast('Your account was deleted');
      rerender();
    } catch (e) { toast(e.message, { ms: 6000 }); }
  });
}
