/* Proxy checks — `npm test` in proxy/ (also run by proxy.yml before a
   deploy). No network: plans and periods, the pool on an in-memory KV, the
   schema post-validation, the request pipeline with a stubbed model. */
import assert from 'node:assert/strict';
import { TIERS, period, periodKey, allowance } from '../src/plans.js';
import { reserve, release, getUsed } from '../src/pool.js';
import { validate, validDue, validPriority, MAX_ACTIONS } from '../src/schema.js';
import { toModelText, isTranscript } from '../src/transcript.js';
import worker from '../src/index.js';
import { fromSubscriber, resolve, webhook, cacheKey } from '../src/entitlement.js';

/* ── plans ─────────────────────────────────────────────────────────── */
assert.equal(TIERS.plus.audioSeconds, 8 * 3600); assert.equal(TIERS.plus.summaries, 20);
assert.equal(TIERS.pro.audioSeconds, 16 * 3600); assert.equal(TIERS.pro.summaries, 50);
assert.equal(TIERS.max.audioSeconds, 24 * 3600); assert.equal(TIERS.max.summaries, 100);
assert.equal(TIERS.tester.summaries, 10);
const now = Date.UTC(2026, 9, 20, 14, 0);          // 2026-10-20 14:00Z
// tester: a UTC day
assert.equal(periodKey('tester', null, now), '2026-10-20');
assert.equal(period('tester', null, now).end, Date.UTC(2026, 9, 21));
// subscriber with a renewal date: the month before it
const renews = Date.UTC(2026, 10, 12, 9, 30);        // 2026-11-12
assert.equal(periodKey('pro', renews, now), '2026-10-12');
assert.equal(period('pro', renews, now).end, renews);
// renewal on the 31st, period start clamps to the shorter month
assert.equal(periodKey('pro', Date.UTC(2026, 11, 31), Date.UTC(2026, 11, 1)), '2026-11-30');
// no renewal date (or a stale one): the calendar month
assert.equal(periodKey('plus', null, now), '2026-10-01');
assert.equal(periodKey('plus', now - 1000, now), '2026-10-01');
// allowance maths
let a = allowance('plus', { audioSeconds: 3600, summaries: 5 }, renews, now);
assert.deepEqual([a.audioSecondsLeft, a.audioSecondsTotal, a.summariesLeft, a.summariesTotal, a.renewsAt], [7 * 3600, 8 * 3600, 15, 20, renews]);
a = allowance('free', undefined, null, now);
assert.deepEqual([a.audioSecondsLeft, a.summariesLeft, a.renewsAt], [0, 0, null]);
assert.equal(allowance('max', { summaries: 500 }).summariesLeft, 0, 'never negative');

/* ── pool on an in-memory KV ────────────────────────────────────────── */
const mem = new Map();
const kv = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => { mem.set(k, v); } };
let r = await reserve(kv, 'sub1', '2026-10-01', 'plus', { summaries: 1 });
assert.equal(r.ok, true); assert.equal(r.used.summaries, 1);
for (let i = 0; i < 19; i++) r = await reserve(kv, 'sub1', '2026-10-01', 'plus', { summaries: 1 });
assert.equal(r.ok, true); assert.equal(r.used.summaries, 20);
r = await reserve(kv, 'sub1', '2026-10-01', 'plus', { summaries: 1 });
assert.equal(r.ok, false, 'the 21st summary is refused'); assert.equal(r.used.summaries, 20);
assert.deepEqual(await getUsed(kv, 'sub1', '2026-11-01'), { audioSeconds: 0, summaries: 0 }, 'a new period starts empty');
await release(kv, 'sub1', '2026-10-01', { summaries: 1 });
assert.equal((await getUsed(kv, 'sub1', '2026-10-01')).summaries, 19);
await release(kv, 'sub1', '2026-10-01', { summaries: 99 });
assert.equal((await getUsed(kv, 'sub1', '2026-10-01')).summaries, 0, 'release never goes negative');
r = await reserve(kv, 'sub2', '2026-10-01', 'free', { summaries: 1 });
assert.equal(r.ok, false, 'free has no pool');
r = await reserve(kv, 'sub3', '2026-10-01', 'pro', { audioSeconds: 16 * 3600 });
assert.equal(r.ok, true);
r = await reserve(kv, 'sub3', '2026-10-01', 'pro', { audioSeconds: 60 });
assert.equal(r.ok, false, 'audio pool is separate and capped');

/* ── schema post-validation ─────────────────────────────────────────── */
assert.equal(validDue('2026-10-24', '2026-10-20'), '2026-10-24');
assert.equal(validDue('2026-09-01', '2026-10-20'), null, 'more than 30 days before the meeting');
assert.equal(validDue('2027-11-01', '2026-10-20'), null, 'more than a year after');
assert.equal(validDue('Friday', '2026-10-20'), null);
assert.equal(validDue(null, '2026-10-20'), null);
assert.equal(validPriority('high', ['High', 'Medium', 'Low']), 'High');
assert.equal(validPriority('Urgent', ['High', 'Medium', 'Low']), null);
assert.equal(validPriority(null, ['High']), null);
const v = validate({
  summary: '  A   short\n summary ', decisions: ['Cut travel', '', '  '], openQuestions: ['Who owns QA?'],
  actions: [
    { title: ' Marco to send the deck ', due: '2026-10-24', priority: 'HIGH', excerpt: "I'll send the deck on Friday." },
    { title: '', due: null, priority: null, excerpt: 'dropped: no title' },
    { title: 'Guessy date', due: '2030-01-01', priority: 'urgent', excerpt: 'x' },
    'not an object',
    ...Array.from({ length: 15 }, (_, i) => ({ title: `Extra ${i}`, due: null, priority: null, excerpt: '' })),
  ],
}, { meetingDate: '2026-10-20', priorities: ['High', 'Medium', 'Low'] });
assert.equal(v.minutes.summary, 'A short summary');
assert.deepEqual(v.minutes.decisions, ['Cut travel']);
assert.deepEqual(v.actions[0], { title: 'Marco to send the deck', due: '2026-10-24', priority: 'High', excerpt: "I'll send the deck on Friday." });
assert.deepEqual([v.actions[1].due, v.actions[1].priority], [null, null], 'out-of-range date and unknown priority are dropped');
assert.equal(v.actions.length, MAX_ACTIONS, 'at most twelve');
assert.throws(() => validate(null, { meetingDate: '2026-10-20', priorities: [] }));
assert.throws(() => validate([], { meetingDate: '2026-10-20', priorities: [] }));
assert.deepEqual(validate({}, { meetingDate: '2026-10-20', priorities: [] }), { minutes: { summary: '', decisions: [], openQuestions: [] }, actions: [] });

/* ── transcript text ────────────────────────────────────────────────── */
assert.equal(toModelText({ speakers: { S1: 'Marco', S2: null }, segments: [{ speaker: 'S1', startMs: 12000, text: 'a\nb' }, { speaker: 'S2', startMs: null, text: 'c' }] }), '[00:12] Marco: a b\nSpeaker 2: c');
assert.equal(isTranscript({ segments: [{ speaker: 'S1', text: 'x' }] }), true);
assert.equal(isTranscript({ segments: [{ text: 'x' }] }), false);

/* ── the request pipeline with a stubbed model ──────────────────────── */
const env = { APP_TOKEN: 'tok', TESTERS: 'tester00000001', ALLOWED_ORIGINS: 'https://eugeniocalva.github.io', POOL: kv };
const call = (path, { method = 'GET', headers = {}, body } = {}) =>
  worker.fetch(new Request(`https://proxy.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
const H = (sub) => ({ 'X-Stackd-App': 'tok', 'X-Stackd-Subscriber': sub, 'Content-Type': 'application/json' });
let res = await call('/v1/health');
assert.equal(res.status, 200);
res = await call('/v1/allowance', { headers: { 'X-Stackd-Subscriber': 'tester00000001' } });
assert.equal(res.status, 401, 'no app token');
res = await call('/v1/allowance', { headers: { 'X-Stackd-App': 'tok', 'X-Stackd-Subscriber': 'bad id' } });
assert.equal(res.status, 400, 'bad subscriber id');
res = await call('/v1/allowance', { headers: { ...H('tester00000001'), Origin: 'https://evil.example' } });
assert.equal(res.status, 403, 'unknown origin');
res = await call('/v1/allowance', { headers: { ...H('tester00000001'), Origin: 'https://eugeniocalva.github.io' } });
assert.equal(res.status, 200);
assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://eugeniocalva.github.io');
let body = await res.json();
assert.equal(body.allowance.tier, 'tester'); assert.equal(body.allowance.summariesTotal, 10);
res = await call('/v1/allowance', { headers: H('someoneelse01') });
body = await res.json();
assert.equal(body.allowance.tier, 'free');
res = await call('/v1/summarise', { method: 'POST', headers: H('someoneelse01'), body: { transcript: { segments: [{ speaker: 'S1', text: 'hi' }] }, meetingDate: '2026-10-20', priorities: [] } });
assert.equal(res.status, 403); assert.equal((await res.json()).code, 'plan_required');
res = await call('/v1/summarise', { method: 'POST', headers: H('tester00000001'), body: { transcript: { segments: [] }, meetingDate: '2026-10-20' } });
assert.equal(res.status, 400);
res = await call('/v1/summarise', { method: 'POST', headers: H('tester00000001'), body: { transcript: { segments: [{ speaker: 'S1', text: 'hi' }] }, meetingDate: '20/10/2026' } });
assert.equal(res.status, 400, 'meetingDate must be ISO');
res = await call('/v1/transcribe', { method: 'POST', headers: H('tester00000001'), body: {} });
assert.equal(res.status, 501);
res = await call('/v1/nope', { headers: H('tester00000001') });
assert.equal(res.status, 404);
/* a tester's summaries are counted and refused at the limit: the model call is
   reached only after the reservation, so without a key it fails as misconfigured
   and the reservation is released */
const before = (await getUsed(kv, 'tester00000001', periodKey('tester'))).summaries;
res = await call('/v1/summarise', { method: 'POST', headers: H('tester00000001'), body: { transcript: { segments: [{ speaker: 'S1', text: 'hi' }] }, meetingDate: '2026-10-20', priorities: ['High'] } });
assert.ok([500, 503].includes(res.status), `no key → service error, got ${res.status}`);
assert.equal((await getUsed(kv, 'tester00000001', periodKey('tester'))).summaries, before, 'a failed step is not charged');

/* ── entitlement: RevenueCat shape, cache, webhook ─────────────────── */
const t0 = Date.UTC(2026, 9, 20);
assert.deepEqual(fromSubscriber({ entitlements: {} }, t0), { tier: 'free', renewsAt: null });
assert.deepEqual(fromSubscriber({ entitlements: { plus: { expires_date: '2026-11-12T09:30:00Z' } } }, t0), { tier: 'plus', renewsAt: Date.parse('2026-11-12T09:30:00Z') });
assert.equal(fromSubscriber({ entitlements: { plus: { expires_date: '2026-11-12T09:30:00Z' }, max: { expires_date: '2026-11-01T00:00:00Z' } } }, t0).tier, 'max', 'the highest active tier wins');
assert.equal(fromSubscriber({ entitlements: { pro: { expires_date: '2026-10-01T00:00:00Z' } } }, t0).tier, 'free', 'an expired entitlement does not count');
assert.deepEqual(fromSubscriber({ entitlements: { pro: { expires_date: null } } }, t0), { tier: 'pro', renewsAt: null }, 'no expiry = active');
const rcMem = new Map();
const rcKv = { get: async (k) => rcMem.get(k) ?? null, put: async (k, v) => { rcMem.set(k, v); }, delete: async (k) => { rcMem.delete(k); } };
let rcCalls = 0;
const rcFetch = async (url) => { rcCalls++; assert.ok(url.endsWith('/v1/subscribers/sub00000001')); return { ok: true, json: async () => ({ subscriber: { entitlements: { pro: { expires_date: '2026-11-12T09:30:00Z' } } } }) }; };
const rcEnv = { TESTERS: '', RC_SECRET_KEY: 'sk_test', POOL: rcKv };
let ent = await resolve(rcEnv, 'sub00000001', { fetchImpl: rcFetch, now: t0 });
assert.equal(ent.tier, 'pro'); assert.equal(rcCalls, 1);
ent = await resolve(rcEnv, 'sub00000001', { fetchImpl: rcFetch, now: t0 });
assert.equal(rcCalls, 1, 'the second lookup is served from the cache');
assert.equal((await resolve({ ...rcEnv, RC_SECRET_KEY: '' }, 'sub00000002', { fetchImpl: rcFetch })).tier, 'free', 'no secret key → free');
assert.equal((await resolve({ ...rcEnv, TESTERS: 'sub00000003' }, 'sub00000003', { fetchImpl: rcFetch })).tier, 'tester', 'testers first');
const failing = async () => { throw new Error('down'); };
assert.equal((await resolve(rcEnv, 'sub00000001', { fetchImpl: failing, now: t0 })).tier, 'pro', 'a RevenueCat outage falls back to the cache');
assert.equal((await resolve(rcEnv, 'sub00000009', { fetchImpl: failing })).tier, 'free', '…and to free without one');
// webhook: wrong auth → 401; right auth → the cache entry goes
const hookEnv = { ...rcEnv, RC_WEBHOOK_AUTH: 'hook-secret' };
const hook = (auth, body) => webhook(new Request('https://proxy.test/v1/rc-webhook', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) }), hookEnv);
assert.equal((await hook('wrong', { event: { app_user_id: 'sub00000001' } })).status, 401);
assert.equal((await hook(null, { event: { app_user_id: 'sub00000001' } })).status, 401);
assert.ok(rcMem.has(cacheKey('sub00000001')));
assert.equal((await hook('hook-secret', { event: { type: 'RENEWAL', app_user_id: 'sub00000001' } })).status, 204);
assert.ok(!rcMem.has(cacheKey('sub00000001')), 'the webhook drops the cache');
assert.equal((await hook('hook-secret', { event: {} })).status, 204, 'an event without an id is accepted and ignored');
res = await call('/v1/rc-webhook', { method: 'POST', headers: { Authorization: 'nope' }, body: { event: {} } });
assert.equal(res.status, 401, 'the route needs the webhook auth, not the app token');

console.log('proxy tests: ok');
