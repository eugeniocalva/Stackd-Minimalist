# PRD: Stack'd Minimalist 1.7.0 — swipe back, a tidier Settings, import and export

Status: **in progress, 2026-11-26.** Phases 1 to 4 of 8 are done and
agreed. Forty-four decisions taken by the owner (§02). The decisions
still to take are listed by phase in §11 and are
asked when their phase starts; each answer is recorded in §02. Branch:
`release/1.7.0`, cut from `release/1.6.0` at `602b94c`.

Rule for this work, set by the owner: nothing is assumed. Every design is
shown with options before it is built, and shown again before it counts as
done (§12). Device checks (the swipe on the iPhone, saving a file, opening
the exported files) are done by the owner on one TestFlight build at the end.

---

## 01. What changes

| # | Change | Size |
|---|---|---|
| A | A swipe left on the main menu returns to the page you came from | Small |
| B | Settings: the Theme and Date format toggles look the same; three text sizes; even spacing | Small |
| C | Tasks get a description | Medium |
| D | Settings › Data: Import and export, Backup, Remembered imports | Large |

## 02. Decisions taken (owner, 2026-11-26)

| # | Question | Decision |
|---|---|---|
| 1 | Where an imported card's description goes | Tasks get a description field |
| 2 | Formats Import accepts | CSV, Excel, JSON, XML. PDF and Word are export only |
| 3 | What an import does to existing data | The guide asks each time: a new board, or add to an existing board. Nothing existing changes |
| 4 | Backup | Save and restore one Stack'd file, by hand. No automatic backups |
| 5 | Import automation | Remembers the answers given in the guide, per file layout. No hand-written rules |
| 6 | Export scope | Tasks only, with a picker: boards, fields, format |
| 7 | PDF | Hand-written, no library. Western European letters and € only |
| 8 | Release | A new 1.7.0 branch; 1.6.0 stays as tested |
| 9 | Toggles in Settings | Own line under the title, full width, equal segments, in both cards |
| 10 | When swipe left works | However the menu was opened (swipe right or the Boards button) |
| 11 | Where swipe left starts | Anywhere on the menu, rows included |
| 12 | Text sizes | Settings only: 16, 14 and 12 px, plus the page title |
| 13 | Saving files on iPhone and Android | Add the Capacitor Filesystem and Share plugins |
| 14 | Price | Import and export are free for everyone, always, with no limit |
| 15 | Description format | Formatted like notes (bold, italic, underline, strikethrough, line breaks). A card shows a small mark when it has one |
| 16 | Restore a backup while signed in | Refused, as today, and the page says why |
| 17 | The same file imported twice | Cards already imported are skipped |
| 18 | Other tools | None recognised by name. Import and export work by logic: the file's columns and the answers in the guide, whatever tool wrote it |
| 19 | Import automation | Synced with the account |
| 20 | Word and PDF layout | Group by list, and checklists as boxes. No cover page, no accent colour, no title field |
| 21 | Export | A page to pick the type of file, as in the power-up |
| 22 | Phase 1, Settings as built | Agreed from the before and after pictures |
| 23 | Toggle labels | Stay 12 px bold. At 14 px the three date formats do not fit side by side under 375 px |
| 24 | Plan cards in the paywall sheet | Same look as in Settings |
| 25 | Toggles on wide screens | Full width of the card, as on the phone |
| 26 | Phase 2, the swipe left as built | Agreed from the pictures and the tested cases. The feel on the iPhone is checked on TestFlight |
| 27 | Where the description sits in an open task | Its own card, between the fields and Subtasks |
| 28 | The mark on a row or card with a description | Three short lines, at the end of the line with the date, priority and labels |
| 29 | Devices still on 1.6.0 | Protected: 1.7.0 keeps the description such a device left out and sends it back |
| 30 | The New task sheet | No description field; it is written in the open task |
| 31 | Phase 3, the task description as built | Agreed from the pictures of the app, with the short empty card and, in the wide table, the mark after the title. The iPhone keyboard is checked on TestFlight |
| 32 | Where Backup opens | A page of its own under Settings, with a back arrow, as in Stack'd Finance. The third row opens a page of the same kind |
| 33 | The third Data row's name | "Remembered imports", not "Import automation": it sat one line above the unrelated section "Automations". Replaces the name in decisions 5 and 19; what it does is unchanged |
| 34 | Shared boards in a backup | Left out, with their cards, and the Backup page says so. No other person's e-mail address goes into a file |
| 35 | Import file and Export file until phases 5 to 7 | The Data card and the sheet are built in phase 4; the two buttons are shown switched off until their phase. Remembered imports shows its empty page |
| 36 | Restore while signed in | The button is switched off; the page gives the reason and the way round in words (sign out and keep a copy, restore, sign in again) and what Merge and Use my account then do |
| 37 | The old github.io address | No Data section there. The banner and "Download my data" stay, and their words point to Settings › Backup at the new address |
| 38 | The backup file's name | `stackd-backup-2026-11-26-1405.json`: date and time. Files made under the old name still restore |
| 39 | The signed-in Account card labelled "Your data" | Renamed "Account data". Its rows are unchanged |
| 40 | The restore confirmation | Shows when the backup was made and both counts, says archived and deleted items are counted, and Cancel has the focus |
| 41 | Last backup | The Backup page shows "Last backup file made" with date and time, or that none was made on this device yet |
| 42 | Results and refusals | A success is a short message at the bottom; every refusal is a dialog with the full sentence |
| 43 | Icons of the Data rows | Three new ones: opposed arrows, a shield with a tick, a list with dots |
| 44 | Phase 4, the Data section and Backup as built | Agreed from the pictures of the app, with the check before a backup is handed over and the stand-in board when only shared boards are in use. A real file picker, a real download, a signed-in account and the iPhone app are checked on TestFlight |

---

## 03. A — Swipe left from the menu

**Today.** A swipe right on Board, List, Notes, Meetings, Archived, Deleted
or Settings slides the menu in (`app.js`, `peekMenu`). The only way back is
to tap something in the menu. The page you were on is forgotten.

**Wanted.** The menu remembers the page it was opened from. A swipe left
puts that page back, exactly as it was.

- **A-1** Opening the menu, by swipe or by the Boards button, records where
  you were: the screen, and with it the board and its view (List or
  Kanban), or the folder (Archived or Deleted).
- **A-2** On the menu, a swipe left that starts anywhere follows the finger:
  the menu slides off to the left and the remembered page shows under it.
  Letting go past the same distance or speed the swipe right uses completes
  it; otherwise the menu springs back.
- **A-3** The page returns with its scroll position, as it was left.
- **A-4** A tap on a menu row still opens it. Holding a row still works as
  now. A mostly vertical drag scrolls the menu.
- **A-5** If the remembered page is gone (its board was deleted or archived
  from the menu), the swipe goes to the current board instead.
- **A-6** The memory lasts until the app is closed. Opened cold on the
  menu, a swipe left does nothing.
- **A-7** After swiping back, a swipe right opens the menu again, and so on.
- **A-8** No change on wide screens, where the menu is a sidebar.

Built with the same finger-following code as the swipe right
(`src/ui/gestures.js`), mirrored, so the two feel alike.

**Built and agreed, 2026-11-26** (`app.js`, `src/ui/gestures.js`,
`styles/screens.css`; decision 26). Checked at 375 px with simulated
touches:

| Case | Result |
|---|---|
| Settings scrolled 600 px, menu by the Boards tab, swipe left from a board row | Back on Settings at 600 px (A-1, A-2, A-3) |
| Kanban scrolled to the third lane, menu by a swipe right, swipe left | Back on the board at the same lane |
| Swipe right again, swipe left again | Menu, then the page, each time (A-7) |
| A short slow swipe | Springs back to the menu |
| A short fast flick | Completes |
| A tap on a board row | Opens the board (A-4) |
| A press of 450 ms, then a drag | Lifts the row to reorder; no swipe (A-4) |
| Out and back to where the finger started, on a board row | Stays on the menu; opens nothing |
| A mostly vertical drag | Not a swipe (A-4) |
| The board it came from is no longer the current one | Goes to the current board, from the top (A-5) |
| Swipe right on the menu; swipe left on a page; a sheet open | Nothing |

One change to existing behaviour, needed for "rows included": the release
that ends a swipe is never a tap on the row under the finger. Not checked
here: how it feels under a real finger, and A-6 after the app is closed and
reopened. Both are for the TestFlight build.

## 04. B — Settings

### B1. Toggles (decision 9)

Theme's toggle sits to the right of its title; Date format's is too wide
for that, wraps, and ends up pushed right. In both cards the toggle moves
to its own line under the title and spans the card, with three equal
segments. The same rule applies to any later toggle in Settings.

### B2. Text sizes (decision 12)

Measured on the page today: 6 sizes in 10 size-and-weight combinations.

| Today | Where | Becomes |
|---|---|---|
| 24 px / 800 | Page title | unchanged |
| 18 px / 800 | Plan names (Free, Plus, Pro, Max) | 16 / 700 |
| 16 px / 700 | Row titles, prices, name fields | 16 / 700 |
| 14 px / 400 | Row sub-lines | 14 / 400 |
| 14 px / 600 | Plan allowance lines | 14 / 400 |
| 14 px / 700 | Buttons | 14 / 700 |
| 12 px / 700 | Toggle segments | 12 / 700 (decision 23) |
| 12 px / 700 caps | Section labels, "Stack'd" kicker | 12 / 700 caps |
| 12 px / 400 | Footnotes, usage bar lines | 12 / 400 |
| 11 px / 700 | The "On" tag | 12 / 700 |

Result: 16 for names and prices, 14 for secondary text and buttons, 12
for labels, toggles and footnotes. Two weights, 700 and 400. Only Settings
changes, and the plan cards in the paywall sheet with it (decision 24).

**Built and agreed, 2026-11-26** (`styles/screens.css`). Measured at 375
and 1280 px, light and dark: six size-and-weight pairs under the title
(16/700, 14/400, 14/700, 12/700, 12/700 capitals, 12/400); both toggles
303 px wide with 17 px each side and three 98 px parts; every gap 12, 8 or
24 px; the plan footnote 8 px under the Max card, where it was 8 px over
it. Not seen: the signed-in Account rows and the Face ID toggle, which
need an account and a phone; they use the same rules.

### B3. Spacing

The footnote under the plan cards sits against the Max card because
footnotes pull themselves up by 8 px, which is right under a card with a
bottom margin and wrong under the plan grid, which has none. One rule for
the whole page:

- section label → its card: 12 px
- card → card inside a section: 12 px
- card or grid → its footnote: 8 px
- footnote or last card → next section label: 24 px

Checked by measuring every gap on the page, phone and wide.

## 05. C — Task description (decision 1)

- **C-1** A task has a description, formatted like a note (decision 15):
  bold, italic, underline, strikethrough and line breaks, through the same
  cleaning notes use (`src/richtext.js`). No lists, links or headings,
  because notes have none.
- **C-2** It is edited in the open task, in a card of its own between the
  fields and Subtasks (decision 27), with the notes formatting row (bold,
  italic, underline, strikethrough) and a Done button, shown while the
  caret is in the text. An empty one shows as "Add a description…". The
  New task sheet has no description field (decision 30).
- **C-3** Search finds text in descriptions.
- **C-4** It is in the Stack'd file, in sync, in copy and move, and in every
  export format.
- **C-5** Board cards and list rows show a small mark, three short lines,
  when the task has a description, never the text. It sits at the end of
  the line with the date, priority and labels (decision 28). The wide
  table has no such line: there the mark follows the title.
- **C-6** At most 20,000 characters. An archived or deleted task shows its
  description as text, not editable.

**Built and agreed, 2026-11-26** (decision 31). Checked in the browser at
375 and 1280 px: typing saves by itself half a second after the
last key without moving the caret; a redraw while typing (a subtask
ticked) loses nothing; bold from the row and from Ctrl+B; pasted markup is
cleaned; Escape and Done leave the text; the mark shows in List, Kanban
and the table; search finds a word that is only in the description; a copy
carries it; an archived task shows it read-only. New automated checks in
`npm run check` cover cleaning, the 20,000 limit, copy, quiet saving,
search, the Stack'd file and the 1.6.0 protection below.

**Devices still on 1.6.0** (checked in `src/sync.js`, 2026-11-26). An old
device drops the field when a task arrives, and does not send the task back
by itself, so nothing is lost while it only reads. But when it edits that
task (ticks it, renames it), it sends the whole task without the
description, and the account takes that as the newest copy. Protection,
agreed as decision 29 and built, with no server change: once a task has
had a description, 1.7.0 always writes the field, even emptied; a task
that arrives with no such field at all came from an old device, so 1.7.0
keeps the description it has and sends the task back in the same sync,
with the old device's edit. A description emptied on purpose on a 1.7.0
device stays empty. Tasks from before 1.7.0 are not given the field on
load, so the update does not send every task of an account again. Covered
end to end against the real server code in `scripts/check-sync.mjs`; the
check fails when the protection is switched off. The same applies to
Remembered imports in the settings record (§06.4).

## 06. D — Settings › Data

The "Your data" card and its "Import a Stack'd file" row go. The
"Developer" fold stays where it is and holds only the server address, as
now. A new section takes the card's place, as in Stack'd Finance:

```
DATA
┌──────────────────────────────────────────────┐
│ (⇄) Import and export                      › │
│     Bring in a file or send your tasks to    │
│     another app.                             │
├──────────────────────────────────────────────┤
│ (shield) Backup                            › │
│     Save everything in one file, or restore  │
│     one.                                     │
├──────────────────────────────────────────────┤
│ (list) Remembered imports                  › │
│     What Stack'd remembers from your imports.│
└──────────────────────────────────────────────┘
```

Each row is a button with its own new icon (decision 43). The third row is
called "Remembered imports" (decision 33). The section is shown signed in
and signed out, and not at all on the old github.io address, which is for
leaving (decision 37).

**Import and export** opens a sheet, as in Finance: the title, the line
"Bring tasks in from a file, or send them to another app.", and three equal
buttons, **Import file**, **Export file**, **Cancel**. Until phases 5 and 7
are built the first two are shown switched off, with a line under them that
says so (decision 35); both go before release (§10, phase 8).

**Backup** and **Remembered imports** open pages of their own under
Settings, with a back arrow that returns to Settings where it was left
(decision 32). A swipe right on such a page opens the menu, as on
Settings, and the swipe left on the menu comes back to the page.

**Built and agreed, 2026-11-26** (decision 44): `src/ui/data.js`
(the section, the sheet, the two pages), `src/files.js` (the one place
that hands a file over), `src/backup.js`, `src/ui/settings.js`,
`src/ui/shell.js`, `src/ui/primitives.js` (a dialog with one button, for
what must be read in full). Checked in the browser at 375 and 1280 px and
on the old-address test server. One independent review of the change
found one gap (no backup possible when only shared boards are in use) and
five small points (focus after a dialog closes, a silent press after a
sign-in in another tab, one misleading sentence, two weak checks); all six
are fixed and covered by `scripts/check-backup.mjs` or re-tested in the
browser.

### 06.1 Import: the guide

Formats: CSV, Excel (.xlsx), JSON, XML (decision 2). All read on the
device; nothing is uploaded. A file is untrusted: every value is rebuilt
through the same cleaning the Stack'd file import uses.

| Step | What the user sees | Skipped when |
|---|---|---|
| 1 File | Pick a file. Stack'd says what it found: "A table with 35 columns, 265 rows", and which columns it could place by itself | never |
| 2 Columns | Which column is the title, list, description, labels, due date, start date, done, archived, checklist. Columns are placed by their names and by what is in them (decision 18), not by the tool. A layout seen before arrives filled in (§06.4) | every needed column was placed and nothing is ambiguous |
| 3 Where | A new board (name it) or one of my boards (decision 3) | never |
| 4 Lists → lanes | Each list in the file: a new lane, or one of the board's lanes. A list called Done goes to Done | new board, and the file has lists |
| 5 Labels | Keep as labels (default). Optionally, a label becomes a priority, or is dropped | file has no labels |
| 6 Dates | Day-first or month-first, asked only when the file leaves it unclear (03/04/2026) | dates are unambiguous |
| 7 Review | Counts, the first rows as they will look, how many are skipped because they were imported before (decision 17), and a plain list of what will not come in. **Import** | never |

After Import: "Imported 265 tasks into Personal", with **Undo**, which
removes exactly what was added.

**What a Trello card becomes**, as the worked example (from the six sample
files; the power-up writes 35 columns). The guide reaches this by the
columns' names, not because the file says Trello:

| Trello | Stack'd |
|---|---|
| Name | Title |
| List Name | Lane (step 4) |
| Desc | Description. Trello writes Markdown: `**bold**`, `_italic_` and `~~struck~~` become formatting; a link `[text](address)` becomes its text and address; list and heading marks stay as typed |
| Labels, written `name (colour)` | Labels; the colour is dropped |
| Due, Start | Due date and time, start date |
| Due Complete | Done (moves to the Done lane) |
| Closed | Archived, or left out: asked in step 7 |
| Check Lists / Check Items | Subtasks |
| Pos | Order within the lane |
| Url / Short Link | Kept unseen, to skip a card that was imported before (decision 17). A file with no such column: §11, phase 5 |
| Date Last Activity | Edited date |
| Members, comments, attachments, votes, location, cover, reminder | Not imported; step 7 says how many cards have them |

Notes on the six samples, all read on 2026-11-26:

- **CSV.** Quoted cells that run over several lines; `TRUE`/`FALSE`.
- **JSON.** Empty fields are left out; names have spaces.
- **XML.** `<base><element>`, names with hyphens, values padded with
  line breaks and spaces.
- **Excel.** Two sheets, Cards and Summary; the guide reads the first and
  offers the others. The headings differ from the CSV's for the same
  columns (List / List Name, Description / Desc, Archived / Closed, Due
  complete, Last activity), two headings appear twice (Comments,
  Description), yes and no are `Yes`/`No`, and dates are Excel day numbers
  with a date style. So one tool writes three spellings of the same
  layout, which is why columns are placed by logic and not by name alone.
- **Word.** Not a Word document: a web page saved with the `.doc` ending.
  Export only, so only its layout matters (§06.2).
- **PDF.** Nine pages: a cover, then one block per card under its list.
- The PDF and Word files show a due date on every card (28 Nov to 20 Dec
  2026). The CSV, JSON, XML and Excel files of the same export have the
  Due column empty. The power-up loses it; the guide can only import what
  the file holds.
- The files hold 10 of 265 cards (the power-up's free limit), all in one
  list, and none has a checklist, a member, a comment, an attachment or a
  start date. How those are written is still not known (§13).

### 06.2 Export (decision 6)

Tasks only. Three steps, after the Trello power-up in the screenshots:

1. **Boards and tasks.** Tick boards. Switches: include done tasks,
   include archived tasks. A count: "189 tasks selected".
2. **Fields.** Tick fields; a sensible set is on at first: board, lane,
   title, description, labels, priority, due, start, done, subtasks.
   Reset.
3. **Type of file** (decision 21). Excel, CSV, PDF, Word, JSON, XML, then
   **Export**. A preview of the first rows. For PDF and Word, two
   switches (decision 20): group by list, and checklists as boxes. The
   board's name is the heading; there is no cover page and no colour.

Free for everyone, with no limit on tasks or exports (decision 14).

| Format | Made how | Notes |
|---|---|---|
| CSV | Hand-written | UTF-8 with a mark so Excel reads accents; one row per task |
| JSON | Hand-written | An array of tasks, field names as in step 2 |
| XML | Hand-written | One element per task |
| Excel (.xlsx) | Hand-written zip + sheet XML | One sheet; dates as real dates |
| Word | A true `.docx` (hand-written zip + document XML), or a web page saved as `.doc` as the power-up does: §11, phase 7 | A heading per board and list, a line per task; subtasks as boxes |
| PDF | Hand-written (decision 7) | A4, same layout as Word. Letters outside Western European print as "?"; the format step says so |

A file Stack'd exported as CSV, Excel, JSON or XML imports back through
the guide with every column placed in step 1.

On iPhone and Android the file goes to the share sheet (Save to Files,
Mail, AirDrop), through the Filesystem and Share plugins (decision 13). In
a browser it downloads.

### 06.3 Backup (decision 4)

A page under Settings with two cards.

**Back up now** writes one file, `stackd-backup-2026-11-26-1405.json`
(decision 38): boards, tasks, notes, meetings with transcripts and minutes,
priorities, labels. Not in it, and the page says so:

- recordings;
- boards shared with other people, and their cards (decision 34): no other
  person's e-mail address goes into a file, and a shared board stays what
  it is, a board in its owner's account. The sentence shows only on a
  device that has a shared board.

A backup that could not be restored is not made: before the file is handed
over it is checked against everything a restore checks (size, number of
items), and a dialog says why when it fails. One case needs help to
restore: a device whose only boards in use are shared ones, with notes,
meetings or archived boards of its own. A restore needs one board in use,
so the file then carries an empty board called "Board" to stand in. Under the
card: "Last backup file made on 26/11/2026 at 14:05.", or "No backup file
made on this device yet." (decision 41). The time is noted only when a
file really was handed over; it belongs to the device, is not in the file,
is not synced, and a restore leaves it alone. A short message confirms:
"Backup file made".

**Restore a backup** replaces what is on the device with what is in a
backup file. The file is read and checked first; then one question,
"Replace what is on this device?", shows when the backup was made, what it
holds and what it replaces, says that archived and deleted items are
counted and how many recordings would go, with Cancel in focus (decision
40). Then "Backup restored".

Every refusal is a dialog titled "The backup was not restored", with the
whole sentence, and each ends "Nothing was changed." (decision 42):

| The file is | The dialog says |
|---|---|
| not a backup, or not readable | This is not a Stack'd Minimalist backup. |
| the file from Account › Export my data | This is the file from Export my data. It holds the account as the server keeps it and cannot be restored here. |
| a Stack'd Finance backup | This is a backup of Stack'd Finance, not of Stack'd Minimalist. |
| from a newer version | This backup comes from a newer version of Stack'd. Update the app, then restore it. |
| damaged | This file is damaged (what is wrong). |
| too large | This file is too large to be a Stack'd Minimalist backup. |
| too big for this device's storage | There is not enough room on this device for the backup. |

**Signed in** (decisions 16 and 36): Back up now works as above. Restore is
switched off, with "Not while signed in: your account is the copy of your
data." and, under the card, the way round: "To restore a file anyway: sign
out and choose Keep a copy, restore the file, then sign in again. At
sign-in, Merge sends the restored versions to your account and your other
devices; Use my account discards them." The signed-in Account card that
was also labelled "Your data" is now "Account data" (decision 39).

**The old address** (decision 37): the banner's "Download my data" writes
the same backup file, and a dialog says where it goes: "Open
app.stackdplatform.com, go to Settings › Backup, press Restore a backup
and choose that file."

**Inside the iPhone and Android apps** a file cannot be saved until phase
8 (decision 13). Until then Back up now says so in a dialog and notes no
time: the app never claims a file it did not hand over.

### 06.4 Remembered imports (decisions 5 and 33)

A page that lists what the guide has learned, one row per file layout,
named after its columns or by the owner: "35 columns: List Name, Name,
Desc… · used 3 times · last 26 Nov 2026". A row opens to show the
remembered answers (columns, lists → lanes, label choices, date order) and
can be renamed or deleted. On the next import of a file with the same
columns the guide arrives filled in and stops only at Where and Review.

Synced with the account (decision 19): the layouts travel in the settings
record, next to priorities and labels, so an import set up on the laptop is
remembered on the phone. Only the answers are kept, never the file or its
rows. A device still on 1.6.0 is handled as in §05.

## 07. Out of scope

- Importing PDF or Word. Exporting notes or meetings.
- Automatic or scheduled backups. Hand-written import rules.
- Reading a board straight from another tool's account.
- Readers written for one named tool (decision 18).
- Label colours. Card members, comments and attachments.
- Lists, links and headings inside a description (notes have none).
- A cover page, an accent colour or a title field in Word and PDF.
- Text sizes outside Settings.

## 08. Engineering notes

- No new JavaScript libraries. New modules, each testable under Node like
  `src/backup.js`: `src/formats/csv.js`, `xlsx.js`, `xml.js`, `docx-write.js`,
  `pdf.js`, `zip.js` (the reader in `src/docx.js` grows a writer), and
  `src/importer.js` (recognise, map, clean), `src/exporter.js`.
- New checks in `npm run check`: each format written then read back; the
  importer against made-up fixtures in the six sample layouts. The owner's
  real files are not committed: the repository is public.
- The service worker's file list grows; `app.bundle.js` is rebuilt.
- Import is new untrusted input: `/security-review` before the version
  bump, as for every release.

## 09. Risks

| Risk | What is done about it |
|---|---|
| Saving a file from inside the iPhone app | Today's download link does not work in the app's web view. Needs two official Capacitor plugins (Filesystem, Share). Cannot be verified without a device: a TestFlight build, then the owner's check |
| How the swipe left feels on the iPhone | Same code as the swipe right, which took several builds to get right. Checked in the test browser, then on the owner's phone |
| Description or automation lost when a 1.6.0 device edits (§05) | Checked: it can happen. 1.7.0 keeps and re-sends what an old device left out; agreed in phase 3 |
| Hand-written Excel, Word and PDF opening everywhere | Each is opened in Excel, Word, Pages, Numbers, Preview and a browser's PDF viewer before it is called done; the owner opens them too |
| Columns never seen with a value: checklists, start date, members (§06.1) | Not blocking, since columns are placed by logic and the guide asks when unsure. A file with those filled in would still let the checklist reading be tested on real data (§13) |
| Long boards: importing 5,000 cards | Import in one commit, measured; the board already pages at 100 |

## 10. Order of work

Each phase: options shown → owner agrees → built → shown → owner agrees.

| Phase | What | Shown for agreement as |
|---|---|---|
| 1 | B: Settings toggles, sizes, spacing. **Done and agreed** (decisions 22 to 25) | Before and after screenshots, phone and wide, light and dark |
| 2 | A: swipe left. **Done and agreed** (decision 26) | Pictures of the swipe half way in the test browser, then TestFlight |
| 3 | C: task description. **Done and agreed** (decisions 27 to 31) | Mock-ups of the task detail, three options; then the built screens |
| 4 | D: Data section, the sheet, Backup. **Done and agreed** (decisions 32 to 44) | Mock-ups, then the working pages |
| 5 | D: Import guide, CSV and JSON, Trello layout, automation | The guide, step by step, on the sample files |
| 6 | D: Import of Excel and XML | The same files in those formats |
| 7 | D: Export, six formats | The pages, and one file of each format to open |
| 8 | iPhone saving, QA, security review, version, release notes. QA includes: no switched-off button and no "being built" line left in the Import and export sheet | TestFlight build |

## 11. Still to decide, asked when the phase starts

The nine questions of the first draft (O-1 to O-9) were answered on
2026-11-26 and are decisions 13 to 21. What is left is asked as a question
when its phase starts, and the answer goes into §02.

| Phase | Question | My suggestion |
|---|---|---|
| 5 | A JSON or XML file that is not a flat list, such as Trello's own free "Export as JSON" (the whole board, with checklists, where the power-up's free plan stops at 10 cards). Decision 18 says no readers for named tools, so: leave such files out, or let the guide ask which part of the file holds the cards? | Let the guide ask; no tool is named |
| 5 | A file with no link or number per row: how a second import recognises a card (decision 17) | Same list and same title; Review shows how many were skipped and offers "import them anyway" |
| 5 | An Excel file with several sheets | Read the first, offer the others |
| 7 | Word: a true `.docx`, or a web page saved as `.doc` as the power-up does | True `.docx`: Pages and Google Docs open it properly |
| 7 | The fields ticked at first in the export | Board, list, title, description, labels, priority, due, start, done, subtasks |

## 12. Agreement points

Nothing reaches `main` without the owner. Commit and push only when asked.
A design the owner has not seen is not built; a build the owner has not
seen is not done.

## 13. Confidence

| Part | Confidence | What it rests on |
|---|---|---|
| B Settings | 95% | Measured in the browser; a matter of taste, shown first |
| A Swipe left | 85% | Logic is certain; the feel on the iPhone is not |
| C Description | 85% | The old-device question in §05 |
| D Import: CSV, JSON, XML | 90% | Sample files read; some columns never seen with a value |
| D Import and export: Excel | 85% | Hand-written; the sample is now read (two sheets, day-number dates) |
| D Export: Word, PDF | 80% | Hand-written; both samples now read, layout known; must open cleanly in several apps |
| D Saving files on the iPhone | 65% | Plugins agreed; cannot run on a device here |
| **Overall** | **about 85%** | |

Where the six points of the first draft stand (2026-11-26):

1. The three missing samples: **received and read.**
2. A full board export: **not received.** The six files sent the second
   time are the same 10-card export as the first (written 10:55 to 10:57).
   No card in them has a checklist, a start date, a comment or an
   attachment, and none is archived. Not blocking: checklists and the rest
   are tested on made-up files, and on a real one if it arrives.
3. The nine answers: **done**, decisions 13 to 21.
4. Agreement on each design: asked phase by phase (§11).
5. and 6. The iPhone checks and opening the exported files: **the owner,
   on one TestFlight build at the end.** Until then those two parts stay
   at the confidence above.
