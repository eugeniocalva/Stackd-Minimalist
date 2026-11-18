# Product Requirements Document (PRD): Stack'd Minimalist — Improvements and Shared Boards

Scope of this PRD: the sixteen items of the owner's brief of 2026-11-15
("Stack'd Minimalist: Improvement Instructions"). Thirteen are changes to
the app on the device (Kanban, navigation, the "+" button, boards). Two
(sync, sign-up and login) are already specified in `docs/prd-accounts.md`
and are only cross-referenced here. One (shared boards) is new and
depends on accounts and sync.

Status: **US-01 to US-10 built 2026-11-15, US-12 built 2026-11-16** (shared boards, server and app, run locally end to end; not deployed). AC-12.11, the Terms and Privacy wording, is drafted in accounts phase 29. Decisions
taken are in §07; calls the analyst made alone are in §08; open questions
are in §09. Companion documents: `docs/prd-accounts.md`,
`docs/architecture.md` Part V (§38 onwards). Target release: **1.6.0**
(owner decision, §07 Q1).

The brief's screenshots (S1 to S16) were not in the file that reached the
analyst. The two Stack'd Finance references (S6, S16) were read from the
Finance code instead (`widgets.js` remove badge, `components.js` action
grid).

---

## 00. Vocabulary

| Term | Meaning | Today in code / UI |
|---|---|---|
| **Main menu** | The mobile screen that lists boards, Notes, Meetings, the archive and Settings | `UI.screen === 'lists'`, titled "Boards" |
| **Done lane** | The column every completed card goes to | `DONE_LANE`, can be renamed and moved |
| **Origin lane** | The lane a card was in when it was marked done | not stored |
| **Session** (of the app) | From opening the app to closing or reloading it | — |
| **Hold** | Pressing a card or a board row without moving | 350 ms starts a card drag on touch |
| **Delete badge** | A small round "X" button shown on a held card or board row | does not exist |
| **Archive & Bin** | The menu group that holds the Archived and Deleted pages | "Folders" |
| **Add menu** | The grid the "+" button opens | does not exist; "+" acts per page |
| **Personal board** | A board only its owner sees | every board |
| **Shared board** | A board several accounts see and edit | does not exist |
| **Owner / member** | The account that created a shared board / an account it was shared with | does not exist |
| **Invitation** | A pending offer to join a shared board, addressed to an email | does not exist |

---

## 01. Problem Statement

### The core problem
Daily use of 1.5.0 surfaced friction in the Kanban view (the view jumps
when a card is completed, the Done lane can be broken by renaming or
moving it, the drop target is drawn badly, deleting a card is hidden),
inconsistent navigation between areas, and a "+" button that means
something different on each page. Separately, a board cannot be used by
two people.

### Why now
1.6.0 already introduces accounts and sync. Navigation and the "+"
button change shape once an account exists, and sharing is only possible
on top of sync, so doing these together avoids reworking the same
screens twice.

### Current workarounds
Scrolling back to the lane by hand after each completion; deleting cards
from the detail screen; sharing a board by reading it aloud.

---

## 02. Goals & Non-Goals

### Goals — users can
- Complete and reopen cards without losing their place on the board.
- Rely on the Done lane always being there, named and placed the same.
- Move a card by holding it, and delete it by holding longer, with a
  confirmation and an Undo.
- Reach any area from any top-level page the same way (the title chevron,
  or a swipe from the left).
- Add a task, note, meeting or automation from one "+" menu on any page.
- Reorder, archive and delete boards from the main menu.
- Create a board shared with other people and see who it is shared with.

### Non-Goals — this release does not include
- Custom automations (the tile leads to the existing Automations section).
- Roles beyond owner and member; read-only members; comments; mentions.
- Sharing notes or meetings.
- Live cursors or presence. Shared boards update within about 30 seconds.
- Push notifications for invitations (in-app only).
- Changes to the desktop "Add task" / "New meeting" buttons.

---

## 03. User Stories with Acceptance Criteria

Every criterion must hold in light and dark mode and survive a reload
unless it says "session". "Mobile" is ≤ 899 px, "desktop" ≥ 900 px. New
controls meet WCAG 2.2 AA: target size ≥ 24 × 24 px with a ≥ 44 px hit
area on touch (2.5.8), a non-drag alternative for every drag (2.5.7),
action on release, not on press (2.5.2), keyboard operable (2.1.1),
visible focus (2.4.7, 2.4.11), contrast ≥ 4.5 : 1 for text and ≥ 3 : 1
for controls (1.4.3, 1.4.11), motion off under reduced-motion (2.3.3).

### US-01 — Completing and reopening a card (brief 1)
*As a user on the Kanban view, I want to tick a card without the board
jumping.*

- [x] AC-01.1 Ticking a card moves it to the Done lane and the board
      stays scrolled where it was, sideways and inside each lane. The
      same holds for unticking, and for the List view's vertical scroll.
- [x] AC-01.2 Unticking a card in the session in which it was ticked
      returns it to the lane it was ticked in. The same applies to a
      card dragged or moved into Done.
- [x] AC-01.3 After the app is closed and reopened, unticking sends the
      card to the board's first lane that is not Done. The origin lane
      is never written to storage.
- [x] AC-01.4 If the origin lane was deleted meanwhile, the card goes to
      the first lane that is not Done.

### US-02 — A fixed Done lane (brief 2, 3)
*As a user, I want the Done lane to be dependable.*

- [x] AC-02.1 The Done lane's name is not editable: tapping it does
      nothing and it is not announced as a button.
- [x] AC-02.2 *(revised 2026-11-17)* No lane has a "⋯" menu, Done
      included.
- [x] AC-02.3 The Done lane is always the last column. No other lane can
      be moved past it; "Move right" is not offered to the lane before it.
- [x] AC-02.4 A board whose Done lane was moved in an earlier version
      opens with Done last. A Done lane renamed in an earlier version
      keeps that name.
- [x] AC-02.5 *(owner's review 2026-11-17)* A lane other than Done is
      dragged like a card, by holding it outside its cards (its header,
      the space between and below the cards). While it moves, a bar in
      the gap shows where it will land; Done stays last whatever the drop.
- [x] AC-02.6 *(2026-11-17)* Holding a lane about 1.2 s without moving
      shows the delete badge in its top-right corner, named "Remove lane
      {name}". Delete on the lane's focused name does the same from the
      keyboard. Tapping the name still renames it.
- [x] AC-02.7 *(2026-11-17)* Removing asks first: "Remove {name}?" with
      where its cards go. They move to the leftmost other lane. When Done
      would be the only lane left, they go to Deleted instead (30 days,
      Restore), and the next card added to or restored onto that board
      brings a Backlog lane back.

### US-03 — Dragging a card (brief 4)
- [x] AC-03.1 While a card is dragged, the lane under it is marked on
      all four sides by a ring drawn inside the lane, never clipped by
      the header or the screen edge, and the lane's background tints.
- [x] AC-03.2 The mark fades in and out (about 150 ms); with reduced
      motion it switches without a fade.

### US-04 — Hold to move, hold longer to delete (brief 5)
- [x] AC-04.1 On touch, holding a card about 350 ms lifts it and it can
      be dragged (as in 1.5.0). With a mouse, dragging starts on move.
- [x] AC-04.2 Holding about 1.2 s without moving puts the card down and
      shows a delete badge at its right edge, halfway down the card
      *(2026-11-17: was its top-right corner)*: a 24 px circle with an
      "X", hit area ≥ 44 px, named "Delete card: {title}".
- [x] AC-04.3 The badge stays until it is used or the user taps anywhere
      else. It has no timeout.
- [x] AC-04.4 Pressing the badge opens a dialog: "Delete “{title}”?",
      Cancel and Delete. Delete moves the card to Deleted and shows the
      Deleted toast with Undo. *(2026-11-17)* Dialog button labels are
      centred on their capital letters, so they sit in the middle on
      every platform.
- [x] AC-04.5 Without holding: a focused card opens with Enter and asks
      to delete with the Delete or Backspace key; the detail screen
      keeps its Move and Delete buttons.
- [x] AC-04.6 A board narrowed by search does not lift cards (as in
      1.5.0) but still shows the delete badge.
- [x] AC-04.7 *(owner's review 2026-11-17)* On an open card, a swipe to
      the right takes it back to its board (or to Archived / Deleted for
      a card opened there). The card follows the finger and the board
      shows underneath as it goes; released past a third of the width,
      or flicked, it finishes, otherwise it springs back. It starts from
      the left edge, or anywhere but a field or a subtask.

### US-05 — The Deleted toast (brief 6)
- [x] AC-05.1 Every toast fades in and fades out over about 250 ms. A
      toast replaced by a newer one leaves at once.

### US-06 — One way to switch area (brief 7, 8, 9)
- [x] AC-06.1 On mobile, the titles of Notes, Meetings, Archived and
      Deleted carry the same chevron as a board's title; pressing the
      title opens the main menu.
- [x] AC-06.2 The group is called **Archive & Bin** in the main menu,
      the desktop sidebar and the bottom navigation.
- [x] AC-06.3 Archived and Deleted are two pages, each with its own
      title. The Archived / Deleted tabs are gone. The Tasks / Notes /
      Meetings / Boards switch inside each page stays.
- [x] AC-06.4 *(2026-11-17)* The main menu has no "Hold a board to move
      it" hint under Boards.

### US-07 — Swipe to the main menu (brief 10)
- [x] AC-07.1 *(revised 2026-11-17)* On mobile, on a board (List or
      Kanban), Notes, Meetings, Archived, Deleted and Settings, a swipe to
      the right brings in the main menu following the finger, over the
      page, which dims as it comes. Released past a third of the width,
      or flicked, it opens; otherwise it slides back. *(Owner's review of
      build 11, 2026-11-18)* The bottom bar and its "+" stay in place
      while the menu slides in beneath them: one bar, one "+".
- [x] AC-07.2 A swipe inside the lanes still scrolls the board, as today.
- [x] AC-07.3 *(revised 2026-11-17)* A swipe that starts on an item does
      nothing: a row (a task, done or not, a note, a meeting, an archived
      or deleted entry), a card, a lane, a Settings card, a text field,
      anything that scrolls sideways. It starts on the space around them
      (titles, headers, gaps), and always from the left edge (24 px).
- [x] AC-07.4 With reduced motion the menu appears without sliding.

### US-08 — Main menu header (brief 11)
- [x] AC-08.1 The only thing fixed at the top of the main menu is
      "Stack'd Minimalist", right-aligned.
- [x] AC-08.2 "Boards" is a section title like the others and scrolls
      with the list.
- [x] AC-08.3 Section titles in the main menu use one style, between the
      old "Boards" title (24 to 32 px) and the old "Notes" label (12 px).

### US-09 — One "+" menu (brief 12)
- [x] AC-09.1 On mobile, "+" opens the Add menu on every page that shows
      it: a grid of Add task, Add note, Add meeting, Add automation.
      *(2026-11-17)* The four tiles alone, without a sheet around them,
      over the page blurred and washed with its background; they rise one
      after another.
- [x] AC-09.2 Add task opens the New task sheet for the current board.
      *(2026-11-17)* The sheet's first row, under the title, is Board: the
      board the task goes to, the one last open, changeable like the
      other rows.
      Add note opens Notes with the composer focused. Add meeting
      creates a meeting and opens it. Add automation opens Settings ›
      Automations.
- [x] AC-09.3 The menu closes on a choice, on Escape and on a tap
      outside; focus starts on the first tile; tiles are ≥ 44 px.

- [ ] AC-09.4 *(owner's review 2026-11-17)* On iPhone, the keyboard of
      a note, a board name or any other field has the app's background
      around it, not black, and takes the app's light or dark style. Built
      into the iOS workflow; to check on the next TestFlight build.
      *(Owner's review of build 11, 2026-11-18: still dark around a light
      app on a phone in dark mode. The surround now follows the app's
      setting, not the phone's.)*

### US-10 — Reorder, archive and delete boards (brief 15)
- [x] AC-10.1 In the main menu and the desktop sidebar, holding a board
      (touch) or dragging it (mouse) moves it up and down; the order is
      kept.
- [x] AC-10.2 Holding about 1.2 s without moving shows a delete badge on
      the row, named "Remove board: {name}".
- [x] AC-10.3 The badge opens a dialog naming the board and its number
      of cards, with Cancel, **Archive** and **Delete**.
- [x] AC-10.4 The board leaves the menu together with all its cards and
      appears under Archived › Boards or Deleted › Boards with its card
      count. A toast offers Undo.
- [x] AC-10.5 Restore puts the board back with every card where it was.
      A deleted board is removed for good after 30 days, with its cards;
      "Delete forever" asks first.
- [x] AC-10.6 The last remaining board cannot be removed; the app says
      why.
- [x] AC-10.7 Cards on an archived or deleted board fire no reminders
      and are not offered as a destination anywhere.
- [x] AC-10.8 Without holding: a focused board row opens with Enter and
      asks to remove with Delete or Backspace.
- [x] AC-10.9 "New board" asks for the name in the app's own dialog, not
      the browser's prompt.

### US-11 — Sync (brief 13)
Specified in `docs/prd-accounts.md` US-05 and US-06. Assessment asked for
by the brief:

- Sync stays **automatic**: 2 s after an edit, and on open, resume,
  focus and reconnect. A **Sync now** row is added for certainty
  (already AC-05.x there).
- Cost: one small request per sync, a few database rows per changed
  record, no open connections. Within the hosting plan's included
  volume for the foreseeable user count; verify current provider
  pricing before publishing numbers.
- Addition from this PRD: while the app is visible and signed in, it
  also pulls every 30 s, so two open devices converge without a tap
  (needed by US-12 as well).

- [x] AC-11.1 With two signed-in devices open, a change made on one
      appears on the other within 35 s without any action.

### US-12 — Shared boards (brief 14)
*As a signed-in user, I want a board other people can work on with me.*

- [x] AC-12.1 "New board" first asks **Personal** or **Shared**.
      Personal continues to the name. Signed out, Shared explains that
      sharing needs an account and offers Sign in.
- [x] AC-12.2 Shared asks for the name, then for one or more email
      addresses. Invalid addresses are refused in place. The owner's own
      address is refused.
- [x] AC-12.3 Each invited person who is, or later becomes, a signed-in
      user with that email sees an invitation in the app: a dot on the
      main menu and a card "{owner email} shared “{board}” with you",
      Accept or Decline. Invitations expire after 30 days.
- [x] AC-12.4 The answer to the owner is the same whether or not the
      email has an account.
- [x] AC-12.5 An accepted board appears in the member's board list.
      Owner and members can add, edit, move, complete, archive and
      delete cards and change lanes. Only the owner can rename, archive
      or delete the board, invite and remove people. A member can leave.
- [x] AC-12.6 Inside a shared board, a "Shared" mark sits next to the
      title; pressing it lists the people (email, owner / member,
      pending) and, for the owner, Invite and Remove.
- [x] AC-12.7 Settings › Shared boards lists every shared board with the
      people on it.
- [x] AC-12.8 Changes by one person reach the others within 35 s while
      the app is open. The newer change wins per card (as in sync).
- [x] AC-12.9 When the owner deletes the board or removes a member, the
      board disappears from that member's device at the next sync, with
      a one-line notice.
- [x] AC-12.10 A shared board has at most 10 people. Reminders stay per
      device. A priority level a member does not have shows as none and
      is kept.
- [x] AC-12.11 Terms and Privacy say that content on a shared board and
      the member's email are visible to the people on it.

### US-13 — Sign up and login (brief 16)
Specified in `docs/prd-accounts.md` US-02, US-03, US-04, US-07 (email
code, 4-digit PIN, device biometrics). Nothing added here.

---

## 04. Scope — MoSCoW

### Must have
US-01 to US-10; US-11 and US-13 as far as `prd-accounts.md` marks them
Must; US-12 AC-12.1 to 12.9 and 12.11.

### Should have
- AC-11.1 (30 s pull while visible) and AC-12.10.
- The delete badge on List view rows (today: hold deletes at once, with
  Undo).

### Could have
- Opening an archived board read-only.
- An email to the invited person in addition to the in-app invitation.

### Won't have (this release)
Everything in §02 Non-Goals.

---

## 05. Technical Notes & Constraints

### Tech stack
Unchanged: vanilla ES modules, no framework, `localStorage`, Capacitor
shells. Shared boards use the Worker and D1 database that accounts add.

### Constraints & dependencies
- US-12 needs phases 24 to 26 of `prd-accounts.md` (sign-in, sync).
- Sharing makes content visible to other people: the copyright-agent
  registration in `plan-accounts.md` §4 row 6 becomes an owner task
  before release.
- Every gesture change must leave the existing ones working: double-tap
  complete and swipe-left delete on List rows, lane scroll on the board.

---

## 06. Success Metrics

### Key metrics
- Zero view jumps when completing 20 cards across three lanes.
- A card can be deleted from the board in two taps after the hold.
- Any top-level page reaches the main menu in one gesture.

### Definition of done
`npm run check` green; each AC verified in the preview at 375 px and
1280 px, light and dark; QA report updated; `/security-review` before
the version bump.

---

## 07. Decisions taken (2026-11-15)

| # | Question | Decision |
|---|---|---|
| Q1 | What does this round cover? | **Everything in 1.6.0**, shared boards included. |
| Q2 | Name of the Folders group | **Archive & Bin.** |
| Q3 | "Add automation" before custom automations exist | **Opens Settings › Automations.** |
| Q4 | Documents | **PRD and architecture first, then build**, no approval stop. |

---

## 08. Calls made without a question

Each can be reversed by editing the AC it names.

- **Done is pinned last** (AC-02.3). "Cannot be moved left" plus a
  disabled menu leaves no other position reachable.
- **A renamed Done keeps its name** (AC-02.4). Overwriting something the
  user typed is worse than one odd label.
- **The delete badge needs a release and a second tap** (AC-04.2 to
  04.4), like the Finance tile, so nothing is deleted by a long press
  alone.
- **List rows keep hold-to-delete with Undo.** The brief names Kanban
  cards only.
- **The main menu is still a full screen**; the swipe slides it in
  (AC-07.1). A partial drawer would be a second menu to maintain.
- **"Left side" means the left half of the screen** (AC-07.1). A thin
  edge strip collides with the browser's own back gesture on the web.
- **Desktop keeps its own add buttons** (AC-09.1). The brief describes
  the mobile "+".
- **An archived board keeps its cards inside it** (AC-10.4, 10.5); they
  are not listed one by one under Archived › Tasks.
- **Sharing is by invitation that must be accepted** (AC-12.3), and all
  members can edit (AC-12.5).
- **Notifications are in-app only** (AC-12.3), as the brief says.

---

## 09. Open questions and risks

### Owner tasks
- [ ] Those of `prd-accounts.md` §09 (email provider, EU database, legal
      name, processor agreements, store forms, lawyer's read).
- [ ] Register a copyright agent before shared boards ship.

### Open questions
- Should an invitation also send an email (Could-have)?
- May a member invite others, or only the owner (now: only the owner)?

### Risks
| Risk | Mitigation |
|---|---|
| The hold gesture fights scrolling on touch | Hold timers cancel on 10 px of movement; verified on both phones in QA. |
| Pinning Done surprises a user who moved it | One-time, order-only change; names untouched. |
| Shared boards widen the sync data model late in the release | Built last, behind sign-in; personal sync ships unchanged if sharing slips. |
| A member's device keeps a board after removal while offline | It is removed at the next sync; stated in the Terms. |

---

## 10. Delivery plan

| Phase | Content | Stories |
|---|---|---|
| 31 | Kanban: scroll, origin lane, fixed Done, drop mark, hold gestures, toast | US-01 to US-05 |
| 32 | Navigation: title chevron, Archive & Bin, two pages, swipe, menu header, Add menu | US-06 to US-09 |
| 33 | Boards: reorder, archive, delete, restore | US-10 |
| 24 to 28 | Accounts, sync, plan, app lock (`prd-accounts.md`) | US-11, US-13 |
| 34 | Shared boards on the server | US-12 |
| 35 | Shared boards in the app | US-12 |
| 29, 30 | Legal surface, QA, security review, release | all |

Order: 31, 32, 33, then 24 to 28, then 34, 35, then 29 and 30.
