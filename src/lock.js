/* App lock (PRD-accounts US-07; architecture §30 "App lock"). Only a
   signed-in device locks (AC-07.7). Online, the PIN is checked by the
   server and counts towards the account's five (AC-07.5); offline, against
   a verifier kept on the device, with waits that double from 30 s. The
   verifier is an app lock, not a secret store: it guards the screen, it
   does not encrypt anything (AC-03.8).

   Biometrics: the plugin is not chosen yet (it must support Capacitor 8 and
   expose isAvailable() → { available, kind } and verify({ reason }) under
   Capacitor.Plugins.Biometric). Until it is in the shells, the switch is
   not shown and the PIN pad is the way in. */

import * as account from './account.js';
import * as secure from './secure.js';
import { randomHex, pbkdf2Hex } from './webcrypto.js';

export const AFTER = [['immediately', 'Immediately'], ['5m', 'After 5 minutes'], ['1h', 'After 1 hour'], ['off', 'Off']];
const AFTER_MS = { immediately: 0, '5m': 5 * 60_000, '1h': 3600_000 };
const VERIFIER_KEY = 'stackd-verifier';

/* ── pure ────────────────────────────────────────────────────────────── */

/** Should the app ask for the PIN now? booting: the app was just opened. */
export function shouldLock({ after = '5m', lastActiveAt = 0, now = Date.now(), booting = false }) {
  if (after === 'off') return false;
  if (booting) return true;
  return now - lastActiveAt >= (AFTER_MS[after] ?? AFTER_MS['5m']);
}

/** Offline waits (AC-07.5): none for the first four, then 30 s doubling. */
export const backoffMs = (fails) => (fails < 5 ? 0 : 30_000 * 2 ** (fails - 5));

export async function makeVerifier(pin) {
  const salt = randomHex(16);
  return { salt, hash: await pbkdf2Hex(pin, salt) };
}
export async function checkVerifier(pin, v) {
  return !!v?.salt && (await pbkdf2Hex(pin, v.salt)) === v.hash;
}

/* ── state ───────────────────────────────────────────────────────────── */

let isLocked = false;
let reason = null;            // 'pin_required' when another device changed the PIN
const listeners = new Set();
export const locked = () => isLocked;
export const lockReason = () => reason;
export function onLockChange(fn) { listeners.add(fn); }
const emit = () => listeners.forEach((fn) => fn(isLocked));

export const settings = () => account.current()?.lock || { after: '5m', biometrics: false };

export function lock(why = null) {
  if (!account.signedIn() || (settings().after === 'off' && why !== 'pin_required')) return;
  reason = why;
  if (!isLocked) { isLocked = true; emit(); }
}

function unlocked() {
  isLocked = false; reason = null;
  account.patch({ lastActiveAt: Date.now(), offlineFails: 0, offlineWaitUntil: 0 }, { quiet: true });
  emit();
}

/** Record activity, so "after 5 minutes" counts from the last use.
    Written at most every 15 s, and quietly: a tap must never re-render. */
let touchedAt = 0;
export function touch(now = Date.now()) {
  if (!account.signedIn() || isLocked || now - touchedAt < 15_000) return;
  touchedAt = now;
  account.patch({ lastActiveAt: now }, { quiet: true });
}

async function verifier() {
  return secure.needed() ? JSON.parse((await secure.get(VERIFIER_KEY)) || 'null') : account.current()?.verifier || null;
}
async function keepVerifier(pin) {
  const v = await makeVerifier(pin);
  if (secure.needed()) await secure.set(VERIFIER_KEY, JSON.stringify(v));
  else account.patch({ verifier: v }, { quiet: true });
}

/** → { ok: true } | { ok: false, code: 'pin_wrong'|'pin_locked'|'wait', left?, waitMs?, message } */
export async function unlockWithPin(pin) {
  const a = account.current(); if (!a) return { ok: true };
  const now = Date.now();
  if (a.offlineWaitUntil > now) return { ok: false, code: 'wait', waitMs: a.offlineWaitUntil - now, message: 'Too many wrong PINs. Wait a moment.' };
  try {
    await account.checkPin(pin);          // proves it to the server; keepVerifier runs through onPinProved
    unlocked();
    return { ok: true };
  } catch (e) {
    if (e.code === 'pin_wrong' || e.code === 'pin_locked') return { ok: false, code: e.code, left: e.left, message: e.message };
    if (e.code === 'signed_out') return { ok: true };            // the app is signed out now: nothing to unlock
    if (reason === 'pin_required') return { ok: false, code: 'wait', waitMs: 0, message: 'Connect to the internet to enter the new PIN.' };
    /* no answer: the device's own check, with its own waits */
    if (await checkVerifier(pin, await verifier())) { unlocked(); return { ok: true }; }
    const fails = (a.offlineFails || 0) + 1;
    const wait = backoffMs(fails);
    account.patch({ offlineFails: fails, offlineWaitUntil: wait ? Date.now() + wait : 0 }, { quiet: true });
    return wait
      ? { ok: false, code: 'wait', waitMs: wait, message: `Wrong PIN. Try again in ${Math.round(wait / 1000)} seconds.` }
      : { ok: false, code: 'pin_wrong', left: null, message: 'Wrong PIN.' };
  }
}

/* — biometrics (AC-07.4), through the bridge when a plugin is installed — */

const bio = () => globalThis.Capacitor?.Plugins?.Biometric;
export async function biometricsAvailable() {
  if (!globalThis.Capacitor?.isNativePlatform?.() || typeof bio()?.isAvailable !== 'function') return false;
  try { const r = await bio().isAvailable(); return r?.available ? (r.kind || 'other') : false; } catch { return false; }
}
export async function unlockWithBiometrics() {
  if (!settings().biometrics || !(await biometricsAvailable())) return false;
  try { await bio().verify({ reason: 'Unlock Stack\'d' }); unlocked(); return true; } catch { return false; }
}

/** Change the timing or the biometrics switch; the caller has asked for the PIN. */
export function setLock(patch) {
  account.patch({ lock: { ...settings(), ...patch } });
}

/* ── wiring ──────────────────────────────────────────────────────────── */

export function init() {
  /* a PIN proved anywhere (sign-in, reset, Change PIN) also opens the app */
  account.onPinProved((pin) => { keepVerifier(pin).catch(() => {}); if (isLocked) unlocked(); });
  account.onForget(() => { isLocked = false; reason = null; secure.remove(VERIFIER_KEY); emit(); });
  const a = account.current();
  if (a && shouldLock({ after: settings().after, lastActiveAt: a.lastActiveAt, booting: true })) { isLocked = true; }
  let hiddenAt = 0;
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (!account.signedIn()) return;
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); touch(); return; }
    if (hiddenAt && shouldLock({ after: settings().after, lastActiveAt: hiddenAt })) lock();
  });
}
