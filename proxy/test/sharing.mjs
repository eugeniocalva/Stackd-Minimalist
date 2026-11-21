/* Shared boards on a real SQL engine (architecture Part V §43, Phase 34):
   an owner shares a board, a member accepts and edits it, the rules for
   who may change what, removal, leaving, deletion, and isolation. */
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { d1 } from './d1.mjs';
import { retention } from '../src/retention.js';

const logged = [];
for (const k of ['log', 'error', 'warn']) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };

const db = d1();
db.migrate(new URL('../migrations/', import.meta.url));
let t = Date.UTC(2026, 11, 1, 9, 0);
const outbox = [];
const env = {
  APP_TOKEN: 'tok', DB: db, POOL: { get: async () => null, put: async () => {}, delete: async () => {} },
  PIN_PEPPER: 'p'.repeat(40), CODE_PEPPER: 'c'.repeat(40), TERMS_VERSION: 'v1', PRIVACY_VERSION: 'v1',
  MAIL_PROVIDER: 'stub', MAIL_OUTBOX: outbox, ALLOWED_ORIGINS: '', NOW: () => t,
};
let ip = 0;
async function call(path, { method = 'POST', body, token } = {}) {
  const h = { 'X-Stackd-App': 'tok', 'X-Stackd-Client': 'ios', 'CF-Connecting-IP': `203.0.113.${(ip++ % 200) + 1}` };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://proxy.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function account(email, pin = '2580') {
  t += 61_000;
  await call('/v1/auth/start', { body: { email } });
  const code = /code is (\d{6})/.exec([...outbox].reverse().find((m) => m.to === email).text)[1];
  const v = await call('/v1/auth/verify', { body: { email, code } });
  const path = v.body.account === 'new' ? '/v1/auth/register' : '/v1/auth/signin';
  const r = await call(path, { body: { email, ticket: v.body.ticket, pin, adult: true, termsVersion: 'v1', privacyVersion: 'v1', label: 'iPhone' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
const sync = (token, spaces = {}, extra = {}) => call('/v1/sync', { body: { cursor: 0, changes: [], spaces, ...extra }, token });
const board = (id, name, at, extra = {}) => ({ kind: 'list', id, changedAt: at, deleted: false, data: { id, name, lanes: [{ id: 'backlog', name: 'Backlog' }, { id: 'done', name: 'Done' }], status: 'active', ...extra } });
const task = (id, listId, title, at) => ({ kind: 'task', id, changedAt: at, deleted: false, data: { id, listId, title, lane: 'backlog' } });

const ana = await account('ana@example.com');
const ben = await account('ben@example.com', '1357');
const eve = await account('eve@example.com', '7531');

/* ── create (AC-12.1, AC-12.2) ──────────────────────────────────────── */
let r = await call('/v1/spaces', { body: { boardName: 'Trip', emails: ['not-an-email'] }, token: ana });
assert.deepEqual([r.status, r.body.code], [400, 'bad_request']);
assert.match(r.body.message, /not an email address/);
r = await call('/v1/spaces', { body: { boardName: 'Trip', emails: ['Ana@Example.com'] }, token: ana });
assert.match(r.body.message, /already on this board/, 'the owner cannot invite themself');
r = await call('/v1/spaces', { body: { boardName: 'Trip', emails: ['ben@example.com', 'nobody@example.com'] }, token: ana });
assert.equal(r.status, 200, JSON.stringify(r.body));
const TRIP = r.body.id;
assert.match(TRIP, /^s_[A-Za-z0-9]{16}$/, 'the server makes the space id');
let trip = r.body.shared.spaces.find((s) => s.id === TRIP);
assert.equal(trip.role, 'owner');
assert.deepEqual(trip.members.map((m) => [m.email, m.role, m.state]), [['ana@example.com', 'owner', 'active'], ['ben@example.com', 'member', 'pending'], ['nobody@example.com', 'member', 'pending']],
  'an unknown email is pending like a known one (AC-12.4)');

/* the owner's board and cards go into the space, never into personal records */
r = await sync(ana, { [TRIP]: { cursor: 0, changes: [board(TRIP, 'Trip', t), task('pack', TRIP, 'Pack', t)] } });
assert.equal(r.body.spaces[TRIP].accepted, 2);
assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE id IN (?, 'pack')").get(TRIP).n, 0);

/* ── the invitation (AC-12.3) ───────────────────────────────────────── */
r = await sync(ben);
assert.deepEqual(r.body.shared.invites.map((i) => [i.boardName, i.ownerEmail]), [['Trip', 'ana@example.com']]);
const inviteId = r.body.shared.invites[0].id;
r = await sync(ben, { [TRIP]: { cursor: 0, changes: [] } });
assert.deepEqual(r.body.spaces[TRIP], { gone: true }, 'not a member before accepting');
r = await call(`/v1/invites/${inviteId}/accept`, { token: eve });
assert.equal(r.body.code, 'gone', 'only the invited person can answer');
r = await call(`/v1/invites/${inviteId}/accept`, { token: ben });
assert.equal(r.status, 200);
assert.deepEqual(r.body.shared.spaces.map((s) => [s.id, s.role, s.ownerEmail]), [[TRIP, 'member', 'ana@example.com']]);
assert.deepEqual(r.body.shared.invites, []);
r = await call(`/v1/invites/${inviteId}/accept`, { token: ben });
assert.equal(r.body.code, 'gone', 'an invitation is answered once');

/* ── both edit (AC-12.5, AC-12.8) ───────────────────────────────────── */
t += 1000;
r = await sync(ben, { [TRIP]: { cursor: 0, changes: [] } });
assert.deepEqual(r.body.spaces[TRIP].changes.map((c) => c.id).sort(), ['pack', TRIP], 'the member pulls the board and its cards');
let benCursor = r.body.spaces[TRIP].cursor;
r = await sync(ben, { [TRIP]: { cursor: benCursor, changes: [
  task('tickets', TRIP, 'Book tickets', t),
  board(TRIP, 'Trip', t, { lanes: [{ id: 'backlog', name: 'Backlog' }, { id: 'booked', name: 'Booked' }, { id: 'done', name: 'Done' }] }),
] } });
assert.equal(r.body.spaces[TRIP].accepted, 2, 'a member adds cards and lanes');
assert.equal(db.raw.prepare("SELECT changed_by FROM space_records WHERE id = 'tickets'").get().changed_by.length, 24);
t += 1000;
r = await sync(ben, { [TRIP]: { cursor: benCursor, changes: [board(TRIP, 'Renamed by Ben', t)] } });
assert.deepEqual(r.body.spaces[TRIP].rejected, [{ kind: 'list', id: TRIP, reason: 'not_allowed' }], 'only the owner renames');
r = await sync(ben, { [TRIP]: { cursor: benCursor, changes: [{ kind: 'list', id: TRIP, changedAt: t, deleted: true, data: null }] } });
assert.equal(r.body.spaces[TRIP].rejected[0].reason, 'not_allowed', 'nobody deletes the board through sync');
r = await sync(ana, { [TRIP]: { cursor: 0, changes: [board(TRIP, 'Trip', t, { status: 'archived' })] } });
assert.equal(r.body.spaces[TRIP].rejected[0].reason, 'not_allowed', 'a shared board is not archived through sync');
r = await sync(ben, { [TRIP]: { cursor: benCursor, changes: [task('elsewhere', 'other', 'Wrong board', t), { kind: 'note', id: 'n1', changedAt: t, deleted: false, data: { id: 'n1' } }] } });
assert.deepEqual(r.body.spaces[TRIP].rejected.map((x) => x.reason), ['not_allowed', 'not_allowed'], 'only this board and its tasks');
t += 1000;
r = await sync(ana, { [TRIP]: { cursor: 0, changes: [board(TRIP, 'Summer trip', t)] } });
assert.equal(r.body.spaces[TRIP].accepted, 1, 'the owner renames');
assert.ok(r.body.spaces[TRIP].changes.some((c) => c.id === 'tickets'), 'the owner sees the member\'s card');
/* delete wins, for cards, between people too */
t += 1000;
await sync(ana, { [TRIP]: { cursor: 0, changes: [{ kind: 'task', id: 'tickets', changedAt: t, deleted: true, data: null }] } });
r = await sync(ben, { [TRIP]: { cursor: 0, changes: [task('tickets', TRIP, 'Edited after the delete', t + 10)] } });
assert.equal(r.body.spaces[TRIP].rejected[0].reason, 'deleted');

/* isolation (AC-05.10): Eve knows the id but is not on the board */
r = await sync(eve, { [TRIP]: { cursor: 0, changes: [task('evil', TRIP, 'x', t)] } });
assert.deepEqual(r.body.spaces[TRIP], { gone: true });
assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM space_records WHERE id = 'evil'").get().n, 0);
r = await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: ['eve@example.com'] }, token: eve });
assert.equal(r.body.code, 'gone');
r = await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: ['eve@example.com'] }, token: ben });
assert.equal(r.body.code, 'not_allowed', 'only the owner invites');

/* ── at most 10 people (AC-12.10) ───────────────────────────────────── */
r = await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: Array.from({ length: 8 }, (_, i) => `p${i}@example.com`) }, token: ana });
assert.equal(r.body.code, 'quota', 'ana, ben, nobody and eight more is eleven');
r = await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: ['eve@example.com'] }, token: ana });
assert.equal(r.status, 200);

/* ── remove, decline, leave (AC-12.9) ───────────────────────────────── */
r = await sync(eve);
const eveInvite = r.body.shared.invites[0].id;
assert.equal((await call(`/v1/invites/${eveInvite}/decline`, { token: eve })).status, 200);
r = await sync(ana, { [TRIP]: { cursor: 0, changes: [] } });
assert.ok(!r.body.shared.spaces[0].members.some((m) => m.email === 'eve@example.com'), 'a declined invitation is gone');
r = await call(`/v1/spaces/${TRIP}/remove`, { body: { email: 'nobody@example.com' }, token: ana });
assert.ok(!r.body.shared.spaces[0].members.some((m) => m.email === 'nobody@example.com'), 'a pending invitation can be withdrawn');
r = await call(`/v1/spaces/${TRIP}/remove`, { body: { email: 'ben@example.com' }, token: ana });
assert.deepEqual(r.body.shared.spaces[0].members.map((m) => m.email), ['ana@example.com']);
r = await sync(ben, { [TRIP]: { cursor: benCursor, changes: [] } });
assert.deepEqual(r.body.spaces[TRIP], { gone: true }, 'a removed member gets gone');
assert.deepEqual(r.body.shared.spaces, []);

/* a member who leaves */
await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: ['ben@example.com'] }, token: ana });
const again = (await sync(ben)).body.shared.invites[0].id;
await call(`/v1/invites/${again}/accept`, { token: ben });
assert.equal((await call(`/v1/spaces/${TRIP}/leave`, { token: ana })).body.code, 'not_allowed', 'the owner deletes instead of leaving');
assert.equal((await call(`/v1/spaces/${TRIP}/leave`, { token: ben })).status, 200);
assert.deepEqual((await sync(ben, { [TRIP]: { cursor: 0, changes: [] } })).body.spaces[TRIP], { gone: true });

/* the owner deletes: everything goes, for everyone */
await call(`/v1/spaces/${TRIP}/invite`, { body: { emails: ['ben@example.com'] }, token: ana });
await call(`/v1/invites/${(await sync(ben)).body.shared.invites[0].id}/accept`, { token: ben });
assert.equal((await call(`/v1/spaces/${TRIP}`, { method: 'DELETE', token: ben })).body.code, 'not_allowed');
assert.equal((await call(`/v1/spaces/${TRIP}`, { method: 'DELETE', token: ana })).status, 200);
for (const table of ['spaces', 'space_members', 'invites', 'space_records']) {
  const col = table === 'spaces' ? 'id' : 'space_id';
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(TRIP).n, 0, `nothing left in ${table}`);
}
assert.deepEqual((await sync(ben, { [TRIP]: { cursor: 0, changes: [] } })).body.spaces[TRIP], { gone: true });

/* a client cannot choose the id: not a former space's (known to its old
   members), not a sample board's ('work' is on every new device) */
for (const boardId of [TRIP, 'work']) {
  r = await call('/v1/spaces', { body: { boardId, boardName: 'Work', emails: ['ben@example.com'] }, token: eve });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.id, boardId, 'the id the client sent is ignored');
  assert.match(r.body.id, /^s_[A-Za-z0-9]{16}$/);
}
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM spaces WHERE id IN (?, ?)').get(TRIP, 'work').n, 0);

/* ── expiry and account deletion ────────────────────────────────────── */
const LATER = (await call('/v1/spaces', { body: { boardName: 'Later', emails: ['eve@example.com'] }, token: ana })).body.id;
t += 31 * 86400_000;
assert.deepEqual((await sync(eve)).body.shared.invites, [], 'invitations expire after 30 days');
assert.ok((await retention(env, t)).invites >= 1);
const SHARED2 = (await call('/v1/spaces', { body: { boardName: 'Shared', emails: ['ben@example.com'] }, token: await account('ana@example.com') })).body.id;
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM spaces WHERE id = ?').get(SHARED2).n, 1);
const anaNow = await account('ana@example.com');
assert.equal((await call('/v1/account/delete', { body: { pin: '2580' }, token: anaNow })).status, 204);
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM spaces WHERE id IN (?, ?)').get(SHARED2, LATER).n, 0, 'deleting the account deletes the boards it shared');
assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM invites WHERE email = 'ben@example.com'").get().n, 0);

for (const line of logged) for (const s of ['ana@example.com', 'ben@example.com', 'eve@example.com']) assert.ok(!line.includes(s), 'no email in the logs');
process.stdout.write('sharing tests: ok\n');
