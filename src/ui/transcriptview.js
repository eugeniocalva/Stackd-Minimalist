/* Transcript block (PRD-meetings US-06): the segments with their speaker
   label and time, merged when one speaker continues, collapsed past the
   first lines behind "Show all", with a tap on a label to rename that
   speaker everywhere in the meeting. Tap-to-seek and inline text edits come
   with the recording and transcription phases (19–20). */

import { UI, renameSpeaker, rerender } from '../store.js';
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
      <div class="tseg" role="listitem" data-seg="${s.id}">
        ${single ? '' : `
        <div class="tseg-head">
          ${readOnly
            ? `<span class="tseg-who">${esc(speakerName(t, s.speaker))}</span>`
            : `<button type="button" class="tseg-who" data-speaker="${esc(s.speaker)}" title="Rename this speaker" aria-label="Rename ${esc(speakerName(t, s.speaker))}">${esc(speakerName(t, s.speaker))}</button>`}
          ${s.startMs === null || s.startMs === undefined ? '' : `<span class="tseg-time num">${fmtDuration(s.startMs)}</span>`}
        </div>`}
        <p class="tseg-text">${esc(s.text)}</p>
      </div>`).join('')}
    </div>
    ${collapsed ? `<button type="button" class="btn btn-ghost btn-sm showall" data-showall>Show all (${merged.length})</button>` : ''}
  </section>`;
}

export function bindTranscript(root, m, { readOnly = false } = {}) {
  root.querySelector('[data-showall]')?.addEventListener('click', () => { UI.transcriptAll = true; rerender(); });
  if (readOnly) return;
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
