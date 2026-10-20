/* Recording (PRD-meetings US-04): the Source block (mic, paste, attach),
   the Recording state (level line, clock, red Stop) and the Saved state
   (player, Transcribe, Delete, Record again). MediaRecorder with a
   five-second timeslice writes chunks to IndexedDB as they arrive
   (media.js), so an app kill keeps what was captured. One recording
   session at a time, app-wide, kept in this module so a re-render of the
   screen re-attaches to it instead of losing it. On Android the local
   recording-service plugin keeps the process in the foreground; on iOS the
   audio background mode does (AC-04.3). */

import {
  S, UI, MAX_RECORDING_MS, meetingById, setRecording, replaceRecording, markConsented, markDisclosed, rerender,
} from '../store.js';
import { fmtDuration } from '../dates.js';
import * as media from '../media.js';
import { esc } from '../util.js';
import { icon } from './icons.js';
import { confirmDialog, toast } from './primitives.js';
import { buzz } from '../haptics.js';
import { transcribe, cancelUpload, uploadProgress, isOnline } from '../ai.js';
import { aiButtonState, openPlanRequired } from './paywall.js';

const TIMESLICE_MS = 5000;
const BITRATE = 48_000;                      // mono speech: 30 min ≈ 11 MB
const EXPECTED_BYTES = 15 * 1024 * 1024;     // what a full recording may take (AC-04.6)
const LOW_SPACE = 2 * EXPECTED_BYTES;        // warn below this (AC-04.7)
const MIN_SPACE = 512 * 1024;                // refuse below this
const BARS = 48;

const nativeService = () => globalThis.Capacitor?.Plugins?.RecordingService;

/** The MIME type this browser records: AAC in Safari and the iOS shell, Opus elsewhere. */
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';   // let the browser choose
}
export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && media.available();

/* ── The live session ────────────────────────────────────────────────── */

let session = null;   // { meetingId, key, stream, rec, ctx, analyser, startedAt, durationMs, levels, mimeType, stopping, tick, raf, chunkQueue }
export const isRecording = () => !!session;
export const recordingMeetingId = () => session?.meetingId || null;

async function startRecording(m) {
  if (session || !canRecord()) return;
  const key = media.keyFor(m.id);
  const svc = nativeService();
  let stream;
  try {
    if (svc?.start) await svc.start();                 // Android: permission + foreground service
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, channelCount: 1 } });
  } catch (e) {
    UI.recorderDenied = true; rerender();
    return;
  }
  const mimeType = pickMimeType();
  let rec;
  try {
    rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    toast("This browser can't record audio."); return;
  }
  await media.persist();
  await media.begin(key, { meetingId: m.id, mimeType: rec.mimeType || mimeType || 'audio/webm' });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  session = {
    meetingId: m.id, key, stream, rec, ctx, analyser, mimeType: rec.mimeType || mimeType,
    startedAt: Date.now(), durationMs: 0, levels: new Array(BARS).fill(0), stopping: false, tick: null, raf: null, chunkQueue: Promise.resolve(),
  };
  UI.recorder = { meetingId: m.id };
  rec.addEventListener('dataavailable', (e) => {
    if (!e.data || !e.data.size) return;
    const at = Date.now() - session.startedAt;
    session.chunkQueue = session.chunkQueue.then(() => media.append(key, e.data, at)).catch((err) => console.error('recording: write failed', err));
  });
  rec.addEventListener('stop', () => finish());
  rec.addEventListener('error', (e) => { console.error('recording', e.error || e); stopRecording(); });
  rec.start(TIMESLICE_MS);
  rerender();
}

export async function stopRecording() {
  if (!session || session.stopping) return;
  session.stopping = true;
  session.durationMs = Date.now() - session.startedAt;
  try { session.rec.stop(); } catch { finish(); }
}

async function finish() {
  const s = session; if (!s) return;
  s.stream.getTracks().forEach((t) => t.stop());
  try { await s.ctx.close(); } catch { /* already closed */ }
  cancelAnimationFrame(s.raf); clearInterval(s.tick);
  nativeService()?.stop?.().catch?.(() => {});
  await s.chunkQueue;
  const durationMs = s.durationMs || (Date.now() - s.startedAt);
  const row = await media.finish(s.key, durationMs);
  session = null; UI.recorder = null;
  const m = meetingById(s.meetingId);
  if (m && row && row.sizeBytes > 0) {
    const rec = { key: s.key, mimeType: row.mimeType, durationMs, sizeBytes: row.sizeBytes, recordedAt: s.startedAt };
    if (m.recording) replaceRecording(m.id, rec); else setRecording(m.id, rec);
  } else {
    await media.remove(s.key).catch(() => {});
    toast('Nothing was recorded');
    rerender();
  }
}

/* The level line (AC-04.2): RMS of the time-domain signal, pushed into a
   ring of bars; drawn on a canvas, static under reduced motion. */
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function level() {
  const a = session.analyser;
  const buf = new Uint8Array(a.fftSize);
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}
function draw(canvas) {
  const s = session; if (!s) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const accent = getComputedStyle(canvas).color;
  const gap = 3, bw = Math.max(2, (w - gap * (BARS - 1)) / BARS);
  s.levels.forEach((v, i) => {
    const bh = Math.max(3, v * (h - 4));
    g.fillStyle = accent; g.globalAlpha = 0.35 + 0.65 * (i / BARS);
    const x = i * (bw + gap), y = (h - bh) / 2;
    g.beginPath(); g.roundRect?.(x, y, bw, bh, bw / 2); if (!g.roundRect) g.rect(x, y, bw, bh); g.fill();
  });
  g.globalAlpha = 1;
}

/* ── Markup ──────────────────────────────────────────────────────────── */

function sourceHTML(m) {
  const denied = UI.recorderDenied;
  return `
  <div class="card source-block" data-source>
    ${canRecord() ? `
    <button type="button" class="mic-btn" data-record aria-label="Record" aria-pressed="false">${icon('mic', 30)}</button>
    <span class="source-label">Record</span>
    <span class="hint" data-space></span>
    ${denied ? `<div class="notice"><span>Microphone access was refused. ${globalThis.Capacitor?.isNativePlatform?.() ? 'Allow the microphone for Stack’d in the phone’s Settings, then try again.' : 'Allow the microphone for this site in the browser’s address bar, then try again.'}</span></div>` : ''}`
    : '<span class="hint">Recording is not available here; paste or attach a transcript instead.</span>'}
    <div class="source-alt">
      <button type="button" class="btn btn-secondary" data-paste>${icon('clipboard', 18)}Paste transcript</button>
      <button type="button" class="btn btn-secondary" data-attach>${icon('attach', 18)}Attach file</button>
    </div>
  </div>`;
}

function recordingHTML() {
  return `
  <div class="card rec-block is-recording" data-recording role="group" aria-label="Recording">
    <canvas class="rec-level" data-level aria-hidden="true"></canvas>
    <span class="sr-only" data-rec-live aria-live="polite" role="status">Recording started</span>
    <div class="rec-row">
      <span class="rec-clock num" data-clock aria-live="off">00:00 <span class="hint">/ ${fmtDuration(MAX_RECORDING_MS)}</span></span>
      <button type="button" class="stop-btn" data-stop aria-label="Stop recording" aria-pressed="true">${icon('stop', 26)}</button>
    </div>
    <span class="hint">Recording keeps going if the screen locks</span>
  </div>`;
}

/** The Transcribe control in its states (AC-05.1, AC-05.4, AC-05.5, AC-12.5). */
function transcribeHTML(m) {
  const job = m.jobs?.transcribe;
  const err = m.lastError?.step === 'transcribe' ? m.lastError : null;
  const offline = !isOnline();
  if (job?.phase === 'upload') {
    const pct = uploadProgress(m.id) ?? 0;
    return `
    <div class="cta cta-running" role="status" aria-live="polite">
      <span class="upload-bar" aria-hidden="true"><span class="upload-fill" data-upload-fill style="width:${pct}%"></span></span>
      <span data-upload-text>Uploading ${pct} %</span>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-upload>Cancel</button>
    </div>`;
  }
  if (job) {
    const mins = Math.max(1, Math.round(m.recording.durationMs / 60000 / 6));
    return `
    <div class="cta cta-running" role="status" aria-live="polite">
      <span class="spin" aria-hidden="true"></span>
      <span>Transcribing… about ${mins} min</span>
      <span class="hint">keeps going if you leave this screen</span>
    </div>`;
  }
  const state = aiButtonState('transcribe');
  const planErr = err && (err.code === 'plan_required' || err.code === 'allowance_exhausted');
  const mins = Math.ceil(m.recording.durationMs / 60000);
  const hint = state.locked ? state.hint : state.hint ? `uses ${mins} min of ${state.hint.replace(' of audio left', ' left')}` : '';
  return `
  <div class="cta" data-cta="transcribe">
    ${err && !planErr ? `<div class="notice"><span>${esc(err.message)}</span></div>` : ''}
    ${err?.code === 'allowance_exhausted' ? `<div class="notice"><span>${esc(err.message)}</span></div>` : ''}
    <span class="cta-row">
      <button type="button" class="btn ${m.transcript ? 'btn-secondary' : 'btn-primary'} ${state.locked ? 'is-locked' : ''}" data-transcribe ${offline ? 'disabled' : ''} ${state.locked ? 'data-locked="1"' : ''}>
        ${icon(state.locked ? 'lock' : 'document', 18)}${err && !planErr ? 'Retry' : m.transcript ? 'Transcribe again' : 'Transcribe'}
      </button>
      ${hint ? `<span class="hint cta-hint">${esc(hint)}</span>` : ''}
    </span>
    ${offline ? '<span class="hint">Needs a connection</span>' : ''}
  </div>`;
}

function savedHTML(m) {
  const r = m.recording;
  return `
  <div class="card rec-block" data-saved role="group" aria-label="Recording">
    <div class="player">
      <button type="button" class="play-btn" data-play aria-label="Play">${icon('play', 22)}</button>
      <input type="range" class="scrub" data-scrub min="0" max="${Math.max(1, Math.round(r.durationMs / 1000))}" value="0" step="1" aria-label="Position">
      <span class="num rec-times"><span data-pos>00:00</span> / ${fmtDuration(r.durationMs)}</span>
    </div>
    ${transcribeHTML(m)}
    <div class="rec-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-rerecord>${icon('mic', 16)}Record again</button>
      <button type="button" class="btn btn-ghost btn-sm danger" data-delete-rec>${icon('trash', 16)}Delete recording · ${esc(media.fmtBytes(r.sizeBytes))}</button>
    </div>
  </div>`;
}

export function recorderHTML(m) {
  if (session && session.meetingId === m.id) return recordingHTML();
  if (m.recording) return savedHTML(m);
  if (m.transcript) return '';          // a transcript from text: no source block, the Transcript block has Paste / Attach
  return sourceHTML(m);
}

/* ── Binding ─────────────────────────────────────────────────────────── */

export function bindRecorder(root, m, { bindSource } = {}) {
  const src = root.querySelector('[data-source]');
  if (src) {
    bindSource?.(src);
    src.querySelector('[data-record]')?.addEventListener('click', () => record(m));
    showSpace(src.querySelector('[data-space]'), src.querySelector('[data-record]'));
  }
  const live = root.querySelector('[data-recording]');
  if (live && session && session.meetingId === m.id) attach(live);
  const saved = root.querySelector('[data-saved]');
  if (saved) bindSaved(saved, m);
}

async function record(m) {
  if (!S.ai.consented) {
    const ok = await confirmDialog('Recording a meeting', 'Make sure everyone present knows and agrees to be recorded.', { confirmLabel: 'Record' });
    if (!ok) return;
    markConsented();
  }
  const e = await media.estimate();
  if (e && e.free < MIN_SPACE) { toast('Not enough space on this device to record'); return; }
  if (m.recording && !await confirmDialog('Record again?', 'The current recording, its transcript, minutes and the actions not yet added to a board are replaced.', { confirmLabel: 'Record' })) return;
  UI.recorderDenied = false;
  await startRecording(m);
}

async function showSpace(el, btn) {
  if (!el) return;
  const e = await media.estimate();
  if (!e) return;
  if (e.free < MIN_SPACE) { el.textContent = `Not enough space to record (${media.fmtBytes(e.free)} left)`; if (btn) btn.disabled = true; }
  else if (e.free < LOW_SPACE) el.textContent = `Low space: about ${media.fmtBytes(e.free)} left`;
}

function attach(live) {
  const s = session;
  const live_ = () => live.querySelector('[data-rec-live]');
  const canvas = live.querySelector('[data-level]');
  const clock = live.querySelector('[data-clock]');
  live.querySelector('[data-stop]').addEventListener('click', () => { buzz('MEDIUM'); stopRecording(); });
  cancelAnimationFrame(s.raf); clearInterval(s.tick);
  const frame = () => {
    if (!session || session.stopping) return;
    s.levels.push(level()); s.levels.shift();
    draw(canvas);
    s.raf = reduced() ? setTimeout(frame, 500) : requestAnimationFrame(frame);
  };
  if (reduced()) { frame(); } else s.raf = requestAnimationFrame(frame);
  const tick = () => {
    if (!session) return;
    const ms = Date.now() - s.startedAt;
    if (clock) clock.firstChild.textContent = `${fmtDuration(ms)} `;
    if (ms % 30000 < 500) { const live = live_(); if (live) live.textContent = `Recording, ${fmtDuration(ms)}`; }
    if (ms >= MAX_RECORDING_MS && !s.stopping) {
      buzz('MEDIUM');
      toast(`Stopped at ${fmtDuration(MAX_RECORDING_MS)}`);
      stopRecording();
    }
  };
  s.tick = setInterval(tick, 500); tick();
}

/* ── Playback (AC-04.5) ──────────────────────────────────────────────── */

let player = null;   // { audio, url, key }
export function stopPlayback() {
  if (!player) return;
  player.audio.pause();
  URL.revokeObjectURL(player.url);
  player = null;
}

async function bindSaved(root, m) {
  const r = m.recording;
  const playBtn = root.querySelector('[data-play]'), scrub = root.querySelector('[data-scrub]'), pos = root.querySelector('[data-pos]');
  let audio = null;
  const ensure = async () => {
    if (player && player.key === r.key) { audio = player.audio; return audio; }
    stopPlayback();
    const b = await media.blob(r.key);
    if (!b) { toast('The recording is missing from this device'); return null; }
    const url = URL.createObjectURL(b);
    audio = new Audio(url);
    player = { audio, url, key: r.key };
    audio.addEventListener('timeupdate', () => {
      if (!scrub.matches(':active')) scrub.value = String(Math.floor(audio.currentTime));
      pos.textContent = fmtDuration(audio.currentTime * 1000);
      timeListeners.forEach((fn) => fn(audio.currentTime * 1000, !audio.paused));
    });
    audio.addEventListener('pause', () => timeListeners.forEach((fn) => fn(audio.currentTime * 1000, false)));
    audio.addEventListener('ended', () => { playBtn.innerHTML = icon('play', 22); playBtn.setAttribute('aria-label', 'Play'); });
    audio.addEventListener('pause', () => { playBtn.innerHTML = icon('play', 22); playBtn.setAttribute('aria-label', 'Play'); });
    audio.addEventListener('play', () => { playBtn.innerHTML = icon('pause', 22); playBtn.setAttribute('aria-label', 'Pause'); });
    return audio;
  };
  loader = ensure;
  playBtn.addEventListener('click', async () => {
    const a = await ensure(); if (!a) return;
    if (a.paused) a.play().catch(() => toast("Couldn't play the recording")); else a.pause();
  });
  scrub.addEventListener('input', async () => {
    const a = await ensure(); if (!a) return;
    a.currentTime = +scrub.value; pos.textContent = fmtDuration(a.currentTime * 1000);
  });
  root.querySelector('[data-transcribe]')?.addEventListener('click', async (e) => {
    if (e.currentTarget.dataset.locked) { openPlanRequired({ step: 'transcribe' }); return; }
    if (!S.ai.disclosed) {
      const ok = await confirmDialog('Before the first transcript', 'The recording is sent to our server and to a speech-to-text provider to make the transcript. Nothing is kept there after the result comes back, and nothing is sent until you press this button.', { confirmLabel: 'Continue' });
      if (!ok) return;
      markDisclosed();
    }
    if (m.transcript && !await confirmDialog('Transcribe again?', 'The transcript, the minutes and the actions not yet added to a board are replaced.', { confirmLabel: 'Transcribe' })) return;
    stopPlayback();
    transcribe(m.id, { onProgress: (pct) => {
      const fill = root.querySelector('[data-upload-fill]'), text = root.querySelector('[data-upload-text]');
      if (fill) fill.style.width = `${pct}%`;
      if (text) text.textContent = `Uploading ${pct} %`;
    } });
  });
  root.querySelector('[data-cancel-upload]')?.addEventListener('click', () => { if (cancelUpload(m.id)) toast('Upload cancelled'); });
  root.querySelector('[data-rerecord]').addEventListener('click', () => { if (m.jobs?.transcribe) { toast('Wait for the transcription to finish'); return; } record(m); });
  root.querySelector('[data-delete-rec]').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete the recording?', `Frees ${media.fmtBytes(r.sizeBytes)}. ${m.transcript ? 'The transcript and minutes stay.' : ''}`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    stopPlayback();
    setRecording(m.id, null);
    toast('Recording deleted');
  });
}

/* Tap-to-seek (AC-06.3): the transcript asks the player to start at a
   segment; the player reports its position so the segment can highlight. */
let timeListeners = new Set();
export function onPlayerTime(fn) { timeListeners.add(fn); return () => timeListeners.delete(fn); }
let loader = null;   // set by bindSaved: loads the current recording into the player
export async function seekTo(ms) {
  if (!player && loader) await loader();
  if (!player) return false;
  player.audio.currentTime = ms / 1000;
  await player.audio.play().catch(() => {});
  return true;
}
