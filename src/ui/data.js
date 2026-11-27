/* Settings › Data (PRD 1.7.0 §06): the section with its three rows, the
   "Import and export" sheet, and the two pages under Settings that the
   rows open, Backup and Remembered imports.

   A page under Settings is still the Settings screen (UI.screen stays
   'settings'): UI.settingsPage says which page is drawn in its place. So
   the sidebar, the bottom bar, the swipe to the menu and the redraw rules
   treat it as Settings, and nothing else in the app has to know it exists.

   Backup (§06.3). "Back up now" writes the backup file and notes when.
   "Restore a backup" replaces what is on the device, after a confirmation
   that shows what the file holds; it is switched off while signed in,
   where the account is the copy, and the page says so. A success is a
   short message; a refusal is a dialog, because it has to be read in full
   (decision 42). The pages draw everything from the store on every
   render and keep nothing in the DOM. */

import { S, UI, noteFileBackup, renameImportLayout, deleteImportLayout, restoreImportLayout, rerender } from '../store.js';
import { canImport, importFile, makeBackup, sharedBoards } from '../backup.js';
import { saveFile } from '../files.js';
import { isLegacyOrigin } from '../legal.js';
import { fmtDate, fmtClock } from '../dates.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { overlay, choiceDialog, noticeDialog, promptDialog, openMenu, toast } from './primitives.js';
import { FIELDS } from '../importer.js';
import { startImport, guideOpen, guideHTML, bindGuide } from './importguide.js';
import { bindScrollShadow } from './board.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const countLine = (c) => [plural(c.boards, 'board'), plural(c.tasks, 'task'), plural(c.notes, 'note'), plural(c.meetings, 'meeting')].join(', ');
const when = (ts) => `${fmtDate(ts, S.dateFormat)} at ${fmtClock(ts)}`;
/* a sheet or a dialog that closes leaves the keyboard's place on <body>: it goes back to the control that opened it */
const refocus = (selector) => app.querySelector(selector)?.focus({ preventScroll: true });

/* ── The section in Settings ─────────────────────────────────────────── */

/* A row that opens something is a real button: the keyboard reaches it and
   Enter and Space press it. */
const navRow = (ic, title, sub, attrs) => `
        <button type="button" class="set-row set-nav" ${attrs}>
          <span class="lrow-icon">${icon(ic, 18)}</span>
          <span class="set-text">
            <span class="set-title">${title}</span>
            <span class="set-sub set-long">${sub}</span>
          </span>
          ${icon('chevronRight', 18)}
        </button>`;

/** Not on the old address, which is for leaving: there the banner's
    "Download my data" is the one way out (decision 37). */
export function dataSectionHTML() {
  if (isLegacyOrigin()) return '';
  return `
      <span class="section-title list-label" id="settings-data">Data</span>
      <div class="card list-card">
        ${navRow('swap', 'Import and export', 'Bring in a file or send your tasks to another app.', 'data-open-transfer aria-haspopup="dialog"')}
        ${navRow('shield', 'Backup', 'Save everything in one file, or restore one.', 'data-open-page="backup"')}
        ${navRow('listDots', 'Remembered imports', "What Stack'd remembers from your imports.", 'data-open-page="remembered"')}
      </div>`;
}

export function bindDataSection() {
  app.querySelector('[data-open-transfer]')?.addEventListener('click', openTransferSheet);
  app.querySelectorAll('[data-open-page]').forEach((b) => b.addEventListener('click', () => openPage(b.dataset.openPage)));
}

/* ── Import and export: the sheet ────────────────────────────────────── */

/* Three buttons, as in Stack'd Finance. Import file opens the system's
   file picker and then the guide (ui/importguide.js). The pages behind
   Export file are built in phase 7 of 1.7.0: until then that button is shown
   switched off (decision 35), and the line under it says why. NOT FOR
   RELEASE as it is: the line and the `disabled` go when that phase lands. */
function openTransferSheet() {
  const { ov, close } = overlay(`
    <div class="sheet" role="dialog" aria-labelledby="xfer-title" aria-describedby="xfer-body">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><span class="section-title" id="xfer-title">Import and export</span></div>
      <p class="sheet-text" id="xfer-body">Bring tasks in from a file, or send them to another app.</p>
      <div class="sheet-stack">
        <button type="button" class="btn btn-secondary btn-block" data-import-file>Import file</button>
        <button type="button" class="btn btn-secondary btn-block" data-export-file disabled>Export file</button>
        <button type="button" class="btn btn-secondary btn-block" data-cancel>Cancel</button>
      </div>
      <p class="hint sheet-note">Import reads CSV, Excel, JSON and XML files. Export is being built: its button switches on in a later step of 1.7.0.</p>
    </div>`, { onClose: () => refocus('[data-open-transfer]') });
  ov.querySelector('[data-cancel]').addEventListener('click', () => close());
  /* the picker opens inside this tap, or the phone keeps it shut */
  const pick = ov.querySelector('[data-import-file]');
  pick.addEventListener('click', () => { close(); startImport(); });
  pick.focus();
}

/* ── Pages under Settings ────────────────────────────────────────────── */

const PAGES = ['backup', 'remembered', 'import'];
/* the guide is a page only while it holds a file: after a reload there is none */
const onPage = () => (!isLegacyOrigin() && PAGES.includes(UI.settingsPage) && (UI.settingsPage !== 'import' || guideOpen()) ? UI.settingsPage : null);

function openPage(name) {
  UI.settingsScroll = { area: app.querySelector('.scroll-area')?.scrollTop || 0, main: app.querySelector('.main')?.scrollTop || 0 };
  UI.settingsPage = name;
  rerender();
  app.querySelector('.sub-title')?.focus({ preventScroll: true });
}

/* Back to Settings where it was left, with the focus on the row that was pressed. */
function closePage() {
  const from = UI.settingsPage, at = UI.settingsScroll;
  UI.settingsPage = null; UI.settingsScroll = null;
  rerender();
  const put = (sel, v) => { const el = app.querySelector(sel); if (el && v) el.scrollTop = v; };
  put('.scroll-area', at?.area); put('.main', at?.main);
  app.querySelector(`[data-open-page="${from}"]`)?.focus({ preventScroll: true });
}

const pageHTML = (title, body) => `
  <div class="screen settings-screen set-page">
    <header class="page-head detail-top">
      <button class="icon-btn" data-sub-back aria-label="Back to Settings">${icon('chevronLeft')}</button>
      <span class="kicker">Settings</span>
      <span class="icon-btn-spacer" aria-hidden="true"></span>
    </header>
    <div class="scroll-area">
      <h1 class="sub-title" tabindex="-1">${title}</h1>
      ${body}
    </div>
  </div>`;

const actionRow = (ic, title, sub, button) => `
        <div class="set-row set-wrap">
          <span class="lrow-icon">${icon(ic, 18)}</span>
          <div class="set-text">
            <span class="set-title">${title}</span>
            <span class="set-sub set-long">${sub}</span>
          </div>
          ${button}
        </div>`;

function backupPageHTML() {
  /* everything about Restore asks canImport(), the same test the restore itself makes */
  const can = canImport();
  const last = S.lastFileBackupAt ? `Last backup file made on ${when(S.lastFileBackupAt)}.` : 'No backup file made on this device yet.';
  const shared = sharedBoards() ? " Shared boards are not in it either: they stay in their owner's account." : '';
  return pageHTML('Backup', `
      <div class="card list-card">
        ${actionRow('download', 'Back up now', 'One file with your boards, tasks, notes and meetings.',
          '<button type="button" class="btn btn-sm btn-secondary" data-backup-now>Back up now</button>')}
      </div>
      <p class="hint set-hint">${esc(last)} Recordings are not in the file; transcripts, minutes and actions are.${shared}</p>
      <div class="card list-card">
        ${actionRow('upload', 'Restore a backup',
          can ? 'Replaces what is on this device with what is in a backup file.' : 'Not while signed in: your account is the copy of your data.',
          `<button type="button" class="btn btn-sm btn-secondary" data-restore-pick ${can ? '' : 'disabled'}>Choose file</button>`)}
      </div>
      <p class="hint set-hint">${can
        ? 'You see what the file holds and confirm before anything changes.'
        : 'To restore a file anyway: sign out and choose Keep a copy, restore the file, then sign in again. At sign-in, Merge sends the restored versions to your account and your other devices; Use my account discards them.'}</p>`);
}

/* What the guide learned (PRD §06.4): one row per file layout, with where
   its columns went. A row can be renamed or forgotten; the guide adds and
   updates them by itself. A name comes from a file, so it is escaped. */
function rememberedPageHTML() {
  const rows = S.importLayouts;
  if (!rows.length) {
    return pageHTML('Remembered imports', `
      <p class="sub-empty">Nothing remembered yet.</p>
      <p class="hint set-hint">When you import a file, Stack'd remembers your answers here, so the next file of the same kind needs fewer questions.</p>`);
  }
  const placed = (l) => FIELDS.filter(([k]) => l.mapping[k]).map(([k, label]) => `${label}: ${l.mapping[k]}`).join(' · ');
  return pageHTML('Remembered imports', `
      <div class="card list-card">
        ${rows.map((l) => `
        <div class="set-row" data-layout="${esc(l.id)}">
          <span class="lrow-icon">${icon('listDots', 18)}</span>
          <div class="set-text">
            <span class="set-title">${esc(l.name)}</span>
            <span class="set-sub set-long">${plural(l.columns, 'column')} · used ${plural(l.used, 'time')}${l.lastUsedAt ? ` · last on ${esc(fmtDate(l.lastUsedAt, S.dateFormat))}` : ''}</span>
            <span class="set-sub set-long">${esc(placed(l))}</span>
          </div>
          <div class="set-actions">
            <button type="button" class="set-btn" data-layout-more aria-label="More for ${esc(l.name)}" aria-haspopup="menu">${icon('more', 18)}</button>
          </div>
        </div>`).join('')}
      </div>
      <p class="hint set-hint">A file with the same columns arrives in the import guide with these answers filled in. They are saved with your account when you are signed in, and in a backup.</p>`);
}

function bindRemembered() {
  app.querySelectorAll('[data-layout]').forEach((row) => {
    const id = row.dataset.layout;
    const layout = S.importLayouts.find((l) => l.id === id);
    if (!layout) return;
    const back = () => refocus(`[data-layout="${CSS.escape(id)}"] [data-layout-more]`);
    row.querySelector('[data-layout-more]').addEventListener('click', (e) => openMenu(e.currentTarget, [
      { label: 'Rename', icon: 'text', onClick: async () => {
        const name = await promptDialog('Name this import', { value: layout.name, confirmLabel: 'Save' });
        if (name) renameImportLayout(id, name);
        back();
      } },
      { divider: true },
      { label: 'Forget', icon: 'trash', danger: true, onClick: () => {
        const gone = deleteImportLayout(id);
        if (gone) toast(`Forgot ${layout.name}`, { action: { label: 'Undo', onClick: () => restoreImportLayout(gone) } });
      } },
    ]));
  });
}

/** The page to draw in place of Settings, or null for Settings itself. */
export function settingsPageHTML() {
  const page = onPage();
  return page === 'backup' ? backupPageHTML() : page === 'remembered' ? rememberedPageHTML() : page === 'import' ? guideHTML() : null;
}

/** Binds the page on show. False when Settings itself is on show. */
export function bindSettingsPage() {
  if (!onPage()) return false;
  if (onPage() === 'import') { bindGuide(); return true; }
  bindRemembered();
  bindScrollShadow();
  app.querySelector('[data-sub-back]')?.addEventListener('click', closePage);
  app.querySelector('[data-backup-now]')?.addEventListener('click', backUpNow);
  app.querySelector('[data-restore-pick]')?.addEventListener('click', pickBackupFile);
  return true;
}

/* ── Backup: the two actions ─────────────────────────────────────────── */

async function backUpNow() {
  let made;
  try { made = makeBackup(); } catch (e) {
    await noticeDialog('No backup file was made', e?.code ? e.message : 'Something went wrong while making the file. Nothing was changed.');
    refocus('[data-backup-now]');
    return;
  }
  /* the time is noted only when a file really was handed over (src/files.js) */
  if (saveFile(made.blob, made.name) !== 'handed') {
    await noticeDialog('No backup file was made', 'Saving a file is not possible inside the app yet. Nothing was changed.');
    refocus('[data-backup-now]');
    return;
  }
  noteFileBackup(made.at);
  rerender();
  refocus('[data-backup-now]');
  toast('Backup file made');
}

/* The file field is made on <body> inside the tap and removed when it has
   answered: one inside #app would be replaced by any redraw while the
   system's picker is open. */
function pickBackupFile() {
  if (!canImport()) {
    rerender();   // the page was drawn before the sign-in: it now shows Restore switched off, and why
    noticeDialog('The backup was not restored', 'Sign out on this device before restoring a backup. Nothing was changed.');
    return;
  }
  document.querySelectorAll('input[data-backup-pick]').forEach((el) => el.remove());
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.dataset.backupPick = '';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => { const file = input.files?.[0]; input.remove(); if (file) runRestore(file); });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

/* The whole file is read and checked before anything is asked, because the
   question shows what it holds. Cancel has the focus, not the red button
   (decision 40). */
async function runRestore(file) {
  try {
    const done = await importFile(file, {
      confirm: async ({ counts, current, recordingsLost, exportedAt }) => (await choiceDialog(
        'Replace what is on this device?',
        `${exportedAt ? `The backup was made on ${when(exportedAt)} and holds` : 'The backup holds'} ${countLine(counts)}. It replaces the ${countLine(current)} on this device, which cannot be undone. Archived and deleted items are counted.${
          recordingsLost ? ` ${plural(recordingsLost, 'recording')} on this device will be deleted with ${recordingsLost === 1 ? 'its meeting' : 'their meetings'}.` : ''}`,
        [{ id: 'replace', label: 'Replace', danger: true }],
      )) === 'replace',
    });
    if (done) toast('Backup restored');
  } catch (e) {
    if (e?.code === 'signed_in') rerender();
    await noticeDialog('The backup was not restored', e?.code ? e.message : 'The file could not be read. Nothing was changed.');
  }
  refocus('[data-restore-pick]');
}
