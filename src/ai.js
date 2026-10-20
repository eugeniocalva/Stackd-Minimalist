/* Proxy client (PRD-meetings US-05, US-07, US-09; architecture §20, §22).
   The two AI steps, the allowance, the job state that survives leaving a
   screen, and the error mapping. The network layer is injectable
   (setFetch) so scripts/check-ai.mjs runs the state paths under Node.

   A job is persisted on the meeting (jobs.summarise / jobs.transcribe)
   while a request is in flight; the request itself lives in this module.
   After a reload there is a job but no request, so resumeJobs() marks it
   interrupted (transcription, Phase 20, resumes by job id instead). */

import {
  S, APP_TOKEN, meetingById, proxyUrl, setJobState, setMinutes, setPlanCache,
} from './store.js';
import { toISO } from './dates.js';
import { uid } from './util.js';

export const STEPS = ['transcribe', 'summarise'];
export const REQUEST_TIMEOUT_MS = 150_000;
export const ALLOWANCE_TTL_MS = 10 * 60 * 1000;

/** What the app says for each code (the proxy's own message wins when it has one). */
export const MESSAGES = {
  offline: 'No connection. Try again when you are back online.',
  unauthorized: 'This build cannot reach the service. Update the app.',
  plan_required: 'Summarising needs a plan. Plans arrive in a later build; testers are allow-listed by their subscriber id (Settings › Meetings & AI).',
  allowance_exhausted: "You've used this period's summaries.",
  too_large: 'This transcript is too long to summarise.',
  refused: 'The service declined to summarise this transcript.',
  provider_unavailable: 'The service is unavailable right now. Try again in a minute.',
  timeout: 'That took too long. Try again.',
  interrupted: 'Summarising was interrupted. Try again.',
  bad_output: 'The minutes came back unreadable. Try again.',
  bad_request: 'Something went wrong with the request. Try again.',
  misconfigured: 'The service is not set up yet.',
  not_implemented: 'This step arrives in a later build.',
};
const CLIENT_WORDING = new Set(['plan_required']);   // codes whose wording the app owns for now

export const isOnline = () => globalThis.navigator?.onLine !== false;

/** Any thrown thing → { code, message } the UI can show. */
export function errorFor(x) {
  const code = x && typeof x === 'object' ? x.code : null;
  if (code && MESSAGES[code]) return { code, message: !CLIENT_WORDING.has(code) && x.message ? x.message : MESSAGES[code], resetsAt: x.resetsAt ?? null };
  if (x?.name === 'AbortError') return { code: 'timeout', message: MESSAGES.timeout };
  if (!isOnline()) return { code: 'offline', message: MESSAGES.offline };
  return { code: 'provider_unavailable', message: MESSAGES.provider_unavailable };
}

/* ── Network ─────────────────────────────────────────────────────────── */

let fetchImpl = (...args) => globalThis.fetch(...args);
export function setFetch(fn) { fetchImpl = fn; }

async function call(path, { method = 'GET', body, signal } = {}) {
  const res = await fetchImpl(proxyUrl() + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Stackd-App': APP_TOKEN, 'X-Stackd-Subscriber': S.plan.subscriberId },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON: handled below */ }
  if (data?.allowance) setPlanCache(data.allowance);     // every answer carries the post-call state
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.message || `The service answered ${res.status}.`);
    err.code = data?.code || (res.status === 401 ? 'unauthorized' : 'provider_unavailable');
    err.resetsAt = data?.resetsAt ?? null;
    throw err;
  }
  return data;
}

/* ── Job state (pure) ────────────────────────────────────────────────── */

/** (meeting, event) → the fields to assign on the meeting, or null for no change.
    Events: { type: 'start', step, id, at } · { type: 'done', step } ·
    { type: 'error', step, code, message, at } · { type: 'resume', inflight: [step], at } */
export function reduce(m, ev) {
  const jobs = { transcribe: null, summarise: null, ...(m.jobs || {}) };
  switch (ev.type) {
    case 'start': return { jobs: { ...jobs, [ev.step]: { id: ev.id, startedAt: ev.at, phase: 'wait' } }, lastError: null };
    case 'done': return { jobs: { ...jobs, [ev.step]: null }, lastError: null };
    case 'error': return { jobs: { ...jobs, [ev.step]: null }, lastError: { step: ev.step, code: ev.code, message: ev.message, at: ev.at } };
    case 'resume': {
      const lost = STEPS.filter((s) => jobs[s] && !ev.inflight.includes(s));
      if (!lost.length) return null;
      const next = { ...jobs };
      lost.forEach((s) => { next[s] = null; });
      const step = lost[0];
      const message = step === 'transcribe' ? 'Transcribing was interrupted. Try again.' : MESSAGES.interrupted;
      return { jobs: next, lastError: { step, code: 'interrupted', message, at: ev.at } };
    }
    default: return null;
  }
}

const inflight = new Map();   // `${meetingId}:${step}` → AbortController
export const isRunning = (meetingId, step) => inflight.has(`${meetingId}:${step}`);

function apply(meetingId, patch) { if (patch) setJobState(meetingId, patch); }

/* ── Steps ───────────────────────────────────────────────────────────── */

/** Summarise (AC-07.1): the transcript with its speaker names, the meeting
    date and the user's priority names go to the proxy; the minutes and the
    proposed actions come back and replace the old ones. */
export async function summarise(meetingId) {
  const m = meetingById(meetingId);
  const key = `${meetingId}:summarise`;
  if (!m || m.status !== 'active' || !m.transcript || inflight.has(key)) return;
  const now = Date.now();
  if (!isOnline()) { apply(meetingId, reduce(m, { type: 'error', step: 'summarise', code: 'offline', message: MESSAGES.offline, at: now })); return; }
  const ac = new AbortController();
  inflight.set(key, ac);
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  apply(meetingId, reduce(m, { type: 'start', step: 'summarise', id: uid(), at: now }));
  try {
    const t = m.transcript;
    const data = await call('/v1/summarise', {
      method: 'POST',
      signal: ac.signal,
      body: {
        transcript: { segments: t.segments.map((s) => ({ speaker: s.speaker, startMs: s.startMs, text: s.text })), speakers: t.speakers },
        meetingDate: toISO(new Date(m.createdAt)),
        priorities: S.priorities.map((p) => p.name),
      },
    });
    settle();                                   // before the render, so isRunning() is already false
    const cur = meetingById(meetingId);
    if (!cur) return;
    apply(meetingId, reduce(cur, { type: 'done', step: 'summarise' }));
    setMinutes(meetingId, data.minutes, data.actions);
  } catch (e) {
    settle();
    const cur = meetingById(meetingId);
    if (cur) { const { code, message } = errorFor(e); apply(meetingId, reduce(cur, { type: 'error', step: 'summarise', code, message, at: Date.now() })); }
  } finally {
    settle();
  }
  function settle() { clearTimeout(timer); inflight.delete(key); }
}

/** The plan and this period's remaining allowance, from the proxy; cached
    for ten minutes in S.plan unless forced. */
export async function allowance({ force = false } = {}) {
  if (!force && Date.now() - (S.plan.checkedAt || 0) < ALLOWANCE_TTL_MS) return S.plan;
  await call('/v1/allowance');      // call() caches the answer
  return S.plan;
}

/** Boot, Capacitor's `resume`, `online`: a persisted job with no request
    behind it was lost with the page. */
export function resumeJobs(now = Date.now()) {
  S.meetings.forEach((m) => {
    const running = STEPS.filter((s) => inflight.has(`${m.id}:${s}`));
    apply(m.id, reduce(m, { type: 'resume', inflight: running, at: now }));
  });
}
