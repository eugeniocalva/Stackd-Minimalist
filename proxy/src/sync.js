/* /v1/sync and /v1/sync/summary (PRD-accounts US-05; architecture §30,
   "Sync protocol"). The server keeps one row per record, stamps every
   accepted change with the next revision of the account, and hands back
   everything after the device's cursor. It reads no record's content
   beyond its size: the device validates what it applies.

   Per change, against what is stored:
     nothing stored        → stored
     stored as deleted     → rejected 'deleted' (delete wins, AC-05.7)
     stored, newer or same → rejected 'older' (unless the change deletes)
     stored, older         → stored
   changedAt is clamped to the server's clock, so a device whose clock runs
   ahead cannot win every conflict (AC-05.6). */

import { AuthError, json } from './auth/http.js';
import { hit, HOUR, LIMITS as RATE } from './auth/ratelimit.js';
import { requirePin, requireAccepted } from './account.js';

export const KINDS = ['list', 'task', 'note', 'meeting', 'settings'];
export const LIMITS = { changes: 200, bytes: 4_000_000, record: 1_000_000, records: 20_000, account: 50_000_000, pull: 500 };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape only; null when the change is acceptable, else the reason. */
export function invalid(c) {
  if (!c || typeof c !== 'object') return 'not a change';
  if (!KINDS.includes(c.kind)) return 'unknown kind';
  if (typeof c.id !== 'string' || !ID.test(c.id) || (c.kind === 'settings' && c.id !== 'settings')) return 'bad id';
  if (!Number.isSafeInteger(c.changedAt) || c.changedAt <= 0) return 'bad changedAt';
  if (typeof c.deleted !== 'boolean') return 'bad deleted';
  if (c.deleted ? c.data !== null : (!c.data || typeof c.data !== 'object' || Array.isArray(c.data))) return 'bad data';
  if (!c.deleted && c.kind !== 'settings' && c.data.id !== c.id) return 'id mismatch';
  return null;
}

async function apply(env, userId, changes, now) {
  const rejected = [];
  const keep = [];
  const stored = new Map();
  if (changes.length) {
    /* what is there now, for the outcome of each change */
    const keys = changes.map((c) => `${c.kind}:${c.id}`);
    const unique = [...new Set(keys)];
    for (let i = 0; i < unique.length; i += 50) {
      const part = unique.slice(i, i + 50);
      const { results } = await env.DB.prepare(`SELECT kind, id, changed_at, deleted FROM records WHERE user_id = ? AND (kind || ':' || id) IN (${part.map(() => '?').join(',')})`)
        .bind(userId, ...part).all();
      results.forEach((r) => stored.set(`${r.kind}:${r.id}`, r));
    }
  }
  const latest = new Map();          // the last change per record in this request wins inside it
  for (const c of changes) latest.set(`${c.kind}:${c.id}`, c);
  for (const [k, c] of latest) {
    const at = Math.min(c.changedAt, now);
    const s = stored.get(k);
    if (s?.deleted) { rejected.push({ kind: c.kind, id: c.id, reason: 'deleted' }); continue; }
    if (s && !c.deleted && s.changed_at >= at) { rejected.push({ kind: c.kind, id: c.id, reason: 'older' }); continue; }
    if (!s && c.deleted) continue;   // nothing to delete; nothing to tell
    keep.push({ ...c, changedAt: at, text: c.deleted ? null : JSON.stringify(c.data) });
  }
  if (!keep.length) return { accepted: 0, rejected };

  const size = keep.reduce((n, c) => n + (c.text?.length || 0), 0);
  const fresh = keep.filter((c) => !stored.has(`${c.kind}:${c.id}`)).length;
  if (keep.some((c) => (c.text?.length || 0) > LIMITS.record)) throw new AuthError('quota', 'One item is too large to sync.', 413);
  if (fresh) {
    const q = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM records WHERE user_id = ?').bind(userId).first();
    if (q.n + fresh > LIMITS.records || q.bytes + size > LIMITS.account) throw new AuthError('quota', 'This account is full. Delete items you no longer need.', 413);
  }

  /* one atomic batch: reserve revisions, then write each record at its own.
     The WHERE on the upsert repeats the outcome rules, so a sync from
     another device in between can only make a write a no-op, never undo
     a delete. */
  const n = keep.length;
  const stmts = [env.DB.prepare('UPDATE users SET rev = rev + ? WHERE id = ?').bind(n, userId)];
  keep.forEach((c, i) => {
    stmts.push(env.DB.prepare(`
      INSERT INTO records (user_id, kind, id, rev, changed_at, deleted, data)
      VALUES (?1, ?2, ?3, (SELECT rev FROM users WHERE id = ?1) - ?4, ?5, ?6, ?7)
      ON CONFLICT(user_id, kind, id) DO UPDATE SET
        rev = excluded.rev, changed_at = excluded.changed_at, deleted = excluded.deleted, data = excluded.data
      WHERE records.deleted = 0 AND (excluded.deleted = 1 OR records.changed_at < excluded.changed_at)`)
      .bind(userId, c.kind, c.id, n - 1 - i, c.changedAt, c.deleted ? 1 : 0, c.text));
  });
  await env.DB.batch(stmts);
  return { accepted: n, rejected };
}

async function pull(env, userId, cursor) {
  const { results } = await env.DB.prepare('SELECT kind, id, rev, changed_at, deleted, data FROM records WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?')
    .bind(userId, cursor, LIMITS.pull).all();
  const more = results.length === LIMITS.pull;
  const top = more ? results.at(-1).rev : await env.DB.prepare('SELECT rev FROM users WHERE id = ?').bind(userId).first('rev');
  return {
    changes: results.map((r) => ({ kind: r.kind, id: r.id, changedAt: r.changed_at, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) })),
    cursor: Math.max(cursor, top ?? 0), more,
  };
}

export async function syncRoute(request, env, ctx, { path, method, ident, now, cors }) {
  if (ident.kind !== 'account') throw new AuthError('signed_out', 'Sign in first.', 401);
  requirePin(ident);
  const { userId } = ident;

  if (method === 'GET' && path === '/v1/sync/summary') {
    const { results } = await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE user_id = ? AND deleted = 0 GROUP BY kind').bind(userId).all();
    const counts = Object.fromEntries(KINDS.filter((k) => k !== 'settings').map((k) => [k, 0]));
    results.forEach((r) => { if (r.kind in counts) counts[r.kind] = r.n; });
    return json({ ok: true, counts, serverTime: now }, 200, cors);
  }

  if (method === 'POST' && path === '/v1/sync') {
    await requireAccepted(env, userId);
    const r = await hit(env, `sync:u:${userId}`, { limit: RATE.syncPerUser, windowMs: HOUR, now });
    if (!r.ok) throw new AuthError('rate_limited', 'Sync is paused for a moment.', 429, { retryAfter: r.retryAfter });
    const raw = await request.text();
    if (raw.length > LIMITS.bytes) throw new AuthError('too_large', 'Send fewer changes at a time.', 413);
    let b;
    try { b = JSON.parse(raw); } catch { throw new AuthError('bad_request', 'The request body is not JSON.'); }
    const cursor = Number.isSafeInteger(b?.cursor) && b.cursor >= 0 ? b.cursor : 0;
    const changes = Array.isArray(b?.changes) ? b.changes : [];
    if (changes.length > LIMITS.changes) throw new AuthError('too_large', 'Send fewer changes at a time.', 413);
    const bad = changes.map(invalid).findIndex(Boolean);
    if (bad !== -1) throw new AuthError('bad_request', `Change ${bad} is not valid: ${invalid(changes[bad])}.`);
    const { accepted, rejected } = await apply(env, userId, changes, now);
    const out = await pull(env, userId, cursor);
    return json({ ok: true, accepted, rejected, ...out, serverTime: now }, 200, cors);
  }

  throw new AuthError('bad_request', 'No such route.', 404);
}
