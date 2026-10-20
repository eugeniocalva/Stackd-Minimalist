/* Which speech-to-text provider the Worker uses (STT_PROVIDER variable;
   PRD-meetings Q13: the benchmark picks). 'stub' is for the tests: it
   accepts anything and answers a canned transcript on the second poll. */

import { assemblyai } from './assemblyai.js';

export function provider(env, fetchImpl = globalThis.fetch) {
  const name = env.STT_PROVIDER || 'assemblyai';
  if (name === 'assemblyai') return assemblyai(env, fetchImpl);
  if (name === 'stub') return stub();
  throw new Error(`unknown STT_PROVIDER ${name}`);
}

const polls = new Map();
function stub() {
  return {
    name: 'stub',
    async start(blob) {
      const id = `stub-${Math.random().toString(36).slice(2, 8)}`;
      polls.set(id, { n: 0, empty: blob.size < 100 });
      return id;
    },
    async poll(id) {
      const p = polls.get(id);
      if (!p) return { state: 'error', code: 'provider_unavailable' };
      p.n += 1;
      if (p.n < 2) return { state: 'processing' };
      if (p.empty) return { state: 'error', code: 'too_quiet', message: 'no speech' };
      return { state: 'done', segments: [{ speaker: 'S1', startMs: 0, text: 'Hello from the stub.' }, { speaker: 'S2', startMs: 1500, text: 'Hi.' }], speakers: { S1: null, S2: null } };
    },
  };
}
