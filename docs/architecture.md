# Technical Architecture: Stack'd Minimalist v2

Implements `docs/prd.md`. Structural code only (schemas, interfaces, module
layout, phases); no application logic here.

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
index.html ─ loads styles/*.css, fonts, app.js (module)
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
│  └─ ui/
│     ├─ primitives.js         toast(), confirm(), openSheet(), openPopover(), menu()
│     ├─ shell.js              mobile header + bottom nav + FAB, desktop sidebar
│     ├─ board.js              list rows, kanban, desktop table, gestures (moved from app.js)
│     ├─ detail.js             detail screen, field rows, ⋯ menu, inline title
│     ├─ movecopy.js           Board/Lane sheet used by Move and Copy
│     ├─ schedule.js           Schedule popover: month grid + fields + validation
│     ├─ folders.js            Archived / Deleted screens
│     ├─ addsheet.js           add-task sheet (moved from app.js)
│     └─ icons.js              inline SVG strings (Finance set: home, list, archive, trash, …)
├─ styles/
│  ├─ variables.css            Finance tokens (light + dark), trimmed to what is used
│  ├─ base.css                 reset + global (from Finance reset/global, trimmed)
│  ├─ components.css           buttons, chips, sheets, nav pill, calendar, toast
│  └─ screens.css              board / detail / folders / onboarding layouts
├─ fonts/                      inter-latin(.ext).woff2, manrope-latin(.ext).woff2
├─ docs/                       prd.md, architecture.md
├─ sw.js                       SHELL += src/**, styles/**, fonts/**
└─ scripts/build-www.mjs       ASSETS += 'src', 'styles', 'fonts'
```

`ds.css` and `app.css` are deleted at the end of Phase 1.

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
