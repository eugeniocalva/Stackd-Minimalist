/* Meeting detail (PRD-meetings US-03): one screen that fills in from the
   top. Title (autosaved quietly), a date line, then the blocks that exist:
   the Source block while there is nothing yet (record, paste, attach), the
   Transcript block once a transcript exists (transcriptview.js). Minutes
   and action cards arrive in Phases 16 and 17; recording in Phase 19. The
   ⋯ menu holds Rename · Archive · Delete; an untouched meeting is dropped
   on back (AC-03.5). Archived / deleted meetings open read-only. */

import {
  S, UI, RETENTION_DAYS, meetingById, meetingTitle, defaultMeetingTitle,
  updateMeeting, finalizeMeeting, setTranscript, deleteMeetingForever, rerender,
} from '../store.js';
import { fmtDate, fmtClock, fmtRelative, daysLeft, fmtDuration } from '../dates.js';
import { fmtBytes } from '../media.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow } from './board.js';
import { openMenu, toast, confirmDialog, promptDialog } from './primitives.js';
import { archiveMeetingWithUndo, deleteMeetingWithUndo, restoreMeetingWithToast } from './actions.js';
import { transcriptHTML, bindTranscript } from './transcriptview.js';
import { summariseCtaHTML, bindSummariseCta, minutesHTML, bindMinutes } from './minutesview.js';
import { actionsHTML, bindActions } from './actioncards.js';
import { openPasteSheet, pickTranscriptFile } from './sourcesheet.js';
import { recorderHTML, bindRecorder, isRecording, recordingMeetingId, stopPlayback } from './recorder.js';

export function openMeeting(id) {
  if (!meetingById(id)) return;
  UI.detailId = id; UI.screen = 'meeting'; UI.transcriptAll = false;
  rerender();
}

const dateLine = (m) => `${m.recording ? 'Recorded' : 'Created'} ${fmtDate(m.recording?.recordedAt || m.createdAt, S.dateFormat)} · ${fmtClock(m.recording?.recordedAt || m.createdAt)}`;

/* ── Source: paste / attach (AC-03.2); the mic is recorder.js ─────────── */

/** Paste / attach: a transcript from text or a file, replacing an existing
    one only after a confirm (the minutes and proposed actions go with it). */
function bindSource(root, m) {
  const confirmReplace = async () => !m.transcript
    || confirmDialog('Replace the transcript?', 'The minutes and the actions not yet added to a board are removed with it.', { confirmLabel: 'Replace' });
  root.querySelector('[data-paste]')?.addEventListener('click', async () => {
    if (!await confirmReplace()) return;
    openPasteSheet({ onUse: (parsed) => { setTranscript(m.id, { source: 'pasted', ...parsed }); toast('Transcript added'); } });
  });
  root.querySelector('[data-attach]')?.addEventListener('click', async () => {
    if (!await confirmReplace()) return;
    pickTranscriptFile({
      onParsed: (fileName, parsed) => { setTranscript(m.id, { source: 'file', fileName, ...parsed }); toast(`Transcript added from ${fileName}`); },
      onError: (message) => toast(message),
    });
  });
}

/* ── Screen ──────────────────────────────────────────────────────────── */

let flushCurrent = null;
window.addEventListener('pagehide', () => flushCurrent?.());

export function meetingHTML() {
  const m = meetingById(UI.detailId);
  if (!m) { UI.screen = 'meetings'; return '<div class="screen"></div>'; }
  if (m.status !== 'active') return readOnlyHTML(m);
  const live = isRecording() && recordingMeetingId() === m.id;
  return `
  <div class="screen detail-screen meeting-screen ${live ? 'is-live' : ''}">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to Meetings" ${live ? 'disabled' : ''}>${icon('chevronLeft')}</button>
      ${live ? '<span class="kicker rec-indicator"><span class="rec-dot" aria-hidden="true"></span>Recording</span>' : '<span class="kicker">Meeting</span>'}
      <button class="icon-btn" data-more aria-label="More actions" aria-haspopup="menu" ${live ? 'disabled' : ''}>${icon('more')}</button>
    </header>
    <div class="scroll-area">
      <input class="mtitle" data-title value="${esc(m.title)}" placeholder="${esc(defaultMeetingTitle(m.createdAt))}" aria-label="Meeting title" autocomplete="off" maxlength="120">
      <span class="hint mdate" data-dates>${esc(dateLine(m))}</span>
      ${recorderHTML(m)}
      ${m.transcript ? transcriptHTML(m, { readOnly: false }) : ''}
      ${summariseCtaHTML(m)}
      ${minutesHTML(m)}
      ${actionsHTML(m)}
    </div>
  </div>`;
}

export function bindMeeting() {
  const m = meetingById(UI.detailId);
  if (!m) { rerender(); return; }
  if (m.status !== 'active') { bindReadOnly(m); return; }
  bindScrollShadow();

  /* title autosave: 500 ms after a change, on blur, on back (AC-03.5) */
  const input = app.querySelector('[data-title]');
  let timer = null;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer); timer = null;
    updateMeeting(m.id, { title: input.value });
  };
  flushCurrent = flush;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(flush, 500); });
  input.addEventListener('blur', flush);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

  const leaving = () => { flush(); flushCurrent = null; stopPlayback(); };
  app.querySelector('[data-back]').addEventListener('click', () => {
    if (isRecording()) { toast('Stop the recording first'); return; }
    leaving();
    UI.detailId = null; UI.screen = 'meetings';
    finalizeMeeting(m.id);
  });

  app.querySelector('[data-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
    { label: 'Rename', icon: 'text', onClick: async () => {
      const name = await promptDialog('Meeting title', { value: m.title, placeholder: defaultMeetingTitle(m.createdAt), allowEmpty: true });
      if (name === null) return;
      updateMeeting(m.id, { title: name }); rerender();
    } },
    { label: 'Archive', icon: 'archive', onClick: () => { leaving(); archiveMeetingWithUndo(m.id); } },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { leaving(); deleteMeetingWithUndo(m.id); } },
  ]));

  bindRecorder(app, m, { bindSource: (root) => bindSource(root, m) });
  const transcript = app.querySelector('[data-block="transcript"]');
  if (transcript) { bindTranscript(transcript, m); bindSource(transcript, m); }
  const cta = app.querySelector('[data-cta="summarise"]');
  if (cta) bindSummariseCta(cta, m);
  const minutes = app.querySelector('[data-block="minutes"]');
  if (minutes) bindMinutes(minutes, m);
  const actions = app.querySelector('[data-block="actions"]');
  if (actions) bindActions(actions, m.id);
}

/* ── Read-only view for archived / deleted meetings (AC-10.3) ─────────── */

function readOnlyHTML(m) {
  const archived = m.status === 'archived';
  const left = archived ? 0 : daysLeft(m.deletedAt, RETENTION_DAYS);
  const status = archived ? `Archived ${fmtRelative(m.archivedAt)}`
    : left === 0 ? 'Removed today' : `Removed in ${left} day${left === 1 ? '' : 's'}`;
  return `
  <div class="screen detail-screen is-readonly meeting-screen">
    <header class="page-head detail-top">
      <button class="icon-btn" data-back aria-label="Back to ${archived ? 'Archived' : 'Deleted'}">${icon('chevronLeft')}</button>
      <span class="kicker">${archived ? 'Archived' : 'Deleted'} meeting</span>
      <span class="icon-btn-spacer" aria-hidden="true"></span>
    </header>
    <div class="scroll-area">
      <div class="notice ${archived ? 'notice-neutral' : ''}">
        ${icon(archived ? 'archive' : 'trash', 18)}
        <span>${status}. Restore it to edit.</span>
      </div>
      <h1 class="note-ro-title ${m.title.trim() ? '' : 'untitled'}">${esc(meetingTitle(m))}</h1>
      <span class="hint mdate">${esc(dateLine(m))}</span>
      ${m.recording ? `<span class="hint">${icon('mic', 12)} Recording · ${fmtDuration(m.recording.durationMs)} · ${esc(fmtBytes(m.recording.sizeBytes))}</span>` : ''}
      ${m.transcript ? transcriptHTML(m, { readOnly: true }) : '<p class="empty">No transcript.</p>'}
      ${minutesHTML(m, { readOnly: true })}
      <div class="dialog-actions">
        <button class="btn btn-secondary" data-ro-restore>${icon('undo', 18)}Restore</button>
        <button class="btn btn-ghost danger" data-ro-delete>${archived ? 'Delete' : 'Delete forever'}</button>
      </div>
    </div>
  </div>`;
}

function bindReadOnly(m) {
  bindScrollShadow();
  const archived = m.status === 'archived';
  const toFolder = () => { UI.detailId = null; UI.screen = 'folders'; UI.folder = archived ? 'archived' : 'deleted'; UI.folderKind = 'meetings'; };
  app.querySelector('[data-back]').addEventListener('click', () => { toFolder(); rerender(); });
  app.querySelector('[data-ro-restore]').addEventListener('click', () => { toFolder(); restoreMeetingWithToast(m.id); });
  app.querySelector('[data-ro-delete]').addEventListener('click', async () => {
    if (archived) { toFolder(); deleteMeetingWithUndo(m.id); return; }
    if (await confirmDialog('Delete forever?', 'This meeting cannot be recovered afterwards.', { confirmLabel: 'Delete forever', danger: true })) {
      toFolder(); deleteMeetingForever(m.id);
    }
  });
  const transcript = app.querySelector('[data-block="transcript"]');
  if (transcript) bindTranscript(transcript, m, { readOnly: true });
}
