# Technical Architecture: Stack'd Minimalist

Implements four PRDs: `docs/prd.md` (tasks, v2 — §1–§8, shipped in 1.1.0
→ 1.3.0), `docs/prd-notes.md` (Notes, 1.4.0 — §9–§17, shipped),
`docs/prd-meetings.md` (Meetings and paid plans, 1.5.0 — §18–§27) and
`docs/prd-accounts.md` (Accounts and sync, 1.6.0 — §28 onwards, planned).
Structural code only (schemas, interfaces, module layout, phases); no
application logic here. Each part builds on the ones before without
changing them; where an earlier module gains a responsibility, the later
part says so and the earlier section stays as the record of what was
built.

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

**As built (1.4.0, 2026-10-18):** Phases 7–13 shipped in seven commits on
`main`, one per phase, in the order below. Departures from the plan: the
search matcher lives in `src/search.js` (pure) with the field in
`src/ui/search.js`, so `check-text.mjs` can import it; the date format is a
module-level default in `dates.js` set by the store, so no caller takes a
format parameter; and the body was a `contenteditable` from Phase 7 with a
`br`-only whitelist, widened in Phase 12 as planned. QA results and the two
criteria that still need a device are in `docs/qa-report.md`.

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

---

# Part III — Meetings and paid plans (1.5.0, `docs/prd-meetings.md`)

## 18. Approach

- **Meetings are a third array with a linear lifecycle.** `S.meetings`
  sits next to `S.tasks` and `S.notes`. A meeting is a record that fills
  in from the top (recording → transcript → minutes → actions) and the
  detail screen renders exactly the blocks that exist plus the next
  button, so the UI never needs a state machine beyond "which fields are
  non-null".
- **Audio never enters `S`.** Recordings are blobs in an IndexedDB
  database of their own (`stackd-media`), addressed by a key the meeting
  stores. `localStorage` stays a few hundred KB; a 30-minute recording is
  about 11 MB. `media.js` is the only module that touches IndexedDB.
- **The proxy is the only thing that spends money, so it is the only
  thing that counts.** Entitlement and allowance live server-side in
  Workers KV keyed by subscriber id; the app caches what the proxy
  returns for display and never decides on its own whether a step is
  allowed. A Free user is refused before any provider is called.
- **Jobs are persisted, not awaited.** Transcribe and Summarise return a
  job id that is written to the meeting; a single `ai.js` poller resumes
  every open job on app start and on `resume`, so leaving the screen,
  the app or the phone's lock does not lose a result.
- **Reuse the gestures and sheets that exist.** The swipe code in
  `board.js` grows a right-hand action; the Move / Copy sheet and the
  add-task sheet grow options. No second swipe implementation, no second
  board picker, no second task form.
- **Native only where the web platform cannot.** The recorder is
  `MediaRecorder` everywhere; the shells add a background-audio mode
  (iOS) and a foreground service (Android) around it. Purchases are the
  one place a plugin is unavoidable, and it is reached the way haptics
  and notifications are: through the bridge-injected
  `globalThis.Capacitor.Plugins`, guarded so the web build simply shows
  the Free variant.
- **Pure where possible, so Node can test it.** `transcript.js` (parsers,
  merge, serialisation), the allowance maths, the proxy's schema
  validation and the job-state reducer have no DOM or network dependency
  and are covered by `npm run check`.

---

## 19. Data Schema additions (still `stackd-v2`, no migration)

```js
// localStorage['stackd-v2'] — new top-level fields, added by withSettings()
{
  …,                                   // everything from §3 and §10 unchanged
  meetings: [ Meeting, … ],            // ??= []
  meetingsSort: 'created-desc',        // ??= ; 'created-desc' | 'created-asc' | 'title-asc'
  ai: {                                // ??= { proxyUrl: null, disclosed: false, consented: false }
    proxyUrl: null | 'https://…',      // Settings › Developer override; null = PROXY_URL constant
    disclosed: false,                  // AC-05.6 one-time dialog shown
    consented: false,                  // AC-04.1 one-time dialog shown
  },
  plan: {                              // ??= { tier: 'free', subscriberId: uid(), … }; cache of the proxy's truth
    tier: 'free' | 'plus' | 'pro' | 'max',
    subscriberId: 'a1b2…',             // generated once; handed to RevenueCat as the app user id
    renewsAt: null | 1760000000000,    // current period end (pool reset)
    audioSecondsLeft: 0, audioSecondsTotal: 0,
    summariesLeft: 0, summariesTotal: 0,
    checkedAt: 0,                      // last successful /allowance; stale after 10 min → refetch on Settings / AI buttons
  },
}

// Meeting
{
  id: 'f3a9c1d2',
  title: 'Meeting · 20/10/2026 14:03',   // default from createdAt in S.dateFormat; editable
  createdAt: 1760000000000,
  updatedAt: 1760000000000,            // bumped by title, transcript, minutes, action and speaker edits
  recording: null | {
    key: 'rec-f3a9c1d2',               // IndexedDB key in 'stackd-media'
    mimeType: 'audio/mp4' | 'audio/webm',
    durationMs: 754000, sizeBytes: 4521000,
    recordedAt: 1760000000000,
  },
  transcript: null | {
    source: 'recording' | 'pasted' | 'file',
    fileName: null | 'teams.vtt',
    segments: [ { id, speaker: 'S1', startMs: null | 12000, text: '…' } ],   // authoring order
    speakers: { S1: null, S2: 'Marco' },   // label → user-given name (null = default "Speaker n")
    createdAt, updatedAt,              // updatedAt bumps on rename and text edit
  },
  minutes: null | {
    summary: '', decisions: [''], openQuestions: [''],
    generatedAt: 1760000000000,
    transcriptUpdatedAt: 1760000000000,   // the transcript.updatedAt it was made from; stale ⇔ transcript.updatedAt > this
  },
  actions: [ {
    id, title: '', due: null | '2026-10-24', priority: 'none' | priorityId,
    excerpt: '', status: 'proposed' | 'added' | 'dismissed', taskId: null | id,
  } ],
  jobs: {                              // open provider jobs; null when idle
    transcribe: null | { id: 'job_…', startedAt, phase: 'upload' | 'wait' },
    summarise:  null | { id: 'job_…', startedAt, phase: 'wait' },
  },
  lastError: null | { step: 'transcribe' | 'summarise', code: ErrorCode, message: '', at },
  status: 'active' | 'archived' | 'deleted',
  archivedAt: null | ms, deletedAt: null | ms,
}

// Task — one new optional field
task.from = null | { meetingId, actionId }

// IndexedDB 'stackd-media', object store 'recordings' (keyPath 'key')
{ key: 'rec-f3a9c1d2', mimeType, chunks: [ Blob, … ], durationMs, sizeBytes, updatedAt }
// chunks are appended every 5 s while recording (MediaRecorder timeslice) and
// concatenated into one Blob for playback / upload; a crash keeps the chunks.
```

### Transient UI state additions (`UI`, not persisted)

```js
UI.screen: … | 'meetings' | 'meeting'
UI.detailId     // meeting id on 'meeting'
UI.folderKind   // 'tasks' | 'notes' | 'meetings'
UI.recorder     // null | { state: 'idle'|'recording'|'stopping', startedAt, elapsedMs }   (one at a time, app-wide)
UI.player       // null | { meetingId, playing, positionMs }
UI.openCard     // action card whose swipe is open (mirrors openRow in board.js)
```

### Invariants (enforced in `store.js` and `ai.js`, tested in `check-store.mjs` / `check-ai.mjs`)
- Meetings list, counts, search: `status === 'active'` only; folder counts
  are `tasks + notes + meetings`.
- `recording`, `transcript`, `minutes` fill in that order and only that
  order: `minutes` ⇒ `transcript`; `transcript.source === 'recording'` ⇒
  `recording` existed when it was made (it may be deleted later).
- `actions.length > 0` ⇒ `minutes !== null`; an `added` action has a
  `taskId` whose task has `from.meetingId === meeting.id`; deleting that
  task forever does not touch the action (the card shows "task removed").
- `jobs.transcribe` ⇒ `recording !== null`; `jobs.summarise` ⇒
  `transcript !== null`; at most one job per step per meeting; a job
  older than 2 hours is dropped on resume with `lastError.code =
  'timeout'`.
- `minutes.transcriptUpdatedAt < transcript.updatedAt` ⇔ the stale chip.
- `S.plan.tier === 'free'` ⇒ both `*Left` are 0; the app never increments
  or decrements `*Left` itself, it only copies what the proxy returns.
- `S.ai.proxyUrl`, when set, must be `https:` (or `http://localhost…`);
  anything else is ignored.
- Deleting a meeting forever, emptying the Deleted folder and
  `purgeDeleted()` call `media.remove(key)` for every recording they drop;
  `media.js` exposes `orphans(keys)` and boot removes blobs no meeting
  references.

---

## 20. System Architecture (additions)

```
┌──────────── device ────────────┐        ┌──────── Cloudflare ────────┐
│ app (web / iOS / Android)      │  HTTPS │ proxy/ (Worker)            │
│  ui/meeting.js ─ ai.js ───────────────▶ │  POST /v1/transcribe ──────┼──▶ speech-to-text provider (async job)
│  media.js (IndexedDB blobs)    │        │  GET  /v1/transcribe/:id   │◀── poll
│  purchases.js ─ Capacitor ─────┐        │  POST /v1/summarise ───────┼──▶ Claude (structured output)
│                                │        │  GET  /v1/allowance        │
│                                │        │  POST /v1/rc-webhook ◀─────┼──── RevenueCat (renewal / refund)
└────────────────────────────────┘        │  KV: sub:{id} · pool:{id}:{period} · tester:{id} · rccache:{id}
       │ native purchase sheet            └────────────┬───────────────┘
       ▼                                               │ GET /v1/subscribers/{id}
   App Store / Google Play ──▶ RevenueCat ◀────────────┘
```

**Request contract.** Every proxy call carries `X-Stackd-App: <appToken>`
(a constant in the client, rotated by redeploy; it stops drive-by use,
not a determined attacker) and `X-Stackd-Subscriber: <subscriberId>`.
The proxy answers JSON with `{ ok: true, …, allowance }` or
`{ ok: false, code, message }`; `allowance` is always the post-call
state so the app can refresh its cache from any response.

| Endpoint | Body | Returns | Charges |
|---|---|---|---|
| `POST /v1/transcribe` | multipart: `audio` (≤ 40 MB, `audio/mp4` or `audio/webm`), `durationMs` | `{ jobId }` after the provider accepted the upload | reserves `ceil(durationMs / 60000)` minutes; refunded on provider failure |
| `GET /v1/transcribe/:jobId` | — | `{ state: 'queued'|'processing'|'done'|'error', transcript?: { segments, speakers }, code? }` | — |
| `POST /v1/summarise` | `{ transcript: { segments, speakers }, meetingDate, priorities: ['High','Medium','Low'], dateFormat }` | `{ minutes: { summary, decisions, openQuestions }, actions: [ { title, due, priority, excerpt } ] }` | 1 summary on success |
| `GET /v1/allowance` | — | `{ tier, renewsAt, audioSecondsLeft, audioSecondsTotal, summariesLeft, summariesTotal }` | — |
| `POST /v1/rc-webhook` | RevenueCat event (signed) | 204 | invalidates `rccache:{id}` |

**Error codes** (`ErrorCode`): `offline` (client-side), `unauthorized`
(bad app token), `plan_required` (Free), `allowance_exhausted` (with
`resetsAt`), `too_large`, `too_quiet` (provider found no speech),
`provider_unavailable`, `timeout`, `invalid_audio`, `bad_request`. The
app maps each to the PRD's messages (AC-05.4, AC-12.6).

**Entitlement.** `sub:{id}` is read from `rccache:{id}` (TTL 5 min) or
fetched from RevenueCat's REST API (`GET /v1/subscribers/{app_user_id}`,
secret key in a Worker secret) and reduced to `{ tier, renewsAt }` from
the active entitlement with the highest tier. `tester:{id}` entries
(config, not code) give `{ tier: 'tester' }`, which the pool logic treats
as 60 min + 10 summaries **per day**.

**Pools.** `pool:{id}:{period}` where `period` is `YYYY-MM` of
`renewsAt`'s period start for subscribers and `YYYY-MM-DD` for testers;
value `{ audioSeconds, summaries }` used so far. Limits per tier are a
config object in `proxy/src/plans.js` (Plus 8 h / 20, Pro 16 h / 50, Max
24 h / 100). Reservation on `/transcribe` is written before the provider
call and released on failure, so two parallel uploads cannot overspend.

**Providers.** The speech-to-text provider is chosen in Phase 20 (PRD
Q13) and sits behind one adapter interface (`proxy/src/stt/*.js`):
`start(audioBlob, mimeType) → providerJobId`, `poll(providerJobId) →
{ state, segments, speakers }`. Claude is called through the official
SDK with structured output (`output_config.format`, strict JSON schema),
model id from config (`claude-haiku-5-5` or `claude-sonnet-5-5` after the
Phase 16 benchmark, PRD Q15), streaming off (the output is small),
`max_tokens` 4 000. The system prompt is a frozen string in
`proxy/src/prompts.js` with `cache_control` on it.

**Deploy.** `proxy/` has its own `package.json` and `wrangler.toml`;
`.github/workflows/proxy.yml` (manual) runs `npm ci` and `wrangler deploy`
with `CLOUDFLARE_API_TOKEN` from repository secrets; provider keys, the
RevenueCat secret key and webhook secret, and the app token are Worker
secrets set once with `wrangler secret put`. The client's `PROXY_URL`
constant points at the `workers.dev` route (or a custom domain later).

---

## 21. File & Folder Structure (delta)

```
Stackd Minimalist/
├─ app.js                      + routes 'meetings' and 'meeting'; FAB branch; ai.resumeJobs() on boot/resume
├─ src/
│  ├─ store.js                 + meetings state, selectors, mutations; S.ai, S.plan; folders/purge/search cover meetings
│  ├─ media.js                 NEW  IndexedDB 'stackd-media': open, put/append chunks, get, remove, size, orphans, estimate
│  ├─ transcript.js            NEW  pure: parseVTT, parseSRT, parsePasted, parseDocx(xmlText), mergeSegments,
│  │                                speakerName, toModelText, defaultLabels
│  ├─ ai.js                    NEW  proxy client: transcribe(meeting), summarise(meeting), allowance(), resumeJobs(),
│  │                                errors → ErrorCode, upload progress, poll loop, job persistence
│  ├─ purchases.js             NEW  RevenueCat bridge: available(), configure(subscriberId), offerings(), buy(product),
│  │                                restore(), manageUrl(); web → available() === false
│  └─ ui/
│     ├─ meetings.js           NEW  Meetings screen: header (kicker, search, sort), rows with status chips, empty state
│     ├─ meeting.js            NEW  meeting detail: title, date line, block composition, ⋯ menu, read-only variant
│     ├─ recorder.js           NEW  Source / Recording block: consent + permission, MediaRecorder, level line (canvas),
│     │                             clock, 30:00 cap, chunk writes, playback + scrubber, delete / replace
│     ├─ transcriptview.js     NEW  Transcript block: segments, rename speaker, tap-to-seek, inline edit, Show all
│     ├─ minutesview.js        NEW  Minutes block: three sections, AI label, inline edit, stale chip, Regenerate
│     ├─ actioncards.js        NEW  Actions block: cards, inline title, swipe left / right, add-to-board flow, added state
│     ├─ sourcesheet.js        NEW  Paste sheet and file picker (txt / vtt / srt / docx) → transcript.js
│     ├─ paywall.js            NEW  plan cards, Subscribe / Restore / Manage, "plan required" and "allowance used" sheets
│     ├─ board.js              ~ bindRowGestures() → bindSwipe(el, { left, right, onTap, onDoubleTap, onLongPress })
│     ├─ addsheet.js           ~ openSheet({ initial, fixedList, lane, submitLabel, onSaved })
│     ├─ movecopy.js           ~ openMoveCopy({ mode: 'move'|'copy'|'add', title, listId, lane, onConfirm })
│     ├─ detail.js             ~ "From meeting ‹title›" line when task.from is set
│     ├─ shell.js              ~ Meetings in sidebar and Boards menu; FAB → newMeeting(); folder counts
│     ├─ folders.js            ~ Tasks ∕ Notes ∕ Meetings segment; meeting rows; recording size
│     ├─ settings.js           ~ Plan section (paywall.js), Meetings & AI section, Developer proxy URL
│     ├─ actions.js            ~ archive / delete / restore with Undo for meetings; dismissAction with Undo
│     └─ icons.js              + mic, stop, play, pause, document, sparkle, attach, clipboard, meeting, lock
├─ styles/
│  ├─ components.css           + level line, clock, player, segment, action card + swipe-right control,
│  │                             plan card, allowance bar, status chips (≤ 220 lines)
│  └─ screens.css              + meetings list, meeting detail blocks (≤ 120 lines)
├─ proxy/                      NEW  Cloudflare Worker
│  ├─ package.json, wrangler.toml, README.md
│  ├─ src/index.js             router, auth, CORS (GitHub Pages origin + capacitor://localhost + http://localhost)
│  ├─ src/plans.js             tier limits, tester limits, period maths (pure, shared with the client checks)
│  ├─ src/entitlement.js       RevenueCat lookup + KV cache + webhook handler
│  ├─ src/pool.js              reservation / charge / release on KV
│  ├─ src/stt/{provider}.js    adapter(s): start / poll
│  ├─ src/summarise.js         Claude call, JSON schema, due-date and priority post-validation
│  ├─ src/prompts.js           frozen system prompt
│  └─ src/schema.js            transcript / minutes / actions schemas (pure)
├─ android/                    NEW  generated by `npx cap add android`, committed (unlike ios/) because the
│                              foreground-service plugin and manifest edits are hand-maintained
├─ plugins/
│  └─ recording-service/       NEW  tiny local Capacitor plugin: Android foreground service start/stop while
│                              recording; iOS no-op (background audio mode handles it)
├─ .github/workflows/
│  ├─ ios-testflight.yml       ~ PlistBuddy adds NSMicrophoneUsageDescription + UIBackgroundModes [audio]
│  ├─ android-play.yml         NEW  build signed AAB, upload to Play internal testing (manual)
│  └─ proxy.yml                NEW  wrangler deploy (manual)
├─ scripts/
│  ├─ check-store.mjs          + meetings invariants (§19)
│  ├─ check-transcript.mjs     NEW  transcript.js parsers + merge + model text; plans.js maths
│  ├─ check-ai.mjs             NEW  ai.js job reducer and error mapping against a fake fetch; proxy schema validation
│  └─ check-shell.mjs          (unchanged) fails until the new files are in SHELL
├─ sw.js                       SHELL += src/{media,transcript,ai,purchases}.js, src/ui/{meetings,meeting,recorder,
│                              transcriptview,minutesview,actioncards,sourcesheet,paywall}.js; VERSION 'stackd-v1.5.0'
├─ privacy.html, terms.html    NEW  static pages on GitHub Pages (store requirement, PRD AC-12.9)
└─ docs/                       prd-meetings.md (this release), qa-report.md (+1.5.0 section)
```

`scripts/build-www.mjs` gains `privacy.html` and `terms.html` only if
they must ship inside the shells (they need not: the store links point at
the website). `www/` and `ios/` stay generated; `android/` is committed.

---

## 22. Core Interfaces & Types (additions)

```js
/** @typedef {'free'|'plus'|'pro'|'max'} Tier */
/** @typedef {{ id: string, speaker: string, startMs: number|null, text: string }} Segment */
/** @typedef {{ source: 'recording'|'pasted'|'file', fileName: string|null, segments: Segment[], speakers: Record<string, string|null>, createdAt: number, updatedAt: number }} Transcript */
/** @typedef {{ summary: string, decisions: string[], openQuestions: string[], generatedAt: number, transcriptUpdatedAt: number }} Minutes */
/** @typedef {{ id: string, title: string, due: string|null, priority: string, excerpt: string, status: 'proposed'|'added'|'dismissed', taskId: string|null }} Action */
/** @typedef {'offline'|'unauthorized'|'plan_required'|'allowance_exhausted'|'too_large'|'too_quiet'|'provider_unavailable'|'timeout'|'invalid_audio'|'bad_request'} ErrorCode */
/** @typedef {{ tier: Tier, renewsAt: number|null, audioSecondsLeft, audioSecondsTotal, summariesLeft, summariesTotal }} Allowance */

// src/store.js — additions
export const MEETINGS_SORTS;                       // [['created-desc','Newest first'], ['created-asc','Oldest first'], ['title-asc','Title A–Z']]
export const MAX_RECORDING_MS = 30 * 60 * 1000;
export const PROXY_URL = 'https://minimalist-api.stackdplatform.com';
export function blankMeeting(extra = {}): Meeting;  // title from createdAt + S.dateFormat
export function defaultMeetingTitle(ts): string;

// selectors (active only unless named otherwise)
export const meetingById = (id) => Meeting | undefined;   // any status
export function activeMeetings(): Meeting[];
export function sortedMeetings(sort = S.meetingsSort): Meeting[];
export function folderMeetings(status): Meeting[];
export function folderCount(status): number;       // tasks + notes + meetings
export function meetingStatusChips(m): { recording?: string, transcript: boolean, minutes: boolean, actions: { open, added }, job?: 'transcribe'|'summarise', failed: boolean };
export function minutesStale(m): boolean;
export function actionCounts(m): { proposed, added };
export function proxyUrl(): string;                // S.ai.proxyUrl || PROXY_URL

// mutations — every one calls commit() unless noted
export function newMeeting(): Meeting;             // adds, opens (UI.screen = 'meeting')
export function updateMeeting(id, patch: Partial<Pick<Meeting,'title'>>): void;        // touches updatedAt; quiet
export function setRecording(id, rec: Meeting['recording']): void;                     // null clears; also clears nothing else
export function replaceRecording(id, rec): void;   // AC-04.9: clears transcript, minutes, proposed actions; keeps added
export function setTranscript(id, t: Transcript): void;                                // clears minutes + proposed actions
export function renameSpeaker(id, label, name: string|null): void;                     // touches transcript.updatedAt
export function editSegment(id, segmentId, text): void;                                // touches transcript.updatedAt; quiet
export function setMinutes(id, minutes: Minutes, actions: Omit<Action,'id'|'status'|'taskId'>[]): void;   // replaces proposed actions, keeps added + dismissed
export function editMinutes(id, patch: Partial<Pick<Minutes,'summary'|'decisions'|'openQuestions'>>): void;   // quiet
export function editAction(id, actionId, patch: Partial<Pick<Action,'title'|'due'|'priority'>>): void;      // quiet
export function dismissAction(id, actionId): Action;          // status 'dismissed' (Undo restores 'proposed')
export function undismissAction(id, actionId): void;
export function addActionToBoard(id, actionId, draft): Task;  // addTask({ …draft, from: { meetingId, actionId } }); action → 'added'
export function setJob(id, step, job | null): void;           // quiet (persistQuiet)
export function setLastError(id, err | null): void;           // quiet
export function setMeetingsSort(sort): void;
export function archiveMeeting(id), softDeleteMeeting(id), returnMeetingToArchive(id, archivedAt), restoreMeeting(id), deleteMeetingForever(id);
export function setPlanCache(a: Allowance, subscriberId?): void;   // S.plan ← allowance; quiet unless tier changed
export function setProxyUrl(url: string|null): void;
export function markDisclosed(), markConsented(): void;
// purgeDeleted(), emptyDeleted() cover meetings and call media.remove()

// src/media.js — the only IndexedDB module (promises; no store import)
export const DB = 'stackd-media', STORE = 'recordings';
export function available(): boolean;              // indexedDB exists and opens (file:// in Chrome: yes; private mode: maybe not)
export function begin(key, mimeType): Promise<void>;           // creates the record with no chunks
export function append(key, chunk: Blob, durationMs): Promise<void>;   // adds a chunk, updates duration/size (AC-04.4)
export function blob(key): Promise<Blob | null>;   // concatenated, for playback (object URL) and upload
export function remove(key): Promise<void>;
export function size(key): Promise<number>;
export function keys(): Promise<string[]>;
export function orphans(referenced: string[]): Promise<string[]>;   // keys not in the list (boot cleanup)
export function persist(): Promise<boolean>;       // navigator.storage.persist(), once
export function estimate(): Promise<{ usage, quota } | null>;   // AC-04.7 thresholds live in recorder.js

// src/transcript.js — pure (Node-testable)
export function parseVTT(text): Segment[];         // cue times → startMs; <v Name> → speaker label keyed by name
export function parseSRT(text): Segment[];
export function parsePasted(text): Segment[];      // "Name: text" | "[00:12] Name: text" | "Name  00:12" shapes; else one 'T' segment
export function parseDocxXml(documentXml: string): string;   // w:p → lines; caller unzips (see §26)
export function mergeAdjacent(segments): Segment[];          // same speaker, consecutive → one segment (display only)
export function defaultLabels(segments): Record<string, null>;   // S1…Sn in order of first appearance
export function speakerName(t: Transcript, label): string;   // name || 'Speaker n'
export function toModelText(t: Transcript): string;          // "[00:12] Marco: …" lines, names applied
export function fromProvider(result): { segments: Segment[], speakers: Record<string, null> };   // provider-neutral shape

// src/ai.js — proxy client (fetch; XMLHttpRequest for upload progress)
export function isOnline(): boolean;
export function transcribe(meetingId, { onProgress(pct) }): Promise<void>;   // AC-05.1: reads media.blob → POST → setJob → poll
export function summarise(meetingId): Promise<void>;                          // AC-07.1
export function cancelUpload(meetingId): void;     // upload phase only
export function allowance({ force = false } = {}): Promise<Allowance>;        // GET /v1/allowance; caches into S.plan
export function resumeJobs(): void;                // boot + 'resume' + 'online': restart polling for every open job
export function errorFor(response | Error): { code: ErrorCode, message: string };
export const POLL_MS = 4000, JOB_TTL_MS = 2 * 3600 * 1000;
// internal: reduce(meeting, event) → next jobs/lastError/transcript/minutes, pure and tested

// src/purchases.js — RevenueCat through the Capacitor bridge
export function available(): boolean;              // globalThis.Capacitor?.Plugins?.Purchases exists
export function configure(subscriberId): Promise<void>;        // once per launch, after S is loaded
export function offerings(): Promise<{ plus, pro, max }>;      // packages with localized price strings
export function buy(tier: 'plus'|'pro'|'max'): Promise<{ tier }>;   // native sheet; resolves after RevenueCat confirms
export function restore(): Promise<{ tier }>;
export function manageUrl(): Promise<string>;      // store management page
// after buy/restore the caller calls ai.allowance({ force: true }) so the proxy's view wins

// src/ui/board.js — swipe generalised (task rows keep their behaviour)
export function bindSwipe(el, {
  left: null | { el: HTMLElement, onAct() },       // revealed on swipe left (Delete)
  right: null | { el: HTMLElement, onAct() },      // revealed on swipe right (Add to board) — new
  onTap(), onDoubleTap?(), onLongPress?(),
  enabled?: () => boolean,
}): void;
// bindRowGestures(el, task) becomes a thin wrapper over bindSwipe

// src/ui/addsheet.js — options (existing callers unchanged)
export function openSheet({
  lane, initial: Partial<TaskDraft>,                // title, due, priority prefilled (AC-08.5)
  fixedList: listId | null,                         // board chip shown but not changeable
  submitLabel: 'Add task' | 'Save',
  onSaved(task): void,                              // called instead of the default addTask path when given
} = {}): void;

// src/ui/movecopy.js — options
export function openMoveCopy({ mode: 'move'|'copy'|'add', title, listId, lane, onConfirm(listId, lane) }): void;
// 'add' has no "same place" disabling and defaults to S.currentList / firstLane

// src/ui/meetings.js — screen
export function openMeetings(): void;
export function meetingsHTML(): string;
export function bindMeetings(): void;
export function meetingRowHTML(m, { folder = false }): string;   // also used by folders.js

// src/ui/meeting.js — screen, composes the blocks
export function openMeeting(id): void;
export function meetingHTML(): string;             // title, date line, then recorder / transcriptview / minutesview / actioncards HTML
export function bindMeeting(): void;               // binds each block; back → finalizeMeeting (AC-03.5)

// src/ui/recorder.js
export function recorderHTML(m): string;           // Source block | recording | saved + player
export function bindRecorder(root, m): void;
export function stopIfRecording(): Promise<void>;  // app-wide guard (navigation while recording is blocked, AC-04.2)
// internal: MediaRecorder with timeslice 5000 → media.append; AnalyserNode → canvas; cap at MAX_RECORDING_MS

// src/ui/actioncards.js
export function actionsHTML(m): string;
export function bindActions(root, m): void;
// swipe right → openMoveCopy({ mode: 'add' }) → openSheet({ initial, fixedList, lane, submitLabel: 'Save',
//   onSaved: (t) => addActionToBoard(m.id, a.id, t) })

// src/ui/paywall.js
export function planSectionHTML(): string;         // Settings: current plan, bars, plan cards, Restore / Manage; web variant
export function bindPlanSection(root): void;
export function openPlanRequired({ step: 'transcribe'|'summarise' }): void;     // AC-12.6 sheet for Free
export function openAllowanceUsed({ step, resetsAt, tier }): void;              // AC-12.6 sheet for subscribers
export function aiButtonState(step, m): { locked: boolean, hint: string };      // AC-12.5 text next to the buttons
```

Routing: `app.js` and `desktopHTML()` map `'meetings'` → `meetings.js`
and `'meeting'` → `meeting.js`; the mobile nav hides on `'meeting'`;
`inFolders` is true for a non-active meeting. `UI.query` resets in
`openMeetings()`. Boot order: `migrate()` → `purchases.configure(S.plan.subscriberId)`
(no-op on web) → `media.orphans()` cleanup → `ai.resumeJobs()` → render;
`ai.resumeJobs()` runs again on Capacitor's `resume` and on `online`.

---

## 23. Component Inventory (additions)

| Component | Source of styling | Used by |
|---|---|---|
| Mic button (idle) / Stop button (recording) | round 64 px primary button; recording: red surface, square glyph; `aria-pressed` | recorder |
| Level line | `<canvas>` 100 % × 40 px, accent bars from `AnalyserNode`, static bars under reduced motion | recorder |
| Clock | Manrope tabular numerals "mm:ss / 30:00" | recorder |
| Player | `.btn-ghost` play/pause + `<input type="range">` styled on the Finance track + times | recorder, transcript (seek) |
| Status chips | neutral `.chip` size S; spinner variant; amber "Failed" | meeting rows, folders |
| Segment | speaker label (Manrope, secondary) + body text; `.playing` highlight; inline `contenteditable` text | transcriptview |
| Minutes section | section title + paragraph / bullets; AI label line in secondary text | minutesview |
| Action card | surface card, inline title input, chips row, excerpt in secondary; swipe layer with left Delete (red) and right Board (accent) | actioncards |
| Added card | same card, muted, check icon, "Added to ‹board› · ‹lane›" link | actioncards |
| Plan card | surface card: name, price, pool lines, primary Subscribe or "Current plan" | paywall (Settings) |
| Allowance bar | 4 px track + accent fill + label | paywall (Settings) |
| Plan-required / allowance-used sheets | existing `.sheet` with two plan cards or one message + Upgrade | paywall |
| Source sheet | existing `.sheet` with a textarea or the file picker trigger | sourcesheet |
| Tasks ∕ Notes ∕ Meetings segment | existing `.segmented` with three options | folders |

---

## 24. Implementation Phases (the roadmap, continued)

Numbering continues from §14. Same rules: each phase is a vertical slice
that leaves the app working, ends with its acceptance criteria ticked in
`docs/prd-meetings.md`, `npm run check` green, `npm run bundle` run, and
is offered for commit before the next starts. Estimates are focused build
time; device time (two phones) is listed separately where it is needed.

### Phase 14 — Android shell, store accounts, workflows · M (~5 h + owner tasks) — AC-11.5, prerequisite of US-12
- `npx cap add android`, commit `android/`; `applicationId`
  `com.eugeniocalva.stackd`, version from `sw.js` like iOS; permissions
  `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`,
  `POST_NOTIFICATIONS` in the manifest; adaptive icons via
  `@capacitor/assets`.
- `.github/workflows/android-play.yml` (manual): JDK 17, `npm run build`,
  `cap sync android`, `gradlew bundleRelease` signed with an upload key
  from secrets (`ANDROID_KEYSTORE_B64`, passwords), upload with
  `r0adkll/upload-google-play` to the internal track using a service
  account JSON secret; dry-run input like the iOS workflow.
- `ios-testflight.yml`: PlistBuddy adds `NSMicrophoneUsageDescription`
  and `UIBackgroundModes` = `[audio]` next to the encryption key.
- `plugins/recording-service/`: local Capacitor plugin skeleton
  (`start()`, `stop()`), Android foreground service with the recording
  notification, iOS and web no-ops; registered in both shells.
- Owner checklist (PRD §09): Play Console, paid-apps agreement, both
  small-business enrolments, RevenueCat project with `plus_monthly`,
  `pro_monthly`, `max_monthly` in one group on each store, `privacy.html`
  and `terms.html` content.
- **Done when:** the Android workflow produces an installable internal
  build that runs 1.4.3 unchanged; the iOS build still passes its plist
  inspection with the two new keys; the plugin's `start()` shows a
  notification on Android.

### Phase 15 — Meetings area, text path · L (~8 h) — US-01, US-02, US-03, US-06 (5–6), US-10
- `store.js`: `withSettings()` defaults (`meetings`, `meetingsSort`, `ai`,
  `plan` with a generated `subscriberId`), `blankMeeting`,
  `defaultMeetingTitle`, selectors, `newMeeting`, `updateMeeting`,
  `setTranscript`, `renameSpeaker`, sorts, archive / delete / restore /
  forever, folder helpers; search covers meetings; `purgeDeleted` /
  `emptyDeleted` cover meetings (media removal wired in Phase 19).
- `transcript.js`: `parseVTT`, `parseSRT`, `parsePasted`,
  `mergeAdjacent`, `defaultLabels`, `speakerName`.
- `sourcesheet.js`: paste sheet; file picker for `.txt` / `.vtt` / `.srt`
  (`.docx` in Phase 21); errors for unreadable / empty files.
- `meetings.js`: header, search, sort, rows with status chips (jobs and
  failures render once Phase 16 writes them), empty state. `meeting.js`:
  shell, title, date line, Source block button row, ⋯ menu, empty-on-back
  delete, read-only variant. `transcriptview.js`: segments, Show all,
  speaker rename (edit and seek come in Phase 20).
- `shell.js` / `app.js`: sidebar and Boards-menu entries, routes, FAB →
  `newMeeting()`. `folders.js`: three-way segment, meeting rows.
  `icons.js`: meeting, document, attach, clipboard. CSS. SHELL.
- Checks: `check-transcript.mjs` (VTT with and without `<v>`, SRT, the
  three pasted shapes, fallback, merge, labels), `check-store.mjs`
  (defaults, lifecycle, folder counts, search fields, invariants that
  apply without AI).
- **Done when:** AC-01.1–01.5, AC-02.1–02.2, AC-02.4–02.7, AC-03.1–03.5,
  AC-06.1–06.2, AC-06.5–06.6 (minus docx), AC-10.1–10.3 pass; a 1.4.3
  store opens with an empty Meetings list.

### Phase 16 — Proxy and minutes · L (~9 h) — US-07, US-09 (1–3, 5–6), US-11 (1–2), US-05 (4–6, summarise half)
- `proxy/`: Worker with router, CORS, app-token check, `plans.js`,
  `pool.js` on KV, `entitlement.js` with a **stub** that returns `tester`
  for allow-listed ids and `free` otherwise (RevenueCat lands in Phase
  18), `summarise.js` with the JSON schema, due-date resolution relative
  to `meetingDate`, priority names → validated against the list passed,
  ≤ 12 actions, `prompts.js`; `/v1/allowance`; `proxy.yml` deploy; README
  with the secrets list.
- Summary-model benchmark (PRD Q15): five real transcripts through
  `claude-haiku-5-5` and `claude-sonnet-5-5`, blind rating sheet in
  `docs/benchmarks/summary-model.md`; the winner becomes the config
  default.
- `ai.js`: `summarise`, `allowance`, `resumeJobs`, `errorFor`, the pure
  job reducer, `isOnline`. `store.js`: `setMinutes`, `editMinutes`,
  `setJob`, `setLastError`, `setPlanCache`, `setProxyUrl`,
  `markDisclosed`, `minutesStale`.
- `minutesview.js`: three sections, AI label, inline edit, Regenerate
  with confirm, stale chip; Summarise button states (idle / running /
  failed with Retry / offline / locked placeholder text from Phase 18).
  Disclosure dialog. `settings.js`: Meetings & AI section with the
  disclosure text, reset of the one-time dialogs, Developer proxy URL.
- Checks: `check-ai.mjs` (reducer: start → wait → done / error / timeout;
  resume after reload; error mapping), `check-transcript.mjs`
  (`toModelText`, `plans.js` period and limit maths).
- **Done when:** AC-07.1–07.5, AC-09.1, AC-09.3 (summaries half), AC-09.4
  (stub), AC-09.5–09.6, AC-11.1–11.2, AC-05.4–05.6 for Summarise pass
  against the deployed Worker from the PWA and the iOS shell.

### Phase 17 — Action cards · M (~5 h) — US-08
- `board.js`: `bindSwipe()` with left and right actions; task rows
  re-wired through it with no behaviour change (regression walk of swipe
  delete, tap, double-tap, long-press).
- `movecopy.js` `'add'` mode; `addsheet.js` `initial` / `fixedList` /
  `submitLabel` / `onSaved`. `store.js`: `editAction`, `dismissAction`,
  `undismissAction`, `addActionToBoard`, `actionCounts`; `task.from`.
- `actioncards.js`: cards with inline title, chips, excerpt; swipe left
  Delete with Undo; swipe right Board icon → picker → prefilled sheet →
  Save; added state with link to the task; desktop hover controls; a11y
  buttons for both actions. `detail.js`: "From meeting" line.
  `meetings.js` chips and Actions heading counts.
- Checks: `check-store.mjs` (action lifecycle, counts, `from` pointer,
  added action survives task deletion).
- **Done when:** AC-08.1–08.8 and AC-02.2's action chip pass on 375 px
  and 1280 px.

### Phase 18 — Plans and purchases · L (~9 h + 2 h on devices) — US-12, AC-09.2, AC-09.4
- `npm i @revenuecat/purchases-capacitor`, `cap sync`; `purchases.js`
  through the bridge with the web guard; `configure()` at boot with
  `S.plan.subscriberId`.
- `proxy/src/entitlement.js`: real RevenueCat lookup with KV cache,
  `/v1/rc-webhook` with signature check; `pool.js` keyed by period from
  `renewsAt`; tester allow-list kept.
- `paywall.js`: Plan section (bars, cards with localized prices from
  `offerings()`, Subscribe, Restore, Manage), the two sheets, `aiButtonState`
  for locked buttons with cost hints; web variant. `settings.js` places it.
  `minutesview.js` and (later) `recorder.js` consult `aiButtonState`.
  Lapsed handling = whatever `/v1/allowance` says on the next check.
- Sandbox runs on both stores: buy Plus, use a summary, Restore on the
  second device, upgrade to Pro, let the sandbox subscription expire.
- Checks: `check-transcript.mjs` extended with `plans.js` tier limits and
  tester day pools; `check-ai.mjs` with `plan_required` and
  `allowance_exhausted` mapping and the cache refresh rule.
- **Done when:** AC-12.1–12.9, AC-09.2, AC-09.4 pass on iPhone and
  Android sandbox; the web build shows the Free variant with no plugin
  errors in the console.

### Phase 19 — Recording · L (~9 h + 3 h on devices) — US-04
- **Spike first (half a day):** a throwaway TestFlight build with
  `MediaRecorder` + the background audio mode, screen locked 10 minutes;
  same on an Android internal build with the foreground service. Outcome
  recorded in `docs/benchmarks/background-recording.md`. If iOS stops the
  recorder, `recorder.js` gets a native path through the
  `recording-service` plugin (AVAudioRecorder writing `.m4a`, returned as
  a Blob through the bridge) and the rest of this phase is unchanged.
- `media.js` complete; `recorder.js`: consent dialog (`markConsented`),
  `getUserMedia` with denied-state UI and settings deep link via
  `App.openUrl` / `app-settings:`, MediaRecorder with `timeslice 5000`
  → `media.append`, `AnalyserNode` level line, clock, cap at
  `MAX_RECORDING_MS` with toast + haptic, `UI.recorder` guard on
  navigation, persistence request, `estimate()` warnings, saved state
  with player and scrubber, Delete recording (confirm, size), Replace
  (confirm → `replaceRecording`), the post-transcript "delete to free"
  toast (wired in Phase 20). `store.js`: `setRecording`,
  `replaceRecording`; `purgeDeleted` / `emptyDeleted` / forever call
  `media.remove`; boot `orphans()` cleanup. `folders.js` shows sizes.
- Checks: `check-store.mjs` (replace clears the right fields, purge
  reaches media via an injected stub).
- **Done when:** AC-04.1–04.9 pass on iPhone, Android and desktop Chrome;
  a 30-minute recording is ≤ 15 MB, survives an app kill and a restart,
  and the PRD lock-screen metric holds on both phones.

### Phase 20 — Transcription · M (~6 h + benchmark) — US-05, US-06 (1–4, 7), AC-07.5, AC-09.3
- Provider benchmark (PRD Q13): three real recordings (headset,
  phone-on-table, two speakers overlapping) through two providers;
  speaker accuracy first, price second, aiming at ≤ $0.20 / h; result in
  `docs/benchmarks/stt-provider.md`; `proxy/src/stt/<winner>.js`.
- `proxy/`: `/v1/transcribe` (multipart, size limit, reservation,
  provider start), `/v1/transcribe/:id` (poll, provider → neutral shape,
  charge on done, release on error), `too_quiet` detection.
- `ai.js`: `transcribe` with XHR progress and cancel, poll loop, resume;
  `transcript.fromProvider`. `recorder.js`: Transcribe button states,
  cost hint via `aiButtonState`, the "delete to free" toast.
  `transcriptview.js`: times, tap-to-seek with `.playing` highlight,
  inline text edit (`editSegment`), stale chip wiring, Summarise /
  Regenerate placement.
- Checks: `check-ai.mjs` (upload → wait → done path, cancel during
  upload, resume after kill, 2-hour TTL), `check-transcript.mjs`
  (`fromProvider` on the chosen provider's sample payload).
- **Done when:** AC-05.1–05.6, AC-06.1–06.4, AC-06.7, AC-07.5, AC-09.3
  pass; a 30-minute recording transcribes in under 5 minutes end to end
  on a phone on mobile data.

### Phase 21 — `.docx`, Should items, polish · S (~4 h) — AC-06.6, Should list
- `.docx`: a minimal zip reader in `transcript.js` (central directory →
  `word/document.xml` entry → `DecompressionStream('deflate-raw')`) and
  `parseDocxXml`; if `DecompressionStream` is missing (older WebView), the
  file picker says so rather than failing silently. No dependency unless
  the reader exceeds ~120 lines, in which case `fflate` is bundled.
- Copy minutes to clipboard; extra pasted-text shapes; `prefers-reduced-motion`
  pass on the level line; screen-reader pass (AC-11.4); icon and spacing
  polish against the Finance tokens (AC-11.3).
- **Done when:** AC-06.6 (docx), AC-11.3–11.4 and the Should items chosen
  for the release pass.

### Phase 22 — Release 1.5.0 · M (~4 h + QA on two phones) — AC-04.3, AC-11.5, AC-12.9
- Walk `docs/prd-meetings.md` as QA (`agents/qa_tester.md`) on Chrome
  375 px + 1280 px, light + dark, iPhone (TestFlight) and Android
  (internal track), including sandbox purchases, lock-screen recording,
  an app kill mid-job and an offline pass; append to `docs/qa-report.md`;
  fix.
- `privacy.html` / `terms.html` live; store listings carry the
  subscription text; `file://` bundle run (AI buttons explain they need
  http(s)); PWA install.
- README (Meetings, plans, proxy, Android, new check scripts), `VERSION`
  `stackd-v1.5.0`, `npm run check`, `npm run bundle`, commit, push
  `main`, then the three manual workflows (proxy, iOS, Android).

Order rationale: the Android shell (14) comes first because every later
phase is verified on it and the store accounts have lead time; the text
path (15) is the product without any infrastructure and proves the
screen; the proxy (16) is needed by every AI step and the summary half is
the cheaper one to prove it with; action cards (17) complete the "meeting
to tasks" loop before any money is involved; plans (18) go before audio
so TestFlight sees the paywall early and the proxy's entitlement path is
real before the expensive step exists; recording (19) and transcription
(20) are the hardest and the only device-bound work, so they come once
everything around them is stable; docx and polish (21) can be dropped
without a hole; release (22) last.

---

## 25. Acceptance criteria → phase

| PRD criterion | Phase |
|---|---|
| AC-01.1 – 01.5 | 15 |
| AC-02.1 – 02.2, 02.4 – 02.7 | 15 (02.2 action chip: 17; job / failed chips: 16, 20) |
| AC-02.3 | 16 (summarise), 20 (transcribe) |
| AC-03.1 – 03.5 | 15 |
| AC-04.1 – 04.9 | 19 (04.3 iOS keys and Android service: 14 + 19; 04.8 toast: 20) |
| AC-05.1 – 05.3 | 20 |
| AC-05.4 – 05.6 | 16 (summarise), 20 (transcribe) |
| AC-06.1 – 06.2, 06.5 | 15 |
| AC-06.3 – 06.4, 06.7 | 20 |
| AC-06.6 | 15 (txt / vtt / srt), 21 (docx) |
| AC-07.1 – 07.4 | 16 |
| AC-07.5 | 16 (chip), 20 (wired to edits) |
| AC-08.1 – 08.8 | 17 |
| AC-09.1, 09.3 (summaries), 09.5 – 09.6 | 16 |
| AC-09.2, 09.4 | 18 |
| AC-09.3 (audio minutes) | 20 |
| AC-10.1 – 10.3 | 15 |
| AC-10.4 | 19 |
| AC-11.1 – 11.2 | 16 |
| AC-11.3 – 11.4 | 21 |
| AC-11.5 | 14 (shells, keys), 22 (verified) |
| AC-12.1 – 12.9 | 18 (12.9 pages live: 22) |

---

## 26. Risks and Mitigations (1.5.0)

| Risk | Mitigation |
|---|---|
| `MediaRecorder` in WKWebView stops when the app is backgrounded even with the audio background mode | Phase 19 spike before any recorder code; fallback is a native AVAudioRecorder path inside the `recording-service` plugin returning a Blob; the web code keeps `MediaRecorder`. |
| IndexedDB eviction or private-mode failure loses recordings | `media.persist()` once; `estimate()` warnings; the shells store in the app sandbox, which is not evicted; `available()` false → recorder explains and offers paste / attach only. |
| An app kill mid-recording loses audio | `timeslice 5000` chunks written as they arrive; `media.begin` before the first chunk; on boot a recording record with chunks but no meeting link is attached back or offered for deletion. |
| 11 MB upload on a flaky mobile connection | XHR progress + cancel; `too_large` before upload; job id persisted so a retry re-uploads but never double-charges (reservation keyed by meeting id + recording key, idempotent). |
| Pool overspend by parallel requests or reinstalls | Reservation before the provider call; counters keyed by subscriber id (RevenueCat app user id, restored with purchases), not device; the proxy, never the client, decides. |
| RevenueCat plugin not reachable through the bridge for some method (complex return shapes) | `purchases.js` is the only caller; if a method needs the JS wrapper, that wrapper is bundled with esbuild into `app.bundle.js` only (the module build keeps the bridge path); verified in Phase 18 sandbox runs. |
| Store review rejects the subscription screens | AC-12.9 checklist in `paywall.js`: price, period, renewal text, terms and privacy links, Restore visible; no mention of other platforms' prices; the web variant never says "buy". |
| Provider prices or quality change after the benchmark | One adapter interface; tier limits and model id are config; §11 of the PRD is re-run with the benchmark's numbers before 1.5.0 ships. |
| Claude returns something outside the schema (dates, priorities) | Structured output with a strict schema on the proxy; dates re-validated as ISO within −30…+365 days of the meeting; priorities validated against the list sent; invalid items dropped, never shown. |
| CORS / origin drift between GitHub Pages, `capacitor://localhost` (iOS), `http://localhost` (Android) and `file://` | Allow-list in `proxy/src/index.js` from config; `file://` sends a `null` origin, so the bundle's AI buttons explain they need http(s) (AC-11.5). |
| `.docx` unzip without a dependency | Minimal reader behind one function; size cap ~120 lines or switch to `fflate`; both tested in `check-transcript.mjs` with a real Teams export. |
| Three swipe behaviours drift (task rows, action cards, future note rows) | One `bindSwipe()`; task regression walk in Phase 17. |
| Service-worker shell drift with twelve new files | `check-shell.mjs`; VERSION bump in Phase 22. |
| Proxy secrets or app token in the public repository | Only `wrangler.toml` (no secrets) and code are committed; secrets via `wrangler secret put` and GitHub secrets; the app token is a low-value constant by design and documented as such. |

---

## 27. Checks added to `npm run check`

| Script | Covers |
|---|---|
| `scripts/check-transcript.mjs` (new) | `transcript.js`: VTT with and without `<v>` cues, SRT, the pasted shapes and fallback, `mergeAdjacent`, `defaultLabels`, `speakerName`, `toModelText`, `fromProvider` on the chosen provider's sample, `parseDocxXml` and the zip reader on a real export. `proxy/src/plans.js`: tier limits, tester day pools, period boundaries around `renewsAt`. |
| `scripts/check-ai.mjs` (new) | `ai.js` reducer: summarise and transcribe state paths (start, wait, done, error, cancel, resume after reload, 2-hour TTL), `errorFor` mapping for every `ErrorCode`, plan cache refresh rule. `proxy/src/schema.js`: minutes / actions schema validation, date and priority post-validation. Runs against a fake `fetch`; no network. |
| `scripts/check-store.mjs` (extended) | §19 invariants: defaults on a 1.4.3 store, lifecycle order, `replaceRecording` and `setTranscript` clearing rules, action lifecycle and `task.from`, folder counts with three kinds, purge reaching `media.remove` through an injected stub, `proxyUrl()` scheme rule. |
| `scripts/check-shell.mjs` (unchanged) | Fails until the twelve new files are in SHELL. |

The proxy has its own `npm test` in `proxy/` (Node, no framework, same
style) for `pool.js` reservation / charge / release on an in-memory KV and
the webhook signature check; `proxy.yml` runs it before `wrangler deploy`.

---

# Part IV — Accounts and sync (1.6.0, `docs/prd-accounts.md`)

Implements `docs/prd-accounts.md`, written from `docs/plan-accounts.md`.
Structural code only. Where this part refines the plan or the PRD, §28
says so and the two documents were updated to match.

## 28. Approach

- **Signed out is the default and stays untouched.** Everything in this
  part hangs off one device-local key, `stackd-account`. When it is
  absent, no new module makes a request, schedules a timer or changes a
  byte of `stackd-v2`.
- **One backend.** The Worker in `proxy/` gains a D1 database created with
  the EU jurisdiction (it cannot be added later), a mail adapter and a
  daily clean-up. No second service holds personal data.
- **The mailbox is the root of trust; the PIN is the lock.** Signing in on
  a new device takes an email code and the PIN. Resetting the PIN takes
  an email code alone, so whoever controls the mailbox controls the
  account, as with any reset-by-email design. A reset is loud: it signs
  out every other device and sends a notice. The PIN's jobs are the app
  lock and stopping a single intercepted code from being enough.
- **Sync has its own clock.** Each record syncs inside an envelope with a
  `changedAt` that only the sync engine writes. The records' own
  `updatedAt` keeps its meaning ("Edited …" on notes), and no mutation in
  `store.js` is rewritten. Boards therefore do **not** gain `updatedAt`
  (the PRD's data note is superseded).
- **Diff against a shadow, not instrument every mutation.** After a
  commit the engine hashes each record's wire form and compares it with
  the hash it last synced. Changed → push; missing → tombstone. About
  1 000 records hash in a few milliseconds.
- **Delete wins.** Once the server holds a tombstone for an id, later
  writes to that id are refused. No clock can resurrect a record
  (AC-05.7).
- **The web app moves to Cloudflare hosting, not to a GitHub Pages custom
  domain.** Two reasons found during design: setting a custom domain on
  GitHub Pages redirects the old `github.io` address, which would strand
  the browser data stored there and make AC-12.2 impossible; and GitHub
  Pages cannot send response headers, so `frame-ancestors` and a real
  Content-Security-Policy are out of reach. `app.stackdplatform.com` is
  served by Cloudflare from the same repository with a `_headers` file;
  GitHub Pages keeps serving the old address, where the same code shows
  the move banner and offers no account.
- **Two session carriers.** Web: an `HttpOnly` cookie, possible because
  `app.` and `minimalist-api.` are the same site. Shells: a bearer token
  in the Keychain / Keystore, because `capacitor://localhost` is not.
- **Plugins through the bridge, as before.** Biometrics and secure
  storage are reached through `globalThis.Capacitor.Plugins`, never
  imported, so the module build keeps loading (see `notify.js`).
- **Pure where possible.** Hashing, the diff, the merge decision, the
  lock timing, the request validation and the PIN / code rules have no
  DOM or network dependency and run under `npm run check` and the
  proxy's `npm test`.

Refinements recorded in the PRD and the plan: hosting (AC-12.1, owner
tasks); no `updatedAt` on boards (§05 Data); AC-06.8 now covers "Keep a
copy" and requires a second confirmation before "Remove from this device"
deletes recordings that exist nowhere else; testers are flagged in the
database rather than listed by email in a public config file (AC-08.6).

---

## 29. Data Schema additions

### On the device

```js
// localStorage['stackd-v2'] — unchanged. No field is added for accounts or sync.

// localStorage['stackd-account'] — absent ⇔ signed out
{
  userId: 'k3f…',                 // 24 chars [a-z0-9]; also the RevenueCat app user id and the pool id
  email: 'ana@example.com',
  sessionId: 's_…',               // this device's row in Devices; not a secret
  platform: 'web' | 'ios' | 'android',
  pinVersion: 3,                  // the account's PIN generation this device last proved
  accepted: { terms: '2026-12-01', privacy: '2026-12-01' },
  lock: { after: 'immediately' | '5m' | '1h' | 'off', biometrics: false },
  verifier: { salt: 'b64', hash: 'b64' } | null,   // web only: offline PIN check; shells keep it in secure storage
  lastActiveAt: 1760000000000,    // lock timing across reloads
  offlineFails: 0, offlineWaitUntil: 0,
}

// localStorage['stackd-sync'] — the shadow; kept on "Keep a copy" sign-out, tagged with its account
{
  userId: 'k3f…',
  cursor: 1287,                   // last server revision applied
  serverOffset: -420,             // ms to add to Date.now() to get server time
  shadow: { 'task:a1b2c3d4': ['9f3c…', 1760000000000], … },   // key → [hash, changedAt]
  lastSyncAt: 1760000000000,
  paused: null | { code: ErrorCode, at },
}

// localStorage['stackd-v2-backup'] — one slot, written before a merge or replace (AC-06.5)
{ savedAt: 1760000000000, reason: 'merge' | 'replace', doc: { …stackd-v2… } }

// localStorage['stackd-age-refused'] — epoch ms; the Age step refuses until + 24 h (AC-02.3)

// Secure storage (shells only, Keychain / Keystore)
'stackd-session'   → bearer token
'stackd-verifier'  → { salt, hash }
```

The session on the web is a cookie the page cannot read:
`stackd_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/v1;
Max-Age=7776000`, host-only on `minimalist-api.stackdplatform.com`.

### Wire records

```js
/** One synced record in transit and at rest. */
{ kind: 'list' | 'task' | 'note' | 'meeting' | 'settings',
  id: 'a1b2c3d4',                 // the record's own id; 'settings' for the single settings record
  changedAt: 1760000000000,       // sync clock, device time corrected by serverOffset, strictly increasing per record
  deleted: false,                 // true ⇒ data is null (tombstone)
  data: { … } | null }

// What data holds, per kind (toWire / fromWire in src/sync.js):
// list      the board as stored: { id, name, lanes }
// task      the task as stored, minus reminderFiredAt
// note      the note as stored
// meeting   the meeting as stored, minus recording, jobs, lastError
// settings  { dateFormat, priorities, labels }
// Never on the wire: theme, currentList, view, sort, notesSort, meetingsSort, lastAuto, onboarded, ai, plan.
```

Inbound, `fromWire` puts back what the device owns: a meeting keeps its
local `recording`, `jobs` and `lastError`; a task keeps its local
`reminderFiredAt`, or is re-armed when its schedule changed.

### In D1 (`proxy/migrations/0001_accounts.sql`)

```sql
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,           -- 24 chars [a-z0-9]
  email              TEXT NOT NULL UNIQUE,       -- trimmed, lower-cased
  created_at         INTEGER NOT NULL,
  adult_confirmed_at INTEGER NOT NULL,           -- the fact and the time; never a birth year
  terms_version      TEXT NOT NULL,
  privacy_version    TEXT NOT NULL,
  accepted_at        INTEGER NOT NULL,
  pin_salt           BLOB NOT NULL,
  pin_hash           BLOB NOT NULL,
  pin_version        INTEGER NOT NULL DEFAULT 1, -- bumped by change and reset
  pin_fails          INTEGER NOT NULL DEFAULT 0,
  pin_locked         INTEGER NOT NULL DEFAULT 0,
  rev                INTEGER NOT NULL DEFAULT 0, -- last sync revision handed out
  tester             INTEGER NOT NULL DEFAULT 0  -- set by the owner with wrangler d1 execute
);

CREATE TABLE legacy_ids (                        -- anonymous device ids linked at sign-in (AC-08.2)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL,
  linked_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, subscriber_id)
);

CREATE TABLE login_codes (                       -- one live code per email; no user row needed
  email_key         TEXT PRIMARY KEY,            -- HMAC(CODE_PEPPER, email)
  code_hash         BLOB NOT NULL,               -- HMAC(CODE_PEPPER, email ‖ code)
  expires_at        INTEGER NOT NULL,            -- sent_at + 10 min
  attempts          INTEGER NOT NULL DEFAULT 0,  -- 5 max
  sent_at           INTEGER NOT NULL,
  ticket_hash       BLOB,                        -- set by a correct code; proves the mailbox for 10 min
  ticket_expires_at INTEGER
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                 -- 's_…', shown in Devices
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   BLOB NOT NULL UNIQUE,             -- SHA-256 of the 32-byte token
  platform     TEXT NOT NULL,                    -- 'web' | 'ios' | 'android'
  label        TEXT NOT NULL,                    -- 'iPhone', 'Android', 'Browser on Windows' …
  pin_version  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL                  -- written at most once an hour
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE records (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,                               -- JSON; NULL when deleted
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX records_rev ON records(user_id, rev);

CREATE TABLE consent_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  what    TEXT NOT NULL,                         -- 'terms' | 'privacy' | 'adult'
  version TEXT NOT NULL,
  at      INTEGER NOT NULL
);

CREATE TABLE rate (                              -- fixed-window counters
  key          TEXT PRIMARY KEY,                 -- 'code:e:<email_key>' | 'code:n:<HMAC(ip)>' | 'verify:n:…' | 'sync:u:<id>'
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
```

Signing out or revoking deletes the session row; deleting the account
deletes the user row and everything cascades. KV keeps what it has today
(`pool:`, `rccache:`, `job:`).

### Invariants (tested in `check-sync.mjs`, `check-lock.mjs` and `proxy/test`)
- `stackd-account` absent ⇒ no request to `/v1/auth`, `/v1/account` or
  `/v1/sync`, and no sync timer.
- `toWire(kind, x)` never contains `recording`, `jobs`, `lastError`,
  `reminderFiredAt`, or any per-device setting.
- `fromWire(toWire(x), x)` deep-equals `x` for every kind.
- A pushed `changedAt` is greater than the shadow's `changedAt` for that
  record, whatever the device clock says.
- Server: every query on `records`, `sessions`, `legacy_ids` and
  `consent_log` is bound to the session's `user_id`; no id from a request
  body selects a user (AC-05.10).
- Server: a row with `deleted = 1` is never updated back to `deleted = 0`.
- Server: `pin_fails` only resets on a correct PIN or a reset; a locked
  PIN accepts no PIN at all, right or wrong.
- Server: a new user row exists only after a correct code **and** a PIN;
  an abandoned registration leaves a code row that expires.

---

## 30. System Architecture (additions)

```
┌──────────────── device ────────────────┐        ┌────────────── Cloudflare ──────────────┐
│ web:   app.stackdplatform.com          │        │ proxy/ (Worker)                        │
│        (static, _headers: CSP)         │  HTTPS │  /v1/auth/*   codes · PIN · sessions   │
│ shells: capacitor://localhost          ├───────▶│  /v1/account  profile · devices ·      │
│                                        │ cookie │               export · delete          │
│  account.js ─┐                         │   or   │  /v1/sync     push + pull              │
│  sync.js ────┼─ net.js ────────────────│ bearer │  /v1/…        the 1.5.0 routes,        │
│  ai.js ──────┘                         │        │               identity from session    │
│  lock.js ─ secure.js ─ Keychain/Keystore        │  scheduled()  daily clean-up           │
│  purchases.js ─ RevenueCat plugin      │        │  D1 (EU) · KV (pools, jobs) · mail ────┼──▶ mailbox
└────────────────────────────────────────┘        └────────────────────────────────────────┘
 old address eugeniocalva.github.io/Stackd-Minimalist: same code, banner + export only
```

### Identity on every request

`identify(request, env)` in `proxy/src/auth/sessions.js` runs before any
route and returns one of:

| Result | When | Used as |
|---|---|---|
| `{ kind: 'account', userId, sessionId }` | a valid cookie or `Authorization: Bearer` | pool id and RevenueCat id = `userId` |
| `{ kind: 'anon', subscriberId }` | no session; `X-Stackd-Subscriber` as today | the 1.5.0 behaviour, unchanged |
| error `signed_out` (401) | a cookie or bearer was sent and is unknown or expired | the device signs itself out |

The 1.5.0 handlers keep their signatures: where they took `sub`, they
take the pool id. A request that carries a session ignores
`X-Stackd-Subscriber` for identity (AC-08.3). User ids match the existing
`SUB_ID` pattern, so `pool.js` and `jobs.js` need no change.

Cookie-authenticated requests must carry an `Origin` on the allow-list
(today a missing `Origin` is accepted for the shells; with a cookie it is
refused). CORS gains `Access-Control-Allow-Credentials: true` and the
headers `Authorization` and `X-Stackd-Client`.

### Endpoints

| Endpoint | Auth | Body | Returns |
|---|---|---|---|
| `POST /v1/auth/start` | app token | `{ email }` | 204 always; 429 `rate_limited` |
| `POST /v1/auth/verify` | app token | `{ email, code }` | `{ ticket, account: 'new' \| 'existing', pinLocked }` |
| `POST /v1/auth/register` | ticket | `{ ticket, pin, adult: true, termsVersion, privacyVersion, label, legacyId? }` | session |
| `POST /v1/auth/signin` | ticket | `{ ticket, pin, label, legacyId? }` | session |
| `POST /v1/auth/pin/reset` | ticket | `{ ticket, pin, label }` | session; every other session deleted; mail |
| `POST /v1/auth/pin/check` | session | `{ pin }` | `{ pinVersion }` (the lock screen, online) |
| `POST /v1/auth/pin/change` | session | `{ pin, newPin }` | `{ pinVersion }`; mail |
| `GET /v1/account` | session | — | `{ id, email, createdAt, pinVersion, accepted, current: { terms, privacy }, devices[] }` |
| `POST /v1/account/accept` | session | `{ termsVersion, privacyVersion }` | 204 |
| `POST /v1/account/signout` | session | `{ sessionId? , all? }` | 204 |
| `GET /v1/account/export` | session | — | the AC-10.1 file |
| `POST /v1/account/delete` | session | `{ pin }` or `{ ticket }` | 204; mail |
| `GET /v1/sync/summary` | session | — | `{ counts: { list, task, note, meeting } }` |
| `POST /v1/sync` | session | `{ cursor, changes[] }` | `{ cursor, changes[], rejected[], more, serverTime }` |

A session answer is `{ account }` plus `Set-Cookie` when
`X-Stackd-Client: web`, or `{ account, token }` for the shells.

New error codes: `rate_limited` (with `retryAfter`), `code_wrong`,
`code_expired`, `pin_wrong` (with `left`), `pin_locked`, `pin_weak`,
`underage`, `accept_required`, `pin_required` (this session's
`pin_version` is behind), `signed_out`, `quota`, `conflict`.

### Sign-in sequence

```
app                                   proxy                                  mailbox
 │ age step (device only, AC-02.3)      │                                       │
 │── POST /auth/start { email } ───────▶│ rate check; store code hash; ───────▶ │ code
 │◀──────────────── 204 ────────────────│ (same work for a known and an unknown email)
 │── POST /auth/verify { email, code } ▶│ compare in constant time; attempts+1
 │◀── { ticket, account, pinLocked } ───│ ticket = 32 random bytes, hash stored, 10 min
 │  account 'new'      → Choose a PIN ──▶ /auth/register   user row is created here
 │  account 'existing' → Enter your PIN ▶ /auth/signin     pin_wrong { left } · pin_locked
 │  locked or forgotten → New PIN ──────▶ /auth/pin/reset  other sessions deleted, mail
 │◀── session (cookie or token) ────────│ mail "New sign-in" unless this is the account's first
 │ GET /sync/summary → mergePlan → first POST /sync
```

### Secrets and hashing

| Thing | How it is stored |
|---|---|
| Email code | `HMAC-SHA256(CODE_PEPPER, email ‖ ':' ‖ code)`; compared in constant time |
| PIN | `PBKDF2-HMAC-SHA256(HMAC-SHA256(PIN_PEPPER, userId ‖ ':' ‖ pin), pin_salt, 100 000, 32 bytes)`. 100 000 is the Workers runtime's ceiling; the pepper, a Worker secret outside the database, is what makes a stolen database useless for a 10 000-value PIN (AC-03.7) |
| Session token, ticket | 32 random bytes to the client, SHA-256 at rest |
| Device PIN verifier | `PBKDF2(pin, device salt, 100 000)`; web: in `stackd-account`; shells: secure storage. An app-lock, not a secret store (AC-03.8) |
| Network address | never stored; `HMAC(CODE_PEPPER, ip)` as a rate key for one window |

New Worker secrets: `PIN_PEPPER`, `CODE_PEPPER`, the mail key if the
provider needs one. New vars: `APP_ORIGIN`, `MAIL_FROM`,
`TERMS_VERSION`, `PRIVACY_VERSION`, `OWNER_FOOTER`.

### Sync protocol

Client, in `sync.js`:

1. **Diff.** For every record: `hash(canonical(toWire(x)))` against the
   shadow. Changed or new → a change with
   `changedAt = max(now + serverOffset, shadow.changedAt + 1)`. In the
   shadow but gone → a tombstone.
2. **Push and pull** in one `POST /v1/sync`, at most 200 changes and 4 MB
   per request, repeated while `more`.
3. **Apply.** Inbound changes whose hash differs from local go through
   `store.applyRemote()`; the shadow is updated first, so applying never
   looks like a local edit. While a text field or `contenteditable` has
   focus, inbound changes wait (up to the next blur or 2 s idle), so sync
   never moves a caret.
4. **Rejected** changes (`older`, `deleted`) are dropped locally in favour
   of what the pull delivered.

Server, per change, in one transaction with the revision counter:

| Stored row | Incoming | Outcome |
|---|---|---|
| none | upsert or tombstone | stored, `rev = ++users.rev` |
| `deleted = 1` | anything | rejected `deleted` |
| live, `changed_at >= incoming` | upsert | rejected `older` |
| live, `changed_at < incoming` | upsert or tombstone | stored, new `rev` |

`changed_at` is clamped to the server's clock on the way in. The pull is
`rev > cursor ORDER BY rev LIMIT 500`. Limits: 1 MB per record, 20 000
records and 50 MB per account (`quota`).

Triggers (all through one debounced `sync.request()`): boot, Capacitor
`resume`, `visibilitychange` to visible, `online`, 2 s after a commit
(the `setAfterCommit` hook that already runs `syncReminders`), and
**Sync now**. Failures back off 5 s → 5 min and surface as "Sync paused".

### First sign-in and sign-out

`mergePlan(local, remoteCounts)` is pure and returns `'upload'`,
`'download'` or `'ask'` (AC-06.1 to 06.4). `isUntouchedSeed(S)` is true
when the boards and task titles equal the seed's and nothing was edited,
added, or onboarded past the samples; such a device counts as empty.

| Choice | What happens |
|---|---|
| upload | first sync pushes everything |
| download | untouched samples are removed, then the pull fills the store |
| Merge | backup slot written; union by id through a normal sync |
| Use my account | backup slot written; local records replaced by the pull |
| Sign out, keep a copy | session and `stackd-account` removed; store and shadow stay |
| Sign out, remove | unsynced changes pushed or counted in the dialog; recordings that exist only here are counted and need a second confirmation; then the store, the shadow and the backup are removed and the app restarts as a fresh install |

While a backup slot exists, `media.orphans()` treats its recording keys
as referenced, so restoring the backup finds its audio.

### App lock

```
            sign-in / correct PIN / biometrics ok
 locked ───────────────────────────────────────────▶ unlocked
   ▲                                                    │
   └──── hidden or backgrounded longer than lock.after ─┘
         · boot with lock.after ≠ 'off' · pin_required from the server
```

- `app.js` `render()` shows the lock screen and nothing else while
  locked; open sheets are closed on lock.
- Online, the PIN goes to `/v1/auth/pin/check` (it counts towards the
  five, AC-07.5) with a 3 s timeout; offline or on timeout it is checked
  against the device verifier with waits of 30 s doubling per failure.
- Biometrics is a local yes or no from the operating system through the
  bridge; nothing is sent anywhere.
- PC biometrics (Should): a WebAuthn platform credential created on that
  browser and used with `userVerification: 'required'` as the same local
  yes or no.

### The plan on an account

- `purchases.identify(userId)` after sign-in: the plugin's `logIn`, then
  `syncPurchases` so a purchase made under the device's anonymous id
  moves to the account without a store prompt. Sign-out logs the plugin
  back in as the device's `subscriberId`.
- `legacyId` (the device's `subscriberId`) is sent at sign-in and stored
  in `legacy_ids` (5 per account at most). For the current period the
  pool that is read is the account's plus those of its legacy ids, so
  usage carries over (AC-08.2). Claiming someone else's id can only add
  their usage to one's own count.
- `entitlement.resolve` checks `users.tester` for accounts and the
  `TESTERS` variable for anonymous ids.
- Account deletion calls RevenueCat's subscriber delete with the Worker's
  existing secret key.

### Mail

One adapter interface, like speech-to-text: `proxy/src/mail/index.js`
picks `send({ to, subject, text })` from `MAIL_PROVIDER`. First choice is
Cloudflare's own email service through a Worker binding (no extra
processor; in public beta and needs the Workers Paid plan at the time of
writing); the fallback is an HTTP provider with an EU region. Five
templates in `mail/templates.js`, plain text only, each ending with
`OWNER_FOOTER`. Sending runs in `ctx.waitUntil`, so the answer to
`/auth/start` does not wait for it.

### Hosting, headers, the old address

- `app.stackdplatform.com`: Cloudflare static hosting of the output of
  `npm run build -- --site` (the `www/` tree plus `privacy.html`,
  `terms.html`, `account-deletion.html` and `_headers`), deployed on push
  to `main`.
- `_headers`: `Content-Security-Policy: default-src 'self'; script-src
  'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  media-src 'self' blob:; font-src 'self'; connect-src 'self'
  https://minimalist-api.stackdplatform.com; frame-ancestors 'none';
  base-uri 'none'; form-action 'none'; object-src 'none'`, plus
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and
  HSTS. `script-src 'self'` requires the two inline scripts in
  `index.html` to move into files.
- The shells load from their own scheme and get no header; they are
  covered by the origin check in `npm run check` (§37).
- Old address: `legal.isLegacyOrigin()` is true on `*.github.io`. There
  the shell shows the move banner with **Download my data**, and the
  Account section is replaced by a pointer to the new address. Recordings
  cannot travel in the file; the banner says so and the meetings keep
  their transcripts.

### Retention (the `scheduled()` handler, daily)

Expired `login_codes`; sessions with `last_seen_at` older than 90 days;
`records` with `deleted = 1` and `changed_at` older than 90 days; `rate`
rows older than a day. Worker logs: invocation logging off, and no code
path logs an email, a code, a PIN, a token, an address or record data
(AC-11.7).

---

## 31. File & Folder Structure (delta)

```
Stackd Minimalist/
├─ index.html                  ~ the two inline scripts become src/pretheme.js and src/filefallback.js
├─ app.js                      ~ boot: account.init(), lock gate in render(), sync triggers, afterCommit → sync.request()
├─ account-deletion.html       NEW  public page (AC-10.5)
├─ privacy.html, terms.html    ~ rewritten (US-11)
├─ _headers                    NEW  CSP and security headers for the Cloudflare site
├─ src/
│  ├─ legal.js                 NEW  APP_ORIGIN, TERMS_URL, PRIVACY_URL, DELETION_URL, TERMS_VERSION, PRIVACY_VERSION,
│  │                                isLegacyOrigin(); the URL constants leave ui/paywall.js
│  ├─ net.js                   NEW  the one fetch wrapper: app token, subscriber id, cookie or bearer, error mapping,
│  │                                setFetch(); ai.js, account.js and sync.js all call it
│  ├─ account.js               NEW  'stackd-account' state, sign-in / register / reset calls, devices, accept,
│  │                                sign-out, export, delete; signedIn(), onChange()
│  ├─ secure.js                NEW  bearer token and verifier in Keychain / Keystore through the bridge; web no-op
│  ├─ sync.js                  NEW  canonical, hash, toWire / fromWire, diff, mergePlan, clock (pure) + the runner
│  ├─ lock.js                  NEW  shouldLock, backoff (pure); verifier (WebCrypto); biometrics bridge; lock / unlock
│  ├─ backup.js                NEW  the pre-sign-in backup slot; exportFile(); importFile() with validation
│  ├─ pretheme.js              NEW  classic script: theme before first paint (was inline)
│  ├─ filefallback.js          NEW  classic script: the file:// bundle loader (was inline)
│  ├─ store.js                 ~ + exportRecords(), applyRemote(), replaceRecords(), isUntouchedSeed(), SEED_TITLES;
│  │                             no schema change
│  ├─ ai.js                    ~ call() and the upload go through net.js; 'signed_out' handled once, there
│  ├─ purchases.js             ~ + identify(userId), anonymous(subscriberId)
│  ├─ media.js                 ~ orphans(keys) also receives the backup slot's keys
│  └─ ui/
│     ├─ pinpad.js             NEW  four dots + digit keys; used by sign-in, lock screen, change PIN
│     ├─ signin.js             NEW  the sheet: Age, Email, Code, PIN; reset; re-accept; merge dialog; sign-out dialog
│     ├─ lockscreen.js         NEW  "Stack'd is locked": pinpad, biometric prompt, waits, "Reset with an email code"
│     ├─ account.js            NEW  Settings › Account: signed-out card, email, sync status, Sync now, Devices,
│     │                             App lock, Change PIN, Export, Delete, restore-backup row
│     ├─ settings.js           ~ Account section first; the id row shows the account email when signed in
│     ├─ paywall.js            ~ renewal terms on every card (AC-11.5); web texts of AC-08.5
│     ├─ shell.js              ~ sync dot on the Settings entry; move banner on the old address
│     ├─ meeting.js, recorder.js  ~ "Recording is on the device that made it" (AC-05.3)
│     └─ icons.js              + cloud, cloud-off, device, shield, fingerprint, backspace
├─ styles/
│  ├─ components.css           + pin pad, lock screen, step sheet, device rows, sync status, banner (≤ 160 lines)
│  └─ screens.css              + account section (≤ 60 lines)
├─ proxy/
│  ├─ wrangler.toml            ~ [[d1_databases]] DB · mail binding · [triggers] crons · new vars ·
│  │                             ALLOWED_ORIGINS += https://app.stackdplatform.com · invocation logs off
│  ├─ migrations/0001_accounts.sql   NEW  §29
│  ├─ src/index.js             ~ identify() first; routes for auth, account, sync; credentials in CORS; scheduled()
│  ├─ src/db.js                NEW  the D1 statements, each bound to a user id; batch helper
│  ├─ src/auth/crypto.js       NEW  random, HMAC, PBKDF2, constant-time compare
│  ├─ src/auth/codes.js        NEW  start, verify, tickets
│  ├─ src/auth/pin.js          NEW  rules (four digits, weak list), set, check with lockout, change, reset
│  ├─ src/auth/sessions.js     NEW  create, identify, revoke, cookie and bearer handling, labels
│  ├─ src/auth/ratelimit.js    NEW  fixed windows on the rate table
│  ├─ src/account.js           NEW  profile, accept, sign-out, export, delete (+ RevenueCat delete)
│  ├─ src/sync.js              NEW  validate changes, apply with revisions, pull, summary, quotas
│  ├─ src/mail/index.js, mail/{provider}.js, mail/templates.js   NEW
│  ├─ src/retention.js         NEW  the daily clean-up
│  ├─ src/entitlement.js       ~ tester flag for accounts
│  ├─ src/pool.js              ~ getUsed sums the legacy ids for the period
│  └─ test/run.mjs             ~ + auth, sessions, sync, isolation, retention on a real SQL engine (node:sqlite)
├─ plugins / package.json      + the biometric plugin and a secure-storage plugin for Capacitor 8
├─ android/…/AndroidManifest.xml   + USE_BIOMETRIC
├─ .github/workflows/
│  ├─ ios-testflight.yml       ~ PlistBuddy adds NSFaceIDUsageDescription; Podfile greps for the two plugins
│  ├─ proxy.yml                ~ d1 migrations apply before deploy
│  └─ site.yml                 NEW  build --site and deploy to Cloudflare on push to main
├─ scripts/
│  ├─ build-www.mjs            ~ --site adds the legal pages and _headers
│  ├─ check-sync.mjs           NEW
│  ├─ check-lock.mjs           NEW
│  ├─ check-origins.mjs        NEW
│  └─ check-store.mjs          ~ applyRemote, replaceRecords, isUntouchedSeed
├─ sw.js                       SHELL += src/{legal,net,account,secure,sync,lock,backup,pretheme,filefallback}.js,
│                              src/ui/{pinpad,signin,lockscreen,account}.js; VERSION 'stackd-v1.6.0'
└─ docs/                       prd-accounts.md, plan-accounts.md, qa-report.md (+1.6.0 and its Security review entry)
```

---

## 32. Core Interfaces & Types (additions)

```js
/** @typedef {'list'|'task'|'note'|'meeting'|'settings'} Kind */
/** @typedef {{ kind: Kind, id: string, changedAt: number, deleted: boolean, data: object|null }} Change */
/** @typedef {{ id: string, platform: 'web'|'ios'|'android', label: string, createdAt: number, lastSeenAt: number, current: boolean }} Device */
/** @typedef {{ id: string, email: string, createdAt: number, pinVersion: number, accepted: { terms, privacy }, current: { terms, privacy }, devices: Device[] }} Account */
/** @typedef {'immediately'|'5m'|'1h'|'off'} LockAfter */
/** @typedef {'synced'|'syncing'|'pending'|'offline'|'paused'} SyncState */
/** @typedef {'upload'|'download'|'ask'} MergePlan */
// ErrorCode gains: 'rate_limited'|'code_wrong'|'code_expired'|'pin_wrong'|'pin_locked'|'pin_weak'|'underage'
//                 |'accept_required'|'pin_required'|'signed_out'|'quota'|'conflict'

// src/legal.js
export const APP_ORIGIN = 'https://app.stackdplatform.com';
export const TERMS_URL, PRIVACY_URL, DELETION_URL;        // under APP_ORIGIN
export const TERMS_VERSION, PRIVACY_VERSION;              // the effective dates of the two pages
export function isLegacyOrigin(host = location.hostname): boolean;

// src/net.js — no store import beyond the ids it sends
export function setFetch(fn), setUpload(fn);              // moved here from ai.js, re-exported there
export function request(path, { method, body, signal, auth = 'auto' }): Promise<object>;   // throws { code, message, … }
export function upload(path, formData, { onProgress, signal }): Promise<object>;
export function onSignedOut(fn): void;                    // 'signed_out' from any call → account.forget()

// src/account.js
export const ACCOUNT_KEY = 'stackd-account';
export function init(): void;                             // reads the key; no network when absent
export function signedIn(): boolean;
export function current(): { userId, email, sessionId, platform, lock, pinVersion } | null;
export function onChange(fn): void;
export function ageRefusedUntil(): number;                // 0 when not refused
export function checkAge(year, now = new Date()): boolean;   // false also writes the 24 h refusal
export function start(email): Promise<void>;
export function verify(email, code): Promise<{ ticket, account: 'new'|'existing', pinLocked: boolean }>;
export function register(ticket, pin): Promise<Account>;  // sends adult, versions, label, legacyId
export function signIn(ticket, pin): Promise<Account>;
export function resetPin(ticket, pin): Promise<Account>;
export function changePin(pin, newPin): Promise<void>;
export function accept(): Promise<void>;
export function refresh(): Promise<Account>;              // GET /v1/account
export function signOutDevice(sessionId): Promise<void>;
export function signOut({ everywhere = false, keepData }): Promise<void>;
export function exportData(): Promise<Blob>;
export function deleteAccount({ pin, ticket, keepData }): Promise<void>;
export function forget({ keepData }): void;               // local half of sign-out; also after 'signed_out'
export function deviceLabel(): string;                    // 'iPhone' | 'Android' | 'Browser on Windows' …

// src/secure.js — shells only; resolves null on the web
export function available(): boolean;
export function get(key), set(key, value), remove(key): Promise<…>;

// src/sync.js — pure part
export const KINDS: Kind[];
export function canonical(value): string;                 // JSON with sorted keys
export function hash(text): string;                       // 53-bit, hex; not cryptographic
export function toWire(kind, record): object;
export function fromWire(kind, data, local | undefined): object;
export function collect(S): Map<string, { kind, id, data }>;          // 'task:a1b2' → wire form
export function diff(collected, shadow, now): Change[];
export function mergePlan(local: { untouched: boolean, counts }, remote: { counts }): MergePlan;
export function nextChangedAt(now, serverOffset, previous): number;
// runner
export function request(reason?): void;                   // debounced; no-op when signed out or locked out
export function now(): Promise<void>;                     // Sync now
export function firstSync(choice: 'upload'|'download'|'merge'|'replace'): Promise<void>;
export function state(): { state: SyncState, pending: number, lastSyncAt: number|null, paused: { code, at } | null };
export function onState(fn): void;
export function reset({ keepShadow }): void;              // sign-out

// src/store.js — additions (no schema change)
export const SEED_TITLES: string[];
export function isUntouchedSeed(state = S): boolean;
export function exportRecords(): { lists, tasks, notes, meetings, settings };
export function applyRemote({ upserts: { kind, record }[], deletes: { kind, id }[] }): void;
                                                          // no touch(), no updatedAt change; save + render + afterCommit skipped
                                                          // for sync; drops media of meetings deleted remotely
export function replaceRecords(records): void;            // "Use my account"

// src/lock.js
export function shouldLock({ after: LockAfter, lastActiveAt, now, booting }): boolean;
export function backoffMs(fails): number;                 // 0,0,0,0,30 s, 60 s, 120 s …
export function makeVerifier(pin): Promise<{ salt, hash }>;
export function checkVerifier(pin, verifier): Promise<boolean>;
export function locked(): boolean;
export function lock(), touch(): void;                    // touch(): record activity
export function unlockWithPin(pin): Promise<{ ok: true } | { ok: false, code: 'pin_wrong'|'pin_locked'|'wait', left?, waitMs? }>;
export function biometricsAvailable(): Promise<false | 'face' | 'fingerprint' | 'other'>;
export function unlockWithBiometrics(): Promise<boolean>;
export function setLock(patch: { after?: LockAfter, biometrics?: boolean }, pin): Promise<void>;

// src/backup.js
export const BACKUP_KEY = 'stackd-v2-backup', BACKUP_DAYS = 30;
export function keep(reason: 'merge'|'replace'): void;
export function info(): { savedAt, reason, counts } | null;
export function restore(): void;                          // signs out first, then puts the document back
export function purgeOld(now = Date.now()): void;
export function recordingKeys(): string[];                // for media.orphans()
export function exportFile(): Blob;                       // the old-address "Download my data"
export function importFile(file): Promise<{ counts }>;    // validates shape, runs withSettings + sanitize; signed out only

// src/purchases.js — additions
export function identify(userId): Promise<void>;          // logIn + syncPurchases
export function anonymous(subscriberId): Promise<void>;   // back to the device id on sign-out

// src/ui/pinpad.js
export function pinpadHTML({ label, length = 4, error, disabled }): string;
export function bindPinpad(root, { onComplete(pin), onChange(n) }): { clear(), shake(), focus() };

// src/ui/signin.js
export function openSignIn({ reason }: { reason?: 'plan'|'settings' }): void;
export function openMergeDialog(local, remote): Promise<'merge'|'replace'|null>;
export function openSignOutDialog(): Promise<{ keepData: boolean } | null>;

// src/ui/lockscreen.js
export function lockHTML(): string;
export function bindLock(): void;

// src/ui/account.js
export function accountSectionHTML(): string;
export function bindAccountSection(root): void;

// proxy/src/auth/sessions.js
export function identify(request, env): Promise<{ kind: 'account', userId, sessionId, pinVersion } | { kind: 'anon', subscriberId }>;
export function createSession(env, { userId, platform, label, pinVersion }): Promise<{ id, token }>;
export function sessionResponse(body, { token, client }): Response;   // Set-Cookie for web, token in body for shells
export function revoke(env, userId, { sessionId, allBut }): Promise<void>;

// proxy/src/auth/pin.js
export function validPin(pin): 'ok' | 'pin_weak' | 'bad_request';
export function setPin(env, userId, pin): Promise<{ salt, hash }>;
export function checkPin(env, user, pin): Promise<{ ok: true } | { ok: false, code: 'pin_wrong'|'pin_locked', left: number }>;

// proxy/src/sync.js
export const LIMITS = { changes: 200, bytes: 4_000_000, record: 1_000_000, records: 20_000, account: 50_000_000, pull: 500 };
export function validChange(c): boolean;                  // kind, id pattern, changedAt, data shape per kind
export function apply(env, userId, changes, now): Promise<{ accepted: number, rejected: { kind, id, reason }[] }>;
export function pull(env, userId, cursor): Promise<{ changes: Change[], cursor: number, more: boolean }>;

// proxy/src/mail/index.js
export function send(env, { to, template, vars }): Promise<void>;
```

---

## 33. Component Inventory (additions)

| Component | Source of styling | Used by |
|---|---|---|
| Step sheet (1 of 4, Back, title, one field, primary button) | Premium sheet (§6) with a step line | sign-in |
| Year picker | native `<select>`, no default option | Age step |
| Code field | Finance input, `inputmode="numeric"`, `autocomplete="one-time-code"`, wide letter-spacing | Code step, reset, delete |
| PIN pad | new: four dots + 3 × 4 round keys ≥ 56 px, `aria-live` count | sign-in, lock screen, change PIN |
| Lock screen | full-height centred card on the page background | app |
| Account card (signed out) | Finance `.card` with one primary button | Settings |
| Sync status line | `.set-sub` text + state icon | Settings › Account |
| Sync dot | 8 px accent dot on the Settings entry | sidebar, mobile nav |
| Device row | Flush row (§6): icon, label, "last active", Sign out | Settings › Account |
| Merge dialog | confirm dialog with two option cards and counts | first sign-in |
| Move banner | Disclaimer banner (§6) with a button | old address |
| Plan card renewal line | `.hint` directly above the button | paywall |

---

## 34. Implementation Phases (the roadmap, continued)

Numbering continues from §24. Same rules, with two changes for this
release: phases are committed on the branch `release/1.6.0`, not on
`main` (AC-13.6), and the release phase includes the security review.
Estimates are focused build time.

### Phase 23 — Branch, new address, headers, export and import · M (~6 h + owner tasks) — US-12, AC-11.6, AC-13.6
- Owner: Cloudflare site for `app.stackdplatform.com`; D1 database
  created with `--jurisdiction=eu`; mail provider decision and DNS; legal
  name and contact address.
- `release/1.6.0` branch. `src/legal.js`; URL constants move out of
  `paywall.js`. `index.html` inline scripts → `src/pretheme.js`,
  `src/filefallback.js`. `_headers`. `build-www.mjs --site`. `site.yml`.
- `src/backup.js` `exportFile` / `importFile`; Settings row "Import a
  Stack'd file" (signed out); move banner and **Download my data** on the
  old address.
- `scripts/check-origins.mjs`; proxy `ALLOWED_ORIGINS`.
- **Done when:** the app runs from the new address with the CSP header
  and no console violation; a file exported at the old address imports
  at the new one with every task, note and meeting; AC-12.1 to 12.4 and
  AC-11.6 pass. This phase alone may be merged to `main` early, since it
  contains no account code.

### Phase 24 — Sign-in on the server · L (~9 h) — US-02, US-03, US-04, US-09 (server half)
- Migration `0001`; `db.js`; `auth/crypto.js`, `codes.js`, `pin.js`,
  `sessions.js`, `ratelimit.js`; `account.js` (profile, accept,
  sign-out); `mail/*` with the five templates; `identify()` in front of
  the router; CORS credentials; `retention.js` and the cron trigger;
  `proxy.yml` applies migrations.
- `proxy/test/run.mjs` on `node:sqlite`: wrong, expired and reused codes;
  the 5-attempt and 5-per-hour limits; identical answers for known and
  unknown emails; register requires `adult` and current versions; weak
  PINs; lockout after five and refusal of a correct PIN while locked;
  reset deletes other sessions; change bumps `pin_version` and other
  sessions get `pin_required`; a revoked or 90-day-old session gets
  `signed_out`; cookie requests without an allowed `Origin` are refused;
  no test output contains an email or a PIN.
- **Done when:** a scripted client registers, signs in as a second
  device, is locked out, resets, and the three notices are produced by a
  stub mail adapter; AC-02.6 to 02.9, AC-03.3 to 03.7, AC-04.2, AC-04.4,
  AC-04.5 hold at the API.

### Phase 25 — Sign-in UI · M (~7 h) — US-02, US-03, US-04, US-14
- `net.js` (and `ai.js` moved onto it), `account.js`, `secure.js`
  (plugin added to both shells), `ui/pinpad.js`, `ui/signin.js`,
  `ui/account.js` with the signed-out card, email, Devices, Change PIN;
  re-accept flow; `settings.js` and `icons.js` changes.
- `check-ai.mjs` still passes through `net.js`; new cases for
  `signed_out` and `accept_required`.
- **Done when:** AC-01.1 to 01.3, AC-02.1 to 02.5, AC-03.1, 03.2, 03.6,
  AC-04.1, 04.3, 04.6, AC-14.1 to 14.3 pass on web at 375 px and
  1280 px and in both shells; an under-18 year stops the flow for 24 h.

### Phase 26 — Sync · L (~11 h) — US-05, US-06
- `sync.js` pure part first, with `check-sync.mjs`; then `proxy/src/sync.js`
  with its tests (the outcome table of §30, isolation between two users,
  quotas, paging); then the runner, the triggers in `app.js`,
  `store.applyRemote` / `replaceRecords` / `isUntouchedSeed`, the focus
  rule for inbound changes, status line and dot.
- `backup.js` slot, merge dialog, sign-out dialog, restore-backup row;
  `media.orphans` honours the backup; "Recording is on the device that
  made it".
- **Done when:** AC-05.1 to 05.11 and AC-06.1 to 06.8 pass with two
  browsers and one phone, including: offline edits on both sides, a
  delete against an edit, a device clock set one day back, 500 / 500 / 50
  records within the time limits.

### Phase 27 — The plan on the account · M (~5 h + sandbox) — US-08
- `purchases.identify` / `anonymous`; `legacyId` at sign-in; pool sum
  over legacy ids; tester flag; handlers use the identity's pool id;
  paywall texts for the web; the id row in Settings.
- **Done when:** AC-08.1 to 08.7 pass: a tester account shares one
  allowance between phone and PC; a sandbox purchase made before
  registering follows the account; a forged `X-Stackd-Subscriber` on a
  signed-in request changes nothing.

### Phase 28 — App lock and biometrics · M (~7 h + devices) — US-07
- Spike first (1 h): the biometric and secure-storage plugins answer
  through `Capacitor.Plugins` on both shells; if a call needs the JS
  wrapper, it is bundled as `purchases.js` documents for RevenueCat.
- `lock.js`, `ui/lockscreen.js`, the lock gate in `render()`, activity
  tracking, settings rows; `NSFaceIDUsageDescription` and
  `USE_BIOMETRIC`; `check-lock.mjs`.
- **Done when:** AC-07.1 to 07.8 pass: unlock by PIN offline on all
  three platforms, by Face ID / Touch ID on the iPhone and by fingerprint
  on the Android phone; a PIN changed on the PC is asked for on the
  phone.

### Phase 29 — Rights and the legal surface · M (~6 h) — US-10, US-11
- Export and delete (client and server, RevenueCat delete, final mail);
  `account-deletion.html`; `privacy.html` and `terms.html` rewritten with
  the owner's details; renewal line on every plan card; log review
  against AC-11.7.
- Owner: store privacy forms, processing agreements, the lawyer's read.
- **Done when:** AC-10.1 to 10.6 and AC-11.1 to 11.9 are ticked; after a
  test deletion the database holds no row for that user in any table.

### Phase 30 — QA, security review, release 1.6.0 · M (~5 h + two phones) — US-13, US-14, US-01
- QA walk of `docs/prd-accounts.md` per `agents/qa_tester.md` on two
  phones and a PC; the 1.5.0 regression walk signed out (AC-01.4);
  findings fixed.
- `/security-review` on `release/1.6.0` against `main`, with the AC-13.5
  targets; high findings fixed; the entry written to
  `docs/qa-report.md`.
- README, `VERSION` `stackd-v1.6.0`, `npm run check`, `npm run bundle`,
  merge to `main`, then the workflows: proxy (with migrations), site,
  iOS, Android.

Order rationale: the address moves first because cookies, the CSP and
the legal URLs all depend on it, and it is the only phase safe to ship
alone; the server precedes its UI so the UI is built against real
answers; sync needs a session; the plan needs both; the lock is
independent of sync and waits for the plugin spike; the legal pages come
late so they describe what was actually built; the review comes last so
it sees everything.

---

## 35. Acceptance criteria → phase

| PRD criterion | Phase |
|---|---|
| AC-01.1 – 01.3 | 25 |
| AC-01.4 | 30 |
| AC-02.1 – 02.5 | 25 |
| AC-02.6 – 02.9 | 24 (API), 25 (messages) |
| AC-03.1, 03.2, 03.6 | 25 (03.1 rules: 24) |
| AC-03.3 – 03.5, 03.7 | 24 |
| AC-03.8 | 29 (texts) |
| AC-04.1, 04.3, 04.6 | 25 |
| AC-04.2, 04.4, 04.5 | 24 |
| AC-05.1 – 05.11 | 26 |
| AC-06.1 – 06.8 | 26 |
| AC-07.1 – 07.8 | 28 |
| AC-08.1 – 08.7 | 27 |
| AC-09.1 – 09.3, 09.5 | 24 |
| AC-09.4 | 23 (DNS), 30 (three mailboxes) |
| AC-10.1 – 10.6 | 29 |
| AC-11.1 – 11.5, 11.7 – 11.9 | 29 |
| AC-11.6 | 23 |
| AC-12.1 – 12.4 | 23 |
| AC-13.1 – 13.3, 13.5 | 30 |
| AC-13.4 | done (README, workflow doc) |
| AC-13.6 | 23 |
| AC-14.1 – 14.3 | 25 (sign-in), 26, 28, 29 for their own screens |
| AC-14.4 | each phase for its files; 30 verified |

---

## 36. Risks and Mitigations (1.6.0)

| Risk | Mitigation |
|---|---|
| Whoever controls the mailbox can reset the PIN and take the account | Inherent to reset by email and stated in §28. A reset deletes every other session and mails a notice; hardening later: a waiting period before a reset takes effect. |
| A stolen database reveals PINs (10 000 values) | The PIN hash is keyed with a Worker secret that is not in the database; PBKDF2 at the runtime's ceiling on top. |
| A device clock that is wrong loses or wins every conflict | `changedAt` uses server-corrected time and is always above the last synced value; the server clamps to its own clock. |
| Inbound sync re-renders while the user types | Inbound changes wait while an editable element has focus; the shadow is updated before applying, so no echo. |
| Manual reordering renumbers a whole board and floods sync | 200 changes per request with paging; hashing makes unchanged records free; measured in Phase 26 against AC-05.11. |
| First merge doubles the sample data or loses real data | `isUntouchedSeed`; the backup slot; `mergePlan` and the merge paths in `check-sync.mjs` before any UI. |
| "Use my account" or "Remove from this device" orphans recordings | Backup keys count as referenced; "Remove" counts the recordings and asks again. |
| The session cookie is not sent (browser treats the API as third party) | App and API share the registrable domain, so the cookie is same-site; verified in Safari, Firefox and Chrome in Phase 25. Local development uses `wrangler dev` with the app on `localhost`. |
| Cross-site request forgery on cookie routes | `SameSite=Strict`, mandatory allowed `Origin`, and a custom header that forces a preflight. |
| GitHub Pages redirect or missing headers | Avoided: the new address is on Cloudflare, the old one is left as it is (§28). |
| Recordings made in the browser at the old address cannot move | Stated in the banner; transcripts and minutes move in the file; phones are unaffected. |
| The biometric or secure-storage plugin is not reachable through the bridge | One-hour spike at the start of Phase 28; fallback is bundling the wrapper as for RevenueCat; the PIN works regardless. |
| RevenueCat does not move the purchase on `logIn` from a custom id | `syncPurchases` after `logIn`, with the project's restore behaviour set to transfer; verified in the Phase 27 sandbox run before anything else in that phase. |
| Cloudflare's email service is still beta, or the Worker is on the free plan | The mail adapter; an HTTP provider behind the same interface. |
| Worker logs capture addresses or emails | Invocation logs off; emails only in POST bodies, never in URLs; a test greps the captured console output. |
| D1 limits (row size, statement count per batch) | 1 MB per record and 200 changes per request stay well inside them; a transcript near the limit is refused with `too_large` rather than truncated. |
| The lock is mistaken for encryption | Texts in Settings and the policy (AC-03.8); the review in Phase 30 checks them. |
| The CSP breaks the shells or the `file://` bundle | The CSP is a response header of the web host only; shells and `file://` never receive it. |
| Service-worker shell drift with thirteen new files | `check-shell.mjs`; VERSION bump in Phase 30. |
| Secrets in the public repository | Peppers and the mail key are Worker secrets; tester status is a database flag; `check-origins.mjs` and the security review both look for stray keys. |

---

## 37. Checks added to `npm run check`

| Script | Covers |
|---|---|
| `scripts/check-sync.mjs` (new) | `canonical` key order and stability; `hash` on equal and different input; `toWire` strips the device-only fields for every kind; `fromWire(toWire(x), x)` round trip; `diff` for new, changed, unchanged and removed records; `nextChangedAt` with a clock a day behind; `mergePlan` for the four cases; the runner against a fake `net.request`: push then apply, rejected `older` and `deleted`, paging, back-off, nothing sent when signed out. |
| `scripts/check-lock.mjs` (new) | `shouldLock` for each setting around its boundary and at boot; `backoffMs`; verifier round trip and a wrong PIN; `checkAge` at the 18-year boundary and the 24-hour refusal. |
| `scripts/check-origins.mjs` (new) | Every URL in `index.html`, the legal pages, `styles/`, `src/`, `app.js` and `sw.js` is on the allow-list (the app origin, the proxy, the store management links, XML namespaces); fails on anything else, and on a string shaped like a provider key. |
| `scripts/check-store.mjs` (extended) | `applyRemote` does not change `updatedAt`, keeps a meeting's local `recording` and a task's `reminderFiredAt`, removes media for a remotely deleted meeting through the injected stub; `replaceRecords`; `isUntouchedSeed` on a fresh seed, after one edit, and on a 1.5.0 store; a signed-out store written by 1.6.0 equals what 1.5.0 would write. |
| `scripts/check-ai.mjs` (extended) | The AI steps through `net.js`; `signed_out` forgets the session once; a signed-in request sends no reliance on `X-Stackd-Subscriber`. |
| `scripts/check-shell.mjs` (unchanged) | Fails until the thirteen new files are in SHELL. |

The proxy's `npm test` gains the Phase 24 and Phase 26 cases listed in
§34, run against `node:sqlite` through a thin D1-shaped adapter so the
SQL in `db.js` is the SQL that is tested; `proxy.yml` runs it before the
migrations and the deploy.

---

# Part V — Improvements and shared boards (1.6.0, `docs/prd-improvements.md`)

Implements `docs/prd-improvements.md`. Structural code only. Phases 31
to 33 touch the device only and are built before Phase 24; phases 34 and
35 sit on top of Part IV's sync.

## 38. Approach

- **The render stays whole-screen.** The view jump of US-01 is fixed
  where it is caused: `render()` in `app.js` records the scroll offsets
  of the screen it is about to replace and puts them back when the new
  screen has the same key. No screen keeps its own scroll code.
- **The origin lane lives in memory.** A `Map` in `store.js`, never
  saved, never exported, never synced (AC-01.3).
- **One hold gesture.** `src/ui/gestures.js` owns press timing for
  Kanban cards and board rows: hold to lift, hold longer for the delete
  badge. `bindCard` and the board rows are thin callers.
- **A board carries its cards.** Archiving or deleting a board sets a
  status on the board record only. Its cards keep their own status and
  become invisible because every "live" selector also requires a live
  board (AC-10.4, 10.7).
- **Sharing is a second sync space, not a second sync.** A shared board
  and its tasks are stored once on the server under the board's space,
  and each member's device runs the same push / pull loop against that
  space with its own cursor (§41).

## 39. Data Schema additions

### On the device (`stackd-v2`, no migration beyond defaults)

```
list   + status: 'active' | 'archived' | 'deleted'   (missing = 'active')
       + archivedAt: number | null
       + deletedAt:  number | null
       lanes: the lane with id 'done' is always last (withSettings moves it)
       + share: null | { spaceId, role: 'owner' | 'member', ownerEmail,
                         members: [{ email, role, state: 'active' | 'pending' }] }
                                                   (Phase 35; device copy of server truth)
S      + invites: [{ id, boardName, ownerEmail, expiresAt }]   (Phase 35)
```

Not persisted: `doneOrigin: Map<taskId, { listId, lane }>` in `store.js`.

### Transient UI state additions (`UI`)

```
menuSlide: boolean      // the next render of 'lists' animates in from the left
folderKind: + 'boards'
```

### In D1 (`proxy/migrations/0002_sharing.sql`, Phase 34)

```sql
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,             -- equals the board id
  owner_id TEXT NOT NULL REFERENCES users(id),
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  email_hash TEXT NOT NULL,        -- keyed hash, as login_codes
  board_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (space_id, email_hash)
);
CREATE TABLE space_records (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('board','task')),
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  PRIMARY KEY (space_id, kind, id)
);
CREATE INDEX space_records_rev ON space_records (space_id, rev);
```

### Invariants (tested in `check-store.mjs`, `check-sync.mjs`, `proxy/test`)

- `lanesOf(id).at(-1).id === 'done'` for every board after load.
- `renameLane` and `moveLane` refuse the Done lane; `moveLane` never
  swaps a lane with Done.
- At least one board has `status === 'active'`.
- `tasksOf`, `openCount`, `planReminders` and `allTags` ignore cards
  whose board is not active.
- `doneOrigin` is absent from `save()`, `exportRecords()` and the wire.
- A space's records are readable and writable only by rows in
  `space_members`; a removed member's next request gets `gone`.
- A shared board's tasks never appear in the owner's personal records.

## 40. File & Folder Structure (delta)

```
src/
  store.js            + doneOrigin, activeLists, folderBoards, reorderList,
                        archiveList, softDeleteList, restoreList, deleteListForever
  ui/
    gestures.js       NEW  hold-to-lift, hold-longer delete badge, swipe-to-menu
    addmenu.js        NEW  the "+" grid
    board.js          Done lane locked; pageTitleHTML / bindPageTitle; bindCard on gestures.js
    shell.js          menu header, Archive & Bin, board rows on gestures.js
    folders.js        two pages, Boards kind
    primitives.js     toast fade; choiceDialog; overlay exported
    sharing.js        NEW (Phase 35)  new-board chooser, people sheet, invitations
  share.js            NEW (Phase 35)  calls to /v1/spaces, device copy of members
proxy/
  migrations/0002_sharing.sql   NEW (Phase 34)
  src/spaces.js                 NEW (Phase 34)
```

## 41. Core Interfaces & Types (additions)

```js
/* gestures.js */
bindHold(el, {
  ignore,                 // selector: presses on these start nothing
  canDrag(), canArm(),    // () => boolean
  onTap(),                // release without hold or movement
  onDragStart(), onDragMove(ev), onDrop(), onDragEnd(),
  scroller, axis,         // element auto-scrolled near its edge, 'x' | 'y'
  deleteLabel(),          // accessible name of the badge
  onDelete(),             // badge pressed
})
disarm()                  // removes the badge, if any
bindMenuSwipe(root, { enabled(), open() })

/* store.js */
activeLists(): List[]
folderBoards(status): List[]
reorderList(id, beforeId | null)
archiveList(id) / softDeleteList(id): prev | null
restoreList(id) / deleteListForever(id)

/* primitives.js */
choiceDialog(title, body, [{ id, label, danger? }]): Promise<id | null>
```

### Endpoints (Phase 34), all behind `identify()`

```
POST   /v1/spaces                { boardName, emails[] }           → { id, shared }  (the server makes the id)
GET    /v1/spaces                                                  → { spaces[], invites[] }
POST   /v1/spaces/:id/invite     { emails[] }                      → 204 (same for known and unknown)
POST   /v1/spaces/:id/remove     { email }                         → 204   (owner)
POST   /v1/spaces/:id/leave                                        → 204   (member)
DELETE /v1/spaces/:id                                              → 204   (owner)
POST   /v1/invites/:id/accept | decline                            → 204
POST   /v1/sync                  { cursor, changes, spaces: { [id]: { cursor, changes } } }
                                 → { changes, cursor, spaces: { [id]: { changes, cursor } | { gone: true } } }
```

The space id is the board's id on every device, and the server makes it
(`s_` and 16 random characters); a client never chooses one, so a space
cannot be opened under a board that already exists (security review of
2026-11-16, docs/qa-report.md). A device attaches a space only to a board
it created through `createShared` or pulled from that space, never to a
personal board. The outcome table of §30 applies per space with
`spaces.rev` as the counter. Limits: 10 members per space, 20 pending invitations per space,
20 invitations per account per day.

## 42. Component Inventory (additions)

| Component | Where | Notes |
|---|---|---|
| Delete badge | `.hold-del` in `gestures.js` | 24 px circle, `::after` hit area 44 px, primary colour, focusable button |
| Lane drop mark | `.lane.dropover` | inset ring + tint, 150 ms |
| Page title with chevron | `pageTitleHTML(label)` | mobile only; desktop keeps the plain `h1` |
| Add menu | `addmenu.js` | sheet with a 2 × 2 grid of tiles |
| Choice dialog | `primitives.js` | Cancel plus two or more actions |
| Board row | `.lrow[data-id]`, `.side-item[data-id]` | `role="button"`, hold gestures, Delete key |
| Shared mark | `sharing.js` | chip next to the board title, opens the people sheet |

## 43. Implementation Phases (the roadmap, continued)

### Phase 31 — Kanban · M (~5 h) — US-01 to US-05
- `app.js` scroll keeping; `store.js` `doneOrigin`, Done pinned and
  locked; `gestures.js` `bindHold`; `bindCard` rewritten on it; drop
  mark; toast fade.
- **Done when:** AC-01.x to AC-05.x pass at 375 px and 1280 px.

### Phase 32 — Navigation and the Add menu · M (~5 h) — US-06 to US-09
- `pageTitleHTML`; Archive & Bin; `folders.js` as two pages;
  `bindMenuSwipe`; menu header; `addmenu.js`; `sw.js` SHELL.
- **Done when:** AC-06.x to AC-09.x pass.

### Phase 33 — Boards · M (~5 h) — US-10
- Board status and selectors; board rows on `bindHold`; `choiceDialog`;
  Boards kind in the two pages; purge; `backup.js` keeps board status;
  reminders ignore non-active boards.
- **Done when:** AC-10.x pass; `check-store.mjs` and `check-backup.mjs`
  cover board status, restore and purge.

### Phase 34 — Shared boards on the server · L (~9 h) — US-12
- After Phase 26. Migration `0002`; `spaces.js`; `/v1/sync` gains the
  `spaces` map; invitation hashing and limits; retention of expired
  invitations.
- **Done when:** a scripted owner and member create, accept, edit both
  ways, remove and leave; a non-member gets `gone`.

### Phase 35 — Shared boards in the app · L (~9 h) — US-12, AC-11.1
- New-board chooser; `share.js`; people sheet; invitations card and
  dot; Settings › Shared boards; 30 s pull while visible; Terms and
  Privacy wording.
- **Done when:** AC-12.x pass with two accounts on two devices.

## 44. Checks added to `npm run check`

| Script | Covers |
|---|---|
| `scripts/check-store.mjs` (extended) | origin lane within a session and after a reload; Done pinned, not renamable, not movable; board reorder, archive, delete, restore, purge after 30 days, last board kept; live selectors skip non-active boards. |
| `scripts/check-backup.mjs` (extended) | a board's status and dates survive export and import; a file with no active board is refused. |
| `scripts/check-reminders.mjs` (extended) | no reminder is planned for a card on a non-active board. |
| `scripts/check-shell.mjs` (unchanged) | fails until `gestures.js` and `addmenu.js` are in SHELL. |

---

## 45. As built: phases 24 to 28 (2026-11-16)

Where the build departs from Part IV, and what it still waits for.

**Departures**
- *Hashes are hex `TEXT`, not `BLOB`* (`proxy/migrations/0001_accounts.sql`),
  so a row reads the same in D1 and in the `node:sqlite` adapter the tests
  use (`proxy/test/d1.mjs`).
- *Register, sign-in and reset send the email with the ticket.* The ticket
  row only knows the email's keyed hash; the server checks both agree.
  The ticket survives a wrong PIN, so the user can try again or go on to
  reset within its ten minutes; the PIN's own count of five still applies.
- *A used code says so*: new error code `code_used` beside `code_wrong` and
  `code_expired` (AC-02.6). A missing ticket is `ticket_expired`.
- *Two paths into the sheet*: "Create an account" asks the age first
  (AC-02.1); "I have an account" starts at the email (AC-04.1). After the
  code, a new email on the sign-in path gets the age step before its PIN,
  and a known email on the create path goes to "Enter your PIN". Only
  `adult: true` is ever sent.
- *Age boundary*: "younger than 18 on 1 January of this year" is read
  strictly from the year alone: born in or before `year − 19`.
- *An empty account takes the device's data, samples included*
  (`mergePlan` has no `fresh` case). A second device with untouched
  samples then downloads instead of adding its own, which is what AC-06.1
  is for.
- *Incoming records are cleaned like an imported file*: `backup.cleanRemote`
  runs every pulled record through the import validators before
  `store.applyRemote`, so a record written by another device (or anyone
  holding the session) cannot carry markup or values the views do not
  expect.
- *Plan on the account*: `pool.getUsed` / `reserve` take the account's
  legacy ids and add their usage this period; the charge goes to the
  account's own pool. A tester account is flagged in `users.tester`.
- *`X-Stackd-Client`* names the platform on every request (`web`, `ios`,
  `android`); the session answer sets the cookie for `web` only.

**Local development**: `proxy/wrangler.dev.toml` (never deployed: public
placeholder peppers) with a local D1 file and the mail stub; launch
configuration `proxy-accounts`; `GET /v1/dev/mail?to=` shows the stub's
last message, served only with `DEV_MAIL=1` on localhost. Point the app at
`http://localhost:8787` in Settings › Developer.

**Still waiting**
- *Owner*: the EU D1 database, the two peppers, the mail provider (only
  the stub exists; `mailReady` is false otherwise and every account route
  answers `misconfigured`), `TERMS_VERSION` / `PRIVACY_VERSION` /
  `OWNER_FOOTER` in `[vars]` matching `src/legal.js`, then uncommenting
  the D1 block and the cron trigger in `wrangler.toml`.
- *Shells*: a secure-storage plugin for Capacitor 8 exposing
  `get / set / remove` as `Capacitor.Plugins.SecureStorage`, and a
  biometric plugin exposing `isAvailable / verify` as
  `Capacitor.Plugins.Biometric`. Until both are chosen and added,
  `secure.available()` is false in the shells and they offer no sign-in
  ("Sign-in arrives in the next update"); the biometric switch is hidden.
  `NSFaceIDUsageDescription` and `USE_BIOMETRIC` come with that plugin.
- *Phase 29*: the rewritten `privacy.html` / `terms.html`,
  `account-deletion.html`, renewal terms on every plan card.
- *Not built*: PC biometrics through WebAuthn (Should), the "Do not sync
  meetings" switch (Should), the "Recording is on the device that made
  it" line on a meeting without its audio (AC-05.3).

---

## 46. As built: phases 34 and 35, shared boards (2026-11-16)

Departures from §38 to §43:
- *Record kinds in a space are `list` and `task`* (not `board`), the same
  kinds as personal sync, so one wire form and one cleaner serve both.
- *Membership rides on every sync answer* (`shared: { spaces, invites }`)
  instead of a separate `GET /v1/spaces` per poll; `GET /v1/spaces`
  remains for an explicit refresh.
- *A shared board is never archived or deleted through sync*: the server
  refuses a board record with a status other than active (`not_allowed`).
  The owner's "Delete for everyone" deletes the space; that device keeps
  the board as a personal one in Deleted, with its cards, for 30 days. A
  member's remove action is "Leave".
- *Only new boards are shared.* "New board" asks Personal or Shared and a
  shared one is created on the server before it exists on the device, so
  it never enters the personal records and nothing has to move.
- *Pending invitations keep the invited address* (`invites.email`) so the
  owner can see and withdraw them; the row goes when the invitation is
  answered, withdrawn or 30 days old. Phase 29's privacy text must say so.
- *A refused change (`not_allowed`, e.g. a member's rename) resets that
  space's cursor to 0*, so the next sync pulls the server's version back
  and the device stops resending it.
- *Unknown priority levels on another person's card are kept* by letting
  the cleaner accept the card's own priority id; the views show none.
- *Deleting an account deletes the spaces it owns* (for every member), its
  memberships, the invitations it sent and those sent to its email.

Tests: `proxy/test/sharing.mjs` (create, invite, accept, who may change
what, isolation, the ten-person limit, decline, withdraw, remove, leave,
delete, expiry, account deletion) and the shared-board part of
`scripts/check-sync.mjs` (the app's engine against the Worker with a
second person over HTTP).

Not built: email to the invited person (Could), opening an archived board
read-only (Could), members inviting others (open question, now: owner only).

---

## 47. As built: phase 29, the legal surface (2026-11-16, draft)

- `privacy.html` and `terms.html` rewritten for accounts, sync and shared
  boards; effective 2026-11-16, which is now `TERMS_VERSION` /
  `PRIVACY_VERSION` in `src/legal.js` (and in `proxy/wrangler.dev.toml`).
  Re-date both pages and the constants, and set the same values in the
  Worker's `[vars]`, on the day they are published: every account is
  asked to accept again when they change.
- `account-deletion.html` is new and is now a required page of the site
  build (`scripts/build-www.mjs --site`); its URL (`DELETION_URL`) is the
  one for Google Play (AC-10.5).
- Each plan card shows the price per month, "renews automatically every
  month" and where to cancel, directly above its button (AC-11.5).
- Settings › Meetings & AI says what changes when signed in and links to
  the policy; Settings › Account links to both documents (AC-11.4).
- **Placeholders.** The pages carry `[OWNER: …]` where only the owner can
  write: legal name, postal address, the email provider and its region,
  the supervisory authority, and the copyright agent line.
  `check-origins.mjs` lists them on every run and fails once `VERSION` in
  `sw.js` is 1.6.0 or later, so no release ships them.
- Promises the pages make that the owner must keep: answering a deletion
  request by email within 30 days; reading copyright complaints at
  hi@stackdplatform.com.
- Not legal advice: a lawyer reads both pages before publishing (PRD §06).
