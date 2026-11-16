/* Accounts and sync on a real SQL engine (architecture §34, Phase 24 and
   the server half of Phase 26). A scripted client registers, signs in as a
   second device, is locked out, resets, changes the PIN, syncs both ways,
   deletes; nothing is sent anywhere (stub mail, no RevenueCat). */
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { d1 } from './d1.mjs';
import { validPin } from '../src/auth/pin.js';
import { invalid } from '../src/sync.js';
import { retention } from '../src/retention.js';
import { periodKey } from '../src/plans.js';

/* Nothing the Worker logs may carry an email, a code, a PIN or a token (AC-11.7). */
const logged = [];
for (const k of ['log', 'error', 'warn']) {
  const orig = console[k];
  console[k] = (...a) => { logged.push(a.map(String).join(' ')); if (process.env.VERBOSE) orig(...a); };
}

const db = d1();
db.migrate(new URL('../migrations/', import.meta.url));
let t = Date.UTC(2026, 11, 1, 9, 0);
const mem = new Map();
const outbox = [];
const env = {
  APP_TOKEN: 'tok', DB: db, POOL: { get: async (k) => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); } },
  PIN_PEPPER: 'p'.repeat(40), CODE_PEPPER: 'c'.repeat(40),
  TERMS_VERSION: '2026-12-01', PRIVACY_VERSION: '2026-12-01',
  MAIL_PROVIDER: 'stub', MAIL_OUTBOX: outbox, OWNER_FOOTER: 'Owner Name, Somewhere 1, Rome',
  ALLOWED_ORIGINS: 'https://app.stackdplatform.com', NOW: () => t,
};
const WEB = 'https://app.stackdplatform.com';

async function call(path, { method = 'POST', body, client = 'ios', token, cookie, origin, ip = '203.0.113.7', headers = {} } = {}) {
  const h = { 'X-Stackd-App': 'tok', 'X-Stackd-Client': client, 'CF-Connecting-IP': ip, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = `stackd_session=${cookie}`;
  if (origin) h.Origin = origin;
  const res = await worker.fetch(new Request(`https://proxy.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
const lastCode = (to) => { const m = [...outbox].reverse().find((x) => x.to === to && x.template === 'code'); return /code is (\d{6})/.exec(m.text)[1]; };
const tick = (ms) => { t += ms; };
async function codeFor(email, opts) {
  tick(61_000);
  const r = await call('/v1/auth/start', { body: { email }, ...opts });
  assert.equal(r.status, 204, `start ${JSON.stringify(r.body)}`);
  return lastCode(email.trim().toLowerCase());
}
const ANA = 'ana@example.com', BEN = 'ben@example.com';
const reg = (email, ticket, pin = '2580', extra = {}) => ({ email, ticket, pin, adult: true, termsVersion: '2026-12-01', privacyVersion: '2026-12-01', label: 'iPhone', ...extra });

/* ── rules that need no server ──────────────────────────────────────── */
assert.deepEqual(['2580', '0000', '1234', '4321', '7890', '0987', '123', 'abcd', 1234].map(validPin),
  ['ok', 'pin_weak', 'pin_weak', 'pin_weak', 'ok', 'ok', 'bad_request', 'bad_request', 'bad_request']);
assert.equal(validPin('3456'), 'pin_weak'); assert.equal(validPin('9876'), 'pin_weak'); assert.equal(validPin('1357'), 'ok');

/* ── not set up: every account route says so, the 1.5.0 routes still work ── */
{
  const saved = env.DB; env.DB = undefined;
  assert.equal((await call('/v1/auth/start', { body: { email: ANA } })).status, 503);
  env.DB = saved;
}

/* ── register (US-02) ───────────────────────────────────────────────── */
let r = await call('/v1/auth/start', { body: { email: 'not an email' } });
assert.equal(r.body.code, 'bad_request');
r = await call('/v1/auth/start', { body: { email: ' Ana@Example.com ' } });
assert.equal(r.status, 204, 'an unknown email gets a code');
const unknownAnswer = r;
assert.equal(outbox.at(-1).to, ANA, 'the address is normalised');
assert.match(outbox.at(-1).text, /valid for 10 minutes/);
assert.match(outbox.at(-1).text, /If you did not ask for this, ignore this message\./);
assert.match(outbox.at(-1).text, /Owner Name, Somewhere 1, Rome\nYou receive this because of activity on your Stack'd account\./);
assert.ok(!/https?:\/\//.test(outbox.at(-1).text), 'no link in the code message (AC-09.3)');
r = await call('/v1/auth/start', { body: { email: ANA } });
assert.equal(r.body.code, 'rate_limited', 'a new code waits 60 s'); assert.ok(r.body.retryAfter > 0 && r.body.retryAfter <= 60);

let code = lastCode(ANA);
const wrong = code === '000000' ? '111111' : '000000';
r = await call('/v1/auth/verify', { body: { email: ANA, code: wrong } });
assert.deepEqual([r.status, r.body.code, r.body.left], [400, 'code_wrong', 4]);
r = await call('/v1/auth/verify', { body: { email: ANA, code: '12' } });
assert.equal(r.body.code, 'code_wrong');
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.status, 200);
assert.deepEqual([r.body.account, r.body.pinLocked], ['new', false]);
let ticket = r.body.ticket;
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.body.code, 'code_used', 'a used code says so (AC-02.6)');

r = await call('/v1/auth/register', { body: reg(ANA, ticket, '2580', { adult: false }) });
assert.equal(r.body.code, 'underage');
r = await call('/v1/auth/register', { body: reg(ANA, ticket, '1111') });
assert.equal(r.body.code, 'pin_weak');
r = await call('/v1/auth/register', { body: reg(ANA, ticket, '2580', { termsVersion: '2020-01-01' }) });
assert.equal(r.body.code, 'accept_required');
r = await call('/v1/auth/register', { body: reg(BEN, ticket) });
assert.equal(r.body.code, 'ticket_expired', 'a ticket proves one mailbox only');
r = await call('/v1/auth/register', { body: reg(ANA, ticket, '2580', { legacyId: 'olddevice001' }), client: 'ios' });
assert.equal(r.status, 200, JSON.stringify(r.body));
const anaPhone = r.body.token;
assert.ok(anaPhone && anaPhone.length >= 40, 'the shells get the token in the body');
assert.equal(r.headers.get('Set-Cookie'), null);
assert.equal(r.body.account.email, ANA);
assert.equal(r.body.account.devices.length, 1);
assert.equal(r.body.account.devices[0].current, true);
const anaId = r.body.account.id;
assert.match(anaId, /^[a-z0-9]{24}$/);
assert.equal(outbox.filter((m) => m.template === 'new_signin').length, 0, 'no notice for the first device');
r = await call('/v1/auth/register', { body: reg(ANA, ticket) });
assert.equal(r.body.code, 'ticket_expired', 'the ticket is spent');

/* what the server keeps: the fact of 18+, never a year; no readable PIN or code */
const row = db.raw.prepare('SELECT * FROM users WHERE id = ?').get(anaId);
assert.ok(row.adult_confirmed_at > 0);
assert.ok(!JSON.stringify(row).includes('2580'));
assert.equal(row.pin_hash.length, 64);
assert.deepEqual(db.raw.prepare('SELECT what, version FROM consent_log WHERE user_id = ? ORDER BY what').all(anaId).map((x) => [x.what, x.version]),
  [['adult', '18+'], ['privacy', '2026-12-01'], ['terms', '2026-12-01']]);
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM legacy_ids WHERE user_id = ?').get(anaId).n, 1);
assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM login_codes').all()).includes(code));

/* known and unknown emails get the same answer to start (AC-02.7) */
r = await codeFor(ANA).then(() => call('/v1/auth/start', { body: { email: 'nobody@example.com' } }));
assert.deepEqual([r.status, r.body], [unknownAnswer.status, unknownAnswer.body]);

/* expiry and the attempt cap */
code = lastCode(ANA);
tick(11 * 60_000);
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.body.code, 'code_expired');
code = await codeFor(ANA);
const bad = code === '999999' ? '888888' : '999999';
for (let i = 0; i < 4; i++) await call('/v1/auth/verify', { body: { email: ANA, code: bad } });
r = await call('/v1/auth/verify', { body: { email: ANA, code: bad } });
assert.equal(r.body.code, 'code_expired', 'the fifth wrong code ends it');
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.body.code, 'code_expired', 'even the right code is refused after five wrong ones');

/* five codes an hour per email (AC-02.9) */
{
  const C = 'cara@example.com';
  for (let i = 0; i < 5; i++) await codeFor(C);
  tick(61_000);
  r = await call('/v1/auth/start', { body: { email: C } });
  assert.equal(r.body.code, 'rate_limited');
  assert.match(r.body.message, /Try again in \d+ minutes?/);
  tick(3600_000);
  assert.equal((await call('/v1/auth/start', { body: { email: C } })).status, 204, 'the window passes');
}

/* ── a second device: the web, by cookie (US-04) ─────────────────────── */
code = await codeFor(ANA);
r = await call('/v1/auth/verify', { body: { email: ANA, code }, client: 'web', origin: WEB });
assert.deepEqual([r.body.account, r.body.pinLocked], ['existing', false]);
ticket = r.body.ticket;
r = await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '0000', label: 'Browser on Windows' }, client: 'web', origin: WEB });
assert.deepEqual([r.status, r.body.code, r.body.left], [401, 'pin_wrong', 4]);
r = await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '2580', label: 'Browser on Windows' }, client: 'web', origin: WEB });
assert.equal(r.status, 200, 'the ticket survives a wrong PIN');
assert.equal(r.body.token, undefined, 'the web never sees its token');
const setCookie = r.headers.get('Set-Cookie');
assert.match(setCookie, /^stackd_session=[A-Za-z0-9_-]{40,}; HttpOnly; Secure; SameSite=Strict; Path=\/v1; Max-Age=7776000$/);
assert.equal(r.headers.get('Access-Control-Allow-Credentials'), 'true');
const anaWeb = /stackd_session=([^;]+)/.exec(setCookie)[1];
assert.equal(outbox.at(-1).template, 'new_signin'); assert.match(outbox.at(-1).text, /Browser on Windows/);
assert.equal(db.raw.prepare('SELECT pin_fails FROM users WHERE id = ?').get(anaId).pin_fails, 0, 'a correct PIN clears the count');

r = await call('/v1/account', { method: 'GET', cookie: anaWeb, client: 'web' });
assert.equal(r.status, 403, 'a cookie without an allowed Origin is refused');
r = await call('/v1/account', { method: 'GET', cookie: anaWeb, client: 'web', origin: 'https://evil.example' });
assert.equal(r.status, 403);
r = await call('/v1/account', { method: 'GET', cookie: anaWeb, client: 'web', origin: WEB });
assert.equal(r.status, 200);
assert.deepEqual(r.body.account.devices.map((d) => [d.label, d.platform, d.current]).sort(), [['Browser on Windows', 'web', true], ['iPhone', 'ios', false]]);
r = await call('/v1/account', { method: 'GET', token: 'x'.repeat(43) });
assert.equal(r.body.code, 'signed_out', 'an unknown token signs the device out');

/* ── lockout and reset (AC-03.4, AC-03.5) ────────────────────────────── */
code = await codeFor(ANA);
ticket = (await call('/v1/auth/verify', { body: { email: ANA, code } })).body.ticket;
for (let i = 4; i >= 1; i--) {
  r = await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '9999', label: 'Android' }, client: 'android' });
  assert.deepEqual([r.body.code, r.body.left], ['pin_wrong', i]);
}
r = await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '9999', label: 'Android' }, client: 'android' });
assert.deepEqual([r.status, r.body.code], [423, 'pin_locked']);
r = await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '2580', label: 'Android' }, client: 'android' });
assert.equal(r.body.code, 'pin_locked', 'the right PIN is refused while locked');
r = await call('/v1/auth/pin/check', { body: { pin: '2580' }, token: anaPhone });
assert.equal(r.body.code, 'pin_locked', 'locked on every device');
code = await codeFor(ANA);
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.body.pinLocked, true);
r = await call('/v1/auth/pin/reset', { body: { email: ANA, ticket: r.body.ticket, pin: '3691', label: 'Android' }, client: 'android' });
assert.equal(r.status, 200);
const anaAndroid = r.body.token;
assert.equal(outbox.at(-1).template, 'pin_reset');
assert.equal((await call('/v1/account', { method: 'GET', token: anaPhone })).body.code, 'signed_out', 'a reset signs out every other device');
assert.equal((await call('/v1/account', { method: 'GET', cookie: anaWeb, client: 'web', origin: WEB })).body.code, 'signed_out');
assert.equal((await call('/v1/account', { method: 'GET', token: anaAndroid })).body.account.devices.length, 1);

/* ── change, and the other device catching up (AC-03.6) ──────────────── */
code = await codeFor(ANA);
ticket = (await call('/v1/auth/verify', { body: { email: ANA, code } })).body.ticket;
const anaPhone2 = (await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '3691', label: 'iPhone' } })).body.token;
r = await call('/v1/auth/pin/change', { body: { pin: '3691', newPin: '4444' }, token: anaAndroid });
assert.equal(r.body.code, 'pin_weak');
r = await call('/v1/auth/pin/change', { body: { pin: '3691', newPin: '4826' }, token: anaAndroid });
assert.equal(r.status, 200);
assert.equal(outbox.at(-1).template, 'pin_changed');
r = await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: anaPhone2 });
assert.equal(r.body.code, 'pin_required', 'the other device asks for the new PIN');
r = await call('/v1/auth/pin/check', { body: { pin: '3691' }, token: anaPhone2 });
assert.equal(r.body.code, 'pin_wrong');
r = await call('/v1/auth/pin/check', { body: { pin: '4826' }, token: anaPhone2 });
assert.equal(r.status, 200);
assert.equal((await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: anaPhone2 })).status, 200);

/* ── sync (US-05) ───────────────────────────────────────────────────── */
assert.equal(invalid({ kind: 'task', id: 'a1', changedAt: 1, deleted: false, data: { id: 'a1' } }), null);
assert.equal(invalid({ kind: 'plan', id: 'a1', changedAt: 1, deleted: false, data: {} }), 'unknown kind');
assert.equal(invalid({ kind: 'settings', id: 'x', changedAt: 1, deleted: false, data: {} }), 'bad id');
assert.equal(invalid({ kind: 'task', id: 'a1', changedAt: 1, deleted: true, data: { id: 'a1' } }), 'bad data');
assert.equal(invalid({ kind: 'task', id: 'a1', changedAt: 1, deleted: false, data: { id: 'b2' } }), 'id mismatch');
assert.equal(invalid({ kind: 'task', id: '"><x', changedAt: 1, deleted: false, data: {} }), 'bad id');

const task = (id, title, at, extra = {}) => ({ kind: 'task', id, changedAt: at, deleted: false, data: { id, title, ...extra } });
r = await call('/v1/sync', { body: { cursor: 0, changes: [task('t1', 'From the phone', t), task('t2', 'Second', t), { kind: 'settings', id: 'settings', changedAt: t, deleted: false, data: { dateFormat: 'dmy' } }] }, token: anaPhone2 });
assert.equal(r.status, 200);
assert.equal(r.body.accepted, 3);
const phoneCursor = r.body.cursor;
assert.equal(phoneCursor, 3);
r = await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: anaAndroid });
assert.deepEqual(r.body.changes.map((c) => c.id).sort(), ['settings', 't1', 't2'], 'the other device pulls everything');
let androidCursor = r.body.cursor;

r = await call('/v1/sync/summary', { method: 'GET', token: anaAndroid });
assert.deepEqual(r.body.counts, { list: 0, task: 2, note: 0, meeting: 0 });

/* newer wins per record; older is rejected and the pull carries the winner */
tick(1000);
await call('/v1/sync', { body: { cursor: androidCursor, changes: [task('t1', 'Edited on Android', t)] }, token: anaAndroid });
r = await call('/v1/sync', { body: { cursor: phoneCursor, changes: [task('t1', 'Older phone edit', t - 500)] }, token: anaPhone2 });
assert.deepEqual(r.body.rejected, [{ kind: 'task', id: 't1', reason: 'older' }]);
assert.equal(r.body.changes.find((c) => c.id === 't1').data.title, 'Edited on Android');
/* a clock a day ahead is clamped to the server's: it does not win forever (AC-05.6) */
tick(1000);
await call('/v1/sync', { body: { cursor: 0, changes: [task('t2', 'Future clock', t + 86400_000)] }, token: anaPhone2 });
assert.equal(db.raw.prepare("SELECT changed_at FROM records WHERE id = 't2'").get().changed_at, t, 'clamped to the server clock');
tick(1000);
r = await call('/v1/sync', { body: { cursor: 0, changes: [task('t2', 'Fixed clock, later', t)] }, token: anaAndroid });
assert.deepEqual(r.body.rejected, [], 'a later honest edit beats the clamped one');
/* delete wins, whatever comes after (AC-05.7) */
tick(1000);
await call('/v1/sync', { body: { cursor: 0, changes: [{ kind: 'task', id: 't2', changedAt: t - 5000, deleted: true, data: null }] }, token: anaAndroid });
tick(1000);
r = await call('/v1/sync', { body: { cursor: 0, changes: [task('t2', 'Resurrected', t + 10)] }, token: anaPhone2 });
assert.deepEqual(r.body.rejected, [{ kind: 'task', id: 't2', reason: 'deleted' }]);
assert.equal(r.body.changes.find((c) => c.id === 't2').deleted, true);
assert.equal((await call('/v1/sync/summary', { method: 'GET', token: anaAndroid })).body.counts.task, 1);
/* paging */
{
  const many = Array.from({ length: 200 }, (_, i) => task(`m${i}`, `Bulk ${i}`, t));
  await call('/v1/sync', { body: { cursor: 0, changes: many }, token: anaAndroid });
  await call('/v1/sync', { body: { cursor: 0, changes: many.map((c) => ({ ...c, id: `n${c.id}`, data: { ...c.data, id: `n${c.id}` } })) }, token: anaAndroid });
  await call('/v1/sync', { body: { cursor: 0, changes: many.map((c) => ({ ...c, id: `o${c.id}`, data: { ...c.data, id: `o${c.id}` } })) }, token: anaAndroid });
  let cur = 0, pages = 0, seen = 0;
  for (;;) {
    r = await call('/v1/sync', { body: { cursor: cur, changes: [] }, token: anaPhone2 });
    pages++; seen += r.body.changes.length; cur = r.body.cursor;
    if (!r.body.more) break;
  }
  assert.ok(pages >= 2, 'more than 500 changes come in pages');
  assert.equal(seen, db.raw.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ?').get(anaId).n);
  r = await call('/v1/sync', { body: { cursor: 0, changes: [...many, task('x', 'one too many', t)] }, token: anaAndroid });
  assert.equal(r.body.code, 'too_large', 'at most 200 changes a request');
}
r = await call('/v1/sync', { body: { cursor: 0, changes: [{ kind: 'task', id: 'q', changedAt: t, deleted: false, data: { id: 'q', blob: 'x'.repeat(1_000_001) } }] }, token: anaAndroid });
assert.ok(['too_large', 'quota'].includes(r.body.code), 'one huge record is refused');

/* isolation (AC-05.10): another account with the same ids sees only its own */
code = await codeFor(BEN);
ticket = (await call('/v1/auth/verify', { body: { email: BEN, code } })).body.ticket;
const ben = (await call('/v1/auth/register', { body: reg(BEN, ticket, '7531') })).body.token;
r = await call('/v1/sync', { body: { cursor: 0, changes: [task('t1', "Ben's own t1", t)] }, token: ben });
assert.deepEqual(r.body.changes.map((c) => c.data.title), ["Ben's own t1"]);
r = await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: anaAndroid, headers: { 'X-Stackd-Subscriber': 'whoever0001' } });
assert.equal(r.body.changes.find((c) => c.id === 't1').data.title, 'Edited on Android', "Ben's write did not touch Ana's t1");

/* new documents ask again (AC-02.8) */
env.TERMS_VERSION = '2027-01-01';
r = await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: ben });
assert.equal(r.body.code, 'accept_required');
assert.equal((await call('/v1/account', { method: 'GET', token: ben })).body.account.needsAccept, true);
r = await call('/v1/account/accept', { body: { termsVersion: '2027-01-01', privacyVersion: '2026-12-01' }, token: ben });
assert.equal(r.status, 204);
assert.equal((await call('/v1/sync', { body: { cursor: 0, changes: [] }, token: ben })).status, 200);
env.TERMS_VERSION = '2026-12-01';
await call('/v1/account/accept', { body: { termsVersion: '2026-12-01', privacyVersion: '2026-12-01' }, token: ben });

/* the AI routes take the identity from the session (AC-08.3) */
r = await call('/v1/allowance', { method: 'GET', token: ben, headers: { 'X-Stackd-Subscriber': 'tester00000001' } });
assert.equal(r.body.allowance.tier, 'free', 'a header cannot borrow someone else\'s plan');
db.raw.prepare("UPDATE users SET tester = 1 WHERE email = 'ben@example.com'").run();
r = await call('/v1/allowance', { method: 'GET', token: ben });
assert.equal(r.body.allowance.tier, 'tester', 'the owner flags testers in the database (AC-08.6)');
/* usage under the device's old anonymous id still counts this period (AC-08.2) */
{
  const benId = db.raw.prepare("SELECT id FROM users WHERE email = 'ben@example.com'").get().id;
  db.raw.prepare('INSERT INTO legacy_ids (user_id, subscriber_id, linked_at) VALUES (?, ?, ?)').run(benId, 'oldphone0001', t);
  mem.set(`pool:oldphone0001:${periodKey('tester')}`, JSON.stringify({ audioSeconds: 0, summaries: 4 }));
  r = await call('/v1/allowance', { method: 'GET', token: ben });
  assert.equal(r.body.allowance.summariesLeft, 6, 'four used under the old id, six left on the account');
  r = await call('/v1/allowance', { method: 'GET', headers: { 'X-Stackd-Subscriber': 'oldphone0001' } });
  assert.equal(r.body.allowance.tier, 'free', 'the old id itself gains nothing');
}
r = await call('/v1/allowance', { method: 'GET', headers: { 'X-Stackd-Subscriber': 'anon00000001' } });
assert.equal(r.body.allowance.tier, 'free', 'signed-out devices keep the 1.5.0 path (AC-08.4)');

/* ── sign out (AC-04.4) ──────────────────────────────────────────────── */
r = await call('/v1/account', { method: 'GET', token: anaAndroid });
const phoneRow = r.body.account.devices.find((d) => !d.current);
assert.equal((await call('/v1/account/signout', { body: { sessionId: phoneRow.id }, token: anaAndroid })).status, 204);
assert.equal((await call('/v1/account', { method: 'GET', token: anaPhone2 })).body.code, 'signed_out');
assert.equal((await call('/v1/account/signout', { body: { sessionId: phoneRow.id }, token: ben })).status, 204);
assert.equal((await call('/v1/account', { method: 'GET', token: ben })).status, 200, 'another account\'s session id signs Ben out of nothing but himself');

/* ── idle sessions end after 90 days (AC-04.2) ──────────────────────── */
tick(91 * 86400_000);
assert.equal((await call('/v1/account', { method: 'GET', token: ben })).body.code, 'signed_out');

/* ── export and delete (US-10) ──────────────────────────────────────── */
code = await codeFor(ANA);
ticket = (await call('/v1/auth/verify', { body: { email: ANA, code } })).body.ticket;
const anaLast = (await call('/v1/auth/signin', { body: { email: ANA, ticket, pin: '4826', label: 'iPhone' } })).body.token;
const res = await worker.fetch(new Request('https://proxy.test/v1/account/export', { headers: { 'X-Stackd-App': 'tok', Authorization: `Bearer ${anaLast}` } }), env);
assert.match(res.headers.get('Content-Disposition'), /attachment/);
const file = await res.json();
assert.equal(file.account.email, ANA);
assert.ok(file.records.some((x) => x.id === 't1'));
assert.ok(!file.records.some((x) => x.id === 't2'), 'deleted records are not exported');
r = await call('/v1/account/delete', { body: { pin: '0000' }, token: anaLast });
assert.equal(r.body.code, 'pin_wrong');
r = await call('/v1/account/delete', { body: { pin: '4826' }, token: anaLast });
assert.equal(r.status, 204);
assert.equal(outbox.at(-1).template, 'deleted');
for (const table of ['users', 'sessions', 'records', 'legacy_ids', 'consent_log']) {
  const col = table === 'users' ? 'id' : 'user_id';
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(anaId).n, 0, `nothing left in ${table}`);
}
assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ana@example.com'").get().n, 0);
code = await codeFor(ANA);
r = await call('/v1/auth/verify', { body: { email: ANA, code } });
assert.equal(r.body.account, 'new', 'the same email can register again as a new account');

/* ── retention ──────────────────────────────────────────────────────── */
db.raw.prepare("INSERT INTO records (user_id, kind, id, rev, changed_at, deleted, data) SELECT id, 'task', 'old', 999, ?, 1, NULL FROM users WHERE email = ?").run(t - 91 * 86400_000, BEN);
db.raw.prepare("INSERT INTO sessions (id, user_id, token_hash, platform, label, pin_version, created_at, last_seen_at) SELECT 's_idle', id, 'h', 'web', 'Old', 1, ?1, ?1 FROM users WHERE email = ?2").run(t - 91 * 86400_000, BEN);
db.raw.prepare("INSERT INTO records (user_id, kind, id, rev, changed_at, deleted, data) SELECT id, 'task', 'recent', 1000, ?, 1, NULL FROM users WHERE email = ?").run(t - 10 * 86400_000, BEN);
const gone = await retention(env, t);
assert.deepEqual([gone.tombstones, gone.sessions], [1, 1], 'an old tombstone and an idle session go');
assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE id = 'recent'").get().n, 1, 'a recent tombstone stays');

/* ── nothing sensitive in the logs ──────────────────────────────────── */
const secrets = [ANA, BEN, '2580', '3691', '4826', ...outbox.filter((m) => m.template === 'code').map((m) => /(\d{6})/.exec(m.text)[1])];
for (const line of logged) for (const s of secrets) assert.ok(!line.includes(s), `a log line carries something private: ${line.slice(0, 60)}`);

console.log = console.log.bind(console);
process.stdout.write('accounts tests: ok\n');
