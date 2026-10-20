# Technical Architecture: Stack'd Minimalist

Implements three PRDs: `docs/prd.md` (tasks, v2 — §1–§8, shipped in 1.1.0
→ 1.3.0), `docs/prd-notes.md` (Notes, 1.4.0 — §9–§17, shipped) and
`docs/prd-meetings.md` (Meetings and paid plans, 1.5.0 — §18 onwards).
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
