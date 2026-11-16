/* Shared boards (docs/prd-improvements.md US-12; architecture §39 to §41).
   A space is one board the owner shares by email. An invitation waits until
   the invited person, signed in with that email, accepts it in the app; the
   owner's answer is the same whether or not the email has an account
   (AC-12.4). Members change cards and lanes; the owner also renames,
   invites, removes and deletes. The board and its cards sync through
   /v1/sync's `spaces` map (sync.js). */

import { AuthError, json, body, normalEmail } from './auth/http.js';
import { hmac, newId } from './auth/crypto.js';
import { hit } from './auth/ratelimit.js';
import { requirePin, requireAccepted } from './account.js';

export const MAX_PEOPLE = 10;              // owner, members and pending invitations together (AC-12.10)
export const INVITE_DAYS = 30;
const INVITES_PER_DAY = 20;
const DAY = 86400_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const inviteKey = (env, email) => hmac(env.CODE_PEPPER, `invite:${email}`);
const boardName = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '') || 'Shared board';

/** What this account shares and is invited to; every sync answer carries it. */
export async function sharedState(env, userId, now = Date.now()) {
  const me = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
  const { results: mine } = await env.DB.prepare(`
    SELECT m.space_id, m.role, o.email AS owner_email
    FROM space_members m JOIN spaces s ON s.id = m.space_id JOIN users o ON o.id = s.owner_id
    WHERE m.user_id = ?`).bind(userId).all();
  const spaces = [];
  for (const s of mine) {
    const { results: people } = await env.DB.prepare(`
      SELECT u.email, m.role FROM space_members m JOIN users u ON u.id = m.user_id WHERE m.space_id = ? ORDER BY m.role DESC, m.joined_at`).bind(s.space_id).all();
    const { results: pending } = await env.DB.prepare('SELECT email FROM invites WHERE space_id = ? AND expires_at > ? ORDER BY created_at, email').bind(s.space_id, now).all();
    spaces.push({
      id: s.space_id, role: s.role, ownerEmail: s.owner_email,
      members: [...people.map((p) => ({ email: p.email, role: p.role, state: 'active' })), ...pending.map((p) => ({ email: p.email, role: 'member', state: 'pending' }))],
    });
  }
  const invites = me ? (await env.DB.prepare(`
    SELECT i.id, i.board_name, i.expires_at, o.email AS owner_email
    FROM invites i JOIN spaces s ON s.id = i.space_id JOIN users o ON o.id = s.owner_id
    WHERE i.email_key = ? AND i.expires_at > ? ORDER BY i.created_at`).bind(await inviteKey(env, me.email), now).all()).results : [];
  return { spaces, invites: invites.map((i) => ({ id: i.id, boardName: i.board_name, ownerEmail: i.owner_email, expiresAt: i.expires_at })) };
}

/** emails[] → normalised list, refusing bad ones and the owner's own address. */
function cleanEmails(list, ownEmail) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_PEOPLE) throw new AuthError('bad_request', 'Add between one and nine email addresses.');
  const out = [];
  for (const raw of list) {
    const e = normalEmail(raw);
    if (!e) throw new AuthError('bad_request', `“${String(raw).slice(0, 60)}” is not an email address.`, 400, { email: String(raw).slice(0, 254) });
    if (e === ownEmail) throw new AuthError('bad_request', 'You are already on this board.', 400, { email: e });
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

async function invite(env, { spaceId, name, emails, userId, now }) {
  const count = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM space_members WHERE space_id = ?1) + (SELECT COUNT(*) FROM invites WHERE space_id = ?1 AND expires_at > ?2) AS n`).bind(spaceId, now).first('n');
  if (count + emails.length > MAX_PEOPLE) throw new AuthError('quota', `A shared board has at most ${MAX_PEOPLE} people.`, 409);
  const day = await hit(env, `invite:u:${userId}`, { limit: INVITES_PER_DAY, windowMs: DAY, now });
  if (!day.ok) throw new AuthError('rate_limited', 'Too many invitations today. Try again tomorrow.', 429, { retryAfter: day.retryAfter });
  const { results: members } = await env.DB.prepare('SELECT u.email FROM space_members m JOIN users u ON u.id = m.user_id WHERE m.space_id = ?').bind(spaceId).all();
  const already = new Set(members.map((m) => m.email));
  const stmts = [];
  for (const email of emails) {
    if (already.has(email)) continue;                 // on the board already: nothing to send, nothing to say
    stmts.push(env.DB.prepare(`
      INSERT INTO invites (id, space_id, email_key, email, board_name, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, email_key) DO UPDATE SET board_name = excluded.board_name, created_at = excluded.created_at, expires_at = excluded.expires_at`)
      .bind(`i_${newId(16)}`, spaceId, await inviteKey(env, email), email, name, userId, now, now + INVITE_DAYS * DAY));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

async function membership(env, spaceId, userId) {
  if (!ID.test(spaceId)) throw new AuthError('bad_request', 'No such board.', 404);
  const m = await env.DB.prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?').bind(spaceId, userId).first();
  if (!m) throw new AuthError('gone', 'You are not on this board.', 404);
  return m.role;
}
const ownerOnly = (role) => { if (role !== 'owner') throw new AuthError('not_allowed', 'Only the owner of the board can do this.', 403); };

export async function spacesRoute(request, env, ctx, { path, method, ident, now, cors }) {
  if (ident.kind !== 'account') throw new AuthError('signed_out', 'Sign in first.', 401);
  requirePin(ident);
  await requireAccepted(env, ident.userId);
  const { userId } = ident;
  const me = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
  const ok = async (extra = {}) => json({ ok: true, ...extra, shared: await sharedState(env, userId, now) }, 200, cors);

  if (method === 'GET' && path === '/v1/spaces') return ok();

  if (method === 'POST' && path === '/v1/spaces') {
    const b = await body(request);
    const emails = cleanEmails(b.emails, me.email);
    /* The server picks the id, never the client: board ids on a device are
       predictable (the samples are 'work', 'personal', …) and a deleted
       space's id is known to its former members, so a chosen id would let
       anyone open a space under someone else's board and, once they
       accept, receive its cards. 16 random characters are never reused. */
    const id = `s_${newId(16)}`;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO spaces (id, owner_id, rev, created_at) VALUES (?, ?, 0, ?)').bind(id, userId, now),
      env.DB.prepare('INSERT INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)').bind(id, userId, now),
    ]);
    await invite(env, { spaceId: id, name: boardName(b.boardName), emails, userId, now });
    return ok({ id });
  }

  const inv = /^\/v1\/invites\/([^/]+)\/(accept|decline)$/.exec(path);
  if (method === 'POST' && inv) {
    const row = await env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(decodeURIComponent(inv[1])).first();
    /* an invitation is answered only by the person it was sent to */
    if (!row || row.email_key !== await inviteKey(env, me.email) || row.expires_at <= now) throw new AuthError('gone', 'This invitation is no longer open.', 404);
    const stmts = [env.DB.prepare('DELETE FROM invites WHERE id = ?').bind(row.id)];
    if (inv[2] === 'accept') {
      stmts.push(env.DB.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, \'member\', ?)').bind(row.space_id, userId, now));
    }
    await env.DB.batch(stmts);
    return ok();
  }

  const sp = /^\/v1\/spaces\/([^/]+)(?:\/(invite|remove|leave))?$/.exec(path);
  if (sp) {
    const spaceId = decodeURIComponent(sp[1]);
    const role = await membership(env, spaceId, userId);
    if (method === 'DELETE' && !sp[2]) {
      ownerOnly(role);
      await env.DB.prepare('DELETE FROM spaces WHERE id = ? AND owner_id = ?').bind(spaceId, userId).run();   // members, invites and records cascade
      return ok();
    }
    if (method === 'POST' && sp[2] === 'invite') {
      ownerOnly(role);
      const b = await body(request);
      const board = await env.DB.prepare("SELECT data FROM space_records WHERE space_id = ? AND kind = 'list' AND id = ?").bind(spaceId, spaceId).first();
      await invite(env, { spaceId, name: boardName(board ? JSON.parse(board.data).name : b.boardName), emails: cleanEmails(b.emails, me.email), userId, now });
      return ok();
    }
    if (method === 'POST' && sp[2] === 'remove') {
      ownerOnly(role);
      const email = normalEmail((await body(request)).email);
      if (!email || email === me.email) throw new AuthError('bad_request', 'Choose someone else on the board.');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM space_members WHERE space_id = ? AND role = \'member\' AND user_id = (SELECT id FROM users WHERE email = ?)').bind(spaceId, email),
        env.DB.prepare('DELETE FROM invites WHERE space_id = ? AND email_key = ?').bind(spaceId, await inviteKey(env, email)),
      ]);
      return ok();
    }
    if (method === 'POST' && sp[2] === 'leave') {
      if (role === 'owner') throw new AuthError('not_allowed', 'The owner deletes the board instead of leaving it.', 403);
      await env.DB.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').bind(spaceId, userId).run();
      return ok();
    }
  }
  throw new AuthError('bad_request', 'No such route.', 404);
}

/** Account deletion: invitations addressed to this email go too. */
export async function forgetInvites(env, email) {
  await env.DB.prepare('DELETE FROM invites WHERE email_key = ?').bind(await inviteKey(env, email)).run();
}
