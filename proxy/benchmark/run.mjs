/* Summary-model benchmark (PRD-meetings Q15, architecture Phase 16).
   Runs every benchmark/transcripts/*.txt (pasted-shape transcripts) through
   the small and the mid Claude tier with the production prompt, schema and
   validation, and writes the two outputs per transcript as A and B with the
   assignment shuffled per file and recorded in out/key.json, so the owner
   rates them blind on: actions found vs missed, actions invented, summary
   accuracy. Needs ANTHROPIC_API_KEY in the environment.

   Usage: cd proxy && npm run benchmark [-- --date 2026-10-20 --priorities High,Medium,Low]
   Then fill out/ratings.md and read out/key.json. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { summarise } from '../src/summarise.js';
import { toModelText } from '../src/transcript.js';

const MODELS = { small: 'claude-haiku-5-5', mid: 'claude-sonnet-5-5' };
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
const meetingDate = args.date || new Date().toISOString().slice(0, 10);
const priorities = (args.priorities || 'High,Medium,Low').split(',').map((s) => s.trim()).filter(Boolean);
const dir = new URL('./transcripts/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = new URL('./out/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(out, { recursive: true });

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };

/* the same pasted-shape parser as the app, minimal: "Name: text" lines */
function parse(text) {
  const labels = new Map(); const speakers = {}; const segments = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
    const m = /^([^:\n\d][^:\n]{0,39}?):\s+(.*)$/.exec(line.trim());
    const who = m ? m[1].trim() : '', body = m ? m[2] : line.trim();
    if (!body) return;
    if (!labels.has(who)) { const l = `S${labels.size + 1}`; labels.set(who, l); speakers[l] = who || null; }
    segments.push({ speaker: labels.get(who), startMs: null, text: body });
  });
  if (Object.keys(speakers).length === 1 && speakers.S1 === null) speakers.S1 = 'Transcript';
  return { segments, speakers };
}

const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
if (!files.length) { console.error(`no transcripts in ${dir}`); process.exit(1); }
const key = {}; const rows = [];
for (const f of files) {
  const name = basename(f, '.txt');
  const transcriptText = toModelText(parse(readFileSync(join(dir, f), 'utf8')));
  const order = Math.random() < 0.5 ? ['small', 'mid'] : ['mid', 'small'];
  key[name] = { A: MODELS[order[0]], B: MODELS[order[1]] };
  for (const [letter, tier] of [['A', order[0]], ['B', order[1]]]) {
    const t0 = Date.now();
    try {
      const r = await summarise(env, { transcriptText, meetingDate, priorities }, { model: MODELS[tier] });
      writeFileSync(join(out, `${name}.${letter}.json`), JSON.stringify({ minutes: r.minutes, actions: r.actions }, null, 2));
      rows.push(`| ${name} | ${letter} | ${r.actions.length} | ${Math.round((Date.now() - t0) / 100) / 10} s | ${r.usage?.input_tokens ?? '?'} / ${r.usage?.output_tokens ?? '?'} |`);
      console.log(`${name} ${letter}: ${r.actions.length} actions, ${Date.now() - t0} ms`);
    } catch (e) {
      writeFileSync(join(out, `${name}.${letter}.json`), JSON.stringify({ error: e.code || e.message }, null, 2));
      rows.push(`| ${name} | ${letter} | error: ${e.code || e.message} | | |`);
      console.error(`${name} ${letter}: ${e.code || e.message}`);
    }
  }
}
writeFileSync(join(out, 'key.json'), JSON.stringify(key, null, 2));
writeFileSync(join(out, 'ratings.md'), `# Summary-model benchmark — ${meetingDate}

Rate each pair blind (open the two JSON files side by side), then look at key.json.

| Transcript | Output | Actions found of expected | Actions invented | Summary accurate (1–5) | Preferred |
|---|---|---|---|---|---|
${files.map((f) => `| ${basename(f, '.txt')} | A | | | | |\n| ${basename(f, '.txt')} | B | | | | |`).join('\n')}

Run log:

| Transcript | Output | Actions | Time | Tokens in / out |
|---|---|---|---|---|
${rows.join('\n')}
`);
console.log(`wrote ${files.length * 2} outputs, key.json and ratings.md to ${out}`);
