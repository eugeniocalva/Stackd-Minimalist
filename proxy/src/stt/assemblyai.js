/* Speech-to-text adapter: AssemblyAI (async transcripts with speaker
   labels). The default provider; its price sits inside the PRD's range
   (§11) and it carries diarization without an add-on. The adapter shape
   every provider implements (architecture §20):
     start(blob, mimeType) → providerJobId
     poll(providerJobId)   → { state: 'queued'|'processing'|'done'|'error', segments?, speakers?, code? }
   Segments come back in the app's neutral shape: speaker labels S1… in
   order of first appearance, startMs, text. */

const API = 'https://api.assemblyai.com/v2';

export function assemblyai(env, fetchImpl = globalThis.fetch) {
  const key = env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('ASSEMBLYAI_API_KEY is not set');
  const headers = { authorization: key };
  return {
    name: 'assemblyai',
    async start(blob, mimeType) {
      const up = await fetchImpl(`${API}/upload`, { method: 'POST', headers: { ...headers, 'content-type': mimeType || 'application/octet-stream' }, body: blob });
      if (!up.ok) throw new Error(`upload ${up.status}`);
      const { upload_url } = await up.json();
      const res = await fetchImpl(`${API}/transcript`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ audio_url: upload_url, speaker_labels: true, language_code: 'en', punctuate: true, format_text: true }),
      });
      if (!res.ok) throw new Error(`transcript ${res.status}`);
      const { id } = await res.json();
      return id;
    },
    async poll(id) {
      const res = await fetchImpl(`${API}/transcript/${encodeURIComponent(id)}`, { headers });
      if (!res.ok) throw new Error(`poll ${res.status}`);
      const t = await res.json();
      if (t.status === 'error') return { state: 'error', code: /audio|duration|silence|no speech/i.test(t.error || '') ? 'too_quiet' : 'provider_unavailable', message: t.error };
      if (t.status !== 'completed') return { state: t.status === 'queued' ? 'queued' : 'processing' };
      return { state: 'done', ...fromUtterances(t.utterances, t.text) };
    },
  };
}

/** AssemblyAI utterances ({ speaker: 'A', start, end, text }) → the neutral shape. */
export function fromUtterances(utterances, text = '') {
  const labels = new Map(); const speakers = {};
  const segments = (utterances || []).map((u) => {
    const who = String(u.speaker ?? '');
    if (!labels.has(who)) { const l = `S${labels.size + 1}`; labels.set(who, l); speakers[l] = null; }
    return { speaker: labels.get(who), startMs: Math.max(0, Math.round(u.start || 0)), text: String(u.text || '').trim() };
  }).filter((s) => s.text);
  if (!segments.length && String(text || '').trim()) {
    speakers.S1 = 'Transcript';
    segments.push({ speaker: 'S1', startMs: 0, text: String(text).trim() });
  }
  return { segments, speakers };
}
