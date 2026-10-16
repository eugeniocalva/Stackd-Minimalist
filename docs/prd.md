# Product Requirements Document (PRD): Stack'd Minimalist v2

Scope of this PRD: task fields in the detail screen, task actions menu
(move / copy / archive / delete), Archived and Deleted folders, a Trello-style
schedule popover with recurrence, and a design refresh towards Stack'd Finance.

Status: **draft for approval** — see §07 for the decisions needed before build.
Companion document: `docs/architecture.md` (data model, modules, phases).

---

## 00. Vocabulary (used consistently below)

| Term | Meaning | Today in code / UI |
|---|---|---|
| **Board** | Work, Personal, Shopping, Family… | `S.lists`, UI says "Lists" |
| **Lane** | Backlog, In Progress, Done (kanban columns) | `task.lane`, `LANES` |
| **Task** | A card / row | `S.tasks[]` |
| **Folder** | Archived, Deleted | does not exist |
| **View** | List or Kanban rendering of one board | `S.view` |
| **Schedule** | start date, due date + time, repeat rule, reminder | only `due` + a reminder label |

Recommendation (Q1): rename the UI so that Work/Personal are **Boards** and
Backlog/In Progress/Done are **Lanes**. The List ∕ Kanban view switch keeps
its name. The add-task sheet keeps a "Board" group (today "List"); inside an
existing task the same control is called **Move**.

---

## 01. Problem Statement

### The core problem
Once a task is created, its due date, priority, tags and board are frozen:
the detail screen only displays them. There is no way to move a task to
another board or lane except dragging on the kanban, no way to duplicate,
and no safety net: delete is immediate and permanent. Scheduling is a cycling
label with no real date, time, start, repeat or reminder behind it.

### Why now
The app is about to ship through TestFlight. Apple's Guideline 4.2 and real
daily use both need a task that can be edited after creation, recovered after
a mistake, and scheduled like a calendar item. The Finance app established a
visual language the user already trusts; the todo app should feel like the
same family.

### Current workarounds
Delete and recreate the task; keep the schedule in the title; use the kanban
drag as the only way to change lanes; nothing for archive or recovery.

---

## 02. Goals & Non-Goals

### Goals — users can
- Change due date, priority, tags, board and lane of an existing task without
  leaving the detail screen.
- Copy a task to any board/lane, archive it, or delete it, from one ⋯ menu.
- Browse Archived and Deleted folders, restore from either, and trust that
  deleted tasks are purged after 30 days.
- Set a start date, a due date with time, a repeat rule and a reminder from a
  calendar popover; recurring tasks roll forward when completed and stay in
  their lane.
- Use an app that looks and feels like Stack'd Finance (Inter/Manrope, soft
  surfaces, rounded cards, frosted bottom nav, Finance light + dark tokens).

### Non-Goals — this release does not include
- Accounts, sync, sharing, comments, attachments, checklists beyond the
  existing subtasks.
- Board rename / delete / reorder, custom lanes, custom automations.
- A cross-board calendar or "Today" view.
- Push notifications or background reminders (in-app / local notifications are
  a separate optional phase, see US-10).
- Localisation (labels stay English; weeks start on Monday).

---

## 03. User Stories with Acceptance Criteria

Every criterion must hold on mobile (≤ 899 px) and desktop (≥ 900 px), in
light and dark mode, and survive a reload (localStorage).

### US-01 — Edit task fields in the detail screen
*As a user, I want to see and change the due date, priority and tags of an
existing task so that I never have to delete and recreate it.*

- [ ] AC-01.1 The detail screen shows one row per field, in this order:
      **Due date · Priority · Tags · Move · Reminder**. Each row shows the
      current value or a placeholder ("Set date", "None", "Add tags…",
      "Work · Backlog", "None").
- [ ] AC-01.2 **Priority**: the row exposes chips None / Low / Medium / High.
      Selecting one saves immediately, the row and the task's chips in list,
      kanban and desktop table update, and priority sort reflects it.
- [ ] AC-01.3 **Tags**: existing tags show as chips with a remove (✕) control.
      "+ Add tag" asks for a name; the name is trimmed, a leading `#` is
      stripped, and duplicates (case-insensitive) are ignored. Tags used
      anywhere in the app are offered as suggestions. Changes save
      immediately.
- [ ] AC-01.4 **Due date** and **Reminder** rows both open the Schedule
      popover (US-07). After saving, the Due row shows e.g. "Fri, Oct 16 ·
      23:30" (time only if set) with a ↻ mark when repeating; the Reminder row
      shows e.g. "1 day before" or "None".
- [ ] AC-01.5 (Should) The title is editable inline: tap → text input;
      Enter or blur saves; an empty title reverts to the previous one.
- [ ] AC-01.6 The add-task sheet is unchanged except for the group label
      ("Board" if Q1 is approved) and "Pick date…" opening the new calendar
      (Should).

### US-02 — Move a task to another board or lane
*As a user, I want to move a task to another board, or to another lane of the
same board, from the task itself.*

- [ ] AC-02.1 The **Move** row shows "‹Board› · ‹Lane›". Tapping it (or
      choosing Move in the ⋯ menu) opens a sheet with two chip groups,
      **Board** (all boards) and **Lane** (Backlog / In Progress / Done), the
      current values pre-selected, and a primary **Move** button.
- [ ] AC-02.2 Confirming updates the task's board and lane. The task is
      appended at the end of the target lane (manual order). Moving into Done
      marks the task done; moving out of Done marks it not done.
- [ ] AC-02.3 The Move button is disabled while the selection equals the
      current board + lane.
- [ ] AC-02.4 After moving, the detail stays open with the new location, the
      back link points to the new board, and a toast reads "Moved to Personal
      · In Progress".
- [ ] AC-02.5 Board counts in the lists menu / sidebar update immediately.

### US-03 — Task actions menu (⋯)
*As a user, I want the ⋯ control on an open task to give me Move, Copy,
Archive and Delete.*

- [ ] AC-03.1 The ⋯ in the top-right of the detail screen is a real button
      (≥ 44 × 44 px target) that opens a menu with exactly four items in this
      order: **Move, Copy, Archive, Delete**. Delete is styled destructive and
      sits last, separated by a divider.
- [ ] AC-03.2 Mobile: the menu is a bottom action sheet. Desktop: a popover
      anchored under the button. Tap outside or Esc closes it.
- [ ] AC-03.3 Each item starts the matching flow (US-02, US-04, US-05, US-06).
- [ ] AC-03.4 The old "Delete task" footer button is removed; Delete lives
      only in the menu (long-press on rows still deletes, see US-06).

### US-04 — Copy a task
*As a user, I want to duplicate a task into any board/lane so that repeated
work starts from a template.*

- [ ] AC-04.1 Copy opens the same Board/Lane sheet titled **Copy to**, current
      board + lane pre-selected, primary button **Copy**. Same board + lane is
      allowed (it duplicates in place).
- [ ] AC-04.2 The copy is a new task with: a new id; the same title, due,
      time, start, repeat, reminder, priority and tags; subtasks copied with
      their done state reset; `done` false (true only if the target lane is
      Done); appended at the end of the target lane; `createdAt` now.
- [ ] AC-04.3 The original is untouched and stays open. A toast reads
      "Copied to Work · Backlog" with an **Open** action that navigates to the
      copy.

### US-05 — Archive a task and browse the Archived folder
*As a user, I want to archive tasks I am done with but want to keep, with all
their fields and where they came from.*

- [ ] AC-05.1 Archive (from ⋯) sets the task's status to `archived`, records
      `archivedAt` and its origin (board + lane), removes it from every board
      view and count, closes the detail back to the board, and shows a toast
      "Archived · Undo" (5 s). Undo restores it exactly where it was,
      including its position.
- [ ] AC-05.2 A **Folders** section lists **Archived** and **Deleted** with
      live counts: at the bottom of the desktop sidebar, and at the bottom of
      the mobile Boards menu (plus a Folders item in the mobile bottom nav if
      Q3 is approved).
- [ ] AC-05.3 The Archived folder lists archived tasks newest first. Each row
      shows: title, its chips (due / priority / tags), origin "Work · In
      Progress", and "Archived 3 days ago". Row actions: **Restore** and
      **Delete**.
- [ ] AC-05.4 Restore returns the task to its origin board + lane at the end
      of the order, keeping its done state. If the origin board no longer
      exists it goes to the first board's Backlog and the toast says so.
- [ ] AC-05.5 Delete from Archived moves the task to the Deleted folder
      (US-06); the origin is preserved.
- [ ] AC-05.6 (Should) Tapping an archived row opens the detail read-only,
      with only Restore and Delete available.
- [ ] AC-05.7 Empty state: "Nothing archived yet. Archive tasks you are done
      with but want to keep."
- [ ] AC-05.8 Archived tasks never appear in sorting, kanban, board counts,
      tag suggestions still include their tags, and recurrence never fires
      for them.

### US-06 — Soft delete with a 30-day Deleted folder
*As a user, I want deleted tasks to be recoverable for 30 days, and to be told
clearly that they are removed after that.*

- [ ] AC-06.1 Every delete entry point (⋯ Delete, long-press on a row,
      Delete in the Archived folder) performs a soft delete: status
      `deleted`, `deletedAt` now, origin recorded. No confirm dialog; instead a
      toast "Deleted · Undo" (5 s). (Q4)
- [ ] AC-06.2 The Deleted folder uses the Archived row layout plus a
      countdown "Removed in 27 days" (ceil of 30 − days elapsed; "Removed
      today" at 0). Row actions: **Restore** and **Delete forever** (confirm).
      A header action **Empty folder** (confirm) removes everything.
- [ ] AC-06.3 A disclaimer sits at the top of the Deleted folder: *"Tasks
      stay here for 30 days, then they are removed permanently."*
- [ ] AC-06.4 Purge runs at app start and whenever the Deleted folder is
      opened: any task with `deletedAt` older than 30 × 24 h is removed from
      storage for good.
- [ ] AC-06.5 Restore returns the task to its origin board + lane (never back
      to Archived), with the same fallback as AC-05.4.
- [ ] AC-06.6 Empty state: "Nothing in Deleted." with the disclaimer still
      visible.

### US-07 — Schedule popover (calendar, start/due, time, repeat, reminder)
*As a user, I want the reminder / due date control to open a calendar where I
can set a start date, a due date with time, a repeat rule and a reminder, like
Trello's date popover.*

- [ ] AC-07.1 Entry points: the Due date row, the Reminder row (US-01), and
      "Pick date…" in the add-task sheet (Should). Mobile: bottom sheet;
      desktop: popover / centred dialog. Esc or tap outside closes without
      saving.
- [ ] AC-07.2 Layout, top to bottom: month header with ‹ › (month) and
      « » (year); weekday row starting **Monday**; a 6-row day grid where
      adjacent-month days are dimmed and today is marked; **Start date**
      (checkbox + date field); **Due date** (checkbox + date field + time
      field); **Repeat** select: Never / Daily / Weekly / Monthly / Yearly;
      **Reminder** select: None / At time of due / 10 minutes before / 1 hour
      before / 1 day before / 2 days before; helper text "You will be reminded
      on this device"; **Save** (primary) and **Remove** (secondary).
- [ ] AC-07.3 Tapping a day in the grid sets the date field that was last
      focused (Due by default). When both Start and Due are set, the days
      between them are highlighted as a range with rounded ends.
- [ ] AC-07.4 Validation: Start must be ≤ Due, otherwise Save is disabled
      with the hint "Start must be on or before the due date". Repeat and
      Reminder are disabled until a due date is set. Time is optional.
- [ ] AC-07.5 Save writes `start`, `due`, `dueTime`, `recur`, `reminder` in
      one go. Remove clears all five without a confirm. Opening the popover
      again shows the saved values.
- [ ] AC-07.6 Chips: list / kanban / table chips show "Today 23:30" when a
      time is set; "Overdue" is computed against date + time (end of day when
      no time); a ↻ glyph is appended when the task repeats. "Starts Oct 20"
      is shown in the detail only.
- [ ] AC-07.7 (Should) The popover traps focus and is fully keyboard
      operable (arrow keys move across days, Enter selects).
- [ ] AC-07.8 Existing data is migrated: `reminder: 'None'` → `null`; the
      three preset labels become a due time (09:00 / 12:00 / 18:00) with
      reminder "At time of due" when the task has a due date, otherwise they
      are dropped.

### US-08 — Recurring tasks roll forward on completion
*As a user, I want a repeating task to come back with its next date when I
complete it, in the same lane, instead of moving to Done.*

- [ ] AC-08.1 Completing a task whose `recur` ≠ Never (checkbox, double-tap,
      drag to Done, Move to Done) does **not** mark it done and does **not**
      change its lane. Instead the due date (and the start date, shifted by
      the same number of days) advances to the next occurrence; subtasks are
      reset to not done; `completedCount` increments and `lastCompletedAt` is
      set.
- [ ] AC-08.2 Next occurrence rules, computed from the current due date:
      daily +1 day; weekly +7 days; monthly same day next month (clamped to
      the last day of a shorter month, e.g. Jan 31 → Feb 28/29); yearly same
      date next year (Feb 29 → Feb 28). The step repeats until the result is
      later than today, so an overdue weekly task jumps to the next future
      week rather than to another past week. (Q2)
- [ ] AC-08.3 The row shows the completed state for ~400 ms, then re-renders
      with the new date. A toast reads "Done · next Fri, Oct 23 · Undo"; Undo
      restores the previous dates, subtasks and counters.
- [ ] AC-08.4 Dragging a recurring card onto the Done lane triggers the same
      roll-forward and the card snaps back to its lane; the toast explains.
- [ ] AC-08.5 Setting Repeat back to Never makes it a normal task (it can be
      completed and goes to Done as today).
- [ ] AC-08.6 Recurrence only applies to active tasks (not archived or
      deleted).

### US-09 — Design refresh towards Stack'd Finance
*As a user of both apps, I want Stack'd Minimalist to look like part of the
same family as Stack'd Finance.*

- [ ] AC-09.1 **Tokens**: the Finance `variables.css` palette, spacing, radii
      (8 / 12 / 20 / 28 px), shadows, motion tokens and safe-area variables
      replace `ds.css`. Light: base `#f4f7f9`, surface `#ffffff`, primary
      `#111111`. Dark: base `#0b0f19`, surface `#161e2e`, accent `#38bdf8`.
      Theme follows the system as today (manual toggle is a Could).
- [ ] AC-09.2 **Fonts**: Inter (body) and Manrope (display) self-hosted from
      the Finance woff2 files; no Google Fonts request; works offline and
      inside Capacitor.
- [ ] AC-09.3 **Mobile shell** (Q3): a sticky frosted header (board title in
      Manrope, kicker count, segmented List ∕ Kanban control, sort) and a
      floating glass bottom-nav pill with **Boards · Tasks · Folders** plus a
      separate round **+** FAB, exactly the Finance layout. The old footer
      hint + square FAB are removed; gesture hints move to a one-line
      `.hint` under the header.
- [ ] AC-09.4 **Rows and cards**: task rows become flush rows with hairline
      dividers inside a surface card; kanban cards use surface, 1 px border,
      radius 12 and the soft shadow; the round completion control stays.
      Chips are pills with semantic colours: overdue / High → red tokens; due
      ≤ 3 days / Medium → amber tokens; completed → emerald; tags and Low →
      sunken neutral.
- [ ] AC-09.5 **Detail**: sticky top bar (back + ⋯), Manrope title, field
      rows as flush rows with the label left and the value + chevron right,
      progress bar in primary, subtasks unchanged in behaviour.
- [ ] AC-09.6 **Sheets / popovers**: the Finance "premium sheet" (32 px top
      radius, drag handle, spring transition, blurred backdrop) for the add
      sheet, Move/Copy sheet, ⋯ action sheet and Schedule popover.
- [ ] AC-09.7 **Desktop**: sidebar on the surface colour with an active pill
      item, Folders section at the bottom, table with hairline dividers, the
      same chips.
- [ ] AC-09.8 Dark mode parity on every screen and component; text contrast
      ≥ 4.5 : 1; `prefers-reduced-motion` disables the transitions.
- [ ] AC-09.9 The red brand accent is retired from structural UI and kept
      only for the brand mark and app icon; red now means overdue / High.
      (Q5)
- [ ] AC-09.10 Nothing is left in the old style: onboarding, lists menu,
      list, kanban, detail, add sheet, desktop table and kanban are all
      restyled.

### US-10 — Reminder notifications (Could, separate phase)
- [ ] AC-10.1 Web / PWA: while the app is open, a 60 s check fires a
      Notification at `due + dueTime − reminder` after permission is granted;
      each reminder fires once (`reminderFiredAt`).
- [ ] AC-10.2 Native: `@capacitor/local-notifications` schedules the reminder
      on save and cancels it on change, remove, archive or delete.

---

## 04. Scope — MoSCoW

### Must have
US-01 (AC 1–4, 6 label), US-02, US-03, US-04, US-05 (AC 1–5, 7, 8),
US-06, US-07 (AC 1–6, 8), US-08, US-09 (AC 1–4, 6, 8, 9, 10).

### Should have
AC-01.5 inline title edit · AC-01.6 add sheet uses the new calendar ·
AC-05.6 read-only detail for archived tasks · AC-07.7 keyboard operation ·
AC-09.5 detail polish · AC-09.7 desktop polish.

### Could have
US-10 notifications · manual light/dark toggle · "Open" action on the copy
toast · board rename/delete · "Every weekday" repeat option.

### Won't have (this release)
Sync, accounts, sharing, custom lanes, custom automations, cross-board
calendar view, localisation, coloured Trello-style labels.

---

## 05. Technical Notes & Constraints

### Tech stack
Unchanged: vanilla JavaScript (ES modules, no build step), CSS custom
properties, localStorage, service worker, Capacitor wrapper for iOS. Details in
`docs/architecture.md`.

### Constraints & dependencies
- Storage moves from key `stackd-v1` to `stackd-v2` with a one-way migration;
  the v1 key is left in place for rollback.
- Every new file must be added to the service-worker shell list and to
  `scripts/build-www.mjs`, and `VERSION` in `sw.js` bumped on release.
- Date arithmetic must use local time; the current `toISOString()` helper
  shifts the day near midnight in UTC+ timezones and is replaced.
- Fonts are copied from `../Stackd/src/fonts/` (4 woff2 files, ~200 KB).
- Capacitor iOS loads from a custom scheme; ES modules work there, to be
  confirmed with the `ios-debug` Codemagic workflow after Phase 0.

---

## 06. Success Metrics

### Key metrics
- 100 % of Must acceptance criteria pass on 375 px and 1280 px, light and
  dark, in Chrome and Safari (iOS simulator or device).
- A v1 store with the seed data migrates with zero lost tasks.
- No console errors on any screen; Lighthouse PWA "installable" still passes.

### Definition of done
Each phase in `docs/architecture.md` ends with its AC checklist ticked, a
commit, and (for the last phase) `VERSION` bumped and `main` pushed so GitHub
Pages publishes. QA follows `agents/qa_tester.md` against this document.

---

## 07. Open questions — decisions needed before build

| # | Question | Recommendation |
|---|---|---|
| Q1 | Rename UI vocabulary to **Boards** (Work…) and **Lanes** (Backlog…)? Sidebar "Lists" → "Boards", "New list…" → "New board…". | Yes. Avoids "list" meaning two things once lanes become movable targets. |
| Q2 | Recurring task completed: **(A)** roll the same task forward in place (no Done copy), or **(B)** leave a completed copy in Done and create the next one in the original lane? | **A** — it is what you described ("created with the new date but not moved"), keeps Done clean, and Undo covers mistakes. B is a small add-on later if you want history. |
| Q3 | Mobile navigation: adopt the Finance **bottom pill + FAB** (Boards · Tasks · Folders), or keep the current header-only navigation and only restyle? | Bottom pill + FAB. It is the most recognisable Finance element and gives Folders a home on mobile. |
| Q4 | Drop the delete confirm dialog in favour of **toast + Undo**, now that delete is recoverable for 30 days? | Yes, on all entry points. "Delete forever" and "Empty folder" keep a confirm. |
| Q5 | Colour: adopt Finance tokens fully (black primary, sky-blue dark accent) and reserve **red for overdue / High**, keeping red only in the brand mark? | Yes. Keeping red as the structural accent would fight the Finance palette. |
| Q6 | Overdue recurring task: advance from the **due date until it lands in the future** (skips missed periods), or always exactly one period from the due date? | Skip to the future; it avoids a task being "overdue" immediately after completing it. |
| Q7 | Include **US-10 notifications** in this release (adds the Capacitor plugin and a permission prompt) or defer? | Defer to its own phase after the rest ships; the schedule data is designed so it plugs in without migration. |
