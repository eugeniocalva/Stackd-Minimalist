# Product Requirements Document (PRD): Stack'd Minimalist — Meetings

Scope of this PRD: a new top-level **Meetings** area, separate from Notes,
where the user records a meeting (or brings a transcript from elsewhere),
turns it into a transcript with speaker labels, turns the transcript into
**minutes** (summary, decisions, open questions) and a list of **action
cards**, and sends the actions they keep to a board as tasks. Notes stay
exactly as shipped in 1.4.0.

Status: **approved 2026-10-20; in build** — Phases 14 (Android shell), 15 (Meetings area, text path), 16 (proxy and minutes), 17 (action cards) and 18 (plans and purchases) shipped; ticked criteria are verified in Chrome at 639 px and 1280 px, device checks come with Phase 22. Decisions taken so far
are in §07; the few calls the analyst made alone are in §08; the remaining
open questions are in §09; the unit economics of the paid plans are in
§11. Companion documents: `docs/prd.md` (tasks, v2), `docs/prd-notes.md`
(Notes, 1.4.0), `docs/architecture.md`. Target release: **1.5.0**.

---

## 00. Vocabulary

| Term | Meaning | Today in code / UI |
|---|---|---|
| **Meeting** | One record in the Meetings area: title, date, an optional recording, an optional transcript, optional minutes, and its action cards | does not exist |
| **Recording** | The audio captured in the app through the microphone, max 30 minutes, stored on the device outside the main store | does not exist |
| **Transcript** | The meeting as text, split into **segments**, each with a **speaker** label and, when it came from a recording, a start time | does not exist |
| **Speaker** | A label on a segment: "Speaker 1", "Speaker 2"… as detected, or the name the user gave it | does not exist |
| **Minutes** | The AI-written summary of the transcript: a short summary, the decisions, the open questions | does not exist |
| **Action** | One AI-proposed task from the transcript, shown as an editable card until the user adds it to a board or deletes it | does not exist |
| **Source** | Where the transcript came from: the recording, pasted text, or an attached file | — |
| **Transcribe / Summarise** | The two AI steps, each started by the user with a button, never automatically | — |
| **Proxy** | A small server the app calls for the two AI steps; it holds the provider keys, the app never does | does not exist |
| **Processing** | A transcribe or summarise step that is running: upload, wait, result | — |
| **Added** | An action that has become a task on a board; the card shows where it went | — |
| **Plan** | Free, Pro or Max: what the user may ask the AI steps to do each month, and the subscription behind it | does not exist |
| **Entitlement** | The proof, checked by the proxy, that this user's plan allows the step they pressed | does not exist |
| **Paywall** | The Settings section that shows the plans, buys one, restores a purchase, and shows what is left this month | does not exist |
| **Task sheet** | The existing "New task" sheet with due date, repeat, priority, tags, board | `src/ui/addsheet.js` |
| **Board + lane picker** | The existing sheet used by Move and Copy | `src/ui/movecopy.js` |

---

## 01. Problem Statement

### The core problem
A meeting produces three things the user needs afterwards: what was said,
what was agreed, and what they now have to do. Today the first two live in
a recorder or a conferencing tool, and the third is retyped by hand into
Stack'd, one task at a time, usually hours later, usually incompletely. The
actions are the part Stack'd is for, and they are the part that gets lost.

### Why now
Stack'd has boards, lanes, due dates, priorities, labels and reminders
(1.1.0 to 1.3.0) and a quick-notes area (1.4.0). The missing input is the
one that produces the most tasks at once. Speech-to-text with speaker
labels and summarisation with action extraction are now ordinary cloud
services at a few cents per meeting, which makes a "meeting to tasks"
bridge realistic for a one-person app.

### Current workarounds
Apple Voice Memos or the phone's recorder, then listening back; Teams or
Zoom transcripts read in a browser; Otter, Fireflies or Granola for notes,
then manual copy of each action into a board. Every path ends with
retyping.

---

## 02. Goals & Non-Goals

### Goals — users can
- Open Meetings, tap the mic, and record up to 30 minutes with a visible
  level line and a running clock; stop, play back, and keep the recording.
- Alternatively paste a transcript, or attach a `.txt`, `.vtt`, `.srt` or
  `.docx` transcript exported by another tool.
- Turn a recording into a transcript with speaker labels, rename the
  speakers, and tap a line to hear that moment again.
- Turn a transcript into minutes (summary, decisions, open questions) and a
  list of action cards, each with a suggested due date and priority.
- Edit an action's text, delete it with a swipe left, or swipe right to add
  it to a chosen board and lane through the existing task sheet.
- Keep every meeting in a searchable list with the same archive, delete,
  restore and 30-day safety net tasks and notes have.
- Free space by deleting a recording once its transcript exists.
- Know exactly when audio or text leaves the device: only when they press
  Transcribe or Summarise, and the app says where it goes.
- Use everything except the two AI steps for free; subscribe to **Pro** or
  **Max** from Settings on iPhone and Android to unlock transcription and
  minutes with a monthly allowance, restore it on a new phone, and see
  what is left.
- Use it on iPhone, Android and in the browser, light and dark; everything
  except the two AI steps works offline.

### Non-Goals — this release does not include
- Recording audio that another app is playing (a Teams or Zoom call on the
  phone). On iOS and Android an app can only capture the microphone.
- Live transcription or captions while recording; the transcript is made
  after the recording, on request.
- Languages other than English for transcription and minutes.
- Naming speakers automatically, or recognising a voice across meetings.
- Accounts and sign-in. Plans are tied to the App Store / Play account
  through the purchase, not to a Stack'd account.
- **Buying a plan on the web.** The browser version is Free in 1.5.0;
  web subscriptions need accounts to link a web payment to a phone, and
  come with them in a later release (§09).
- Sync, sharing or exporting minutes (export as text is a Could).
- Calendar integration, meeting invites, attendees.
- Custom prompts, choosing the AI model, tuning the summary length.
- Reminders on meetings; the schedule engine stays task-only.
- Annual plans, free trials, promo codes, family sharing, lifetime
  purchases (candidates once the monthly plans have numbers behind them).

---

## 03. User Stories with Acceptance Criteria

Every criterion must hold on mobile (≤ 899 px) and desktop (≥ 900 px), in
light and dark mode, and survive a reload. Touch targets are ≥ 44 × 44 px;
everything is keyboard operable; text contrast ≥ 4.5 : 1. "Device" means a
real iPhone and a real Android phone; the simulator has no microphone.

### US-01 — Reach Meetings from anywhere
*As a user, I want Meetings to be a first-class area next to Boards, Notes
and Folders.*

- [x] AC-01.1 Desktop sidebar: a **Meetings** item with a live count of
      active meetings, directly under Notes.
- [x] AC-01.2 Mobile: the Boards menu lists **Meetings** under Notes (same
      card, same row style, with its count). The bottom nav pill stays at
      four items (§08); Meetings is reached from the Boards menu.
- [x] AC-01.3 The Meetings screen has the board header: title **Meetings**,
      kicker "4 meetings", the **search bar** (AC-02.4) and, on the right,
      the sort control (AC-02.5).
- [x] AC-01.4 On the Meetings screen the **+** FAB creates a new meeting
      and opens it (US-03), so recording is two taps from the list.
- [x] AC-01.5 Empty state: "No meetings yet. Tap + to record one or paste
      a transcript."

### US-02 — Meeting list
*As a user, I want to see my meetings as a calm list and know at a glance
how far each one got.*

- [x] AC-02.1 Meetings appear as flush rows with hairline dividers inside
      one surface card (the note-row pattern), newest first by default.
- [x] AC-02.2 Each row shows: the **title** (default "Meeting · 20/10/2026
      14:03", editable in the detail); under it a **status line** of small
      neutral chips, only the ones that apply: **Recording 12:34** ·
      **Transcript** · **Minutes** · **3 actions** (count of actions not yet
      added or deleted; "3 added" once all are on boards); on the right the
      meeting **date** in the Date format setting, with "Today" /
      "Yesterday" when recent.
- [x] AC-02.3 A row whose transcribe or summarise step is still running
      shows a small spinner chip ("Transcribing…"); one whose last step
      failed shows an amber "Failed" chip. Both open the meeting on tap.
- [x] AC-02.4 Search filters the list as you type (same field and rules as
      Notes) against title, transcript text, minutes and action titles.
      Empty result: "No meetings match ‹query›."
- [x] AC-02.5 Sort: **Newest first** (default), **Oldest first**, **Title
      A–Z**. No manual order (§08).
- [x] AC-02.6 Tapping a row opens the meeting (US-03). Rows have the hover /
      pressed states of note rows and are reachable with Tab + Enter.
- [x] AC-02.7 The list shows **active** meetings only; archived and deleted
      ones live in the Folders (US-10).

### US-03 — Meeting detail: one screen, in order
*As a user, I want one screen that walks me from audio to actions, where
each step appears only when the previous one exists.*

- [x] AC-03.1 The meeting opens on the detail shell (sticky bar with back
      and ⋯). Mobile: full screen; desktop: the main column. Top to bottom:
      **title** (editable, single line); a **date line** "Recorded
      20/10/2026 · 14:03" (or "Created" when there is no recording); then
      the blocks of US-04 to US-08 in this order: **Recording**,
      **Transcript**, **Minutes**, **Actions**. A block that cannot exist
      yet is not drawn; the next possible step is drawn as its button.
- [x] AC-03.2 A new meeting shows only the **Source** block: a large **mic
      button** (primary, round) with the label "Record", and under it two
      secondary buttons **Paste transcript** and **Attach file**.
- [x] AC-03.3 Once a recording exists the Source block becomes the
      **Recording** block (US-04); once a transcript exists from any
      source, the **Transcript** block (US-06) appears under it; once
      minutes exist, **Minutes** then **Actions** (US-07, US-08).
- [x] AC-03.4 The **⋯ menu** holds **Rename · Archive · Delete** (Delete
      last, destructive, after a divider), like a note.
- [x] AC-03.5 Title edits save on blur / after 500 ms, like a note. A new
      meeting left with no recording, no transcript and the default title
      is deleted silently on back (no empty rows).

### US-04 — Record audio
*As a user, I want to tap a mic and trust that the whole meeting is being
captured, even with the phone locked in my pocket.*

- [ ] AC-04.1 **First use**: before the first recording the app shows a
      one-time dialog "Recording a meeting — make sure everyone present
      knows and agrees." with **Record** / **Cancel**; after that the
      system microphone permission prompt. Denied permission shows an
      in-place message with a button that opens the system settings on
      iOS / Android and instructions on the web.
- [ ] AC-04.2 **Recording**: the mic button becomes a **red square Stop**
      button; a **level line** animates with the microphone input (a
      horizontal line of bars or a waveform that scrolls, in the accent
      colour, flat when silent); a **clock** "mm:ss" counts up from 00:00
      next to a muted "/ 30:00"; a red dot and "Recording" sit in the
      header. The ⋯ menu and back are disabled while recording.
- [ ] AC-04.3 **Lock screen and background**: on iPhone and Android the
      recording continues when the screen locks or the user switches app,
      and the system shows its own recording indicator (orange dot on iOS,
      the notification of a foreground service on Android). On the web the
      recording continues while the tab is in the background on desktop;
      on mobile browsers the OS may stop it when the screen locks, and the
      Record screen says so once ("On the web, keep the screen on while
      recording.").
- [ ] AC-04.4 **Stop**: tapping Stop ends the recording. At **30:00** the
      recording stops by itself, with a toast "Stopped at 30 minutes" and a
      haptic. Either way the recording is saved before the UI changes;
      an app kill mid-recording keeps what was captured up to the last
      saved chunk (at most a few seconds lost).
- [ ] AC-04.5 **Saved**: the Recording block shows a **Play / Pause**
      button, a scrubber, the elapsed and total time "03:12 / 12:34", and a
      **Transcribe** button with the document icon (AC-05.1). Playback
      pauses when another playback starts or the user leaves the screen.
- [ ] AC-04.6 **Size and place**: audio is recorded mono at a bitrate that
      keeps 30 minutes under about 15 MB, in the format the platform
      produces natively (AAC on iOS and Safari, Opus on Chrome and
      Android). It is stored on the device outside the main store (the
      main document stays small) and survives app updates and restarts.
      The app asks the browser for persistent storage the first time it
      records.
- [ ] AC-04.7 **Space**: when free storage is below twice the maximum
      recording size, Record is still allowed but a warning sits above the
      mic button ("Low space: about 40 MB left"). When there is not enough
      space for one minute, Record is disabled with the reason.
- [ ] AC-04.8 **Delete recording**: a secondary "Delete recording · 11 MB"
      action in the Recording block (confirm). Deleting it keeps the
      transcript and minutes; tap-to-seek (AC-06.3) is then unavailable.
      After a transcript is made, a toast suggests it once: "Transcript
      ready. Delete the recording to free 11 MB?" with **Delete** / dismiss.
- [ ] AC-04.9 One recording per meeting. Recording again on a meeting that
      has one replaces it after a confirm, and clears its transcript,
      minutes and un-added actions (added tasks stay on their boards).

### US-05 — Transcribe with speaker labels
*As a user, I want the recording turned into text where I can see who said
what.*

- [ ] AC-05.1 **Transcribe** uploads the recording to the proxy, which
      sends it to the speech-to-text provider with speaker labelling on,
      English. The button becomes a progress state: "Uploading 40 %" with a
      bar, then "Transcribing… about 2 min" with a spinner. Cancel is
      available during upload; after that the step completes or fails.
- [ ] AC-05.2 **Survives leaving**: the step keeps running if the user
      goes back to the list, to a board, or closes the app; the meeting
      row shows "Transcribing…" (AC-02.3), and on return or app start the
      app resumes waiting for the result. The result is stored the moment
      it arrives.
- [ ] AC-05.3 **Result**: the Transcript block (US-06) appears with the
      segments, each labelled "Speaker 1", "Speaker 2"… in order of first
      appearance, each with its start time.
- [ ] AC-05.4 *(Summarise half done in Phase 16; Transcribe in Phase 20)* **Failure**: a clear in-place message with the reason the
      user can act on ("No connection", "Recording too quiet to
      transcribe", "Daily limit reached, try tomorrow", "Service
      unavailable, try again") and a **Retry** button. Nothing is
      partially written.
- [ ] AC-05.5 *(Summarise half done in Phase 16)* **Offline**: with no connection Transcribe and Summarise are
      disabled with the hint "Needs a connection"; everything else on the
      screen works.
- [ ] AC-05.6 *(done in Phase 16 for both buttons)* **Disclosure**: the first time either AI button is pressed,
      a one-time dialog says what leaves the device and where ("The
      recording is sent to our server and to a speech-to-text provider to
      make the transcript. Nothing is sent until you press this button.")
      with **Continue** / **Cancel**; the same text is always readable
      under Settings › Meetings & AI (US-11).

### US-06 — Read, fix and name the transcript
*As a user, I want to correct a name, fix a word, and jump to the audio.*

- [x] AC-06.1 The Transcript block lists segments as **speaker label** in
      Manrope on its own line, then the text. Consecutive segments by the
      same speaker merge visually. Long transcripts collapse after about 12
      lines behind **Show all**.
- [x] AC-06.2 **Rename a speaker**: tapping a label opens a small prompt
      ("Name for Speaker 2"); the name applies to every segment of that
      speaker in this meeting, is stored on the meeting, and is used in the
      minutes and actions generated afterwards. Clearing the name returns
      the default label.
- [ ] AC-06.3 **Tap to seek**: when the recording exists, tapping a
      segment's time starts playback there and the playing segment is
      highlighted while audio runs.
- [ ] AC-06.4 **Edit text**: a segment's text is editable in place (tap the
      text, edit, blur to save). Edits set `updatedAt` and mark minutes as
      possibly stale (AC-07.5).
- [x] AC-06.5 **Pasted transcript** (AC-03.2): a sheet with a multi-line
      text area, placeholder "Paste the transcript here", and **Use**.
      Lines shaped "Name: text", "[00:12] Name: text" or "Name  00:12"
      are split into segments with that speaker; anything else becomes one
      segment labelled "Transcript" with no times.
- [ ] AC-06.6 *(txt / vtt / srt done in Phase 15; docx in Phase 21)* **Attached file** (AC-03.2): the system file picker limited
      to `.txt`, `.vtt`, `.srt`, `.docx`. `.vtt` and `.srt` keep their
      timestamps and, when present (Teams' `<v Name>` cues), the speaker
      names. `.txt` and `.docx` are treated as pasted text (AC-06.5). The
      file name is kept as the source. Unreadable or empty files show
      "Couldn't read this file" without creating a transcript.
- [ ] AC-06.7 Under the Transcript block, a **Summarise** button with the
      sparkle icon, labelled "Summarise into minutes and actions"
      (US-07). Once minutes exist it reads **Regenerate** (confirm, since it
      replaces the minutes and the un-added actions).

### US-07 — Minutes
*As a user, I want the gist in a minute, not the whole transcript.*

- [x] AC-07.1 **Summarise** sends the transcript (with speaker names) to
      the proxy, which asks the language model for a fixed structure:
      summary (≤ 150 words), decisions (list), open questions (list),
      actions (US-08). The button becomes "Summarising…" with a spinner;
      the step survives leaving like AC-05.2 and fails like AC-05.4.
- [x] AC-07.2 The Minutes block shows three sections, each with its
      heading and left empty with "None noted" rather than hidden:
      **Summary** (paragraph), **Decisions** (bullets), **Open questions**
      (bullets).
- [x] AC-07.3 A muted line under the heading reads **"Generated by AI ·
      20/10/2026 14:40 · check before you rely on it."**
- [x] AC-07.4 Minutes text is editable in place (tap, edit, blur), with
      the same save rules as a note body; plain text only.
- [x] AC-07.5 If the transcript changes after the minutes were made
      (AC-06.2, AC-06.4), a muted chip "Transcript edited since" appears
      next to Regenerate. Nothing regenerates by itself.

### US-08 — Action cards, and from a card to a board
*As a user, I want the actions as cards I can fix, drop, or send to the
right board without retyping.*

- [x] AC-08.1 The Actions block lists the proposed actions as **cards**
      (surface, one per action), in the order the model found them. Each
      card shows: the **title** (editable in place, single line, plain
      text); a **due chip** when a date was suggested ("Fri 24/10", from
      phrases like "by Friday" counted from the meeting date) and a
      **priority chip** when one was suggested (the user's own priority
      names from Settings); and in secondary text the **excerpt**, the
      transcript sentence the action came from, so the user can judge it.
      No owner field (§07 Q6); the title may name the person when the
      transcript did.
- [x] AC-08.2 The model proposes only actions the transcript states as
      commitments or requests; vague future tense is not an action. At
      most 12 per meeting; an empty result shows "No actions found."
- [x] AC-08.3 **Swipe left** on a card reveals the red **Delete** control
      (the task-row gesture and visuals); tapping it removes the card with
      a toast and **Undo** (5 s). On desktop the card's hover reveals an
      ✕ with the same effect.
- [x] AC-08.4 **Swipe right** reveals a **board** icon control (accent
      colour); tapping it opens the **board + lane picker** (the Move /
      Copy sheet, titled "Add to board"). On desktop the card's hover
      reveals the same icon.
- [x] AC-08.5 Choosing a board and lane and confirming opens the **task
      sheet** pre-filled with the card's title, due date and priority, the
      chosen board shown as a fixed chip (not changeable here; the lane is
      carried silently), tags empty; the primary button reads **Save**.
      Saving creates the task on that board and lane with those values and
      a pointer to the meeting and action; closing the sheet without
      saving leaves the card as it was.
- [x] AC-08.6 **Added state**: the card becomes muted with a check and
      "Added to Work · In Progress"; tapping it opens the task. Swipe
      actions are disabled on an added card; it can still be removed from
      the list via the ✕ (the task stays).
- [x] AC-08.7 The meeting row's chip (AC-02.2) and the Actions heading
      ("3 actions · 1 added") stay in step with the cards.
- [x] AC-08.8 A task created from an action shows, in its detail, a muted
      line "From meeting ‹title›" that opens the meeting (Should).

### US-09 — Proxy, entitlements and allowances
*As the app's owner, I want AI calls to work without shipping a key, to
spend provider money only for users whose plan covers it, and to cap what
each plan can cost me.*

- [x] AC-09.1 The app never contains a provider key. Both AI steps call
      the proxy over HTTPS with the user's **subscriber id** (the id the
      purchase service assigns on first launch, the same on every device
      after Restore); the proxy holds the provider keys as secrets.
- [x] AC-09.2 Before spending anything the proxy checks the subscriber's
      **entitlement** with the purchase service (cached for a few minutes)
      and the subscriber's **allowance** for the current month (US-12):
      audio minutes for Transcribe, summaries for Summarise. A Free user,
      an expired plan, or a used-up allowance gets a specific error that
      the app turns into the paywall or the "allowance used" message
      (AC-12.6), never a generic failure.
- [ ] AC-09.3 *(summaries done in Phase 16; audio minutes in Phase 20)* Allowances are **monthly pools per subscriber** (§07 Q3,
      §11), counted by the proxy: audio minutes are charged by the
      recording's duration rounded up to the minute when a transcription
      is accepted; a summary is charged when it is accepted. Failed steps
      are not charged. The pool resets on the plan's renewal date; the
      remaining amounts come back in every response so the app can show
      them (AC-12.5).
- [x] AC-09.4 **TestFlight and internal testing**: a tester allow-list in
      the proxy config gives listed subscriber ids a daily allowance of
      60 audio minutes and 10 summaries without a purchase, so testers
      exercise everything; the plans are still visible and buyable through
      the store sandbox.
- [x] AC-09.5 The proxy keeps nothing after a step completes: no audio, no
      transcript, no minutes; only the per-subscriber counters and error
      logs without content. This is stated in US-11.
- [x] AC-09.6 The proxy's source lives in the repository (`proxy/`) and
      deploys from a manual GitHub Actions workflow, like the iOS build;
      its secrets are repository secrets. The web app's proxy URL is a
      constant in the code, overridable in Settings for development.

### US-10 — Archive, delete and restore meetings
*As a user, I want the safety net I already have for tasks and notes.*

- [x] AC-10.1 Archive and Delete work like notes: status, timestamp, toast
      with **Undo** (5 s); "Delete forever" and "Empty folder" keep their
      confirm.
- [x] AC-10.2 The Archived and Deleted folders' segmented control becomes
      **Tasks ∕ Notes ∕ Meetings**; folder counts add all three. Meeting
      rows reuse the row layout of AC-02.2 plus "Archived 3 days ago" /
      "Removed in 27 days".
- [x] AC-10.3 An archived or deleted meeting opens read-only with Restore
      and Delete / Delete forever; playback still works, AI buttons do not.
- [ ] AC-10.4 The recording file is removed when the meeting is deleted
      forever, emptied from the folder, or purged after 30 days; Archive
      keeps it. Folder rows show the recording size so the user sees what
      "Empty folder" frees.

### US-11 — Settings, trust and platform parity
- [x] AC-11.1 Settings gets a **Meetings & AI** section: the disclosure
      text (what is sent, where, when, that nothing is kept on the server),
      the one-time dialogs' "show again" reset, and, under a **Developer**
      disclosure, the proxy URL override. The plan and allowance live in
      the **Plan** section right above it (US-12).
- [x] AC-11.2 AI output is always labelled (AC-07.3) and never replaces
      user text without a confirm (AC-06.7, AC-04.9).
- [ ] AC-11.3 Everything uses the Finance tokens; new icons in `icons.js`:
      `mic`, `stop`, `play`, `pause`, `document`, `sparkle`, `board`
      (reuse), `attach`, `clipboard`, `meeting`. The level line uses the
      accent colour and respects `prefers-reduced-motion` (static bars).
- [ ] AC-11.4 Screen readers: the mic / stop button announces its state
      and the elapsed time every 30 s while recording; the transcript is a
      list of segments with the speaker in each item's label; action cards
      are list items whose swipe actions are also reachable as buttons.
- [ ] AC-11.5 Works on the PWA, from `file://` (bundle; AI steps need
      http(s) and say so), inside the Capacitor iOS shell and the Android
      shell; new files are in the SW shell list and `check-shell.mjs`
      passes; `app.bundle.js` is rebuilt. Native requirements: microphone
      usage string and the audio background mode on iOS; microphone and
      foreground-service permissions on Android.

### US-12 — Plans: Free, Pro, Max
*As a user, I want to use Stack'd for free, and pay a clear monthly price
when I want the AI steps; as the owner, I want the store to handle the
money and the proxy to handle the limits.*

- [x] AC-12.1 Four plans, the paid ones monthly and auto-renewing, bought
      through the App Store on iPhone and Google Play on Android (the
      stores require it for digital subscriptions and handle tax, refunds
      and cancellation):

      | Plan | Price | Monthly pool | What it covers |
      |---|---|---|---|
      | **Free** | €0 | no Transcribe, no Summarise | boards, notes, meetings, recording, playback, pasted and attached transcripts, speaker rename; no minutes and no action cards, since both come from Summarise |
      | **Plus** | €9.99 / month | 8 h of audio, 20 summaries | a 30-minute call most working days, a summary for one a day |
      | **Pro** | €19.99 / month | 16 h of audio, 50 summaries | two 30-minute calls every working day, a summary for each |
      | **Max** | €29.99 / month | 24 h of audio, 100 summaries | about an hour of meetings every working day, with room for a long one |

      Pools are per calendar month of the subscription (§07 Q12); the
      sizes live in the proxy config. §11 shows what each tier can cost at
      full use: every tier is profitable at every provider price in the
      range and with every model tier.
- [x] AC-12.2 **Where**: Settings gets a **Plan** section at the top of
      the Meetings & AI area showing the current plan, the renewal date,
      and the two counters as bars ("Audio 2 h 10 min of 8 h · Summaries
      14 of 20 · resets 12/11/2026"). Below it, for a Free user, the three
      paid plans as cards with price, pool and a **Subscribe** button;
      for a subscriber, the other plans as upgrade / downgrade cards, and
      **Manage subscription** (opens the store's management page) and
      **Restore purchases**.
- [ ] AC-12.3 *(built in Phase 18; store sandbox run in Phase 22)* **Buying** uses the platform's native purchase sheet. On
      success the plan is active immediately (the proxy sees the
      entitlement within one call); on cancel nothing changes; on failure
      the store's message is shown. The app never asks for card details.
- [ ] AC-12.4 *(built in Phase 18; store sandbox run in Phase 22)* **Restore purchases** reattaches the plan on a new device or
      after a reinstall through the store account; the subscriber id stays
      the same so the allowance follows the user.
- [x] AC-12.5 **Visibility of limits**: the Transcribe and Summarise
      buttons show the cost of the press next to them ("uses 13 min of 7 h
      50 min left", "1 of 16 summaries left") so nobody is surprised; a
      Free user sees the button with a small lock and the plan price
      instead.
- [x] AC-12.6 **Hitting the wall**: a Free user pressing an AI button
      gets a short sheet that explains what the step does and offers the
      two plans (one tap to the native purchase); a subscriber whose pool
      is used up gets "You've used this month's audio minutes. Resets
      12/11/2026." with an **Upgrade** option to the next tier. Neither
      is shown unprompted, and neither interrupts recording or any
      non-AI feature.
- [x] AC-12.7 **Lapsed plan**: when a subscription expires or is refunded
      the AI steps lock again; meetings, transcripts and minutes already
      made stay readable and editable forever.
- [x] AC-12.8 **Web**: the browser version shows the Plan section with the
      plans described and "Subscribe in the Stack'd app on iPhone or
      Android" instead of a button; AI buttons on the web are shown locked
      with the same note.
- [x] AC-12.9 Store compliance: the plan cards state the price, the period,
      that it renews until cancelled, and link to the terms and privacy
      pages; the restore control is present wherever purchases are offered
      (both stores require all of this for review).

---

## 04. Scope — MoSCoW

### Must have
US-01 (AC 1–5) · US-02 (AC 1–4, 6–7) · US-03 (AC 1–5) · US-04 (AC 1–9) ·
US-05 (AC 1–6) · US-06 (AC 1–3, 5–7) · US-07 (AC 1–3, 5) · US-08 (AC
1–7) · US-09 (AC 1–6) · US-10 (AC 1–4) · US-11 (AC 1–5) · US-12 (AC 1–9).

### Should have
AC-02.5 sort control · AC-06.4 edit transcript text · AC-07.4 edit minutes
· AC-08.8 "From meeting" line on the task · pasted-text speaker detection
beyond the three line shapes · a "Copy minutes" button that puts the
minutes on the clipboard as plain text.

### Could have
- **Share / export** the minutes and actions as a text file or via the
  system share sheet.
- **Add all** remaining actions to one board and lane in one go, through
  the picker then one confirm.
- **Record from a note**: a mic in the Notes composer that creates a
  meeting and links it.
- **On-device transcription** (iOS 26 SpeechAnalyzer) as a free, offline
  fallback without speaker labels, which would give the Free plan a
  transcript and make Pro about speakers and minutes.
- **Annual plans** at a discount, and a **7-day trial** of Pro.
- Global search across boards, notes and meetings.

### Won't have (this release)
Capturing other apps' audio, live transcription, languages other than
English, automatic speaker naming or voice recognition across meetings,
accounts and sign-in, web purchases, sync and sharing, calendar
integration, custom prompts or model choice, reminders on meetings, promo
codes, family sharing, lifetime purchases.

---

## 05. Technical Notes & Constraints

### Tech stack
App: unchanged (vanilla ES modules, CSS custom properties, service worker,
Capacitor). New app modules, to be confirmed by the architecture doc:
`src/ui/meetings.js` (list), `src/ui/meeting.js` (detail and its blocks),
`src/ui/recorder.js` (mic, level line, clock, cap), `src/media.js`
(recording storage, IndexedDB), `src/transcript.js` (pure: parse `.vtt` /
`.srt` / pasted shapes, merge segments, serialise for the model),
`src/ai.js` (proxy client: upload, poll, summarise, errors, quota),
`src/ui/actioncards.js` (cards, gestures, the add-to-board flow).

Proxy: a **Cloudflare Worker** (§07 Q10) with a small KV or D1 store for
the per-subscriber counters, and four endpoints: start transcription
(audio upload), poll transcription, summarise (transcript in, structured
JSON out), and allowance (current plan and counters for the Settings
bars). Providers: one speech-to-text service with speaker labelling for
English (the architect benchmarks two on three real recordings for
speaker accuracy and price, §09 O4), and Claude for the minutes, asked for
a strict JSON structure; the model tier is a cost decision (§11).

Purchases: **RevenueCat** through its Capacitor plugin
(`@revenuecat/purchases-capacitor`) rather than StoreKit and Play Billing
by hand. It gives one subscriber id across both stores, the native
purchase and restore flows, the "Manage subscription" link, and a REST
endpoint the proxy calls to check the entitlement, plus the webhooks for
renewals and refunds. Its free tier covers the first thousands of euros
of monthly revenue. The web build does not load the plugin and shows
AC-12.8. Products: three subscription products per store (`plus_monthly`,
`pro_monthly`, `max_monthly`) mapped to three entitlements (`plus`, `pro`,
`max`), in one subscription group so the stores handle upgrades and
downgrades with proration.

### Data (no migration needed)
`S.meetings` and `S.meetingsSort` are added by `withSettings()` with
defaults, so existing `stackd-v2` stores keep working. **Audio is never
in `S`**: the main document must stay well under localStorage limits. The
recording lives in IndexedDB (web and both shells) under a key the
meeting stores; the architect may choose the Capacitor Filesystem on the
shells if IndexedDB eviction proves a problem on device.

```js
// Meeting
{
  id, title: 'Meeting · 20/10/2026 14:03',
  createdAt, updatedAt,                     // ms
  recording: null | {
    key,                                    // IndexedDB key of the blob
    mimeType: 'audio/mp4' | 'audio/webm',
    durationMs, sizeBytes, recordedAt,
  },
  transcript: null | {
    source: 'recording' | 'pasted' | 'file', fileName: null | 'teams.vtt',
    segments: [ { id, speaker: 'S1', startMs: null | 12000, text } ],
    speakers: { S1: 'Speaker 1', S2: 'Marco' },   // label → display name
    createdAt, updatedAt,
  },
  minutes: null | {
    summary: '', decisions: [''], openQuestions: [''],
    generatedAt, staleSince: null | ms,     // transcript edited after generation
  },
  actions: [ {
    id, title, due: null | 'YYYY-MM-DD', priority: 'none' | priorityId,
    excerpt: '', status: 'proposed' | 'added' | 'dismissed',
    taskId: null | id,
  } ],
  jobs: { transcribe: null | { id, startedAt }, summarise: null | { id, startedAt } },
  lastError: null | { step: 'transcribe' | 'summarise', code, message, at },
  status: 'active' | 'archived' | 'deleted', archivedAt, deletedAt,
}
// Task addition
task.from = null | { meetingId, actionId }
// S.meetingsSort: 'created-desc' | 'created-asc' | 'title-asc'
// Settings: S.ai = { proxyUrl: null | 'https://…', disclosed: false, consented: false }
// Plan (cached from the purchase service and the proxy; the proxy is the truth):
// S.plan = { tier: 'free' | 'plus' | 'pro' | 'max', subscriberId, renewsAt: null | ms,
//            audioSecondsLeft, summariesLeft, audioSecondsTotal, summariesTotal, checkedAt }
```

### Constraints & dependencies
- **Recording** uses `MediaRecorder` with `timeslice` so chunks are
  written to IndexedDB as they arrive (AC-04.4). Safari and the iOS shell
  produce `audio/mp4`; Chrome and the Android shell produce `audio/webm`
  with Opus. The proxy and the provider must accept both. Bitrate target:
  48 kbps mono (30 min ≈ 11 MB).
- **Lock screen (AC-04.3)**: iOS needs `UIBackgroundModes: audio` and
  `NSMicrophoneUsageDescription` in the Info.plist that the CI workflow
  generates (`.github/workflows`, the `cap add ios` step); Android needs
  `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` and a foreground service
  while recording, which means a small Capacitor plugin or an existing
  community one. The architect verifies that `MediaRecorder` inside
  WKWebView keeps running under the background audio mode on a real
  device before Phase 17 is planned in detail; if it does not, the
  recorder on iOS becomes a native plugin and the web code stays for the
  browser.
- **Level line (AC-04.2)**: `AudioContext` + `AnalyserNode` on the same
  stream, drawn on a canvas at ≤ 30 fps, static under reduced motion.
- **Storage**: `navigator.storage.persist()` once (AC-04.6);
  `navigator.storage.estimate()` for AC-04.7; a `media.js` API of
  `put(key, chunks)`, `get(key)`, `remove(key)`, `size(key)`; purge hooks
  in `purgeDeleted()`, `emptyDeleted()` and delete-forever.
- **Upload (AC-05.1)**: `fetch` with a streamed or chunked body is not
  reliable on every platform; a single multipart POST with progress via
  `XMLHttpRequest` is acceptable. Transcription is asynchronous: the proxy
  returns a job id, the app polls (AC-05.2), and the job id is persisted
  on the meeting so polling resumes after a restart.
- **`.docx` (AC-06.6)**: a zip of XML; either a minimal zip reader
  (central directory + `DecompressionStream('deflate-raw')`) or a small
  bundled dependency. The architect decides; it must work from the bundle
  and in both shells.
- **Model output (AC-07.1, AC-08.1)**: the proxy asks for a strict schema
  (structured output), validates it, and returns it as-is; the app never
  parses free text. Due dates are resolved by the model relative to the
  meeting date, which the proxy passes in; priorities are chosen from the
  names the app passes (the user's Settings › Priorities), mapped back to
  ids in the app.
- **Reuse**: the Move / Copy sheet gains a title and an `onConfirm` that
  does not need a task; the task sheet gains an `initial` draft, a fixed
  board option and a custom primary label; the swipe code in `board.js`
  gains a right-swipe action so cards do not get a second gesture
  implementation.
- **Entitlement check**: the proxy asks RevenueCat for the subscriber
  (cached 5 minutes in KV), reads the active entitlement, and applies the
  pool for that tier; a RevenueCat webhook invalidates the cache on
  renewal, cancellation and refund. Counters are keyed by subscriber id and
  period, so a reinstall or a second device does not reset them.
- **Android shell** (§07 Q9): `npx cap add android` committed like iOS
  is generated, a `.github/workflows` job that builds a signed AAB with
  the upload key in repository secrets and uploads it to the Play internal
  testing track, the permissions of AC-11.5, and a Capacitor plugin for the
  foreground service while recording.
- Folders, search, labels and `purgeDeleted()` learn the third kind.
- New icons in `icons.js`; new files in `sw.js` SHELL; `VERSION` bumped to
  1.5.0 on release; `npm run check` and `npm run bundle` before commit;
  `check-text.mjs` or a new `check-transcript.mjs` covers the parsers.

---

## 06. Success Metrics

### Key metrics
- 100 % of Must criteria pass on a real iPhone, a real Android phone and
  Chrome at 1280 px, light and dark.
- A 30-minute recording is ≤ 15 MB, is still there after the app is
  killed and the phone restarted, and plays back with correct duration.
- Recording continues through a locked screen for 10 minutes on iPhone and
  on Android, with the OS indicator visible.
- A 30-minute recording is transcribed in under 5 minutes end to end on a
  normal mobile connection; a transcript is summarised in under 60 s.
- From Summarise to a task on a board: ≤ 4 taps per action (swipe, icon,
  board + lane, Save).
- Nothing leaves the device without a button press; a tester can read in
  Settings what is sent and where before pressing it.
- A 1.4.3 store opens in 1.5.0 with zero lost tasks or notes and an empty
  Meetings list.
- A sandbox purchase of Plus on iPhone and on Android unlocks the AI
  buttons within one press, Restore on a second device carries the plan
  and the used pool, a sandbox upgrade to Pro raises the pool, and a
  sandbox expiry locks the buttons again.
- With the provider chosen under the §11 conditions, a subscriber on any
  tier who uses their whole pool costs less in provider fees than the
  plan pays out after a 30 % store cut.
- No console errors; `npm run check` passes with the new parser checks;
  Lighthouse PWA "installable" still passes.

### Definition of done
Each phase in §10 ends with its AC checklist ticked and a commit; the last
phase bumps `VERSION`, rebuilds the bundle, updates `README.md` and pushes
`main`. QA follows `agents/qa_tester.md` against this document, on two
real phones, and appends to `docs/qa-report.md`.

---

## 07. Decisions taken (2026-10-20)

### Round 1

| # | Question | Decision |
|---|---|---|
| Q1 | Audience and who pays | **TestFlight now, public on iPhone, Android and web later.** So no "bring your own key" as the only path: the app talks to a **proxy** that holds the keys and enforces a per-device quota from day one; accounts and billing come with the public release. |
| Q2 | Where it lives | **A separate Meetings area**; Notes untouched. |
| Q3 | Speaker labels | **Must.** Transcription is a cloud service with speaker labelling; on-device transcription is a Could. |
| Q4 | Platforms | **iOS, Android and web.** Recording **must continue when the screen locks** on iOS and Android; the web gets the best the browser allows and says so. |
| Q5 | Transcript inputs | **Pasted text, `.txt`, `.vtt`, `.srt`, `.docx`.** |
| Q6 | Action fields | **No assignee.** The model suggests **due date and priority** only. |
| Q7 | Language | **English only** for transcription and minutes. |
| Q8 | Audio retention | **Keep the recording, offer to delete it** once the transcript exists, showing the space it frees. |

### Round 2

| # | Question | Decision |
|---|---|---|
| Q9 | Android shell | **Now**, inside 1.5.0: project, signed build in CI, Play internal testing, foreground-service recording. |
| Q10 | Proxy host | **Cloudflare Workers.** |
| Q11 | Testing allowance | **60 audio minutes and 10 summaries per day** for TestFlight testers, through an allow-list (AC-09.4). |
| Q12 | Plans | **Free** (no AI steps) plus paid plans bought in Settings. First proposed as Pro €4.99 and Max €19.99 with daily allowances; §11 showed daily pools of that size can cost more than the plan pays, so the plans moved to **monthly pools** (round 3, Q14). |
| Q13 | Transcript provider | **Benchmark two providers**, on speaker accuracy and price, and use the price in §11 before the pools are fixed. |

### Round 3

| # | Question | Decision |
|---|---|---|
| Q14 | Pool sizes and prices | **Four tiers**: Free · **Plus €9.99** · **Pro €19.99** · **Max €29.99**, monthly pools (AC-12.1). First sized 10 h / 30 h / 50 h with 50 / 150 / 250 summaries; §11 showed Pro and Max were only safe at full use with a provider under about $0.20–0.25 per hour. |
| Q15 | Summary model | **Benchmark the mid and small Claude tiers** on five real transcripts, rated blind on actions found, actions invented and summary accuracy; the small tier wins if it matches on four of five, else the mid tier. The top tier is excluded on cost (§11). |
| Q16 | Store cut | **Enrol in both small-business programmes** (15 %) as a Phase 14 checklist item; **all revenue maths uses 30 %** as the default so the plans stay profitable without it. |
| Q17 | Store accounts | **Owner opens Play Console and signs the App Store paid-apps agreement in Phase 14.** |

### Round 4

| # | Question | Decision |
|---|---|---|
| Q18 | Pool sizes, second pass | Plus 8 h + 25 summaries · Pro 16 h + 100 · Max 24 h + 200: profitable at every provider price with the small or mid model tier. VAT in the maths is **Portuguese (23 %)**. |

### Round 5

| # | Question | Decision |
|---|---|---|
| Q19 | Final pool sizes | **Plus 8 h + 20 summaries · Pro 16 h + 50 · Max 24 h + 100.** Profitable at full use at every provider price in the range and with every Claude tier, including the top one (§11). The provider price ceiling and the small model tier are targets that widen the margin, not conditions. |

---

## 08. Calls made without a question

Small choices the criteria needed; each follows from a decision above and
can be reversed by editing the AC it names.

- **Bottom nav pill stays at four items** (AC-01.2). A fifth item does not
  fit at 375 px with readable labels; Meetings sits in the Boards menu
  under Notes, and in the sidebar on desktop. Reversible if usage shows it
  deserves a slot.
- **No manual order** for meetings (AC-02.5): they are dated events,
  and date sorts cover the need.
- **One recording per meeting** (AC-04.9): keeps the detail a single
  linear flow; a second session is a new meeting.
- **Everything AI is on request** (AC-05.1, AC-07.1, AC-07.5): no step
  runs by itself after recording, so cost and data leaving the device are
  always a user action.
- **Minutes are plain text** (AC-07.4): no formatting toolbar; the summary
  is meant to be read, not styled.
- **Added cards stay visible, muted** (AC-08.6), so the list still tells
  the story of the meeting; removing them is explicit.
- **Twelve actions at most** (AC-08.2), following the common complaint that
  tools over-generate; the user can always add more by hand on a board.
- **Proxy in this repository** (AC-09.4): one place, one CI pattern,
  secrets in GitHub as for the iOS build; the worker's code is not secret.
- **Default title carries date and time** (AC-02.2) so untitled meetings
  stay distinguishable in the list.
- **RevenueCat rather than hand-written store code** (§05): two stores,
  restore, entitlement lookup from a server and refund webhooks are a
  known quantity there and weeks of work by hand. Reversible if its fees
  ever matter.
- **Allowances are counted by the proxy, not the app** (AC-09.3), because
  the app's copy can be edited and the proxy is what spends the money.
- **Free users can record and keep transcripts** (AC-12.1): the paywall
  is on the AI steps only, so the Free app stays a complete recorder and
  the upgrade is about speakers, minutes and actions.
- **Web is Free-only in 1.5.0** (AC-12.8), because linking a web payment
  to a phone needs accounts.

---

## 09. Open questions and risks

O1 to O8 were answered in rounds 2 to 5 (§07 Q9–Q19). **No open
questions remain for the architecture to start.** The Phase 20 provider
benchmark aims for $0.20 per audio hour or less to widen the margin, but
every tier is profitable up to $0.45 (§11), so the choice can follow
speaker accuracy first.

Owner checklist (Phase 14, outside the code):
- Google Play Console account and the Play internal testing track.
- App Store paid-apps agreement, banking and tax forms.
- Enrolment in the App Store Small Business Program and the Play 15 %
  service-fee tier (Q16).
- RevenueCat project, the three products in each store, one subscription
  group.
- A privacy page and a terms page on the GitHub Pages site (AC-12.9).

Risks:

- **Background recording inside the web view.** The biggest unknown. If
  `MediaRecorder` in WKWebView stops when the app is backgrounded even
  with the audio background mode, the iOS recorder becomes a native
  plugin. Mitigation: the architect spikes it on a device before Phase 17
  is detailed (one TestFlight build with a throwaway recorder).
- **Storage eviction.** Browsers may evict IndexedDB under pressure unless
  persistence is granted; the shells are safer. Mitigation: AC-04.6
  persistence request, AC-04.7 warnings, and the shells' native storage as
  a fallback.
- **Upload size on mobile networks.** 11 MB uploads fail on flaky
  connections. Mitigation: progress, cancel, retry, and the job id model so
  nothing is lost; chunked upload is a later improvement.
- **Cost exposure** is bounded by the monthly pools per subscriber, and a
  Free user costs nothing because the proxy refuses before calling a
  provider. The remaining exposure is a subscriber who uses the whole
  pool every month at the dearest provider price; §11 sizes the pools so
  even that user is not a loss.
- **Store review** of subscriptions is strict (restore control, renewal
  text, terms and privacy links, no mention of other platforms' prices).
  Mitigation: AC-12.9, and a privacy page on the GitHub Pages site.
- **Speaker accuracy** on a phone on a table in a meeting room is lower
  than on a headset. Mitigation: rename is one tap, and the minutes are
  labelled as AI output.

---

## 10. Delivery plan (phases, for the architecture doc to refine)

Order follows value and risk: the text path first (no infrastructure,
proves the actions-to-board flow), the proxy and the plans next so testers
see the whole product shape early, audio last because it is the hardest
and the only part needing devices. The Android shell goes first because
every later phase must be verified on it too. Phase numbers continue from
the Notes release (Phase 13 was the 1.4.0 QA).

| Phase | What | Size | Stories |
|---|---|---|---|
| **14** | **Android shell and store accounts**: `cap add android`, signed AAB in a manual GitHub Actions workflow, Play internal testing track; the owner checklist of §09 (store accounts, small-business enrolment, RevenueCat project with the three products in one group, privacy and terms pages) | M | AC-11.5, prerequisite of US-12 |
| **15** | **Meetings area, text path**: `S.meetings`, menu / sidebar entries, list, search, sort, detail shell with the Source block, paste sheet, `.txt` / `.vtt` / `.srt` parsing, folders' third kind, archive / delete / restore, `check-transcript.mjs` | L | US-01, US-02, US-03, US-06 (5–6), US-10 |
| **16** | **Proxy and minutes**: `proxy/` worker with summarise and allowance endpoints, structured output, subscriber id, counters in KV, tester allow-list, deploy workflow; summary-model benchmark (Q15). App: `ai.js`, Summarise button, job persistence and resume, error and offline states, disclosure dialog, Minutes block, Settings › Meetings & AI | L | US-07, US-09 (1–3, 5–6), US-11 (1–2), US-05 (4–6 for the summarise half) |
| **17** | **Action cards**: cards, inline title edit, swipe left delete with Undo, swipe right to board (picker → prefilled task sheet → Save), added state, counts, `task.from` and the "From meeting" line | M | US-08 |
| **18** | **Plans and purchases**: RevenueCat plugin, Plan section with counters, plan cards, native purchase, restore, manage link, locked buttons with cost hints, paywall and "allowance used" sheets, lapsed handling, web variant; proxy entitlement check and webhook; sandbox tests on both stores | L | US-12, AC-09.2, AC-09.4 |
| **19** | **Recording**: device spike for background recording first (risk 1), then consent and permission flow, mic / stop, level line, clock, 30-minute cap, chunked save to IndexedDB, persistence and space checks, playback with scrubber, delete recording with size, replace with confirm; iOS background mode and Android foreground service | L | US-04 |
| **20** | **Transcription**: provider benchmark (Q13) on speaker accuracy first and price second, pricing into §11; upload with progress, proxy transcribe + poll endpoints, audio-minute charging, segments with times, speaker rename, tap to seek, edit text, stale chip | M | US-05, US-06 (1–4, 7), AC-07.5, AC-09.3 |
| **21** | `.docx` import, the Should items (Copy minutes, pasted-text shapes), polish and accessibility pass (AC-11.3–11.4) | S | AC-06.6, Should list |
| **22** | **Release**: iOS Info.plist entries in the CI workflow, TestFlight and Play internal builds, QA on two phones including sandbox purchases, privacy and terms pages, `VERSION` 1.5.0, bundle, README, push | M | AC-04.3, AC-11.5, AC-12.9 |

Each phase is a vertical slice that ships to `main` on its own: after
Phase 15 a tester can paste a Teams transcript and keep it; after 17 they
can turn it into tasks; after 18 they can buy Plus in the sandbox; after
20 they can record and transcribe.

---

## 11. Unit economics of the plans

Provider prices are the ranges found on 2026-10-20 and must be replaced
by the benchmark's real numbers (Q13, O6) before the allowances are
fixed. Speech-to-text with speaker labels: **$0.15 to $0.45 per audio
hour** across the main providers. Minutes for one 30-minute meeting
(about 9 000 input tokens, 1 500 output): **≈ $0.07** on the top Claude
tier, **≈ $0.03** on the mid tier, **< $0.01** on the small tier.

What a plan pays out: price minus VAT (**23 % in Portugal**, remitted by
the store) minus the store's cut. **The default for every calculation is
the full 30 % cut** (Q16); the small-business programmes would raise each
net figure by about a fifth. €1 is taken as $1.10.

| Plan | Price | Ex VAT | Net to Stack'd per month | Net per audio hour in the pool |
|---|---|---|---|---|
| Plus | €9.99 | €8.12 | ≈ €5.69 ($6.25) | $0.78 |
| Pro | €19.99 | €16.25 | ≈ €11.38 ($12.5) | $0.78 |
| Max | €29.99 | €24.38 | ≈ €17.07 ($18.8) | $0.78 |

**Why the daily caps first proposed were dropped** (round 2): Pro at
60 min + 5 summaries a day is 30 h and 150 summaries a month for €4.99,
which costs $5 to $24 in provider fees at full use against about $3.10
net; Max at 480 min a day is 240 h for €19.99, $37 to $129 against about
$12.50. A cap that one heavy user can turn into a loss is not a cap.
Monthly pools, priced so that full use is still profitable, replace them.

**The round-3 sizes (10 h / 30 h / 50 h, 50 / 150 / 250 summaries)**
sold audio hours cheaper at each step up ($0.63, $0.42 and $0.38 net per
hour) while the provider charges the same per hour, so Pro and Max were
only profitable at full use with a provider under about $0.20–0.25 per
hour. Rounds 4 and 5 resized the pools so that every tier nets the same
$0.78 per audio hour and the summary counts stay well inside the margin.

**The final tiers at full use of the pool** (the worst case; typical use
is a fraction of it):

| Plan | Pool | Audio cost ($0.15 to $0.45 / h) | Minutes cost (small to mid tier) | Total | Net | Margin at the dearest provider, mid tier |
|---|---|---|---|---|---|---|
| Plus | 8 h, 20 | $1.2 to $3.6 | $0.1 to $0.6 | **$1.3 to $4.2** | $6.25 | **+ $2.05** |
| Pro | 16 h, 50 | $2.4 to $7.2 | $0.3 to $1.5 | **$2.7 to $8.7** | $12.5 | **+ $3.80** |
| Max | 24 h, 100 | $3.6 to $10.8 | $0.5 to $3.0 | **$4.1 to $13.8** | $18.8 | **+ $5.00** |

**Every tier is profitable at every provider price in the range and with
every Claude tier**, even for a subscriber who uses the whole pool every
month. With the top tier at about $0.07 per summary, the worst cases are
$5.00 on Plus, $10.70 on Pro and $17.80 on Max, all under net; Max is the
closest, which is one more reason to keep minutes on the small or mid
tier (Q15).

Two levers widen the margin further and are **targets** for the
benchmarks rather than conditions: a provider at or below $0.20 per hour
(Q13; Phase 20), which brings worst-case Pro to about $5 and Max to about
$8; and the small Claude tier for minutes, which saves about $1.25 a
month on a Pro subscriber who uses all 50 summaries. The daily numbers
from Q12 can still exist as a **burst limit** on top of the pools (for
example no more than 2 hours a day on Pro) to smooth provider spend, but
they are not what protects the margin.

A typical subscriber: a Plus user with three 30-minute meetings a week and
a summary for each costs about $1 to $2.5 a month against $6.25 net; a
Pro user with two 30-minute meetings every working day and a summary for
each costs about $3 to $8 against $12.5.

Fixed costs at this scale are near zero: Cloudflare Workers and KV free
tiers, RevenueCat free under its revenue threshold, GitHub Actions free on
a public repository, the Play Console's one-off fee and the Apple
Developer Program already paid.
