/* Speech-to-text provider benchmark (PRD-meetings Q13, Phase 20). Runs every
   benchmark/recordings/*.{m4a,mp4,webm,wav} through the provider named by
   STT_PROVIDER (default assemblyai) and writes the transcript as
   out/<name>.<provider>.txt in "[mm:ss] Speaker n: text" lines plus a
   timing log, so two providers' outputs can be compared on the same
   recordings: speaker accuracy first, price second (PRD §11 target
   ≤ $0.20 per hour).

   Usage: cd proxy && STT_PROVIDER=assemblyai ASSEMBLYAI_API_KEY=… node benchmark/stt.mjs
   Headset, phone-on-table and two-speakers-overlapping recordings are the
   three the architecture asks for. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { provider } from '../src/stt/index.js';

const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dir = here('./recordings/'), out = here('./out/');
mkdirSync(out, { recursive: true });
const MIME = { '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const files = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()]);
if (!files.length) { console.error(`no recordings in ${dir}`); process.exit(1); }
const p = provider(process.env);
const mmss = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
for (const f of files) {
  const name = basename(f, extname(f));
  const blob = new Blob([readFileSync(join(dir, f))], { type: MIME[extname(f).toLowerCase()] });
  const t0 = Date.now();
  try {
    const id = await p.start(blob, blob.type);
    let r;
    for (;;) { r = await p.poll(id); if (r.state === 'done' || r.state === 'error') break; await sleep(4000); }
    if (r.state === 'error') throw new Error(r.code);
    const names = r.speakers;
    const lines = r.segments.map((s) => `[${mmss(s.startMs)}] ${names[s.speaker] || `Speaker ${s.speaker.slice(1)}`}: ${s.text}`);
    writeFileSync(join(out, `${name}.${p.name}.txt`), lines.join('\n') + '\n');
    const secs = Math.round((Date.now() - t0) / 1000);
    log.push(`| ${name} | ${p.name} | ${Object.keys(names).length} | ${r.segments.length} | ${secs} s |`);
    console.log(`${name}: ${Object.keys(names).length} speakers, ${r.segments.length} segments, ${secs} s`);
  } catch (e) {
    log.push(`| ${name} | ${p.name} | error: ${e.message} | | |`);
    console.error(`${name}: ${e.message}`);
  }
}
writeFileSync(join(out, `stt-${p.name}.md`), `# STT benchmark — ${p.name}\n\n| Recording | Provider | Speakers | Segments | Time |\n|---|---|---|---|---|\n${log.join('\n')}\n\nRate each transcript: speaker changes right / wrong, words wrong per minute, names of overlapping speech. Price per hour from the provider's page goes into docs/prd-meetings.md §11.\n`);
console.log(`wrote ${files.length} transcripts to ${out}`);
