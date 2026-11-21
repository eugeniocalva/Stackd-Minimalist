/* The device's account (PRD-accounts US-01 to US-04, US-10; architecture
   §29, §32). Everything hangs off one key, 'stackd-account': absent means
   signed out, and then this module makes no request and starts no timer
   (AC-01.2). The session itself is never in it: a cookie on the web, the
   Keychain / Keystore in the shells. */

import { request, setBearer, onSignedOut, client } from './net.js';
import * as secure from './secure.js';
import { TERMS_VERSION, PRIVACY_VERSION, isLegacyOrigin } from './legal.js';
import { S } from './store.js';

export const ACCOUNT_KEY = 'stackd-account';
export const AGE_KEY = 'stackd-age-refused';
export const AGE_REFUSAL_MS = 24 * 3600_000;
const TOKEN_KEY = 'stackd-session';

let state = null;
const listeners = new Set();

function read() {
  try { const v = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); return v && typeof v === 'object' && v.userId ? v : null; } catch { return null; }
}
function write(next, { quiet = false } = {}) {
  state = next;
  if (next) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next)); else localStorage.removeItem(ACCOUNT_KEY);
  if (!quiet) listeners.forEach((fn) => fn(state));
}
/** Merge into the stored account (lock settings, verifier, last activity).
    quiet: bookkeeping nobody draws (last activity), so nothing re-renders. */
export function patch(fields, { quiet = false } = {}) { if (state) write({ ...state, ...fields }, { quiet }); }

export const signedIn = () => !!state;
export const current = () => state;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Resolves when the shells have read their token (immediately on the web). */
export let ready = Promise.resolve();

export function init() {
  state = read();
  onSignedOut(() => { if (state) forget({ keepData: true, reason: 'signed_out' }); });
  if (state && client() !== 'web') ready = secure.get(TOKEN_KEY).then((t) => { setBearer(t); if (!t) forget({ keepData: true }); });
}

/** Can this device have an account at all? */
export function availability() {
  if (isLegacyOrigin()) return { ok: false, reason: 'legacy' };
  if (globalThis.location?.protocol === 'file:') return { ok: false, reason: 'file' };
  if (secure.needed() && !secure.available()) return { ok: false, reason: 'secure' };
  return { ok: true };
}

/* — age (AC-02.2, AC-02.3): checked on the device; nothing is sent — */

export function ageRefusedUntil(now = Date.now()) {
  const at = Number(localStorage.getItem(AGE_KEY)) || 0;
  return at && now - at < AGE_REFUSAL_MS ? at + AGE_REFUSAL_MS : 0;
}
/** Adult if not younger than 18 on 1 January of this year. A refusal is
    remembered for 24 hours, so another year cannot simply be tried. */
export function checkAge(year, now = new Date()) {
  const y = Number(year);
  const ok = Number.isInteger(y) && y >= 1900 && y <= now.getFullYear() - 19;
  if (!ok) localStorage.setItem(AGE_KEY, String(now.getTime()));
  return ok;
}

/* — the device's own name in Devices (AC-04.3) — */

export function deviceLabel(ua = globalThis.navigator?.userAgent || '', platform = client()) {
  if (platform === 'ios') return /iPad/.test(ua) ? 'iPad' : 'iPhone';
  if (platform === 'android') return 'Android';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'another system';
  return `Browser on ${os}`;
}

/* — sign-in (US-02, US-03, US-04) — */

export const start = (email) => request('/v1/auth/start', { method: 'POST', body: { email } });
export const verify = (email, code) => request('/v1/auth/verify', { method: 'POST', body: { email, code } });

async function established(answer, pin) {
  const a = answer.account;
  if (answer.token) {
    if (!await secure.set(TOKEN_KEY, answer.token)) throw Object.assign(new Error('This device cannot keep a session safely.'), { code: 'misconfigured' });
    setBearer(answer.token);
  }
  write({
    userId: a.id, email: a.email, sessionId: answer.sessionId, platform: client(),
    pinVersion: a.pinVersion, accepted: a.accepted, needsAccept: !!a.needsAccept,
    lock: state?.userId === a.id ? state.lock : { after: '5m', biometrics: false },
    lastActiveAt: Date.now(), offlineFails: 0, offlineWaitUntil: 0,
  });
  pinProved.forEach((fn) => fn(pin));
  return a;
}

/* lock.js keeps a device verifier of the PIN for offline unlock (AC-07.3) */
const pinProved = new Set();
export function onPinProved(fn) { pinProved.add(fn); }

const common = () => ({ label: deviceLabel(), legacyId: S.plan.subscriberId });

export async function register(email, ticket, pin) {
  const a = await request('/v1/auth/register', {
    method: 'POST',
    body: { email, ticket, pin, adult: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, ...common() },
  });
  return established(a, pin);
}
export async function signIn(email, ticket, pin) {
  return established(await request('/v1/auth/signin', { method: 'POST', body: { email, ticket, pin, ...common() } }), pin);
}
export async function resetPin(email, ticket, pin) {
  return established(await request('/v1/auth/pin/reset', { method: 'POST', body: { email, ticket, pin, label: deviceLabel() } }), pin);
}

/* — with a session — */

export async function checkPin(pin) {
  const r = await request('/v1/auth/pin/check', { method: 'POST', body: { pin }, timeout: 3000 });
  patch({ pinVersion: r.pinVersion });
  pinProved.forEach((fn) => fn(pin));
  return r;
}
export async function changePin(pin, newPin) {
  const r = await request('/v1/auth/pin/change', { method: 'POST', body: { pin, newPin } });
  patch({ pinVersion: r.pinVersion });
  pinProved.forEach((fn) => fn(newPin));
  return r;
}
export async function accept() {
  await request('/v1/account/accept', { method: 'POST', body: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });
  patch({ accepted: { terms: TERMS_VERSION, privacy: PRIVACY_VERSION }, needsAccept: false });
}
export async function refresh() {
  const { account: a } = await request('/v1/account');
  patch({ email: a.email, pinVersion: a.pinVersion, accepted: a.accepted, needsAccept: !!a.needsAccept });
  return a;
}
export const signOutDevice = (sessionId) => request('/v1/account/signout', { method: 'POST', body: { sessionId } });

/** Ends the session on the server (best effort: offline still signs out here). */
export async function signOut({ everywhere = false, keepData = true } = {}) {
  try { await request('/v1/account/signout', { method: 'POST', body: everywhere ? { all: true } : {} }); } catch (e) { if (e.code !== 'signed_out') { /* the server forgets idle sessions anyway */ } }
  forget({ keepData });
}

export async function exportData() {
  const res = await request('/v1/account/export', { raw: true, timeout: 60_000 });
  return res.blob();
}

/** pin, or (email code) ticket when the PIN is locked or forgotten (AC-10.3). */
export async function deleteAccount({ pin, ticket, keepData }) {
  await request('/v1/account/delete', { method: 'POST', body: ticket ? { ticket } : { pin } });
  forget({ keepData });
}

const forgetHooks = new Set();
/** sync.js and lock.js drop their part of the account here. */
export function onForget(fn) { forgetHooks.add(fn); }

/** The local half of signing out; also what 'signed_out' from the server does. */
export function forget({ keepData = true, reason = 'user' } = {}) {
  if (!state) return;
  const was = state;
  setBearer(null);
  secure.remove(TOKEN_KEY);
  write(null);
  forgetHooks.forEach((fn) => fn({ keepData, reason, was }));
}
