/* Transcripts as text (PRD-meetings US-06): parsers for pasted text, .vtt
   and .srt, the speaker-label scheme, display merging and the text the
   model receives. Pure (no DOM, no store) so scripts/check-transcript.mjs
   runs it under Node.

   Shape: { segments: [{ id, speaker, startMs, text }], speakers: { S1: null | 'Marco' } }
   Labels are S1, S2… in order of first appearance; the speakers map holds
   the display name the source carried (a <v> cue, "Name: …") or the user
   typed, null for the default "Speaker n". A source with no speakers at
   all gets one label named 'Transcript' (AC-06.5). */

const uid = () => Math.random().toString(36).slice(2, 10);

/** 'mm:ss', 'h:mm:ss', with optional '.mmm' or ',mmm' → ms; null for clock
    times with AM / PM or anything else. */
export function parseTime(s) {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return ((+(h || 0) * 60 + +min) * 60 + +sec) * 1000 + (frac ? +frac.padEnd(3, '0') : 0);
}

/** Items [{ who: string | null, startMs, text }] → the transcript shape. */
function assemble(items) {
  const labels = new Map(); const speakers = {};
  const segments = [];
  items.forEach((it) => {
    const text = String(it.text ?? '').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) return;
    const key = (it.who || '').trim();
    if (!labels.has(key)) { const label = `S${labels.size + 1}`; labels.set(key, label); speakers[label] = key || null; }
    segments.push({ id: uid(), speaker: labels.get(key), startMs: it.startMs ?? null, text });
  });
  if (segments.length && Object.keys(speakers).length === 1 && speakers.S1 === null) speakers.S1 = 'Transcript';
  return { segments, speakers };
}

const stripTags = (s) => s.replace(/<\/?[^>]+>/g, '');

/** WebVTT: cue blocks; `<v Name>` voice tags become speakers (Teams exports). */
export function parseVTT(text) {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const items = [];
  blocks.forEach((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]) && !lines.some((l) => l.includes('-->'))) return;
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) return;
    const startMs = parseTime(lines[ti].split('-->')[0].trim().split(/\s+/)[0]);
    const body = lines.slice(ti + 1).join('\n');
    const voice = /<v(?:\.[^\s>]*)?\s+([^>]*)>/.exec(body);
    const who = voice ? voice[1].trim() : null;
    const plain = stripTags(body);
    const named = !who && /^([^:\n]{1,40}):\s+(.+)/s.exec(plain);
    if (named) items.push({ who: named[1].trim(), startMs, text: named[2] });
    else items.push({ who, startMs, text: plain });
  });
  return assemble(items);
}

/** SubRip: index, "00:00:12,000 --> …", text; "Name: text" on the first line is a speaker. */
export function parseSRT(text) {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const items = [];
  blocks.forEach((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) return;
    const startMs = parseTime(lines[ti].split('-->')[0].trim());
    const plain = stripTags(lines.slice(ti + 1).join('\n'));
    const named = /^([^:\n]{1,40}):\s+(.+)/s.exec(plain);
    if (named) items.push({ who: named[1].trim(), startMs, text: named[2] });
    else items.push({ who: null, startMs, text: plain });
  });
  return assemble(items);
}

/* Pasted shapes (AC-06.5):
     "[00:12] Name: text"  (or "(00:12) Name: text")
     "Name (00:12): text"  (or "Name [00:12]: text")
     "Name: text"
     "Name  00:12"  on its own line, the text on the lines after it (Teams copy)
   Anything else continues the current segment; with no shape at all the
   whole text is one segment. A "name" is at most 40 characters, holds no
   digits-only run and is not a URL scheme. */
const NAME = '([^:\\n\\d][^:\\n]{0,39}?)';
const TIMED = new RegExp(`^[\\[(]\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*[\\])]\\s*${NAME}:\\s*(.*)$`);
/* "Name (00:12): text" and "Name [00:12]: text" (Zoom, Otter exports) */
const NAMED_TIMED = new RegExp(`^${NAME}\\s*[\\[(]\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*[\\])]\\s*:\\s*(.*)$`);
const NAMED = new RegExp(`^${NAME}:\\s+(.*)$`);
const HEADER = new RegExp(`^${NAME}\\s{2,}(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[AP]M)?)\\s*$`, 'i');
const isName = (s) => s && !/^(https?|mailto|tel|note|nb|ps|todo|re)$/i.test(s.trim());

export function parsePasted(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  let cur = null;
  const start = (who, startMs, first) => { cur = { who, startMs, text: first }; items.push(cur); };
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { if (cur) cur.text += '\n'; return; }
    let m;
    if ((m = TIMED.exec(line)) && isName(m[2])) { start(m[2], parseTime(m[1]), m[3]); return; }
    if ((m = NAMED_TIMED.exec(line)) && isName(m[1])) { start(m[1], parseTime(m[2]), m[3]); return; }
    if ((m = HEADER.exec(line)) && isName(m[1])) { start(m[1], parseTime(m[2]), ''); return; }
    if ((m = NAMED.exec(line)) && isName(m[1])) { start(m[1], null, m[2]); return; }
    if (cur) cur.text += (cur.text && !cur.text.endsWith('\n') ? ' ' : '') + line;
    else start(null, null, line);
  });
  const anyNamed = items.some((it) => it.who);
  if (!anyNamed) return assemble([{ who: null, startMs: null, text: lines.join('\n') }]);
  return assemble(items);
}

/** word/document.xml → plain text: one line per paragraph, tabs and
    breaks kept, everything else (formatting, comments, images) dropped. */
export function parseDocxXml(xml) {
  const s = String(xml ?? '');
  const paragraphs = [];
  const re = /<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g;
  let m;
  while ((m = re.exec(s))) {
    const p = m[0];
    const text = p
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>|<w:cr\/>/g, '\n')
      .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
      .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
    paragraphs.push(text);
  }
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** By file extension: .vtt, .srt, else plain text (a .docx caller passes
    the text parseDocxXml() produced). */
export function parseByName(fileName, text) {
  const ext = String(fileName ?? '').toLowerCase().split('.').pop();
  if (ext === 'vtt') return parseVTT(text);
  if (ext === 'srt') return parseSRT(text);
  return parsePasted(text);
}

/** The name shown for a label: the user's or the source's, else "Speaker n". */
export function speakerName(t, label) {
  const name = t?.speakers?.[label];
  if (name) return name;
  const n = /^S(\d+)$/.exec(label || '');
  return n ? `Speaker ${n[1]}` : String(label ?? '');
}

/** Display: consecutive segments by one speaker read as one (AC-06.1).
    Keeps the first segment's id and time. */
export function mergeAdjacent(segments) {
  const out = [];
  (segments || []).forEach((s) => {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) { last.text += '\n' + s.text; return; }
    out.push({ ...s });
  });
  return out;
}

const mmss = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** What the model reads: one line per segment, "[mm:ss] Name: text"; the
    time is left out when unknown and the name when the transcript has no
    speakers at all. */
export function toModelText(t) {
  const single = Object.keys(t.speakers || {}).length === 1 && t.speakers.S1 === 'Transcript';
  return (t.segments || []).map((s) => {
    const time = s.startMs === null || s.startMs === undefined ? '' : `[${mmss(s.startMs)}] `;
    const who = single ? '' : `${speakerName(t, s.speaker)}: `;
    return `${time}${who}${s.text.replace(/\s*\n\s*/g, ' ')}`;
  }).join('\n');
}
