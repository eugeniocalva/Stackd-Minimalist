/* /v1/account* (PRD-accounts US-04, US-10, AC-02.8): the profile and the
   device list, accepting new documents, signing out, export and delete.
   Every statement is bound to the session's user id; no id from a request
   body ever selects a user (AC-05.10). */

import { AuthError, json, body } from './auth/http.js';
import { checkPin } from './auth/pin.js';
import { ticketMatches, consumeTicket } from './auth/codes.js';
import { revoke, clearCookie } from './auth/sessions.js';
import { pinError } from './auth/routes.js';
import { send } from './mail/index.js';

const RC_API = 'https://api.revenuecat.com/v1/subscribers/';

export function currentVersions(env) {
  const terms = String(env.TERMS_VERSION || ''), privacy = String(env.PRIVACY_VERSION || '');
  if (!terms || !privacy) throw new AuthError('misconfigured', 'Accounts are not set up on this server.', 503);
  return { terms, privacy };
}

/** The account as the app shows it (architecture §32 Account). */
export async function profile(env, { userId, sessionId }) {
  const u = await env.DB.prepare('SELECT id, email, created_at, pin_version, terms_version, privacy_version, pin_locked FROM users WHERE id = ?').bind(userId).first();
  if (!u) throw new AuthError('signed_out', 'This account no longer exists.', 401);
  const { results } = await env.DB.prepare('SELECT id, platform, label, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').bind(userId).all();
  const current = currentVersions(env);
  return {
    id: u.id, email: u.email, createdAt: u.created_at, pinVersion: u.pin_version, pinLocked: !!u.pin_locked,
    accepted: { terms: u.terms_version, privacy: u.privacy_version }, current,
    needsAccept: u.terms_version !== current.terms || u.privacy_version !== current.privacy,
    devices: results.map((s) => ({
      id: s.id, platform: s.platform, label: s.label, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === sessionId,
    })),
  };
}

/** A session that has not proved the account's current PIN may only unlock or leave (AC-03.6). */
export function requirePin(ident) {
  if (ident.sessionPinVersion < ident.pinVersion) throw new AuthError('pin_required', 'Your PIN changed on another device. Enter the new PIN.', 403);
}

/** The documents this account last accepted are the current ones (AC-02.8). */
export async function requireAccepted(env, userId) {
  const u = await env.DB.prepare('SELECT terms_version, privacy_version FROM users WHERE id = ?').bind(userId).first();
  const cur = currentVersions(env);
  if (!u || u.terms_version !== cur.terms || u.privacy_version !== cur.privacy) {
    throw new AuthError('accept_required', 'The Terms or the Privacy Policy changed. Read them again to continue.', 409, { current: cur });
  }
}

export async function accountRoute(request, env, ctx, { path, method, ident, now, cors }) {
  if (ident.kind !== 'account') throw new AuthError('signed_out', 'Sign in first.', 401);
  const { userId, sessionId } = ident;

  if (method === 'GET' && path === '/v1/account') {
    return json({ ok: true, account: await profile(env, ident, now) }, 200, cors);
  }

  if (method === 'POST' && path === '/v1/account/signout') {
    const b = await body(request);
    if (b.all === true) await revoke(env, userId);
    else if (typeof b.sessionId === 'string' && b.sessionId !== sessionId) await revoke(env, userId, { sessionId: b.sessionId });
    else await revoke(env, userId, { sessionId });
    const own = b.all === true || !b.sessionId || b.sessionId === sessionId;
    return new Response(null, { status: 204, headers: own && ident.via === 'cookie' ? { ...cors, 'Set-Cookie': clearCookie() } : cors });
  }

  requirePin(ident);

  if (method === 'POST' && path === '/v1/account/accept') {
    const b = await body(request);
    const cur = currentVersions(env);
    if (b.termsVersion !== cur.terms || b.privacyVersion !== cur.privacy) {
      throw new AuthError('accept_required', 'Accept the current Terms and Privacy Policy.', 409, { current: cur });
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET terms_version = ?, privacy_version = ?, accepted_at = ? WHERE id = ?').bind(cur.terms, cur.privacy, now, userId),
      env.DB.prepare('INSERT INTO consent_log (user_id, what, version, at) VALUES (?, \'terms\', ?, ?)').bind(userId, cur.terms, now),
      env.DB.prepare('INSERT INTO consent_log (user_id, what, version, at) VALUES (?, \'privacy\', ?, ?)').bind(userId, cur.privacy, now),
    ]);
    return new Response(null, { status: 204, headers: cors });
  }

  if (method === 'GET' && path === '/v1/account/export') {
    const account = await profile(env, ident, now);
    const { results: consents } = await env.DB.prepare('SELECT what, version, at FROM consent_log WHERE user_id = ? ORDER BY at').bind(userId).all();
    const { results: rows } = await env.DB.prepare('SELECT kind, id, changed_at, data FROM records WHERE user_id = ? AND deleted = 0 ORDER BY kind, id').bind(userId).all();
    const file = {
      app: 'stackd-account-export', format: 1, exportedAt: now,
      account: { email: account.email, createdAt: account.createdAt, accepted: account.accepted, consents, devices: account.devices },
      records: rows.map((r) => ({ kind: r.kind, id: r.id, changedAt: r.changed_at, data: JSON.parse(r.data) })),
    };
    return new Response(JSON.stringify(file, null, 2), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="stackd-account.json"' },
    });
  }

  if (method === 'POST' && path === '/v1/account/delete') {
    const b = await body(request);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    let key = null;
    if (typeof b.ticket === 'string') key = await ticketMatches(env, b.ticket, user.email, { now });   // the PIN is locked or forgotten
    else {
      const r = await checkPin(env, user, b.pin);
      if (!r.ok) throw pinError(r);
    }
    /* everything cascades from the user row: records, sessions, legacy ids, consents (AC-10.4) */
    await env.DB.batch([
      env.DB.prepare('DELETE FROM records WHERE user_id = ?').bind(userId),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      env.DB.prepare('DELETE FROM legacy_ids WHERE user_id = ?').bind(userId),
      env.DB.prepare('DELETE FROM consent_log WHERE user_id = ?').bind(userId),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
    if (key) await consumeTicket(env, key);
    ctx.later(send(env, { to: user.email, template: 'deleted', vars: { at: now } }));
    if (env.RC_SECRET_KEY) {
      ctx.later((env.FETCH || fetch)(RC_API + encodeURIComponent(userId), { method: 'DELETE', headers: { Authorization: `Bearer ${env.RC_SECRET_KEY}` } }));
    }
    return new Response(null, { status: 204, headers: ident.via === 'cookie' ? { ...cors, 'Set-Cookie': clearCookie() } : cors });
  }

  throw new AuthError('bad_request', 'No such route.', 404);
}
