/* The text the model reads, built from the app's transcript shape
   ({ segments: [{ speaker, startMs, text }], speakers: { S1: name | null } }).
   Mirrors src/transcript.js toModelText() in the app; kept here so the
   Worker bundle has no imports outside proxy/. */

const mmss = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export function speakerName(speakers, label) {
  const name = speakers?.[label];
  if (name) return name;
  const n = /^S(\d+)$/.exec(label || '');
  return n ? `Speaker ${n[1]}` : String(label ?? '');
}

export function toModelText(t) {
  const speakers = t.speakers || {};
  const single = Object.keys(speakers).length === 1 && speakers.S1 === 'Transcript';
  return (t.segments || []).map((s) => {
    const time = s.startMs === null || s.startMs === undefined ? '' : `[${mmss(s.startMs)}] `;
    const who = single ? '' : `${speakerName(speakers, s.speaker)}: `;
    return `${time}${who}${String(s.text ?? '').replace(/\s*\n\s*/g, ' ')}`;
  }).join('\n');
}

/** Shape check for the request body's transcript. */
export function isTranscript(t) {
  return !!t && typeof t === 'object' && Array.isArray(t.segments)
    && t.segments.every((s) => s && typeof s === 'object' && typeof s.text === 'string' && typeof s.speaker === 'string')
    && (t.speakers === undefined || (t.speakers && typeof t.speakers === 'object'));
}
