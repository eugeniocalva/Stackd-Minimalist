/* Transcript sources other than the recording (PRD-meetings AC-06.5,
   AC-06.6): a paste sheet with a text area, and the system file picker for
   .txt / .vtt / .srt (.docx comes in Phase 21). Both hand the parsed shape
   from src/transcript.js to the caller; nothing is stored here. */

import { parsePasted, parseByName } from '../transcript.js';
import { icon } from './icons.js';
import { pinToViewport } from './primitives.js';

/** openPasteSheet({ onUse(parsed) }) */
export function openPasteSheet({ onUse }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
  <div class="sheet" role="dialog" aria-label="Paste transcript">
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <span class="section-title">Paste transcript</span>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <textarea class="input paste-area" data-text placeholder="Paste the transcript here" aria-label="Transcript text" autocapitalize="off" spellcheck="false"></textarea>
    <span class="hint">Lines like “Marco: …” or “[00:12] Marco: …” become speakers.</span>
    <button class="btn btn-primary btn-block" data-use disabled>Use</button>
  </div>`;
  document.body.appendChild(ov);
  const unpin = pinToViewport(ov);
  const q = (s) => ov.querySelector(s);
  const close = () => { unpin(); ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  q('[data-close]').addEventListener('click', close);
  const area = q('[data-text]'), use = q('[data-use]');
  area.addEventListener('input', () => { use.disabled = !area.value.trim(); });
  use.addEventListener('click', () => {
    const parsed = parsePasted(area.value);
    if (!parsed.segments.length) return;
    close();
    onUse(parsed);
  });
  area.focus();
}

const ACCEPT = '.txt,.vtt,.srt,.docx,text/plain,text/vtt,application/x-subrip';
const MAX_BYTES = 5 * 1024 * 1024;

/** pickTranscriptFile({ onParsed(fileName, parsed), onError(message) }) */
export function pickTranscriptFile({ onParsed, onError }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext === 'docx') { onError('Word files are not supported yet; paste the text instead.'); return; }
    if (!['txt', 'vtt', 'srt'].includes(ext)) { onError('Choose a .txt, .vtt or .srt file.'); return; }
    if (file.size > MAX_BYTES) { onError('That file is too large to be a transcript.'); return; }
    const reader = new FileReader();
    reader.onerror = () => onError("Couldn't read this file.");
    reader.onload = () => {
      const parsed = parseByName(file.name, String(reader.result || ''));
      if (!parsed.segments.length) { onError("Couldn't read this file: it has no text."); return; }
      onParsed(file.name, parsed);
    };
    reader.readAsText(file);
  });
  input.click();
}
