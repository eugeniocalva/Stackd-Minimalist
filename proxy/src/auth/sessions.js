/* Sessions (PRD-accounts US-04; architecture §30, "Identity on every
   request"). A device holds a 32-byte token: an HttpOnly cookie on the web,
   a bearer token in the Keychain / Keystore in the shells. The database
   keeps only its SHA-256. A session unused for 90 days is gone. */

import { sha256, token, newId } from './crypto.js';
import { AuthError, json } from './http.js';

export const SESSION_DAYS = 90;
export const IDLE_MS = SESSION_DAYS * 86400_000;
const SEEN_EVERY_MS = 3600_000;          // last_seen_at is written at most once an hour
export const COOKIE = 'stackd_session';

function cookieToken(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=') || null;
  }
  return null;
}

/** Where the request's token is, if it carries one. */
export function carried(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(auth);
  if (m) return { token: m[1], via: 'bearer' };
  const c = cookieToken(request);
  return c ? { token: c, via: 'cookie' } : null;
}

/** → { kind: 'account', userId, sessionId, pinVersion, sessionPinVersion, tester, via }
      | { kind: 'anon' }. A token that is sent but unknown or expired is
    signed_out, so the device forgets it once instead of retrying. */
export async function identify(request, env, now) {
  const t = carried(request);
  if (!t) return { kind: 'anon' };
  if (!env.DB) throw new AuthError('misconfigured', 'Accounts are not set up on this server.', 503);
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.user_id, s.pin_version AS session_pin, s.last_seen_at, u.pin_version, u.tester
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(await sha256(t.token)).first();
  if (!row || now - row.last_seen_at > IDLE_MS) {
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    throw new AuthError('signed_out', 'This device was signed out.', 401);
  }
  if (now - row.last_seen_at > SEEN_EVERY_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run();
  }
  return {
    kind: 'account', userId: row.user_id, sessionId: row.session_id, via: t.via,
    pinVersion: row.pin_version, sessionPinVersion: row.session_pin, tester: !!row.tester,
  };
}

export async function createSession(env, { userId, platform, label, pinVersion, now }) {
  const id = `s_${newId(16)}`;
  const t = token();
  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, platform, label, pin_version, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, await sha256(t), platform, label, pinVersion, now, now).run();
  return { id, token: t };
}

/** The web gets the token as a cookie it cannot read; the shells get it in the body. */
export function sessionResponse(payload, { token: t, client }, headers) {
  if (client === 'web') {
    return json({ ok: true, ...payload }, 200, {
      ...headers,
      'Set-Cookie': `${COOKIE}=${t}; HttpOnly; Secure; SameSite=Strict; Path=/v1; Max-Age=${SESSION_DAYS * 86400}`,
    });
  }
  return json({ ok: true, ...payload, token: t }, 200, headers);
}

export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/v1; Max-Age=0`;

/** sessionId: one device; allBut: every device except that one; neither: all. */
export async function revoke(env, userId, { sessionId = null, allBut = null } = {}) {
  if (sessionId) return env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(userId, sessionId).run();
  if (allBut) return env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(userId, allBut).run();
  return env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
