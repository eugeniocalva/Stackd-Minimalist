# Product Requirements Document (PRD): Stack'd Minimalist — Notes

Scope of this PRD: a new top-level **Notes** area with a Google Keep-style
capture box (the *composer*) and a Notion-style flat list of the notes
already written. Notes have a title, formatted text, an optional checklist,
tags and a colour. Alongside it, three app-wide additions the Notes work
needs: a **search bar** on boards, a **date format** setting, and sortable
creation / edit dates.

Status: **decisions complete 2026-10-18** (two rounds, all logged in §07);
ready for the architecture update and build. §08 lists the small calls the
analyst made alone. Companion documents: `docs/prd.md` (tasks, v2),
`docs/architecture.md`. Target release: **1.4.0**.

---

## 00. Vocabulary

| Term | Meaning | Today in code / UI |
|---|---|---|
| **Note** | A title + body + optional checklist, with tags and a colour | does not exist |
| **Composer** | The always-visible box at the top of Notes where a new note is typed | does not exist |
| **Note list** | The flat, Notion-style list of added notes under the composer | does not exist |
| **Checklist** | Ordered check items at the bottom of a note | tasks have `subtasks` (same shape) |
| **Tag** | Free-text label, one pool shared with task tags and Settings › Labels | `task.tags`, `S.labels` |
| **Colour** | One of the six priority colours, shown as an accent bar on the note's left edge | `PRIORITY_COLORS` |
| **Format** | Bold, italic, underline, strikethrough inside the body | does not exist |
| **Add** | Turning the composer draft into a note in the list (the button label) | — |
| **Created / Edited** | A note's creation date and last-edit date, both stored and shown | `createdAt`, `updatedAt` on tasks |
| **Date format** | App-wide numeric date style chosen in Settings | hard-coded `en-US` "Oct 16" |

---

## 01. Problem Statement

### The core problem
Stack'd only stores things that are *tasks*: they live on a board, in a lane,
and want a due date and a state. Meeting notes, ideas, a shopping checklist
that is not a task, a reference someone shared: none of these fit, so they
end up in Google Keep, Notion or a task titled "notes". The user runs three
tools for one habit.

### Why now
The task side is complete (1.3.0: fields, folders, schedule, settings). The
next most frequent thing the user does outside the app is jot something
down. Keep's capture is fast but its masonry wall of cards becomes noise;
Notion's list is calm but its editor is heavy for a one-line thought.
Stack'd can combine the two: Keep's capture, Notion's list.

### Current workarounds
Google Keep (fast capture, messy list), Notion (clean list, slow capture),
or a Stack'd task whose title or subtasks carry the note.

---

## 02. Goals & Non-Goals

### Goals — users can
- Open Notes and start typing within one tap: the composer is always at the
  top and expands into Title / note / toolbar on focus.
- Add a checklist, tags, a colour and basic formatting to a note before
  adding it, from icons under the text, without leaving the composer.
- See every note in one flat list, sorted manually or by creation / edit
  date, each row showing its colour bar, title, tags, checklist progress and
  dates.
- Find a note or a task by typing in a search bar at the top of Notes and of
  every board.
- Open a note to read and edit it, tick checklist items, archive or delete
  it, with the same Undo and 30-day safety net tasks already have.
- Choose the date format the whole app uses.
- Use Notes on the phone and on the desktop, light and dark, offline.

### Non-Goals — this release does not include
- Images, drawings, audio, attachments, link previews.
- Sharing, collaborators, sync, accounts.
- Reminders on notes (the schedule engine stays task-only for now).
- Folders / notebooks / nesting; notes are one flat list filtered by tag or
  search.
- Converting notes into tasks or tasks into notes (candidate for a later
  release, see Could).
- Headings, lists other than the checklist, code, tables, colours inside the
  text, markdown syntax.
- Localisation of UI text (dates follow the Date format setting only).

---

## 03. User Stories with Acceptance Criteria

Every criterion must hold on mobile (≤ 899 px) and desktop (≥ 900 px), in
light and dark mode, and survive a reload (localStorage). Touch targets are
≥ 44 × 44 px; everything is keyboard operable; text contrast ≥ 4.5 : 1.

### US-01 — Reach Notes from anywhere
*As a user, I want Notes to be a first-class area next to Boards and Folders.*

- [x] AC-01.1 Desktop sidebar: a **Notes** item with a live count of active
      notes, between the Boards section and the Folders section.
- [x] AC-01.2 Mobile: a **Notes** item in the bottom nav pill, so it reads
      **Boards · Tasks · Notes · Folders**. The mobile Boards menu also
      lists Notes.
- [x] AC-01.3 On the Notes screen the **+** FAB focuses the composer (and
      scrolls it into view) instead of opening the add-task sheet.
- [x] AC-01.4 The Notes screen has the same sticky header as a board: title
      **Notes** in Manrope, kicker "12 notes", then the **search bar**
      (US-08) and, on the right, the **sort** control (US-07).
- [x] AC-01.5 Empty state under the composer: "No notes yet. Write one
      above."

### US-02 — Composer: capture a note like Keep
*As a user, I want a single box where I start typing and only see the extra
controls once I need them.*

- [x] AC-02.1 **Collapsed**: one surface card at the top of the Notes screen
      with the placeholder "Take a note…" and, on the right, a checklist
      icon (AC-02.6 shortcut). Nothing else. If a draft exists, the card
      shows "Draft: ‹title or first words›" instead of the placeholder.
- [x] AC-02.2 **Expanded** (click, tap or keyboard focus anywhere in the
      card): the card grows to show, top to bottom, a **Title** line
      (single line, plain text, Manrope, placeholder "Title"), a **note**
      area (multi-line, auto-growing, placeholder "Take a note…", line
      breaks preserved) and the **toolbar**. Focus lands in the field the
      user clicked, otherwise in the note area. The card animates between
      the two states (respecting `prefers-reduced-motion`).
- [x] AC-02.3 **Toolbar**, left to right: **Format** (Aa), **Tag**,
      **Colour**, **Checklist** icons; on the far right a primary button
      **Add**. Each icon has an `aria-label` and a desktop tooltip. Icons
      that are "on" (format row open, tags added, colour chosen, checklist
      shown) are drawn in the active state.
- [ ] AC-02.4 **Format icon** toggles a second toolbar row with four
      toggle buttons: **Bold · Italic · Underline · Strikethrough**; the
      main toolbar stays at four icons + Add. They apply to the selection in the note area, or to what
      is typed next when nothing is selected, and reflect the formatting at
      the caret. Shortcuts: `Ctrl/⌘+B`, `Ctrl/⌘+I`, `Ctrl/⌘+U`,
      `Ctrl/⌘+Shift+X`. The title never takes formatting. Pasted text keeps
      only these four styles and line breaks; everything else is stripped.
- [x] AC-02.5 **Tag icon** opens the existing tag picker: suggestions come
      from the shared pool (`allTags()`: Settings › Labels plus tags on
      tasks and notes). Chosen tags show as removable chips between the
      note area and the toolbar. Same rules as tasks: trimmed, leading `#`
      stripped, case-insensitive duplicates ignored.
- [x] AC-02.6 **Colour icon** opens a small popover with seven swatches:
      **None** plus red, amber, green, blue, violet, gray — the
      `PRIORITY_COLORS` tokens. Choosing one shows the **colour bar on the
      left edge of the composer card** (AC-06.2) so the user sees the
      result before adding; the title and body text keep their normal
      colour. Each swatch has a name for screen readers; the chosen one is
      marked with a check.
- [x] AC-02.7 **Checklist icon** toggles a checklist section under the note
      area (the card grows). It starts with one empty item; **Enter** adds
      the next item, **Backspace** on an empty item removes it and moves
      focus up, each item has a checkbox and a ✕ on hover/focus. Toggling
      the icon off with non-empty items asks "Remove checklist?" (confirm);
      with only empty items it just hides. The collapsed-state checklist
      icon (AC-02.1) expands the composer with the checklist already open.
- [x] AC-02.8 **Add** is disabled while title, note and every checklist
      item are empty (whitespace only counts as empty). Adding creates the
      note with `createdAt = updatedAt = now`, puts it at the top of the
      list, collapses the composer back to AC-02.1, clears the draft and
      shows a toast "Note added" with an **Open** action. A note with a
      checklist but no title or body is allowed.
- [x] AC-02.9 **Keyboard**: `Ctrl/⌘ + Enter` adds from any field; `Esc`
      collapses the composer; `Tab` moves Title → note → checklist →
      toolbar → Add.
- [x] AC-02.10 **Leaving with content**: click outside, Esc, opening a
      note, switching to a board, Folders or Settings, closing the app —
      the draft is **always kept, never added or discarded**. The composer
      collapses to the "Draft: …" state and reopens with title, body,
      formatting, tags, colour and checklist in place. The draft is stored
      under its own key and survives a reload. An empty draft just
      collapses.
- [ ] AC-02.11 Mobile: when the on-screen keyboard is open the toolbar and
      Add stay reachable (the card scrolls, the toolbar is not hidden
      under the keyboard); the bottom nav pill hides while the composer is
      expanded, as it does on the detail screen.

### US-03 — Note list: see everything like Notion
*As a user, I want my existing notes as a calm list, not a wall of cards.*

- [x] AC-03.1 Under the composer, notes appear as **flush rows with
      hairline dividers inside one surface card** (the task-row pattern),
      in the order chosen by the sort control (US-07); default **newest
      first by creation date**. A newly added note is the first row in
      every sort except "oldest first".
- [x] AC-03.2 Each row shows, left to right: the **colour bar** (AC-06.2,
      absent when the note has no colour); the **title** in the normal text
      colour — if the note has no title, the first line of the body (plain
      text, formatting stripped) in its place, truncated with an ellipsis;
      the **tag chips** (neutral pills, max 3 shown + "+2"); a **checklist
      indicator** when a checklist exists: the checklist icon with the
      progress "2/5"; and on the right the **dates** (AC-03.3).
- [x] AC-03.3 **Date on the row**: a single right-aligned date in secondary text,
      prefixed by a one-word label that says which date it is, following
      the active sort — "Created 11/10/26" when sorting by creation date,
      "Edited 16/10/26" when sorting by edit date or manually. Relative
      words replace the date when it is recent ("Today", "Yesterday").
      Dates use the Date format setting (US-09). Both full dates are always
      visible in the detail (AC-04.1). The abbreviated "C.D." / "L.U."
      labels are not used: they need decoding and fail screen readers.
- [x] AC-03.4 (Should) A second line with a one-line **preview** of the
      body in secondary text (formatting stripped), truncated; hidden when
      the body is empty or was used as the title.
- [x] AC-03.5 Tapping a row opens the note (US-04). Rows have the same
      hover / pressed states as task rows and are reachable with Tab +
      Enter.
- [ ] AC-03.6 Tapping a tag chip in a row filters the list to that tag; an
      active filter shows as a removable chip under the search bar
      ("#meeting ✕") and combines with the search text.
- [x] AC-03.7 The list shows **active** notes only. Archived and deleted
      notes live in the Folders (US-05).
- [x] AC-03.8 Long lists stay smooth up to 500 notes (plain rendering, no
      virtualisation needed below that).

### US-04 — Open, read and edit a note
*As a user, I want to open a note, fix a word, tick an item, change its
colour or tags, without a separate "edit mode".*

- [x] AC-04.1 The note opens on the **detail screen** (same shell as a task:
      sticky bar with back + ⋯). Mobile: full screen; desktop: the main
      column. Layout: the colour bar along the left of the content block;
      title (editable); body (editable, auto-growing, with the Format row
      available as in the composer); checklist (if any); a row with the tag
      chips and the colour swatch; and a footer line **"Created 11/10/26
      · Edited 16/10/26"** (relative words for Today / Yesterday, Date
      format setting otherwise).
- [x] AC-04.2 Edits **save on blur / after 500 ms of inactivity** and on
      back; there is no Save button. Every saved change to title, body,
      checklist, tags or colour sets `updatedAt = now`. Ticking or unticking
      a checklist item also counts as an edit.
- [x] AC-04.3 Checklist items can be **ticked**, edited, added (Enter) and
      removed (Backspace on empty, ✕). Ticked items are struck through and
      **sink to the bottom** of the checklist; unticking lifts them
      back in their original order. A "+ Add checklist" affordance appears
      when the note has none.
- [x] AC-04.4 Tags, colour and formatting use the same picker / popover /
      Format row as the composer.
- [x] AC-04.5 The **⋯ menu** holds **Copy · Archive · Delete** (Delete last,
      destructive, after a divider), behaving like the task menu
      (AC-03.1–3.2 of the v2 PRD). Copy duplicates the note ("Copy of
      ‹title›", checklist reset to unticked, fresh `createdAt`) and opens
      the copy.
- [x] AC-04.6 A note left completely empty when going back is deleted
      silently (no empty rows in the list).

### US-05 — Archive, delete and restore notes
*As a user, I want the safety net I already have for tasks.*

- [x] AC-05.1 Archive and Delete work exactly like tasks: status
      `archived` / `deleted`, timestamp, toast with **Undo** (5 s), no
      confirm; "Delete forever" and "Empty folder" keep their confirm.
- [x] AC-05.2 The Archived and Deleted folders show tasks **and** notes
      behind a segmented control **Tasks ∕ Notes** at the top of each
      folder; folder counts in the sidebar and Boards menu add both kinds.
      Note rows reuse the task-row layout: colour bar, title, tag chips,
      checklist indicator, "Archived 3 days ago" / "Removed in 27 days".
- [x] AC-05.3 Restore returns a note to the Notes list (its manual position
      is kept, see AC-07.4). Deleted notes are purged after 30 days by the
      same `purgeDeleted()` run.
- [x] AC-05.4 An archived or deleted note opens read-only with only
      Restore and Delete / Delete forever, like AC-05.6 of the v2 PRD.
- [x] AC-05.5 Settings › Labels: renaming or deleting a label applies to
      notes as well as tasks; the "used by" counts include notes.

### US-06 — Design, accessibility and platform parity
- [x] AC-06.1 Everything uses the Finance tokens: the composer is a surface
      card with the 1 px border and soft shadow; the expanded composer gets
      the elevated shadow; toolbar icons come from `icons.js` (add `text`,
      `tag`, `palette`, `checklist`, `note`, `search`, `sort-az`).
- [x] AC-06.2 **Colour bar**: a **3 px wide bar,
      fully rounded, inset 4 px from the row's top and bottom, sitting in
      the row's left padding** so the text column does not shift between
      coloured and uncoloured rows. Colour = the token's **text** variant
      (`--color-red-text` …), which reads as a saturated accent on both
      light and dark surfaces. The same bar appears on the composer card
      (AC-02.6) and the detail content block (AC-04.1). No tinting of
      title, background or chips.
- [x] AC-06.3 Colour is never the only cue: the detail shows the colour's
      name next to the swatch, and the row's `aria-label` includes it
      ("Weekly sync, blue").
- [x] AC-06.4 Screen readers: the composer is a `form` with a visible label
      ("New note"); the toolbar and Format row are `toolbar`s with labelled
      toggle buttons (`aria-pressed`); checklist items are real checkboxes;
      the note list is a `list`; search is a `search` landmark.
- [ ] AC-06.5 Works from `file://` (bundle), on the PWA, and inside the
      Capacitor iOS shell; new files are added to the SW shell list and
      `check-shell.mjs` passes; `app.bundle.js` is rebuilt.

### US-07 — Sort notes, including a manual order
*As a user, I want to decide how my notes are ordered, and to move them by
hand when no rule fits.*

- [ ] AC-07.1 A **sort** control sits top-right of the Notes header (the
      board's sort button pattern). Its menu offers: **Manual**, **Created ·
      newest first**, **Created · oldest first**, **Edited · newest first**,
      **Edited · oldest first**. The chosen option is persisted
      (`S.notesSort`); the button shows the active option and is drawn
      "on" when it is not the default. Default: Created · newest first.
- [ ] AC-07.2 **Manual**: rows can be dragged to reorder, with the same
      mechanics as task rows — drag the row on mobile after the 8 px
      threshold, a grip handle on desktop; the dragged row lifts (shadow),
      the drop target shows a divider. Dragging is disabled in every other
      sort, and while a search or tag filter is active (the full list is
      the only thing that can be reordered).
- [ ] AC-07.3 Manual order is stored per note (`order`) and kept while
      another sort is active, so switching back to Manual restores it. A
      new note is placed **first** in manual order.
- [ ] AC-07.4 Archive / delete remove the note from the list without
      renumbering the others; Restore puts it back at its old `order`
      (clamped to the top if that position no longer makes sense).

### US-08 — Search notes and tasks
*As a user, I want a search bar at the top of Notes and of every board, so
that finding things works the same everywhere.*

- [ ] AC-08.1 **Notes**: a search field under the header kicker (placeholder
      "Search notes"), with a clear ✕. Typing filters the list as you type
      (debounced 150 ms), matching case- and accent-insensitively against
      title, body text (formatting stripped), checklist items and tags.
      Matches keep the active sort. Empty result: "No notes match ‹query›."
      The composer stays visible above the results.
- [ ] AC-08.2 **Boards**: the same field under each board's header
      (placeholder "Search tasks"), filtering **the current board only**
      against title, tags and subtask text. In List view the rows filter;
      in Kanban every lane filters, lanes with no match stay in place with
      an empty body, and lane counts show "2 of 5"; the desktop table
      filters its rows; the header kicker reads "3 of 12 tasks". Empty result: "No tasks match
      ‹query›." Drag-to-reorder and lane drag are disabled while a query is
      active.
- [ ] AC-08.3 The query is per screen and transient: switching board or
      area clears it; back from a detail returns to the filtered list with
      the query intact. `Esc` in the field clears it; `/` focuses the field
      on desktop.
- [ ] AC-08.4 Mobile: the field collapses to a search icon in the header
      and expands full-width on tap, so the header stays one line.

### US-09 — Date format setting (app-wide)
*As a user, I want dates written the way I read them.*

- [ ] AC-09.1 Settings gets a **Dates** section (after Appearance) with a
      segmented control **Date format**: `dd/mm/yyyy` · `mm/dd/yyyy` ·
      `yyyy-mm-dd`, each option showing today's date as its example.
      Persisted as `S.dateFormat`.
- [ ] AC-09.2 Default on first run: derived from the device locale
      (`en-US` → `mm/dd/yyyy`, ISO-style locales such as `sv`, `lt`, `zh`
      → `yyyy-mm-dd`, everything else → `dd/mm/yyyy`); an existing store
      with no value gets the same derivation once and keeps it.
- [ ] AC-09.3 **Scope, app-wide**: every date the app *writes* in full
      numerals — note rows and detail footers (US-03 / US-04), the
      "Archived 3 days ago" fallbacks once older than 7 days, the task
      detail's Due / Start values, the reminder helper line in the Schedule
      popover, and the folder rows. Chips keep their short relative words
      ("Today", "Tomorrow", "Fri") because they are about distance, not a
      date; from 7 days out they switch to the numeric format too.
      **Exempt**: the Schedule popover's typed Start / Due fields are
      native `<input type="date">` controls, which the browser renders in
      the device locale and the app cannot restyle; they stay native (the
      calendar grid above them is the primary way to pick a date). The
      month header ("October 2026") and weekday initials are unaffected.
- [ ] AC-09.4 Two-digit years are never used ("16/10/2026", not
      "16/10/26") to keep the three formats unambiguous. Weeks still start
      on Monday regardless of the format.
- [ ] AC-09.5 Changing the format re-renders immediately and is covered by
      `check-dates.mjs` (formatting of a fixed date in the three formats).

---

## 04. Scope — MoSCoW

### Must have
US-01 (AC 1–5) · US-02 (AC 1–11) · US-03 (AC 1–3, 5–8) · US-04 (AC 1–6)
· US-05 (AC 1–5) · US-06 (AC 1–5) · US-07 (AC 1–4) · US-08 (AC 1–3) ·
US-09 (AC 1–5).

### Should have
AC-03.4 body preview line · AC-08.4 collapsible mobile search · colour-name
tooltip on swatches · `/` shortcut to search.

### Could have
- **Pin** a note to the top of the list regardless of sort.
- **Send checklist item to a board**: turns one item into a task on a chosen
  board (bridge between the two halves of the app).
- Global search across boards and notes from one field.
- Auto-link URLs in the body (open in a new tab).
- "Hide ticked items" toggle inside long checklists.
- Sort by title.

### Won't have (this release)
Images and attachments, reminders on notes, sharing or collaboration, sync,
notebooks / nesting, headings / lists / colours inside the text, markdown
syntax, note templates, converting a whole note into a task, time-of-day on
note dates.

---

## 05. Technical Notes & Constraints

### Tech stack
Unchanged: vanilla ES modules, CSS custom properties, localStorage, service
worker, Capacitor. New modules: `src/ui/notes.js` (screen: composer + list
+ sort + search), `src/ui/noteeditor.js` (title / body / checklist / Format
row, shared by composer and detail), `src/ui/search.js` (the field, shared by
notes and boards), `src/richtext.js` (sanitise / strip / shortcuts, pure).

### Data (no migration needed)
`S.notes`, `S.notesSort` and `S.dateFormat` are added by `withSettings()`
with defaults, so existing `stackd-v2` stores keep working. The draft lives
under its own key (`stackd-note-draft`) so a crash or reload never loses a
half-written note and the main document is not rewritten on every keystroke.

```js
// Note
{
  id, order: 0,                          // manual position, smaller = higher
  title: '',                             // plain text
  body: '',                              // sanitised HTML subset: text, <br>, <b>, <i>, <u>, <s>
  color: null | 'red'|'amber'|'green'|'blue'|'violet'|'gray',
  tags: [],                              // same normaliser as task.tags
  checklist: null | [ { id, text, done } ],   // null = no checklist section
  status: 'active'|'archived'|'deleted', archivedAt, deletedAt,
  createdAt, updatedAt,                  // ms; updatedAt bumps on every saved edit
}
// S.notesSort: 'manual' | 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc'
// S.dateFormat: 'dmy' | 'mdy' | 'ymd'
```

### Constraints & dependencies
- **Formatting** means the body is a `contenteditable` region, not a
  `textarea`. `richtext.js` must: whitelist `b i u s br` (and map
  `strong`/`em`/`strike`/`div`/`p` to them), drop every attribute, strip
  everything else on paste and on save, and expose `toText()` for search,
  previews and the untitled-row fallback. Title stays an `<input>`.
  `document.execCommand` is deprecated but still the only zero-dependency
  way to toggle inline styles in all three browsers; wrap it so it can be
  swapped later.
- `allTags()`, `tagUseCount()`, `renameLabel()` and `deleteLabel()` must
  include notes; `folderTasks()` gains a kind filter or a sibling
  `folderNotes()`; `purgeDeleted()` and `emptyDeleted()` cover both arrays.
- `bindReorder()` in `board.js` is generalised (takes a reorder callback)
  so notes reuse it instead of a second drag implementation.
- `dates.js` gains `fmtDate(ts | isoDate)` driven by `S.dateFormat`, and
  the existing `en-US` calls that show a calendar date move to it (chips'
  weekday / relative words stay). Native `<input type="date">` fields keep
  the browser's locale rendering (AC-09.3); replacing them with custom
  text fields is out of scope.
- The FAB and the mobile bottom nav need a Notes-aware branch (`UI.screen
  === 'notes'`); the detail screen needs a note branch or a separate
  `notedetail.js`.
- Colour tokens: the six priority colours already have `-bg` / `-text`
  variants in both themes; the bar uses `-text`.
- New icons in `icons.js`; new files in `sw.js` SHELL; `VERSION` bumped to
  1.4.0 on release; `npm run check` and `npm run bundle` before commit.

---

## 06. Success Metrics

### Key metrics
- 100 % of Must criteria pass on 375 px and 1280 px, light and dark, in
  Chrome and Safari (iOS simulator or device).
- Capture time: from tapping Notes to an added one-line note in ≤ 3
  interactions (tap composer, type, Ctrl+Enter / Add).
- A 1.3.0 store opens in 1.4.0 with zero lost tasks, an empty Notes list
  and a sensible default date format; a draft survives a reload and a trip
  to a board.
- Pasting formatted text from a web page or Word into a note leaves only
  bold / italic / underline / strikethrough and line breaks.
- No console errors; `npm run check` passes (including the new date-format
  and richtext assertions); Lighthouse PWA "installable" still passes.

### Definition of done
Each phase in `docs/architecture.md` §14 (Phases 7–13) ends with its AC
checklist ticked and a commit; the last phase bumps `VERSION`, rebuilds the
bundle, updates `README.md` and pushes `main`. QA follows
`agents/qa_tester.md` against this document and appends to
`docs/qa-report.md`.

---

## 07. Decisions taken (2026-10-18)

### Round 1

| # | Question | Decision |
|---|---|---|
| Q1 | Where does Notes live? | **A** — sidebar item + fourth item in the mobile pill (Boards · Tasks · Notes · Folders). |
| Q2 | Button label | **"Add"**. |
| Q3 | Tags shared with task labels? | **Shared** — one pool, managed in Settings › Labels. |
| Q4 | Leaving the composer with content | **Keep the draft**, also when moving to a board or any other section. |
| Q5 | List order and dates | **Newest first** by default. Store `createdAt` and `updatedAt`; a sort control (manual, created ↑↓, edited ↑↓); dates on the rows; a Settings area for the date format (`dd/mm/yyyy`, `mm/dd/yyyy`, `yyyy-mm-dd`). Row layout for the dates to be settled in Q13. |
| Q6 | Checklist indicator | **Icon + progress "2/5"**. (Sinking ticked items: see Q14.) |
| Q7 | Search | **Yes** on Notes, **and a search bar on every board** for tasks. |
| Q8 | Editing a note | **Detail screen**, consistent with tasks. |
| Q9 | Folders | **One Archived / Deleted pair with a Tasks ∕ Notes switch**. |
| Q10 | Formatting | **Bold, italic, underline, strikethrough**. |
| Q11 | Colour | **Not the title text; a colour bar on the row's left edge**, modern and discreet (design settled in Q16). |

### Round 2

| # | Question | Decision |
|---|---|---|
| Q12 | Format controls layout | **A** — one **Aa** icon opens a second row with B / I / U / S; the main toolbar stays at four icons + Add (AC-02.4). |
| Q13 | Dates on the row | **A** — one right-aligned date whose label follows the sort, "Created 11/10/2026" or "Edited 16/10/2026", "Today" / "Yesterday" when recent (AC-03.3). Both dates in full in the detail (AC-04.1). |
| Q14 | Ticked checklist items | **Sink** to the bottom, struck through; unticking lifts them back (AC-04.3). |
| Q15 | Ticking counts as an edit? | **Yes** — bumps `updatedAt` and the "Edited" sort (AC-04.2). |
| Q16 | Colour bar design | **A** — 3 px rounded bar inset in the row's left padding; text column never shifts; same bar on the composer and the detail (AC-06.2). |
| Q17 | Manual drag while filtered | **Disabled**; only the full list can be reordered (AC-07.2). |
| Q18 | Task search scope | **Current board only** (AC-08.2); cross-board search stays a Could. |
| Q19 | Date format scope | **App-wide** (AC-09.3), with the native date inputs exempt because the browser renders them. |
| Q20 | Default date format | **Derived from the device locale** on first run (AC-09.2). |
| Q21 | Mobile search field | **Collapsed to an icon** on mobile, always visible on desktop (AC-08.4). |

---

## 08. Calls made without a question

Small choices the criteria needed; each follows from a decision above and
can be reversed by editing the AC it names.

- **Kanban search** keeps empty lanes in place rather than hiding them, so
  the board does not reflow while typing, and the kicker reads "3 of 12
  tasks" (AC-08.2).
- **Native date inputs** in the Schedule popover stay in the browser's
  locale; the calendar grid is the primary picker, and the helper line
  below follows the setting (AC-09.3). Custom text fields would cost more
  than they return.
- **Four-digit years** everywhere the numeric format is used, so
  `dd/mm/yyyy` and `mm/dd/yyyy` can never be confused (AC-09.4).
- **Unticking** an item counts as an edit too, for symmetry with Q15
  (AC-04.2).
- **Copy** of a note gets a fresh `createdAt` and a reset checklist, so it
  behaves like a new note in every sort (AC-04.5).

No open questions remain. The architecture and phased plan are in
`docs/architecture.md` Part II (§9–§17); the build follows those phases.
