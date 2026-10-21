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
import * as media from './media.js';
import { setTranscript } from './store.js';

export const STEPS = ['transcribe', 'summarise'];
export const REQUEST_TIMEOUT_MS = 150_000;
export const ALLOWANCE_TTL_MS = 10 * 60 * 1000;
export const POLL_MS = 4000;
export const JOB_TTL_MS = 2 * 3600 * 1000;

/** What the app says for each code (the proxy's own message wins when it has one). */
export const MESSAGES = {
  offline: 'No connection. Try again when you are back online.',
  from_file: 'The AI steps need the app opened from the website (or start-stackd.cmd), not from a file on disk.',
  unauthorized: 'This build cannot reach the service. Update the app.',
  plan_required: 'This needs a plan.',
  allowance_exhausted: "You've used this period's summaries.",
  too_large: 'This is too large to send.',
  too_quiet: 'The recording was too quiet to transcribe.',
  invalid_audio: 'The recording could not be read.',
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
/* Opened from disk (file://): the browser sends no usable origin, so the
   proxy's CORS rules refuse every call (architecture §26, AC-11.5). */
export const fromFile = () => globalThis.location?.protocol === 'file:';

/** Any thrown thing → { code, message } the UI can show. */
export function errorFor(x) {
  const code = x && typeof x === 'object' ? x.code : null;
  if (code && MESSAGES[code]) return { code, message: !CLIENT_WORDING.has(code) && x.message ? x.message : MESSAGES[code], resetsAt: x.resetsAt ?? null };
  if (x?.name === 'AbortError') return { code: 'timeout', message: MESSAGES.timeout };
  if (fromFile()) return { code: 'from_file', message: MESSAGES.from_file };
  if (!isOnline()) return { code: 'offline', message: MESSAGES.offline };
  return { code: 'provider_unavailable', message: MESSAGES.provider_unavailable };
}

/* ── Network ─────────────────────────────────────────────────────────── */

let fetchImpl = (...args) => globalThis.fetch(...args);
export function setFetch(fn) { fetchImpl = fn; }

/* Uploads go through XMLHttpRequest for its progress events; injectable for the checks.
   uploadImpl(url, formData, { headers, onProgress(pct), signal }) → { ok, status, json() } */
let uploadImpl = (url, formData, { headers, onProgress, signal }) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url);
  Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
  xhr.responseType = 'text';
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round(100 * e.loaded / e.total)); };
  xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json: async () => JSON.parse(xhr.responseText) });
  xhr.onerror = () => reject(new TypeError('Network request failed'));
  xhr.onabort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  signal?.addEventListener('abort', () => xhr.abort());
  xhr.send(formData);
});
export function setUpload(fn) { uploadImpl = fn; }
let blobImpl = (key) => media.blob(key);
export function setBlob(fn) { blobImpl = fn; }

const headersFor = () => ({ 'X-Stackd-App': APP_TOKEN, 'X-Stackd-Subscriber': S.plan.subscriberId });

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
    Events: { type: 'start', step, id, at, phase? } · { type: 'phase', step, phase, id? } · { type: 'done', step } ·
    { type: 'error', step, code, message, at } · { type: 'resume', inflight: [step], at }
    A transcribe job in its 'wait' phase has a proxy job id and survives a
    reload (polling resumes); anything else without a live request is lost. */
export function reduce(m, ev) {
  const jobs = { transcribe: null, summarise: null, ...(m.jobs || {}) };
  switch (ev.type) {
    case 'start': return { jobs: { ...jobs, [ev.step]: { id: ev.id, startedAt: ev.at, phase: ev.phase || 'wait' } }, lastError: null };
    case 'phase': return jobs[ev.step] ? { jobs: { ...jobs, [ev.step]: { ...jobs[ev.step], phase: ev.phase, ...(ev.id ? { id: ev.id } : {}) } } } : null;
    case 'done': return { jobs: { ...jobs, [ev.step]: null }, lastError: null };
    case 'error': return { jobs: { ...jobs, [ev.step]: null }, lastError: { step: ev.step, code: ev.code, message: ev.message, at: ev.at, ...(ev.resetsAt ? { resetsAt: ev.resetsAt } : {}) } };
    case 'resume': {
      const resumable = (s) => s === 'transcribe' && jobs[s]?.phase === 'wait' && /^job_/.test(jobs[s].id || '') && ev.at - (jobs[s].startedAt || 0) < JOB_TTL_MS;
      const lost = STEPS.filter((s) => jobs[s] && !ev.inflight.includes(s) && !resumable(s));
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
/* The UI registers what to do when a step fails for plan reasons (open the
   paywall or the allowance sheet, AC-12.6); the store keeps the error too. */
let onPlanError = null;
export function setPlanErrorHandler(fn) { onPlanError = fn; }
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
    if (cur) {
      const { code, message, resetsAt } = errorFor(e);
      apply(meetingId, reduce(cur, { type: 'error', step: 'summarise', code, message, resetsAt, at: Date.now() }));
      onPlanError?.(code, { step: 'summarise', resetsAt });
    }
  } finally {
    settle();
  }
  function settle() { clearTimeout(timer); inflight.delete(key); }
}

/* ── Transcribe (AC-05.1 – AC-05.4, AC-09.3) ─────────────────────────── */

const progress = new Map();   // meetingId → { pct, onProgress }
export const uploadProgress = (meetingId) => progress.get(meetingId)?.pct ?? null;

/** Upload the recording, then poll the proxy until the transcript is ready. */
export async function transcribe(meetingId, { onProgress = null } = {}) {
  const m = meetingById(meetingId);
  const key = `${meetingId}:transcribe`;
  if (!m || m.status !== 'active' || !m.recording || inflight.has(key)) return;
  const now = Date.now();
  if (!isOnline()) { apply(meetingId, reduce(m, { type: 'error', step: 'transcribe', code: 'offline', message: MESSAGES.offline, at: now })); return; }
  const ac = new AbortController();
  inflight.set(key, ac);
  progress.set(meetingId, { pct: 0, onProgress });
  apply(meetingId, reduce(m, { type: 'start', step: 'transcribe', id: uid(), at: now, phase: 'upload' }));
  try {
    const blob = await blobImpl(m.recording.key);
    if (!blob || !blob.size) throw Object.assign(new Error('The recording is missing from this device.'), { code: 'invalid_audio' });
    const fd = new FormData();
    fd.append('audio', blob, `recording.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
    fd.append('durationMs', String(m.recording.durationMs));
    const res = await uploadImpl(proxyUrl() + '/v1/transcribe', fd, {
      headers: headersFor(), signal: ac.signal,
      onProgress: (pct) => { const p = progress.get(meetingId); if (p) { p.pct = pct; p.onProgress?.(pct); } },
    });
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (data?.allowance) setPlanCache(data.allowance);
    if (!res.ok || !data?.ok) {
      const err = new Error(data?.message || `The service answered ${res.status}.`);
      err.code = data?.code || (res.status === 401 ? 'unauthorized' : 'provider_unavailable'); err.resetsAt = data?.resetsAt ?? null;
      throw err;
    }
    const cur = meetingById(meetingId); if (!cur) return;
    apply(meetingId, reduce(cur, { type: 'phase', step: 'transcribe', phase: 'wait', id: data.jobId }));
    inflight.delete(key);
    await pollTranscription(meetingId, data.jobId);
  } catch (e) {
    inflight.delete(key);
    const cur = meetingById(meetingId);
    if (cur) {
      const { code, message, resetsAt } = errorFor(e);
      const cancelled = e?.name === 'AbortError' && ac.signal.aborted && progress.get(meetingId)?.cancelled;
      if (cancelled) apply(meetingId, reduce(cur, { type: 'done', step: 'transcribe' }));
      else { apply(meetingId, reduce(cur, { type: 'error', step: 'transcribe', code, message, resetsAt, at: Date.now() })); onPlanError?.(code, { step: 'transcribe', resetsAt }); }
    }
  } finally {
    inflight.delete(key);
    progress.delete(meetingId);
  }
}

/** Cancel is only possible while uploading (AC-05.1). */
export function cancelUpload(meetingId) {
  const key = `${meetingId}:transcribe`;
  const ac = inflight.get(key);
  const p = progress.get(meetingId);
  if (!ac || !p) return false;
  p.cancelled = true;
  ac.abort();
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until done or failed; the job id on the meeting lets a reload resume here. */
async function pollTranscription(meetingId, jobId) {
  const key = `${meetingId}:transcribe:poll`;
  if (inflight.has(key)) return;
  inflight.set(key, new AbortController());
  try {
    for (;;) {
      const m = meetingById(meetingId);
      if (!m || !m.jobs?.transcribe || m.jobs.transcribe.id !== jobId) return;      // cleared meanwhile (deleted, re-recorded)
      if (Date.now() - (m.jobs.transcribe.startedAt || 0) > JOB_TTL_MS) { apply(meetingId, reduce(m, { type: 'error', step: 'transcribe', code: 'timeout', message: MESSAGES.timeout, at: Date.now() })); return; }
      let data;
      try { data = await call(`/v1/transcribe/${encodeURIComponent(jobId)}`); }
      catch (e) {
        if (e?.code && e.code !== 'provider_unavailable' && e.code !== 'offline') {   // a definite answer: the proxy says the job failed
          const { code, message, resetsAt } = errorFor(e);
          apply(meetingId, reduce(m, { type: 'error', step: 'transcribe', code, message, resetsAt, at: Date.now() }));
          onPlanError?.(code, { step: 'transcribe', resetsAt });
          return;
        }
        await sleep(POLL_MS * 2); continue;                                            // transient: keep waiting
      }
      if (data.state === 'done') {
        const cur = meetingById(meetingId); if (!cur) return;
        apply(meetingId, reduce(cur, { type: 'done', step: 'transcribe' }));
        setTranscript(meetingId, { source: 'recording', segments: data.transcript.segments, speakers: data.transcript.speakers });
        onTranscribed?.(meetingId);
        return;
      }
      await sleep(POLL_MS);
    }
  } finally {
    inflight.delete(key);
  }
}

let onTranscribed = null;
/** The UI's "transcript ready, delete the recording?" toast (AC-04.8). */
export function setTranscribedHandler(fn) { onTranscribed = fn; }

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
    const running = STEPS.filter((s) => inflight.has(`${m.id}:${s}`) || inflight.has(`${m.id}:${s}:poll`));
    apply(m.id, reduce(m, { type: 'resume', inflight: running, at: now }));
    const t = m.jobs?.transcribe;
    if (t && t.phase === 'wait' && /^job_/.test(t.id || '') && !running.includes('transcribe') && isOnline()) pollTranscription(m.id, t.id);
  });
}
