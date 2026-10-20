/* Meetings screen (PRD-meetings US-01, US-02): the board-style header with
   kicker, search and sort, then the flat list of meetings, each row with a
   status line of chips saying how far it got. The + FAB creates a meeting
   and opens it (AC-01.4). */

import {
  S, UI, isDesktop, MEETINGS_SORTS, sortedMeetings, activeMeetings, meetingTitle, actionCounts,
  setMeetingsSort, newMeeting, rerender,
} from '../store.js';
import { fmtDateOrRelative, fmtDuration } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { bindScrollShadow } from './board.js';
import { filterMeetings } from '../search.js';
import { queryFor, searchOpen, searchToggleHTML, searchFieldHTML, bindSearch } from './search.js';
import { openMeeting } from './meeting.js';

export function openMeetings() {
  UI.screen = 'meetings'; UI.query = ''; UI.sortMenu = false;
  rerender();
}

/** The + FAB on the Meetings screen (AC-01.4). */
export function addMeeting() { newMeeting(); }

/* ── Markup ──────────────────────────────────────────────────────────── */

/** Status chips (AC-02.2, AC-02.3): only the ones that apply. Shared with the folders. */
export function meetingChipsHTML(m) {
  const chips = [];
  if (m.recording) chips.push(`<span class="tag"><span aria-hidden="true">${icon('mic', 12)}</span>${fmtDuration(m.recording.durationMs)}</span>`);
  if (m.jobs?.transcribe) chips.push('<span class="tag working">Transcribing…</span>');
  else if (m.transcript) chips.push('<span class="tag">Transcript</span>');
  if (m.jobs?.summarise) chips.push('<span class="tag working">Summarising…</span>');
  else if (m.minutes) chips.push('<span class="tag">Minutes</span>');
  const { proposed, added } = actionCounts(m);
  if (proposed) chips.push(`<span class="tag">${proposed} action${proposed === 1 ? '' : 's'}</span>`);
  else if (added) chips.push(`<span class="tag tag-done">${added} added</span>`);
  if (m.lastError && !m.jobs?.transcribe && !m.jobs?.summarise) chips.push('<span class="tag tag-soon">Failed</span>');
  return chips.length ? `<div class="t-meta mchips">${chips.join('')}</div>` : '';
}

/** One list row: title, status line, date on the right (AC-02.2). */
export function meetingRowHTML(m) {
  const title = meetingTitle(m);
  const when = fmtDateOrRelative(m.createdAt, S.dateFormat);
  return `
  <div class="row nrow mrow" data-id="${m.id}" role="button" tabindex="0" aria-label="${esc(title)}">
    <div class="t-main">
      <div class="nrow-line">
        <span class="t-title ${m.title.trim() ? '' : 'untitled'}">${esc(title)}</span>
        <span class="nrow-date num">${esc(when)}</span>
      </div>
      ${meetingChipsHTML(m)}
    </div>
  </div>`;
}

/* ── Sort (AC-02.5) ──────────────────────────────────────────────────── */

const DEFAULT_SORT = 'created-desc';
const SHORT = Object.fromEntries(MEETINGS_SORTS);

function sortbarHTML() {
  return `
  <div class="viewbar notes-bar ${searchOpen() ? 'searching' : ''}">
    ${searchFieldHTML({ placeholder: 'Search meetings' })}
    <span class="sortwrap">
      <button class="sortbtn ${S.meetingsSort !== DEFAULT_SORT ? 'on' : ''}" data-sortbtn aria-haspopup="menu" aria-expanded="${UI.sortMenu}">${icon('sort')}${SHORT[S.meetingsSort]}</button>
      ${UI.sortMenu ? `
      <div class="sortmenu" role="menu">
        ${MEETINGS_SORTS.map(([v, label]) => `<button role="menuitemradio" aria-checked="${S.meetingsSort === v}" data-meetings-sort="${v}" class="${S.meetingsSort === v ? 'active' : ''}">${label}</button>`).join('')}
      </div>` : ''}
    </span>
    ${isDesktop.matches ? `<button class="btn btn-primary btn-sm" data-new-meeting>${icon('plus', 18)}New meeting</button>` : ''}
  </div>`;
}

function bindSortbar() {
  app.querySelector('[data-new-meeting]')?.addEventListener('click', addMeeting);   // desktop has no FAB
  app.querySelector('[data-sortbtn]')?.addEventListener('click', () => { UI.sortMenu = !UI.sortMenu; rerender(); });
  app.querySelectorAll('[data-meetings-sort]').forEach((b) =>
    b.addEventListener('click', () => { UI.sortMenu = false; setMeetingsSort(b.dataset.meetingsSort); rerender(); }));
}

/* ── Screen ──────────────────────────────────────────────────────────── */

export function meetingsHTML() {
  queryFor('meetings');
  const all = sortedMeetings();
  const total = all.length;
  const meetings = UI.query ? filterMeetings(all, UI.query, meetingTitle) : all;
  const kicker = !total ? 'No meetings'
    : UI.query ? `${meetings.length} of ${total} meeting${total === 1 ? '' : 's'}`
    : `${total} meeting${total === 1 ? '' : 's'}`;
  const empty = !total ? 'No meetings yet. Tap + to record one or paste a transcript.'
    : `No meetings match “${esc(UI.query)}”.`;
  return `
  <div class="screen meetings-screen">
    <header class="page-head">
      <div class="page-title-row">
        <h1 class="page-title-text">Meetings</h1>
        <span class="head-right"><span class="kicker">${kicker}</span>${searchToggleHTML()}</span>
      </div>
      ${sortbarHTML()}
    </header>
    <div class="scroll-area">
      ${meetings.length
        ? `<div class="card list-card" role="list">${meetings.map(meetingRowHTML).join('')}</div>`
        : `<p class="empty">${empty}</p>`}
    </div>
  </div>`;
}

export function bindMeetings() {
  bindScrollShadow();
  bindSortbar();
  bindSearch(app);
  app.querySelectorAll('.mrow').forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener('click', () => openMeeting(id));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMeeting(id); } });
  });
}

/** Sidebar / Boards-menu count. */
export const meetingCount = () => activeMeetings().length;
