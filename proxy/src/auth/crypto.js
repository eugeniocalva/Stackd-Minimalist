/* Randomness, hashing and comparison for accounts (architecture §30,
   "Secrets and hashing"). WebCrypto only: the same code runs in the Worker
   and under Node for the tests. */

const enc = new TextEncoder();
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A uniform integer in [0, n), by rejection so no value is favoured. */
function uniform(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const [x] = crypto.getRandomValues(new Uint32Array(1));
    if (x < limit) return x % n;
  }
}

/** Lower-case letters and digits; user ids (24, matching the proxy's SUB_ID) and session ids. */
export const newId = (len = 24) => Array.from({ length: len }, () => ALNUM[uniform(ALNUM.length)]).join('');

/** The emailed code: six digits, leading zeros kept. */
export const sixDigits = () => String(uniform(1_000_000)).padStart(6, '0');

/** A session token or a ticket: 32 random bytes, URL-safe. */
export const token = () => b64url(randomBytes(32));

export async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** PBKDF2-HMAC-SHA256, 32 bytes, as hex. 100 000 rounds is the Workers
    runtime's ceiling; the pepper in front of it is what protects a
    10 000-value PIN if the database alone is taken. */
export async function pbkdf2(secret, saltHex, iterations = 100_000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Compares two strings in time that depends only on their length. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Peppers must be long random strings; anything shorter is a setup mistake. */
export const secretsReady = (env) => [env.PIN_PEPPER, env.CODE_PEPPER].every((s) => typeof s === 'string' && s.length >= 32);
