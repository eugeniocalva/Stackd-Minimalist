/* The account and sync calls to the proxy (architecture §31, net.js).
   Web: the session is an HttpOnly cookie the page never sees, sent with
   `credentials: 'include'`. Shells: a bearer token read from secure
   storage at boot and held here in memory only. ai.js keeps its own call
   for the AI steps and borrows authHeaders(), so a signed-in device is
   always identified by its session (PRD-accounts AC-08.3). */

import { APP_TOKEN, proxyUrl } from './store.js';

export const TIMEOUT_MS = 20_000;

/** 'ios' | 'android' | 'web': what the proxy is told in X-Stackd-Client. */
export const client = () => {
  const p = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.getPlatform?.() : 'web';
  return p === 'ios' || p === 'android' ? p : 'web';
};

let bearer = null;
/** Shells only: the token from secure storage, or null when signed out. */
export function setBearer(t) { bearer = t || null; }

export function authHeaders() {
  const h = { 'X-Stackd-Client': client() };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  return h;
}

let fetchImpl = (...args) => globalThis.fetch(...args);
export function setFetch(fn) { fetchImpl = fn; }

const signedOutHandlers = new Set();
/** 'signed_out' from any call: the device forgets its account (once). */
export function onSignedOut(fn) { signedOutHandlers.add(fn); }
export function signedOut() { signedOutHandlers.forEach((fn) => fn()); }

/** → the parsed answer, or throws an Error with .code (and the server's extra fields). */
export async function request(path, { method = 'GET', body, signal, timeout = TIMEOUT_MS, raw = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort());
  let res;
  try {
    res = await fetchImpl(proxyUrl() + path, {
      method,
      headers: { 'X-Stackd-App': APP_TOKEN, ...authHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e?.name === 'AbortError' ? 'That took too long. Try again.' : 'No connection. Try again when you are back online.');
    err.code = e?.name === 'AbortError' ? 'timeout' : 'offline';
    throw err;
  }
  clearTimeout(timer);
  if (res.status === 204) return { ok: true };
  if (raw && res.ok) return res;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || data?.ok === false) {
    const { ok, message, code, ...extra } = data || {};
    const err = Object.assign(new Error(message || `The service answered ${res.status}.`), extra);
    err.code = code || 'provider_unavailable';
    err.status = res.status;
    if (err.code === 'signed_out') signedOut();
    throw err;
  }
  return data;
}
