/* /v1/auth/* (architecture §30, "Endpoints" and "Sign-in sequence"). */

import { AuthError, json, body, normalEmail, PLATFORMS, cleanLabel } from './http.js';
import { startCode, verifyCode, ticketMatches, consumeTicket } from './codes.js';
import { validPin, hashPin, checkPin, setPin } from './pin.js';
import { createSession, sessionResponse, revoke } from './sessions.js';
import { newId } from './crypto.js';
import { send } from '../mail/index.js';
import { profile, currentVersions } from '../account.js';

const SUB_ID = /^[a-z0-9]{8,64}$/;
const MAX_LEGACY = 5;

const needEmail = (b) => {
  const email = normalEmail(b.email);
  if (!email) throw new AuthError('bad_request', 'Enter a valid email address.');
  return email;
};
function pinOrThrow(pin) {
  const v = validPin(pin);
  if (v === 'pin_weak') throw new AuthError('pin_weak', 'Choose a PIN that is not four of the same digit or a straight run.');
  if (v !== 'ok') throw new AuthError('bad_request', 'The PIN is four digits.');
}
const userByEmail = (env, email) => env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
const userById = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

/** The device the session is for: the platform from X-Stackd-Client, its own label. */
function device(request, b) {
  const client = request.headers.get('X-Stackd-Client');
  if (!PLATFORMS.includes(client)) throw new AuthError('bad_request', 'Unknown client.');
  return { client, platform: client, label: cleanLabel(b.label) };
}

/** The device's anonymous id, so this period's usage follows it (AC-08.2). */
async function linkLegacy(env, userId, legacyId, now) {
  if (typeof legacyId !== 'string' || !SUB_ID.test(legacyId) || legacyId === userId) return;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM legacy_ids WHERE user_id = ?').bind(userId).first('n');
  if (n >= MAX_LEGACY) return;
  await env.DB.prepare('INSERT OR IGNORE INTO legacy_ids (user_id, subscriber_id, linked_at) VALUES (?, ?, ?)').bind(userId, legacyId, now).run();
}

async function signedIn(env, ctx, { user, dev, now, cors, mailNew }) {
  const s = await createSession(env, { userId: user.id, platform: dev.platform, label: dev.label, pinVersion: user.pin_version, now });
  if (mailNew) ctx.later(send(env, { to: user.email, template: 'new_signin', vars: { label: dev.label, at: now } }));
  const account = await profile(env, { userId: user.id, sessionId: s.id }, now);
  return sessionResponse({ account, sessionId: s.id }, { token: s.token, client: dev.client }, cors);
}

export async function authRoute(request, env, ctx, { path, method, ident, now, cors }) {
  if (method !== 'POST') throw new AuthError('bad_request', 'No such route.', 404);

  if (path === '/v1/auth/start') {
    const email = needEmail(await body(request));
    await startCode(env, request, email, { now, later: ctx.later });
    return new Response(null, { status: 204, headers: cors });
  }

  if (path === '/v1/auth/verify') {
    const b = await body(request);
    const email = needEmail(b);
    const { ticket } = await verifyCode(env, request, email, b.code, { now });
    /* only now, after a correct code, may the answer tell a known email from a new one (AC-02.7) */
    const user = await userByEmail(env, email);
    return json({ ok: true, ticket, account: user ? 'existing' : 'new', pinLocked: !!user?.pin_locked }, 200, cors);
  }

  if (path === '/v1/auth/register') {
    const b = await body(request);
    const email = needEmail(b);
    const dev = device(request, b);
    const key = await ticketMatches(env, b.ticket, email, { now });
    if (b.adult !== true) throw new AuthError('underage', 'Accounts are for adults.', 403);
    const cur = currentVersions(env);
    if (b.termsVersion !== cur.terms || b.privacyVersion !== cur.privacy) {
      throw new AuthError('accept_required', 'The Terms or the Privacy Policy changed. Read them again to continue.', 409, { current: cur });
    }
    pinOrThrow(b.pin);
    if (await userByEmail(env, email)) throw new AuthError('conflict', 'This email already has an account. Sign in instead.', 409);
    const id = newId(24);
    const { salt, hash } = await hashPin(env, id, b.pin);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id, email, created_at, adult_confirmed_at, terms_version, privacy_version, accepted_at, pin_salt, pin_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, email, now, now, cur.terms, cur.privacy, now, salt, hash),
      env.DB.prepare('INSERT INTO consent_log (user_id, what, version, at) VALUES (?, \'adult\', \'18+\', ?)').bind(id, now),
      env.DB.prepare('INSERT INTO consent_log (user_id, what, version, at) VALUES (?, \'terms\', ?, ?)').bind(id, cur.terms, now),
      env.DB.prepare('INSERT INTO consent_log (user_id, what, version, at) VALUES (?, \'privacy\', ?, ?)').bind(id, cur.privacy, now),
    ]);
    await consumeTicket(env, key);
    await linkLegacy(env, id, b.legacyId, now);
    return signedIn(env, ctx, { user: await userById(env, id), dev, now, cors, mailNew: false });
  }

  if (path === '/v1/auth/signin') {
    const b = await body(request);
    const email = needEmail(b);
    const dev = device(request, b);
    const key = await ticketMatches(env, b.ticket, email, { now });
    const user = await userByEmail(env, email);
    if (!user) throw new AuthError('conflict', 'There is no account for this email. Create one instead.', 409);
    /* the ticket survives a wrong PIN, so the user can try again; the PIN's own count still applies */
    const r = await checkPin(env, user, b.pin);
    if (!r.ok) throw pinError(r);
    await consumeTicket(env, key);
    await linkLegacy(env, user.id, b.legacyId, now);
    return signedIn(env, ctx, { user, dev, now, cors, mailNew: true });
  }

  if (path === '/v1/auth/pin/reset') {
    const b = await body(request);
    const email = needEmail(b);
    const dev = device(request, b);
    const key = await ticketMatches(env, b.ticket, email, { now });
    const user = await userByEmail(env, email);
    if (!user) throw new AuthError('conflict', 'There is no account for this email.', 409);
    pinOrThrow(b.pin);
    await setPin(env, user.id, b.pin);
    await revoke(env, user.id);                       // every other device, loudly (AC-03.5)
    await consumeTicket(env, key);
    ctx.later(send(env, { to: user.email, template: 'pin_reset', vars: { at: now } }));
    return signedIn(env, ctx, { user: await userById(env, user.id), dev, now, cors, mailNew: false });
  }

  /* — with a session — */
  if (ident.kind !== 'account') throw new AuthError('signed_out', 'Sign in first.', 401);

  if (path === '/v1/auth/pin/check') {
    const b = await body(request);
    const user = await userById(env, ident.userId);
    const r = await checkPin(env, user, b.pin);
    if (!r.ok) throw pinError(r);
    await env.DB.prepare('UPDATE sessions SET pin_version = ? WHERE id = ? AND user_id = ?').bind(user.pin_version, ident.sessionId, ident.userId).run();
    return json({ ok: true, pinVersion: user.pin_version }, 200, cors);
  }

  if (path === '/v1/auth/pin/change') {
    const b = await body(request);
    const user = await userById(env, ident.userId);
    const r = await checkPin(env, user, b.pin);
    if (!r.ok) throw pinError(r);
    pinOrThrow(b.newPin);
    const v = await setPin(env, user.id, b.newPin);
    await env.DB.prepare('UPDATE sessions SET pin_version = ? WHERE id = ? AND user_id = ?').bind(v, ident.sessionId, ident.userId).run();
    ctx.later(send(env, { to: user.email, template: 'pin_changed', vars: { at: now } }));
    return json({ ok: true, pinVersion: v }, 200, cors);
  }

  throw new AuthError('bad_request', 'No such route.', 404);
}

export function pinError(r) {
  return r.code === 'pin_locked'
    ? new AuthError('pin_locked', 'Your PIN is locked after five wrong tries. Reset it with an email code.', 423, { left: 0 })
    : new AuthError('pin_wrong', `Wrong PIN. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`, 401, { left: r.left });
}
