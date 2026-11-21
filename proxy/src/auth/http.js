/* Shared answers and errors for the account routes. */

export const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

export const fail = (code, message, status, headers, extra = {}) => json({ ok: false, code, message, ...extra }, status, headers);

/** Thrown inside a handler, answered by the router. */
export class AuthError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code; this.status = status; this.extra = extra;
  }
}

/** The request body as an object, or a bad_request. */
export async function body(request) {
  let b;
  try { b = await request.json(); } catch { throw new AuthError('bad_request', 'The request body is not JSON.'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new AuthError('bad_request', 'The request body is not an object.');
  return b;
}

/** The injected clock in tests (env.NOW), the real one in the Worker. */
export const clock = (env) => (typeof env.NOW === 'function' ? env.NOW() : Date.now());

/** Mail and other work that must not hold the answer back. */
export const later = (ctx, promise) => {
  const p = promise.catch((e) => console.error('background', e?.message || 'failed'));
  if (ctx?.waitUntil) ctx.waitUntil(p); else return p;
  return undefined;
};

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Trimmed and lower-cased, or null when it is not shaped like an address. */
export function normalEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export const PLATFORMS = ['web', 'ios', 'android'];
/** What a device calls itself in Devices: printable, short. */
export function cleanLabel(v) {
  const s = typeof v === 'string' ? v.replace(/[^\p{L}\p{N} .,()'+-]/gu, '').trim().slice(0, 40) : '';
  return s || 'Device';
}
