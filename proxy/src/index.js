/* Stack'd Meetings proxy — Cloudflare Worker (docs/architecture.md §20).
   Routes, CORS, the app-token check, then entitlement → pool → provider.
   Keeps nothing but the counters. */

import { allowance, periodKey, isTier } from './plans.js';
import { getUsed, reserve, release } from './pool.js';
import { resolve } from './entitlement.js';
import { summarise, SummariseError } from './summarise.js';
import { toModelText, isTranscript } from './transcript.js';

const SUB_ID = /^[a-z0-9]{8,64}$/;
const MAX_TRANSCRIPT_CHARS = 300_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const origins = (env) => String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Stackd-App, X-Stackd-Subscriber',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  /* the shells and curl send no Origin; the web app's must be on the list */
  if (origin && origins(env).includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const fail = (code, message, status, headers, extra = {}) => json({ ok: false, code, message, ...extra }, status, headers);

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/v1/health') return json({ ok: true }, 200, cors);
    if (request.headers.get('Origin') && !cors['Access-Control-Allow-Origin']) return fail('unauthorized', 'Origin not allowed.', 403, cors);

    if (!env.APP_TOKEN || request.headers.get('X-Stackd-App') !== env.APP_TOKEN) return fail('unauthorized', 'Unknown app.', 401, cors);
    const sub = request.headers.get('X-Stackd-Subscriber') || '';
    if (!SUB_ID.test(sub)) return fail('bad_request', 'Missing subscriber id.', 400, cors);

    try {
      if (request.method === 'GET' && url.pathname === '/v1/allowance') return await handleAllowance(env, sub, cors);
      if (request.method === 'POST' && url.pathname === '/v1/summarise') return await handleSummarise(request, env, sub, cors);
      if (url.pathname.startsWith('/v1/transcribe')) return fail('not_implemented', 'Transcription arrives in a later build.', 501, cors);
      if (url.pathname === '/v1/rc-webhook') return fail('not_implemented', 'Not yet.', 501, cors);
      return fail('bad_request', 'No such route.', 404, cors);
    } catch (e) {
      if (e instanceof SummariseError) return fail(e.code, e.message, e.status, cors);
      console.error('unhandled', e?.stack || e);
      return fail('provider_unavailable', 'Something went wrong. Try again.', 500, cors);
    }
  },
};

async function currentAllowance(env, sub) {
  const ent = await resolve(env, sub);
  const tier = isTier(ent.tier) ? ent.tier : 'free';
  const key = periodKey(tier, ent.renewsAt);
  const used = tier === 'free' ? { audioSeconds: 0, summaries: 0 } : await getUsed(env.POOL, sub, key);
  return { ent: { ...ent, tier }, key, allowance: allowance(tier, used, ent.renewsAt) };
}

async function handleAllowance(env, sub, cors) {
  const { allowance: a } = await currentAllowance(env, sub);
  return json({ ok: true, allowance: a }, 200, cors);
}

async function handleSummarise(request, env, sub, cors) {
  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 'The request body is not JSON.', 400, cors); }
  const { transcript, meetingDate, priorities } = body || {};
  if (!isTranscript(transcript) || !transcript.segments.length) return fail('bad_request', 'A transcript is required.', 400, cors);
  if (typeof meetingDate !== 'string' || !ISO_DATE.test(meetingDate)) return fail('bad_request', 'meetingDate must be YYYY-MM-DD.', 400, cors);
  const names = Array.isArray(priorities) ? priorities.map((p) => String(p).trim()).filter(Boolean).slice(0, 12) : [];
  const transcriptText = toModelText(transcript);
  if (!transcriptText.trim()) return fail('bad_request', 'The transcript is empty.', 400, cors);
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) return fail('too_large', 'This transcript is too long to summarise.', 413, cors);

  const { ent, key, allowance: before } = await currentAllowance(env, sub);
  if (ent.tier === 'free') return fail('plan_required', 'Summarising needs a plan.', 403, cors, { allowance: before });
  const r = await reserve(env.POOL, sub, key, ent.tier, { summaries: 1 });
  if (!r.ok) {
    return fail('allowance_exhausted', "You've used this period's summaries.", 429, cors, { resetsAt: before.renewsAt, allowance: before });
  }
  try {
    const out = await summarise(env, { transcriptText, meetingDate, priorities: names });
    return json({ ok: true, minutes: out.minutes, actions: out.actions, model: out.model, allowance: allowance(ent.tier, r.used, ent.renewsAt) }, 200, cors);
  } catch (e) {
    await release(env.POOL, sub, key, { summaries: 1 });   // a failed step is not charged (AC-09.3)
    throw e;
  }
}
