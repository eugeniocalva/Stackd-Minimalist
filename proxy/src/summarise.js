/* Summarise: one Claude call with a strict JSON schema, then the
   post-validation in schema.js (PRD-meetings AC-07.1). The model id is
   config (SUMMARY_MODEL; the benchmark decides between the small and mid
   tiers, PRD Q15). Server-side fallback is on, so a safety-classifier
   decline is retried on the recommended model before it reaches the app. */

import Anthropic from '@anthropic-ai/sdk';
import { SCHEMA, validate } from './schema.js';
import { SYSTEM, userMessage } from './prompts.js';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class SummariseError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export async function summarise(env, { transcriptText, meetingDate, priorities }, { model = env.SUMMARY_MODEL || DEFAULT_MODEL, client = null } = {}) {
  if (!client && !env.ANTHROPIC_API_KEY) throw new SummariseError('misconfigured', 'The service is not configured.', 500);
  const anthropic = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 110_000 });
  let res;
  try {
    res = await anthropic.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage({ meetingDate, priorities, transcriptText }) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new SummariseError('misconfigured', 'The service is not configured.', 500);
    if (e instanceof Anthropic.BadRequestError) throw new SummariseError('bad_request', `The service rejected the request: ${e.message}`, 400);
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
      throw new SummariseError('provider_unavailable', 'The service is busy. Try again in a minute.', 503);
    }
    console.error('summarise', e?.message || e);     // the detail stays in the log, never in the app
    throw new SummariseError('provider_unavailable', 'The service failed. Try again in a minute.', 503);
  }
  if (res.stop_reason === 'refusal') throw new SummariseError('refused', 'The service declined to summarise this transcript.', 422);
  if (res.stop_reason === 'max_tokens') throw new SummariseError('bad_output', 'The minutes came back incomplete. Try again.', 502);
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let raw;
  try { raw = JSON.parse(text); } catch { throw new SummariseError('bad_output', 'The minutes came back unreadable. Try again.', 502); }
  let out;
  try { out = validate(raw, { meetingDate, priorities }); } catch { throw new SummariseError('bad_output', 'The minutes came back in the wrong shape. Try again.', 502); }
  return { ...out, model: res.model, usage: res.usage };
}
