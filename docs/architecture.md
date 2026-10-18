# Technical Architecture: Stack'd Minimalist

Implements two PRDs: `docs/prd.md` (tasks, v2 — §1–§8, shipped in 1.1.0 →
1.3.0) and `docs/prd-notes.md` (Notes, 1.4.0 — §9 onwards). Structural code
only (schemas, interfaces, module layout, phases); no application logic
here. Everything in §9 builds on §1–§8 without changing them; where a v2
module gains a responsibility, §9 says so and the v2 section stays as the
record of what was built.

---

## 1. Tech Stack Overview

**Frontend:** vanilla JavaScript (ES2022) loaded as native ES modules
(`<script type="module">`), no bundler, no framework.
**Styling:** CSS custom properties; tokens ported from Stack'd Finance
(`../Stackd/src/styles/variables.css`), self-hosted Inter + Manrope.
**Persistence:** `localStorage`, single JSON document under key `stackd-v2`.
**Offline / install:** existing service worker (`sw.js`) and manifest.
**Native:** existing Capacitor wrapper; `@capacitor/local-notifications` only
if US-10 is scheduled.
**State management:** one mutable state object `S` + transient `UI` object,
full re-render on change (as today). Kept deliberately: the app is small and
the re-render model is already proven with the gestures.

Why keep it this simple: the whole app is < 1 000 lines today; a framework or
build step would cost more than the features. Splitting into modules is the
one structural change, so that each phase edits one or two files and an AI
engineer never has to hold the whole app in context.

---

## 2. System Architecture

```
index.html ─ loads styles/*.css, fonts, app.js (module); from file:// it
             falls back to app.bundle.js (esbuild, `npm run bundle`)
app.js ───── boot: migrate → purgeDeleted → render; media-query + global click
             listeners; routes UI.screen to a screen module
src/store.js ─ S / UI, load / save / migrate, selectors, every mutation
src/dates.js ─ local-time date helpers, formatting, recurrence arithmetic
src/ui/*.js ── one module per screen / overlay, each exporting html() + bind()
styles/ ────── variables (tokens) · base (reset + global) · components ·
               screens (todo-specific layouts)
sw.js ──────── unchanged behaviour, shell list extended, VERSION bumped
```

Data flow is unchanged: a UI event calls a mutation in `store.js`, which
`save()`s and calls `render()`; `render()` picks the screen from `UI.screen`
and `isDesktop`. Overlays (sheets, popovers, toasts) are appended to
`document.body` outside `#app` so a re-render underneath never destroys them.

---

## 3. Data Schema (v2)

```js
// localStorage['stackd-v2']  — one JSON document
{
  version: 2,
  onboarded: true,
  currentList: 'work',          // active board id (key name kept from v1)
  view: 'list' | 'kanban',
  sort: 'manual' | 'due' | 'priority',
  lastAuto: 1760000000000 | null,

  lists: [ { id: 'work', name: 'Work' }, … ],      // boards

  tasks: [ Task, … ],           // ONE array; status decides where a task shows
}

// Task
{
  id: 'a1b2c3d4',
  listId: 'work',               // board
  lane: 'backlog' | 'inprogress' | 'done',
  title: 'Prepare Q3 review deck',
  done: false,
  order: 12,                    // manual sort position inside the board
  priority: 'none' | 'low' | 'medium' | 'high',
  tags: ['q3'],
  subtasks: [ { id, title, done } ],

  // schedule (US-07)
  start: '2026-10-20' | null,   // local ISO date
  due: '2026-10-23' | null,
  dueTime: '23:30' | null,      // 24 h local
  recur: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly',
  reminder: null | 0 | 10 | 60 | 1440 | 2880,   // minutes before due
  reminderFiredAt: null,        // US-10 only

  // recurrence bookkeeping (US-08)
  completedCount: 0,
  lastCompletedAt: null,

  // lifecycle (US-05 / US-06)
  status: 'active' | 'archived' | 'deleted',
  archivedAt: null | 1760000000000,
  deletedAt: null | 1760000000000,
  origin: null | { listId: 'work', lane: 'inprogress', order: 12 },

  createdAt: 1760000000000,
  updatedAt: 1760000000000,
}
```

### Migration v1 → v2 (`store.migrate()`)
1. If `stackd-v2` exists → load it, done.
2. Else read `stackd-v1`; if absent → `seed()` (seed is written in v2 shape).
3. For every task: add `status: 'active'`, `start: null`, `dueTime: null`,
   `recur: 'none'`, `completedCount: 0`, `lastCompletedAt: null`,
   `archivedAt/deletedAt/origin: null`, `createdAt/updatedAt: Date.now()`.
4. Reminder label → schedule (PRD AC-07.8):
   `'None'` → `reminder: null`; `'Morning · 9:00 AM'` / `'Noon · 12:00 PM'` /
   `'Evening · 6:00 PM'` → if `due` set: `dueTime` `09:00` / `12:00` / `18:00`
   and `reminder: 0`, else `reminder: null`.
5. Write `stackd-v2`; leave `stackd-v1` untouched (rollback).

### Invariants (enforced in `store.js`, tested in Phase 2)
- Board views, counts, sorting, kanban, recurrence: `status === 'active'` only.
- `done === (lane === 'done')` for non-recurring tasks; recurring tasks are
  never `done`.
- `origin` is set on archive / soft delete, cleared on restore.
- `deletedAt + 30 × 86 400 000 < Date.now()` ⇒ removed by `purgeDeleted()`.

---

## 4. Proposed File & Folder Structure

```
Stackd Minimalist/
├─ index.html                  module script, new stylesheet links
├─ app.js                      entry: boot + router (≈ 80 lines)
├─ src/
│  ├─ store.js                 state, migrate, selectors, mutations, purge
│  ├─ dates.js                 todayISO, addDays, nextOccurrence, fmtDue, fmtRelative
│  ├─ util.js                  uid, esc, app root
│  ├─ reminders.js             reminder engine: plan, text, web firing rules, native diff (pure)
│  ├─ notify.js                permission, web clock + SW notifications, iOS LocalNotifications sync
│  └─ ui/
│     ├─ primitives.js         toast(), confirmDialog(), openMenu()
│     ├─ actions.js            archive / delete / restore / move / complete + their toasts
│     ├─ shell.js              mobile header + bottom nav + FAB, desktop sidebar
│     ├─ board.js              list rows, kanban, desktop table, gestures (moved from app.js)
│     ├─ detail.js             detail screen, field rows, ⋯ menu, inline title, read-only view
│     ├─ movecopy.js           Board/Lane sheet used by Move and Copy
│     ├─ tagpicker.js          tag picker sheet
│     ├─ schedule.js           Schedule popover: month grid + fields + validation + keyboard
│     ├─ folders.js            Archived / Deleted screens
│     ├─ addsheet.js           add-task sheet (moved from app.js)
│     └─ icons.js              inline SVG strings (Finance set: home, list, archive, trash, …)
├─ styles/
│  ├─ variables.css            Finance tokens (light + dark), trimmed to what is used
│  ├─ base.css                 reset + global (from Finance reset/global, trimmed)
│  ├─ components.css           buttons, chips, sheets, nav pill, calendar, toast
│  ├─ screens.css              board / detail / folders / onboarding layouts
│  └─ fonts.css                @font-face for the self-hosted fonts
├─ fonts/                      inter-latin(.ext).woff2, manrope-latin(.ext).woff2
├─ docs/                       prd.md, architecture.md, qa-report.md
├─ sw.js                       SHELL += src/**, styles/**, fonts/**
└─ scripts/
   ├─ build-www.mjs            ASSETS += 'src', 'styles', 'fonts'
   ├─ check-dates.mjs          date maths assertions + pinned-zone DST runs (npm run check)
   ├─ check-reminders.mjs      reminder engine assertions (npm run check)
   ├─ check-store.mjs          store reminder rules on the real store.js (npm run check)
   └─ check-shell.mjs          SHELL list ↔ files on disk (npm run check)
```

`ds.css` and `app.css` are deleted at the end of Phase 1. As built (1.1.0),
the tree matches the above; `util.js`, `actions.js`, `tagpicker.js` and the
two check scripts were added during implementation. Instead of deriving
SHELL and ASSETS from one array (risk table, §8), `check-shell.mjs` fails
`npm run check` when SHELL drifts from the files on disk; ASSETS copies
whole folders, so it cannot drift.

---

## 5. Core Interfaces & Types

```js
/** @typedef {'backlog'|'inprogress'|'done'} Lane */
/** @typedef {'none'|'low'|'medium'|'high'} Priority */
/** @typedef {'none'|'daily'|'weekly'|'monthly'|'yearly'} Recur */
/** @typedef {'active'|'archived'|'deleted'} Status */
/** @typedef {{ listId: string, lane: Lane, order: number }} Origin */
/** @typedef {{ start: string|null, due: string|null, dueTime: string|null,
 *              recur: Recur, reminder: number|null }} Schedule */

// src/store.js — public surface
export const S, UI;                               // state objects
export function migrate(): void;                  // v1 → v2, idempotent
export function save(): void;
export function purgeDeleted(now = Date.now()): number;   // returns count removed

// selectors (all filter status === 'active' unless named otherwise)
export const listById, taskById, tasksOf, openCount, sortedTasks;
export function folderTasks(status: 'archived'|'deleted'): Task[];  // newest first
export function allTags(): string[];              // active + archived, unique

// mutations — every one calls save() then render()
export function toggleDone(id): void;             // recurring → rollForward()
export function moveTask(id, listId, lane): void;
export function copyTask(id, listId, lane): Task; // returns the copy
export function archiveTask(id): Origin;          // returns snapshot for Undo
export function softDelete(id): Origin;
export function restoreTask(id): { listId, lane, fellBack: boolean };
export function deleteForever(id): void;
export function emptyDeleted(): void;
export function setSchedule(id, schedule: Schedule): void;
export function clearSchedule(id): void;
export function setPriority(id, p: Priority), setTags(id, tags), setTitle(id, title);
export function rollForward(id): { prev: Schedule & { subtasks }, next: Schedule };

// src/dates.js
export const todayISO = (): string;               // local, never toISOString()
export function addDays(iso, n), addMonths(iso, n), addYears(iso, n);   // clamped
export function nextOccurrence(due: string, recur: Recur, today = todayISO()): string;
export function isOverdue(due, dueTime, now = new Date()): boolean;
export function fmtDue(due, dueTime, { full }): { label, tone: 'overdue'|'soon'|'normal', days };
export function fmtRelative(ts): string;          // "3 days ago"
export function daysLeft(deletedAt, now): number; // 30-day countdown

// src/ui/primitives.js
export function toast(message, { action: { label, onClick }, ms = 5000 }): void;
export function confirmDialog(title, body, { danger }): Promise<boolean>;
export function openSheet(html, { onClose }): { el, close };     // mobile sheet / desktop dialog
export function openMenu(anchorEl, items: { label, danger?, onClick }[]): void;

// src/ui/schedule.js
export function openSchedule(task, { onSave(schedule), onRemove() }): void;

// src/ui/movecopy.js
export function openMoveCopy({ mode: 'move'|'copy', task, onConfirm(listId, lane) }): void;
```

Every screen module exports `html(): string` and `bind(root): void`; `app.js`
maps `UI.screen` (`'list' | 'lists' | 'detail' | 'archived' | 'deleted'`) to
the module, with `isDesktop` choosing the shell.

---

## 6. Component Inventory (new or reworked UI)

| Component | Source of styling | Used by |
|---|---|---|
| Sticky frosted header | Finance `.header-nav` / `.page-header` | board, folders |
| Bottom nav pill + FAB | Finance `.bottom-nav`, `.nav-pill`, `.nav-fab` | mobile shell |
| Segmented List ∕ Kanban | Finance `.chart-toggle-group` | header |
| Flush task row | Finance `.list-item-flush` | list, folders, detail field rows |
| Kanban card | Finance `.card` (radius 12 variant) | kanban |
| Chip (pill) | Finance `.filter-pill` sizing + semantic colour tokens | everywhere |
| Premium sheet | Finance `.modal-backdrop` / `.modal-content` / `.modal-handle` | add, move/copy, ⋯, schedule |
| Popover menu | Finance `.sortmenu` idea on Finance surface tokens | ⋯ on desktop, sort |
| Calendar grid | Finance `.calendar-*` (range, today, selected) | schedule popover |
| Toast with action | new, glass pill above the bottom nav | undo / confirmations |
| Sidebar (desktop) | Finance surface + active pill, Folders section | desktop shell |
| Disclaimer banner | Finance `.card` with warning tokens | Deleted folder |

---

## 7. Implementation Phases (the roadmap)

Each phase is a vertical slice that leaves the app working, ends with its
PRD checklist ticked, and is offered for commit before the next starts.
Estimates are focused build time, excluding review.

### Phase 0 — Module split and date hygiene · S (~2 h)
- Move `app.js` into `src/store.js`, `src/dates.js`, `src/ui/{shell,board,
  detail,addsheet,primitives}.js` with **zero behaviour change**.
- Replace the `toISOString()` date helper with local-time helpers.
- Add `src/**` to `sw.js` SHELL and `scripts/build-www.mjs`; run the
  `ios-debug` Codemagic workflow once to confirm ES modules load in the
  Capacitor shell.
- **Done when:** every existing feature in the README still works on mobile
  and desktop; `git diff --stat` shows only moves.

### Phase 1 — Design system port · M (~5 h) — PRD US-09
- `styles/variables.css`, `base.css` from Finance (trimmed), fonts copied,
  `ds.css`/`app.css` retired.
- Restyle existing screens in this order: shell (header, bottom nav + FAB,
  sidebar) → list rows → kanban → detail → add sheet → lists menu →
  onboarding → desktop table.
- Semantic chip colours; dark mode pass; reduced-motion pass.
- **Done when:** AC-09.1–09.4, 09.6, 09.8–09.10 pass; screenshots light + dark
  at 375 px and 1280 px attached to the phase summary.

### Phase 2 — Data model v2, folders, soft delete, ⋯ menu · M (~5 h) — US-03, US-05, US-06
- `migrate()`, `status`, `origin`, `purgeDeleted()`; selectors filter active.
- `toast()` with Undo, `confirmDialog()`, `openMenu()`.
- Archive / soft delete / restore / delete forever / empty folder mutations.
- `folders.js` screens with disclaimer and countdown; Folders section in
  sidebar, Boards menu and bottom nav.
- ⋯ button + menu in detail (Move/Copy items wired in Phase 3).
- **Done when:** AC-03.*, AC-05.*, AC-06.* pass; a copied v1 localStorage
  document migrates with all 15 seed tasks intact.

### Phase 3 — Detail fields, Move, Copy · M (~4 h) — US-01, US-02, US-04
- Field rows in `detail.js`; inline priority chips; tag chips with add/remove
  and suggestions; inline title edit (Should).
- `movecopy.js` sheet; `moveTask()` / `copyTask()`; toasts.
- **Done when:** AC-01.1–01.4 (+01.5), AC-02.*, AC-04.* pass.

### Phase 4 — Schedule popover and recurrence · L (~7 h) — US-07, US-08
- `schedule.js`: month grid with range highlight, start/due/time, repeat,
  reminder, validation, Save/Remove; `setSchedule()` / `clearSchedule()`.
- `nextOccurrence()` with month/year clamping and skip-to-future; unit-style
  checks run from a small `scripts/check-dates.mjs` (node, no framework).
- `rollForward()` wired into every completion path incl. kanban drag and
  Move-to-Done; completion flash + Undo toast.
- Chips show time and ↻; "Starts …" in detail; add sheet "Pick date…" opens
  the popover (Should).
- **Done when:** AC-07.1–07.6 (+07.7), AC-07.8 migration, AC-08.* pass.

### Phase 5 — QA and release · S (~2 h)
- Walk `docs/prd.md` as QA (agents/qa_tester.md) on Chrome 375 px + 1280 px,
  light + dark; fix findings.
- Update README (features, files, vocabulary), bump `VERSION` in `sw.js`,
  commit, push `main` → GitHub Pages; tag `v1.1.0` if TestFlight is wanted.

### Phase 6 — Reminder notifications · M (~4 h) — optional, US-10
- Web timer + Notification API; `@capacitor/local-notifications` on native;
  permission prompt only when the first reminder is saved.
- **As built (1.2.0):** pure engine in `src/reminders.js`, device side in
  `src/notify.js`, wired through a `setAfterCommit` hook in the store (which
  never re-renders). Web: one tab holds a Web Lock and checks every 60 s and
  on focus; notifications go through the service worker; each occurrence is
  recorded in `reminderFiredAt` plus a cross-tab ledger. Native: the plugin
  object iOS injects (`window.Capacitor.Plugins.LocalNotifications`) — no
  `@capacitor/core` import — reconciled against `getPending()`, future
  reminders only, soonest 60, cancels even without permission, schedules only
  with it. `armReminder` decides when a reminder is armed or already used.
  Codemagic now adds the iOS platform with CocoaPods to match its pipeline.

Order rationale: the design port comes before the new screens so every new
component is built once, in the final style; the data model comes before the
field editing so Move/Copy/Archive share one set of mutations; the calendar
is last because it is the largest and most self-contained piece.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Date shift bug from `toISOString()` (UTC) in UTC+ timezones | Phase 0 replaces it everywhere; `check-dates.mjs` covers month-end and DST days. |
| Gesture conflicts: single tap (detail) vs double tap (complete) vs new bottom nav | Nav lives outside the row hit areas; keep the 260 ms tap timer; test on a real phone in Phase 1. |
| ES modules under Capacitor iOS custom scheme | Verify with `ios-debug` in Phase 0 before any feature work. |
| Stale service-worker shell after adding files | SHELL list is derived from the same array as `build-www.mjs` ASSETS (single source), VERSION bump in Phase 5. |
| Recurring task dragged to Done feels like a "snap back" bug | Toast explains the roll-forward; AC-08.4 is tested explicitly. |
| Finance CSS is 2 000+ lines; porting it wholesale bloats the app | Port tokens fully, components selectively (inventory in §6); target ≤ 900 lines of CSS total. |
| Undo window (5 s) too short on mobile | Toast pauses its timer while pressed; "Undo" also available via the folders. |

---

# Part II — Notes (1.4.0)

Implements `docs/prd-notes.md`. Same stack, same state model, same render
loop; the additions are one new top-level area, two app-wide features the
area needs (search, date format), and the plumbing so that notes share the
tag pool, the folders and the design tokens with tasks.

## 9. Approach

- **Notes are a second array, not a task variant.** `S.notes` sits next to
  `S.tasks`. A note has no board, lane, schedule or priority, and a task has
  no body or colour, so one shape with optional fields would make every
  selector guard on `kind`. Two arrays, one set of lifecycle helpers.
- **One editor for the composer and the detail.** `noteeditor.js` renders
  title / body / checklist / chips / Format row in a `mode` and is bound by
  both screens, so the two never drift.
- **Body is a sanitised HTML subset from day one.** The body field is a
  `contenteditable` region in Phase 7 with a whitelist of `br` only, and the
  whitelist widens to `b i u s` in Phase 12. Starting with a `textarea` and
  swapping later would rewrite the composer, the detail, search and the
  previews.
- **Everything that can be pure is pure.** `richtext.js`, `search.js`
  matching, the date formatter and the notes selectors have no DOM
  dependency, so `npm run check` covers them under Node like `dates.js`.
- **Search and date format are app features.** They land as shared modules
  used by both halves, not as notes-only code that boards copy later.

---

## 10. Data Schema additions (still `stackd-v2`, no migration)

```js
// localStorage['stackd-v2'] — new top-level fields, added by withSettings()
{
  …,                                   // everything from §3 unchanged
  notes: [ Note, … ],                  // ??= []
  notesSort: 'created-desc',           // ??= ; 'manual' | 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc'
  dateFormat: 'dmy',                   // ??= defaultDateFormat(navigator.language); 'dmy' | 'mdy' | 'ymd'
}

// Note
{
  id: 'f3a9c1d2',
  order: -12,                          // manual position, ascending; a new note takes min(order) − 1
  title: 'Weekly sync',                // plain text, single line
  body: 'Agenda:<br>• budget <b>Q4</b>',   // sanitised HTML subset: text, <br>, <b>, <i>, <u>, <s>
  color: null | 'red'|'amber'|'green'|'blue'|'violet'|'gray',
  tags: ['meeting'],                   // normalizeTags(), shared pool with tasks
  checklist: null | [ { id, text, done } ],   // null = no checklist section; [] = section shown, empty
  status: 'active' | 'archived' | 'deleted',
  archivedAt: null | 1760000000000,
  deletedAt: null | 1760000000000,
  createdAt: 1760000000000,
  updatedAt: 1760000000000,            // bumped by every saved edit, including (un)ticking an item
}

// localStorage['stackd-note-draft'] — the composer draft, written on every
// keystroke (debounced 300 ms), separate so the main document is not
// rewritten while typing and a crash never loses a half-written note.
{ title: '', body: '', color: null, tags: [], checklist: null, savedAt: 1760000000000 }
```

### Transient UI state additions (`UI`, not persisted)

```js
UI.screen: 'lists' | 'list' | 'detail' | 'folders' | 'settings' | 'notes' | 'note'
UI.detailId     // task id on 'detail', note id on 'note'
UI.folderKind   // 'tasks' | 'notes' — which segment the Folders screen shows
UI.composer     // { expanded: false, formatOpen: false }
UI.query        // '' — search text of the current screen; cleared on screen or board change
UI.tagFilter    // null | 'meeting' — Notes only
UI.searchOpen   // false — mobile: the field is expanded from its icon
```

### Invariants (enforced in `store.js`, tested in `check-store.mjs`)
- Notes list, counts, sort, search, tag suggestions: `status === 'active'`
  only; `allTags()` and `tagUseCount()` read tasks **and** notes, both
  `status !== 'deleted'`.
- `order` is unique among active notes; `reorderNote()` renumbers the
  active set 0…n−1; `addNote()` takes `min(order) − 1`; archive / delete
  never renumber; restore keeps the stored `order`.
- `updatedAt >= createdAt`; `copyNote()` sets both to now.
- Checklist storage keeps **authoring order**; "ticked items sink" is a
  render rule (`sortedChecklist()`), so unticking lifts an item back to its
  original place without any stored position.
- `body` always passes `sanitize()` unchanged (`sanitize(body) === body`);
  `toText(body).trim() === '' && !title.trim() && !checklistHasText` ⇔ the
  note is empty ⇔ it is deleted on back (AC-04.6) / Add is disabled
  (AC-02.8).
- `purgeDeleted()`, `emptyDeleted()`, `deleteForever()` act on both arrays;
  folder counts are `tasks + notes`.

---

## 11. File & Folder Structure (delta)

```
Stackd Minimalist/
├─ app.js                      + routes 'notes' and 'note'; FAB / nav branches
├─ src/
│  ├─ store.js                 + notes state, draft persistence, selectors, mutations,
│  │                             setNotesSort, setDateFormat; labels/purge cover notes
│  ├─ dates.js                 + DATE_FORMATS, defaultDateFormat, fmtDate, fmtDateOrRelative;
│  │                             fmtDateLong / fmtRelative take a format
│  ├─ richtext.js              NEW  pure: sanitize, toText, fromPlain, isEmpty, exec, stateAt
│  └─ ui/
│     ├─ notes.js              NEW  Notes screen: header (kicker, search, sort), composer, list, empty states
│     ├─ noteeditor.js         NEW  title / body / checklist / tag chips / colour popover / Format row,
│     │                             shared by composer (notes.js) and detail (notedetail.js)
│     ├─ notedetail.js         NEW  note detail screen (editable, read-only in folders), ⋯ menu
│     ├─ search.js             NEW  search field (desktop inline / mobile icon) + pure matchers
│     ├─ board.js              ~ bindReorder() generalised; task search filtering; kicker "3 of 12"
│     ├─ shell.js              ~ Notes in sidebar, pill, Boards menu; FAB context; folder counts
│     ├─ folders.js            ~ Tasks ∕ Notes segment; note rows; restore / delete for notes
│     ├─ settings.js           ~ Dates section (date format)
│     ├─ actions.js            ~ archive / delete / restore with Undo for notes
│     └─ icons.js              + note, text, palette, checklist, search, bold, italic, underline, strike
├─ styles/
│  ├─ components.css           + composer, format row, colour popover, colour bar, search field (≤ 150 lines)
│  └─ screens.css              + notes screen, note detail (≤ 100 lines)
├─ scripts/
│  ├─ check-dates.mjs          + fmtDate in the three formats, defaultDateFormat by locale
│  ├─ check-store.mjs          + notes invariants (§10)
│  └─ check-text.mjs           NEW  richtext.js sanitise / toText + search.js matching
├─ sw.js                       SHELL += src/richtext.js, src/ui/{notes,noteeditor,notedetail,search}.js;
│                              VERSION 'stackd-v1.4.0'
└─ docs/                       prd-notes.md (this release), qa-report.md (+1.4.0 section)
```

`scripts/build-www.mjs` copies whole folders, so it needs no change;
`check-shell.mjs` fails until every new file is in SHELL.

---

## 12. Core Interfaces & Types (additions)

```js
/** @typedef {null|'red'|'amber'|'green'|'blue'|'violet'|'gray'} NoteColor */
/** @typedef {{ id: string, text: string, done: boolean }} CheckItem */
/** @typedef {'manual'|'created-desc'|'created-asc'|'updated-desc'|'updated-asc'} NotesSort */
/** @typedef {'dmy'|'mdy'|'ymd'} DateFormat */
/** @typedef {{ title: string, body: string, color: NoteColor, tags: string[], checklist: CheckItem[]|null }} NoteDraft */

// src/store.js — additions
export const NOTES_SORTS, DATE_FORMATS;            // option lists with labels, for the menus
export const NOTE_DRAFT_KEY = 'stackd-note-draft';
export function blankNote(extra = {}): Note;

// selectors (active only unless named otherwise)
export const noteById = (id) => Note | undefined;  // any status
export function activeNotes(): Note[];
export function sortedNotes(sort = S.notesSort): Note[];   // manual → by order; dates → by field, ties by order
export function folderNotes(status: 'archived'|'deleted'): Note[];   // newest first, like folderTasks
export function folderCount(status): number;       // tasks + notes
export function checklistProgress(n): { done, total } | null;
export function sortedChecklist(items): CheckItem[];   // open first (authoring order), then done (authoring order)
export function noteIsEmpty(n | NoteDraft): boolean;
// allTags(), tagUseCount(name) now include notes

// draft (no commit, no render)
export function loadDraft(): NoteDraft | null;
export function saveDraft(d: NoteDraft): void;      // debounced by the caller
export function clearDraft(): void;

// mutations — every one calls commit() unless noted
export function addNote(d: NoteDraft): Note;        // order = min − 1, createdAt = updatedAt = now, clears the draft
export function updateNote(id, patch: Partial<Pick<Note,'title'|'body'|'color'|'tags'>>): void;   // touches updatedAt
export function setChecklist(id, items: CheckItem[] | null): void;   // touches
export function toggleCheckItem(id, itemId): void;  // touches (Q15)
export function reorderNote(id, beforeId | null): void;   // manual sort only; renumbers active notes
export function setNotesSort(sort: NotesSort): void;
export function copyNote(id): Note;                 // "Copy of …", checklist unticked, fresh dates, order = min − 1
export function archiveNote(id): void;
export function softDeleteNote(id): { status, archivedAt } | null;
export function returnNoteToArchive(id, archivedAt): void;
export function restoreNote(id): void;              // keeps order
export function deleteNoteForever(id): void;
export function setDateFormat(f: DateFormat): void;
// purgeDeleted(), emptyDeleted(), renameLabel(), deleteLabel() now cover notes

// src/dates.js — additions (pure; callers pass S.dateFormat)
export const DATE_FORMATS = [['dmy', 'dd/mm/yyyy'], ['mdy', 'mm/dd/yyyy'], ['ymd', 'yyyy-mm-dd']];
export function defaultDateFormat(locale = navigator.language): DateFormat;   // en-US → mdy; sv, lt, zh… → ymd; else dmy
export function fmtDate(value: isoDate | epochMs, format: DateFormat): string;   // '16/10/2026', four-digit year always
export function fmtDateOrRelative(ts, format, now = Date.now()): string;        // 'Today' | 'Yesterday' | fmtDate
export function fmtDateLong(due, dueTime, format): string;   // 'Fri · 23/10/2026 · 09:00'  (was 'Fri, Oct 23')
export function fmtRelative(ts, format, now): string;        // > 30 days → fmtDate instead of 'Oct 2'
// fmtDue() chips: unchanged ≤ 6 days (Today / Tomorrow / Fri); ≥ 7 days → fmtDate

// src/richtext.js — pure string module, tokenizer-based (no DOM), so Node can test it
export const ALLOWED_TAGS: string[];                // Phase 7: ['br']; Phase 12: ['br','b','i','u','s']
export function sanitize(html: string): string;     // keeps ALLOWED_TAGS; maps strong→b, em→i, strike/del→s,
                                                    // div/p boundaries → <br>; drops every attribute and other tag;
                                                    // collapses trailing <br>s; idempotent
export function fromPlain(text: string): string;    // escape + '\n' → <br>
export function toText(html: string): string;       // inverse: tags dropped, <br> → '\n', entities decoded
export function isEmpty(html: string): boolean;     // toText(html).trim() === ''
export const SHORTCUTS = { 'ctrl+b': 'bold', 'ctrl+i': 'italic', 'ctrl+u': 'underline', 'ctrl+shift+x': 'strikeThrough' };
export function exec(cmd: 'bold'|'italic'|'underline'|'strikeThrough'): void;   // execCommand wrapper, swappable
export function stateAt(): { bold, italic, underline, strike: boolean };          // for aria-pressed on the Format row

// src/ui/search.js
export function searchBarHTML({ placeholder, value, collapsed }): string;   // desktop: inline field; mobile: icon → field
export function bindSearchBar(root, { onChange(query), onClear() }): void;  // debounced 150 ms, Esc clears, '/' focuses (desktop)
export function normalize(s: string): string;        // lower-case, accents stripped (NFD), for matching
export function matches(query, fields: string[]): boolean;
export function filterTasks(tasks: Task[], query): Task[];   // title, tags, subtask titles
export function filterNotes(notes: Note[], query, tag): Note[];   // title, toText(body), checklist text, tags; AND with tag

// src/ui/noteeditor.js — one component, two modes
export function editorHTML(value: NoteDraft | Note, {
  mode: 'composer' | 'detail', expanded, formatOpen, readOnly,
}): string;
export function bindEditor(root, {
  get(): NoteDraft | Note,
  set(patch): void,                 // composer: saveDraft; detail: updateNote / setChecklist (debounced 500 ms)
  onAdd(): void,                    // composer only: Ctrl/⌘+Enter and the Add button
  onCollapse(): void,               // composer only: Esc / click outside
}): { focus(field: 'title'|'body'|'checklist'): void };
export function openColorPicker(anchorEl, { color, onPick(color) }): void;   // 7 swatches, names for SR
export function colorBarHTML(color): string;     // '' when null; the 3 px inset bar (AC-06.2)

// src/ui/notes.js — screen
export function openNotes(): void;                // UI.screen = 'notes'; clears UI.query
export function notesHTML(): string;              // header (kicker, search, sort) + composer + list / empty / no-match
export function bindNotes(): void;
export function focusComposer(): void;            // FAB on the Notes screen
export function noteRowHTML(n, { dateLabel: 'Created'|'Edited' }): string;   // also used by folders.js

// src/ui/notedetail.js — screen
export function openNote(id): void;               // UI.screen = 'note'
export function noteDetailHTML(): string;         // editable; read-only + Restore/Delete when not active
export function bindNoteDetail(): void;

// src/ui/board.js — generalised reorder (task callers adapted, behaviour unchanged)
export function bindReorder(dragEl, rowEl, {
  rowSel: string,
  enabled(): boolean,               // tasks: S.sort === 'manual' && !task.done && !UI.query
  onDrop(beforeId: string | null): void,   // tasks: reorderTask; notes: reorderNote
}): void;

// src/ui/shell.js — additions
// sidebar: Notes item (activeNotes().length) between Boards and Folders
// mobile pill: Boards · Tasks · Notes · Folders; FAB → openSheet() or focusComposer()
// folderEntries(): count = folderCount(status)
```

Routing: `app.js` and `desktopHTML()` map `'notes'` → `notes.js` and
`'note'` → `notedetail.js`; the mobile nav is hidden on `'note'` as on
`'detail'`; `inFolders` (desktop sidebar highlight) is true for a `'note'`
whose status is not active. `UI.query` and `UI.tagFilter` are reset by
`openNotes()`, by board switches and by `openFolder()`.

---

## 13. Component Inventory (additions)

| Component | Source of styling | Used by |
|---|---|---|
| Composer card (collapsed / expanded) | Finance `.card` + elevated shadow when expanded; spring height transition | notes |
| Editor toolbar + Format row | `.icon-btn` row, `aria-pressed` toggles, Finance `.filter-pill` sizing | composer, note detail |
| Colour popover | Popover menu (§6) with 7 round swatches on the `-text` tokens | composer, note detail |
| Colour bar | new `.cbar`: 3 px, radius 999, inset 4 px, absolutely positioned in the row padding | note rows, composer, note detail, folder rows |
| Note row | Flush task row (§6) + `.cbar`, tag chips, checklist indicator, right-aligned date | notes list, folders |
| Checklist (editable) | Detail subtask rows (§6) with Enter / Backspace keyboard model | composer, note detail |
| Search field | Finance input on surface; mobile: `.icon-btn` that expands to full width | notes, board header |
| Sort menu | existing `.sortmenu` (§6) with five options | notes header |
| Tasks ∕ Notes segment | existing `.segmented` (folders tabs) | folders |
| Dates segmented control | existing `.segmented.solid` (Settings theme row) | settings |

---

## 14. Implementation Phases (the roadmap, continued)

Numbering continues from §7. Same rules: each phase is a vertical slice
that leaves the app working, ends with its acceptance criteria ticked in
`docs/prd-notes.md`, `npm run check` green, `npm run bundle` run, and is
offered for commit before the next starts. Estimates are focused build
time.

### Phase 7 — Store, Notes screen, composer, list · L (~7 h) — US-01, US-02, US-03, US-06
- `store.js`: `withSettings()` defaults (`notes`, `notesSort`,
  `dateFormat` via `defaultDateFormat()`), `blankNote`, draft
  load/save/clear, `activeNotes`, `sortedNotes` (all five sorts: cheap to
  include now, the UI comes in Phase 9), `checklistProgress`,
  `sortedChecklist`, `noteIsEmpty`, `addNote`; `allTags` / `tagUseCount`
  include notes.
- `dates.js`: `DATE_FORMATS`, `defaultDateFormat`, `fmtDate`,
  `fmtDateOrRelative` (used by the row date from day one; the Settings UI
  waits for Phase 11).
- `richtext.js` with `ALLOWED_TAGS = ['br']`, `sanitize`, `fromPlain`,
  `toText`, `isEmpty`; paste handler in the editor goes through
  `sanitize()`.
- `noteeditor.js` in composer mode: collapsed / expanded, Title, body,
  checklist editing, tag picker (reuse `openTagPicker`), colour popover,
  colour bar, Add (disabled while empty), Ctrl/⌘+Enter, Esc, Tab order,
  click-outside keeps the draft, "Draft: …" preview, mobile keyboard
  handling.
- `notes.js`: header with kicker and the sort button placeholder, composer,
  list rows (`noteRowHTML`: bar, title or body fallback, chips + "+n",
  checklist "2/5", date following the sort), preview line, empty state.
- `shell.js` / `app.js`: Notes in sidebar, pill, Boards menu; routes;
  context-aware FAB. `icons.js`: note, text, palette, checklist. CSS for
  the composer, bar, row. SHELL entries.
- Checks: `check-store.mjs` (defaults, addNote order, draft key, tags
  include notes), `check-dates.mjs` (fmtDate × 3, defaultDateFormat),
  `check-text.mjs` (sanitize br-only, toText, isEmpty).
- **Done when:** AC-01.1–01.5, AC-02.1–02.3, AC-02.5–02.11, AC-03.1–03.5,
  AC-03.7–03.8, AC-06.1–06.4 (for composer and rows) pass; a 1.3.0 store
  opens with an empty Notes list and a locale-derived date format.

### Phase 8 — Note detail, folders, labels · M (~5 h) — US-04, US-05
- `notedetail.js`: editor in detail mode with autosave (blur / 500 ms /
  back), colour bar on the content block, tags + colour row, "Created ·
  Edited" footer, ⋯ menu (Copy · Archive · Delete), empty-on-back delete,
  read-only variant with Restore / Delete (forever).
- `store.js`: `updateNote`, `setChecklist`, `toggleCheckItem`, `copyNote`,
  `archiveNote`, `softDeleteNote`, `returnNoteToArchive`, `restoreNote`,
  `deleteNoteForever`, `folderNotes`, `folderCount`; `purgeDeleted` /
  `emptyDeleted` / `renameLabel` / `deleteLabel` cover notes.
- `actions.js`: note variants of archive / delete / restore with the same
  Undo toasts. `folders.js`: Tasks ∕ Notes segment (`UI.folderKind`), note
  rows via `noteRowHTML`, counts = tasks + notes in sidebar and Boards menu.
  `settings.js` label counts include notes.
- Checks: `check-store.mjs` (updatedAt bumps on tick, copy, restore keeps
  order, purge and label rename reach notes).
- **Done when:** AC-04.1–04.6 (04.4 without the Format row), AC-05.1–05.5,
  AC-06.2–06.3 on the detail pass.

### Phase 9 — Sort and manual order · S (~3 h) — US-07
- `notes.js`: sort button + five-option menu (reuse the board's
  `.sortwrap` / `.sortmenu` and the global click-outside in `app.js`),
  persisted `S.notesSort`, "on" state when not default; row date label
  follows the sort.
- `board.js`: `bindReorder()` generalised to `{ rowSel, enabled, onDrop }`;
  task callers adapted with no behaviour change. `store.js`:
  `reorderNote`, `setNotesSort`; manual order kept across other sorts;
  restore keeps `order`.
- Checks: `check-store.mjs` (sortedNotes for each sort, reorder renumbering,
  new note first in manual).
- **Done when:** AC-07.1–07.4 pass and every task drag path in the v2 QA
  report still works (regression walk of list + desktop table reorder).

### Phase 10 — Search: notes, then boards · M (~4 h) — US-08, AC-03.6
- `search.js`: field component (desktop inline, mobile icon → full width),
  `normalize`, `matches`, `filterTasks`, `filterNotes`; `UI.query`,
  `UI.tagFilter`, `UI.searchOpen`; cleared on screen / board change; Esc
  and `/`.
- `notes.js`: field under the kicker, tag-chip filter with removable chip,
  "No notes match ‹query›", drag disabled while filtered.
- `board.js`: field under each board header; list rows, kanban lanes
  ("2 of 5", empty lanes kept) and desktop table filter; kicker "3 of 12
  tasks"; row and card drag disabled while a query is active.
- Checks: `check-text.mjs` (normalize accents / case, matches across
  fields, filterNotes with tag AND query).
- **Done when:** AC-03.6, AC-08.1–08.4 pass on 375 px and 1280 px.

### Phase 11 — Date format setting, app-wide · S (~3 h) — US-09
- `settings.js`: Dates section (after Appearance) with the segmented
  control showing today in each format; `setDateFormat()`.
- Migrate every `en-US` calendar-date call to `fmtDate` /
  `fmtDateOrRelative` / `fmtDateLong(…, format)` / `fmtRelative(…, format)`:
  task detail Due / Start, Schedule popover helper line, folder rows beyond
  7 days, `fmtDue` chips from 7 days out. Native `<input type="date">`
  stays as is (PRD AC-09.3). Month header and weekday initials unchanged.
- Checks: `check-dates.mjs` (fmtDateLong / fmtRelative / fmtDue ≥ 7 days
  in each format).
- **Done when:** AC-09.1–09.5 pass; switching the format re-renders every
  screen listed in AC-09.3 without reload.

### Phase 12 — Formatting: bold / italic / underline / strikethrough · M (~4 h) — AC-02.4, AC-04.4, AC-06.4
- `richtext.js`: `ALLOWED_TAGS` widened to `br b i u s`, tag mapping
  (strong / em / strike / del / div / p), `SHORTCUTS`, `exec`, `stateAt`.
- `noteeditor.js`: Aa toggle, Format row with four `aria-pressed` buttons
  reflecting `stateAt()` on selection change, shortcuts in both modes;
  paste keeps only the four styles and line breaks; title stays an input.
- Previews, untitled fallback and search already go through `toText()`,
  so they need no change: verify.
- Checks: `check-text.mjs` (whitelist, mapping, attribute stripping,
  idempotence, nested tags, paste samples from a web page and Word).
- **Done when:** AC-02.4 and the formatting half of AC-04.4 / AC-06.4
  pass; the PRD paste metric (§06) holds in Chrome and Safari.

### Phase 13 — QA and release 1.4.0 · S (~2 h) — AC-06.5
- Walk `docs/prd-notes.md` as QA (`agents/qa_tester.md`) on Chrome 375 px +
  1280 px, light + dark, plus Safari / iOS simulator for the
  `contenteditable` and the keyboard-overlap criteria (AC-02.11); append
  the findings to `docs/qa-report.md`; fix.
- `file://` run of the bundle, PWA install, Capacitor shell smoke test.
- README (Notes, search, date format, new check script), `VERSION`
  `stackd-v1.4.0`, `npm run check`, `npm run bundle`, commit, push `main`.

Order rationale: the composer and list are the product (Phase 7) and need
the data layer, so they come first; the detail and folders (8) complete
the note lifecycle before any list-level feature; sort (9) precedes search
(10) because search must respect the active sort and disable manual drag;
the date format (11) waits until every date-writing surface exists so the
migration is done once; formatting (12) is last because it is the only
piece that can be dropped without leaving a hole, and its tokenizer is the
riskiest code in the release.

---

## 15. Acceptance criteria → phase

| PRD criterion | Phase |
|---|---|
| AC-01.1 – 01.5 | 7 |
| AC-02.1 – 02.3, 02.5 – 02.11 | 7 |
| AC-02.4 | 12 |
| AC-03.1 – 03.5, 03.7, 03.8 | 7 |
| AC-03.6 | 10 |
| AC-04.1 – 04.6 | 8 (04.4 formatting part: 12) |
| AC-05.1 – 05.5 | 8 |
| AC-06.1 – 06.4 | 7 (composer, rows), 8 (detail), 12 (Format row a11y) |
| AC-06.5 | 13 |
| AC-07.1 – 07.4 | 9 |
| AC-08.1 – 08.4 | 10 |
| AC-09.1, 09.3 – 09.5 | 11 |
| AC-09.2 | 7 (store default), 11 (visible in Settings) |

---

## 16. Risks and Mitigations (1.4.0)

| Risk | Mitigation |
|---|---|
| `contenteditable` lets arbitrary HTML into `body` (paste, drag-in, browser auto-formatting) | `sanitize()` runs on paste, on every save and on load; invariant `sanitize(body) === body` checked in `check-store.mjs`; tokenizer whitelist, never `innerHTML` round-trips of untrusted markup. |
| `document.execCommand` is deprecated | Used only for the four inline toggles through `exec()` in `richtext.js`; one place to swap for a Selection/Range implementation later. Verified in Chrome, Safari and iOS WebKit in Phase 12. |
| iOS keyboard covers the toolbar / Add in the composer | Composer card scrolls inside `.scroll-area`; `visualViewport` resize keeps the toolbar in view; bottom nav hidden while expanded; tested on the simulator in Phase 13. |
| Two drag implementations drift (tasks vs notes) | One `bindReorder()` with callbacks (Phase 9), task regression walk in the same phase. |
| Native `<input type="date">` ignores the date format | Documented exemption (PRD AC-09.3); the calendar grid is the primary picker and the helper line below it follows the setting. |
| Service-worker shell drift with five new files | `check-shell.mjs` fails the build until SHELL is complete; VERSION bump in Phase 13. |
| Draft and notes written from two tabs overwrite each other | The draft key is per tab-session semantics anyway (last writer wins, acceptable); notes go through the existing single-document `save()`; no new cross-tab surface. |
| Manual `order` collisions after restore (old `order` already reused) | `restoreNote()` keeps the stored `order`; ties break by `createdAt`; `reorderNote()` renumbers on the next drag. |
| Search on 500 notes re-filters on every keystroke | 150 ms debounce; `toText()` of a body is memoised per render; plain `Array.filter` is sufficient at this size (measured in Phase 10, threshold in PRD AC-03.8). |
| Accent-insensitive matching differs between engines | `normalize()` uses `String.prototype.normalize('NFD')` + combining-mark strip, asserted in `check-text.mjs`. |

---

## 17. Checks added to `npm run check`

| Script | Covers |
|---|---|
| `scripts/check-text.mjs` (new) | `richtext.js`: whitelist, tag mapping, attribute stripping, idempotence, `toText` / `fromPlain` round trip, paste samples. `search.js`: `normalize`, `matches`, `filterTasks`, `filterNotes`. |
| `scripts/check-dates.mjs` (extended) | `fmtDate` in `dmy` / `mdy` / `ymd`, `defaultDateFormat` for `en-US`, `pt-PT`, `sv-SE`, `ja-JP`; `fmtDateLong`, `fmtRelative`, `fmtDue` ≥ 7 days per format. |
| `scripts/check-store.mjs` (extended) | §10 invariants: defaults on an old store, `addNote` order, draft key round trip, `updatedAt` on tick, `sortedNotes` per sort, `reorderNote`, `copyNote`, restore keeps order, purge / empty / label rename and delete reach notes, `sanitize(body) === body`. |
| `scripts/check-shell.mjs` (unchanged) | Fails until the five new files are in SHELL. |
