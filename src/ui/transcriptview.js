/* Transcript block (PRD-meetings US-06): the segments with their speaker
   label and time, merged when one speaker continues, collapsed past the
   first lines behind "Show all", with a tap on a label to rename that
   speaker everywhere in the meeting, a tap on a time to play from there
   (the playing segment highlights) and inline text edits. */

import { UI, renameSpeaker, editSegment, rerender } from '../store.js';
import { seekTo, onPlayerTime } from './recorder.js';
import { fmtDuration } from '../dates.js';
import { mergeAdjacent, speakerName } from '../transcript.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import { promptDialog } from './primitives.js';

const COLLAPSED = 12;

const sourceLine = (t) => {
  const n = t.segments.length;
  const from = t.source === 'file' ? `from ${t.fileName || 'a file'}` : t.source === 'pasted' ? 'pasted' : 'from the recording';
  return `${from} · ${n} segment${n === 1 ? '' : 's'}`;
};

export function transcriptHTML(m, { readOnly = false } = {}) {
  const t = m.transcript;
  const merged = mergeAdjacent(t.segments);
  const collapsed = merged.length > COLLAPSED && !UI.transcriptAll;
  const single = Object.keys(t.speakers).length === 1 && t.speakers.S1 === 'Transcript';
  return `
  <section class="mblock" data-block="transcript" aria-label="Transcript">
    <div class="mblock-head">
      <span class="section-title">Transcript</span>
      <span class="hint">${esc(sourceLine(t))}</span>
      ${readOnly ? '' : `
      <span class="mblock-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-paste>${icon('clipboard', 16)}Paste</button>
        <button type="button" class="btn btn-ghost btn-sm" data-attach>${icon('attach', 16)}Attach</button>
      </span>`}
    </div>
    <div class="card tsegs ${collapsed ? 'collapsed' : ''}" role="list" data-segs>
      ${merged.map((s) => `
      <div class="tseg" role="listitem" data-seg="${s.id}" aria-label="${esc(single ? 'Transcript' : speakerName(t, s.speaker))}${s.startMs === null || s.startMs === undefined ? '' : `, ${fmtDuration(s.startMs)}`}">
        ${single ? '' : `
        <div class="tseg-head">
          ${readOnly
            ? `<span class="tseg-who">${esc(speakerName(t, s.speaker))}</span>`
            : `<button type="button" class="tseg-who" data-speaker="${esc(s.speaker)}" title="Rename this speaker" aria-label="Rename ${esc(speakerName(t, s.speaker))}">${esc(speakerName(t, s.speaker))}</button>`}
          ${s.startMs === null || s.startMs === undefined ? '' : (m.recording && !readOnly
            ? `<button type="button" class="tseg-time num" data-seek="${s.startMs}" aria-label="Play from ${fmtDuration(s.startMs)}">${icon('play', 10)}${fmtDuration(s.startMs)}</button>`
            : `<span class="tseg-time num">${fmtDuration(s.startMs)}</span>`)}
        </div>`}
        ${readOnly
          ? `<p class="tseg-text">${esc(s.text)}</p>`
          : `<p class="tseg-text" contenteditable="plaintext-only" data-edit="${s.id}" spellcheck="false" aria-label="Transcript text, editable">${esc(s.text)}</p>`}
      </div>`).join('')}
    </div>
    ${collapsed ? `<button type="button" class="btn btn-ghost btn-sm showall" data-showall>Show all (${merged.length})</button>` : ''}
  </section>`;
}

let unlisten = null;

export function bindTranscript(root, m, { readOnly = false } = {}) {
  root.querySelector('[data-showall]')?.addEventListener('click', () => { UI.transcriptAll = true; rerender(); });
  if (readOnly) return;
  /* tap a time → play from there; the playing segment highlights (AC-06.3) */
  root.querySelectorAll('[data-seek]').forEach((b) => b.addEventListener('click', () => seekTo(+b.dataset.seek)));
  unlisten?.();
  const merged = mergeAdjacent(m.transcript.segments).filter((s) => s.startMs !== null && s.startMs !== undefined);
  unlisten = onPlayerTime((ms, playing) => {
    let current = null;
    merged.forEach((s) => { if (s.startMs <= ms + 50) current = s.id; });
    root.querySelectorAll('.tseg.playing').forEach((el) => { if (!playing || el.dataset.seg !== current) el.classList.remove('playing'); });
    if (playing && current) root.querySelector(`.tseg[data-seg="${current}"]`)?.classList.add('playing');
  });
  /* inline text edits (AC-06.4): a merged segment edits its first stored segment's
     text; the merged ones after it are folded into it */
  root.querySelectorAll('[data-edit]').forEach((p) => {
    const original = p.textContent;
    p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { p.textContent = original; p.blur(); } });
    p.addEventListener('blur', () => {
      const text = p.textContent.trim();
      if (text === original.trim()) return;
      if (!text) { p.textContent = original; return; }
      const segs = m.transcript.segments;
      const first = segs.findIndex((s) => s.id === p.dataset.edit);
      if (first === -1) return;
      let last = first;
      while (last + 1 < segs.length && segs[last + 1].speaker === segs[first].speaker) last += 1;
      if (last > first) m.transcript.segments.splice(first + 1, last - first);
      editSegment(m.id, p.dataset.edit, text);
    });
  });
  root.querySelectorAll('[data-speaker]').forEach((b) =>
    b.addEventListener('click', async () => {
      const label = b.dataset.speaker;
      const current = m.transcript.speakers[label] || '';
      const name = await promptDialog(`Name for ${speakerName(m.transcript, label)}`, {
        value: current, placeholder: speakerName({ speakers: {} }, label), confirmLabel: 'Rename', allowEmpty: true,
      });
      if (name === null) return;                 // cancelled; '' clears the name (AC-06.2)
      renameSpeaker(m.id, label, name);
    }));
}
