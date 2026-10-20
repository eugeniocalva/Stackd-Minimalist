/* Checks for src/ai.js (PRD-meetings US-05, US-07, US-09) — `npm run check`.
   The job reducer, the error mapping and the Summarise / allowance paths
   against a fake fetch; no network. Same browser stand-ins as check-store. */
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { getElementById: () => null };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
/* Node 24 defines navigator as a getter; replace it so the tests can flip onLine */
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, language: 'en-US' }, configurable: true, writable: true });

const store = await import('../src/store.js');
const ai = await import('../src/ai.js');
const { S } = store;

/* ── reducer ───────────────────────────────────────────────────────── */
const m0 = { jobs: { transcribe: null, summarise: null }, lastError: null };
let p = ai.reduce(m0, { type: 'start', step: 'summarise', id: 'j1', at: 10 });
assert.deepEqual(p.jobs.summarise, { id: 'j1', startedAt: 10, phase: 'wait' });
assert.equal(p.lastError, null);
const m1 = { ...m0, ...p };
p = ai.reduce(m1, { type: 'done', step: 'summarise' });
assert.equal(p.jobs.summarise, null);
p = ai.reduce(m1, { type: 'error', step: 'summarise', code: 'too_large', message: 'big', at: 20 });
assert.equal(p.jobs.summarise, null);
assert.deepEqual(p.lastError, { step: 'summarise', code: 'too_large', message: 'big', at: 20 });
assert.equal(ai.reduce(m0, { type: 'resume', inflight: [], at: 30 }), null, 'nothing to resume');
assert.equal(ai.reduce(m1, { type: 'resume', inflight: ['summarise'], at: 30 }), null, 'a job with a live request is left alone');
p = ai.reduce(m1, { type: 'resume', inflight: [], at: 30 });
assert.equal(p.jobs.summarise, null);
assert.equal(p.lastError.code, 'interrupted');
p = ai.reduce({ jobs: { transcribe: { id: 't' }, summarise: null } }, { type: 'resume', inflight: [], at: 30 });
assert.match(p.lastError.message, /Transcribing/);
assert.equal(ai.reduce({ jobs: undefined }, { type: 'start', step: 'transcribe', id: 'x', at: 1 }).jobs.summarise, null, 'missing jobs object is tolerated');

/* ── error mapping ─────────────────────────────────────────────────── */
assert.deepEqual(ai.errorFor({ code: 'too_large', message: 'Too big.' }), { code: 'too_large', message: 'Too big.', resetsAt: null }, 'the proxy wording wins');
assert.equal(ai.errorFor({ code: 'plan_required', message: 'server wording' }).message, ai.MESSAGES.plan_required, 'plan_required keeps the app wording for now');
assert.equal(ai.errorFor({ code: 'allowance_exhausted', message: 'Used up.', resetsAt: 99 }).resetsAt, 99);
assert.equal(ai.errorFor({ name: 'AbortError' }).code, 'timeout');
assert.equal(ai.errorFor(new TypeError('Failed to fetch')).code, 'provider_unavailable');
globalThis.navigator.onLine = false;
assert.equal(ai.errorFor(new TypeError('Failed to fetch')).code, 'offline');
assert.equal(ai.errorFor({ code: 'nonsense' }).code, 'offline', 'unknown codes fall through to the connection state');
globalThis.navigator.onLine = true;

/* ── summarise against a fake proxy ───────────────────────────────── */
const calls = [];
let answer = null;
ai.setFetch(async (url, init) => {
  calls.push({ url, init });
  if (typeof answer === 'function') return answer(url, init);
  return answer;
});
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

const m = store.newMeeting();
store.setTranscript(m.id, { source: 'pasted', segments: [{ speaker: 'S1', startMs: 12000, text: "I'll send the deck on Friday." }], speakers: { S1: 'Marco' } });
assert.equal(S.plan.tier, 'free');
answer = reply(200, {
  ok: true,
  minutes: { summary: ' The deck. ', decisions: ['Cut travel', ''], openQuestions: [] },
  actions: [{ title: 'Marco to send the deck', due: '2026-10-24', priority: 'High', excerpt: "I'll send the deck on Friday." }, { title: '', due: null, priority: null, excerpt: '' }],
  allowance: { tier: 'tester', renewsAt: 123, audioSecondsLeft: 3600, audioSecondsTotal: 3600, summariesLeft: 9, summariesTotal: 10 },
});
await ai.summarise(m.id);
assert.equal(calls.length, 1);
assert.ok(calls[0].url.endsWith('/v1/summarise'));
assert.equal(calls[0].init.headers['X-Stackd-Subscriber'], S.plan.subscriberId);
assert.equal(calls[0].init.headers['X-Stackd-App'], store.APP_TOKEN);
{
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent.transcript.speakers, { S1: 'Marco' });
  assert.equal(sent.transcript.segments[0].text, "I'll send the deck on Friday.");
  assert.match(sent.meetingDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(sent.priorities, ['High', 'Medium', 'Low']);
}
assert.equal(m.jobs.summarise, null, 'job cleared');
assert.equal(m.lastError, null);
assert.equal(m.minutes.summary, 'The deck.');
assert.deepEqual(m.minutes.decisions, ['Cut travel']);
assert.equal(m.minutes.transcriptUpdatedAt, m.transcript.updatedAt);
assert.equal(m.actions.length, 1, 'an action without a title is dropped');
assert.equal(m.actions[0].priority, 'high', 'priority name mapped to the id');
assert.equal(m.actions[0].status, 'proposed');
assert.equal(S.plan.tier, 'tester', 'the allowance in the answer is cached');
assert.equal(S.plan.summariesLeft, 9);
assert.ok(S.plan.checkedAt > 0);
assert.equal(store.minutesStale(m), false);
assert.equal(JSON.parse(mem.get(store.STORE_KEY)).plan.tier, 'tester', 'cache persisted');

// an added action survives regeneration, a proposed one is replaced
m.actions[0].status = 'added'; m.actions[0].taskId = 't1';
m.actions.push({ id: 'p2', title: 'old proposed', due: null, priority: 'none', excerpt: '', status: 'proposed', taskId: null });
answer = reply(200, { ok: true, minutes: { summary: 'v2', decisions: [], openQuestions: [] }, actions: [{ title: 'New one', due: null, priority: null, excerpt: '' }], allowance: { tier: 'tester', summariesLeft: 8, summariesTotal: 10 } });
await ai.summarise(m.id);
assert.deepEqual(m.actions.map((a) => [a.title, a.status]), [['Marco to send the deck', 'added'], ['New one', 'proposed']]);

// allowance exhausted: error kept on the meeting, job cleared, cache refreshed from the error body
answer = reply(429, { ok: false, code: 'allowance_exhausted', message: "You've used this period's summaries.", resetsAt: 456, allowance: { tier: 'tester', summariesLeft: 0, summariesTotal: 10 } });
await ai.summarise(m.id);
assert.equal(m.jobs.summarise, null);
assert.equal(m.lastError.code, 'allowance_exhausted');
assert.equal(S.plan.summariesLeft, 0);
assert.equal(m.minutes.summary, 'v2', 'the old minutes stay');

// network failure
answer = () => { throw new TypeError('Failed to fetch'); };
await ai.summarise(m.id);
assert.equal(m.lastError.code, 'provider_unavailable');
// offline: no request at all
globalThis.navigator.onLine = false;
const n = calls.length;
await ai.summarise(m.id);
assert.equal(calls.length, n, 'no request while offline');
assert.equal(m.lastError.code, 'offline');
globalThis.navigator.onLine = true;
// a persisted job with no request behind it is marked interrupted on resume
m.jobs.summarise = { id: 'ghost', startedAt: 1, phase: 'wait' };
ai.resumeJobs(50);
assert.equal(m.jobs.summarise, null);
assert.equal(m.lastError.code, 'interrupted');
// no transcript, no request
const empty = store.newMeeting();
await ai.summarise(empty.id);
assert.equal(calls.length, n);

/* ── transcribe: upload → wait → done, cancel, too quiet, resume by job id ── */
{
  const mediaMod = await import('../src/media.js');
  let uploads = [];
  let uploadAnswer = null;
  ai.setUpload(async (url, fd, { onProgress, signal }) => {
    uploads.push({ url, duration: fd.get('durationMs'), name: fd.get('audio')?.name });
    onProgress?.(40); onProgress?.(100);
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return uploadAnswer;
  });
  /* media.blob is IndexedDB; stand it in */
  ai.setBlob(async () => new Blob([new Uint8Array(5000)], { type: 'audio/webm' }));
  void mediaMod;
  const mr = store.newMeeting();
  store.setRecording(mr.id, { key: 'rec-x', mimeType: 'audio/webm', durationMs: 754000, sizeBytes: 5000, recordedAt: 1 });
  // free plan: nothing uploaded, the error is kept
  S.plan.tier = 'free';
  uploadAnswer = reply(403, { ok: false, code: 'plan_required', message: 'Transcribing needs a plan.', allowance: { tier: 'free', summariesLeft: 0, summariesTotal: 0, audioSecondsLeft: 0, audioSecondsTotal: 0 } });
  await ai.transcribe(mr.id);
  assert.equal(mr.lastError.code, 'plan_required'); assert.equal(mr.jobs.transcribe, null);
  // happy path: upload → job id → processing → done
  let polls = 0;
  uploadAnswer = reply(200, { ok: true, jobId: 'job_abc123', allowance: { tier: 'tester', audioSecondsLeft: 2820, audioSecondsTotal: 3600, summariesLeft: 10, summariesTotal: 10 } });
  answer = (url) => { polls++; return polls < 2 ? reply(200, { ok: true, state: 'processing' }) : reply(200, { ok: true, state: 'done', transcript: { segments: [{ speaker: 'S1', startMs: 12000, text: 'Hello' }], speakers: { S1: null } } }); };
  const origPoll = ai.POLL_MS;
  const t = ai.transcribe(mr.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(mr.jobs.transcribe?.phase, 'wait', 'after the upload the job waits with the proxy id');
  assert.equal(mr.jobs.transcribe?.id, 'job_abc123');
  assert.equal(S.plan.audioSecondsLeft, 2820, 'the reservation shows in the cache');
  await t;
  assert.equal(uploads.length, 2, 'the free-plan attempt uploaded too (the proxy refuses after)'); assert.equal(uploads[1].duration, '754000'); assert.equal(uploads[1].name, 'recording.webm');
  assert.equal(mr.jobs.transcribe, null);
  assert.equal(mr.transcript?.source, 'recording');
  assert.equal(mr.transcript.segments[0].text, 'Hello');
  assert.equal(polls, 2);
  // too quiet from the poll: error kept
  polls = 0;
  answer = () => reply(422, { ok: false, code: 'too_quiet', message: 'No speech was found in the recording.', state: 'error' });
  await ai.transcribe(mr.id);
  assert.equal(mr.lastError.code, 'too_quiet'); assert.equal(mr.jobs.transcribe, null);
  // resume: a persisted waiting job is polled again, not marked interrupted
  mr.jobs.transcribe = { id: 'job_zzz', startedAt: Date.now(), phase: 'wait' };
  mr.lastError = null;
  answer = () => reply(200, { ok: true, state: 'done', transcript: { segments: [{ speaker: 'S1', startMs: 0, text: 'Resumed' }], speakers: { S1: null } } });
  ai.resumeJobs();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(mr.transcript.segments[0].text, 'Resumed');
  assert.equal(mr.jobs.transcribe, null);
  // a job stuck in the upload phase is lost with the page
  mr.jobs.transcribe = { id: 'local', startedAt: Date.now(), phase: 'upload' };
  ai.resumeJobs();
  assert.equal(mr.jobs.transcribe, null); assert.equal(mr.lastError.code, 'interrupted');
  // an old waiting job is dropped too
  mr.jobs.transcribe = { id: 'job_old', startedAt: Date.now() - ai.JOB_TTL_MS - 1, phase: 'wait' };
  ai.resumeJobs();
  assert.equal(mr.jobs.transcribe, null); assert.equal(mr.lastError.code, 'interrupted');
  S.plan.tier = 'tester';
  void origPoll;
}

/* ── allowance caching ─────────────────────────────────────────────── */
answer = reply(200, { ok: true, allowance: { tier: 'plus', renewsAt: 1, audioSecondsLeft: 100, audioSecondsTotal: 200, summariesLeft: 3, summariesTotal: 20 } });
const before = calls.length;
await ai.allowance();
assert.equal(calls.length, before, 'fresh cache: no request');
await ai.allowance({ force: true });
assert.equal(calls.length, before + 1);
assert.equal(S.plan.tier, 'plus');
assert.equal(S.plan.summariesLeft, 3);
S.plan.checkedAt = 0;
await ai.allowance();
assert.equal(calls.length, before + 2, 'stale cache: a request');

/* ── settings helpers ──────────────────────────────────────────────── */
assert.equal(store.setProxyUrl('http://localhost:8787/'), true);
assert.equal(S.ai.proxyUrl, 'http://localhost:8787');
assert.equal(store.proxyUrl(), 'http://localhost:8787');
assert.equal(store.setProxyUrl('ftp://nope'), false);
assert.equal(store.setProxyUrl('http://evil.example'), false, 'plain http only for localhost');
assert.equal(store.setProxyUrl('   '), true);
assert.equal(S.ai.proxyUrl, null);
assert.equal(store.proxyUrl(), store.PROXY_URL);
store.markDisclosed(); assert.equal(S.ai.disclosed, true);
store.resetNotices(); assert.equal(S.ai.disclosed, false);

console.log('check-ai: ok');
