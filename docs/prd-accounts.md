# Product Requirements Document (PRD): Stack'd Minimalist — Accounts and Sync

Scope of this PRD: an **optional account** that lets one person use
Stack'd on a phone and a PC with the same boards, notes and meetings;
sign-in by **email code plus a 4-digit PIN**, with the device's
biometrics in place of the PIN; the plan following the account; and the
legal and security work that holding people's data on a server requires.
Using the app without an account stays exactly as shipped in 1.5.0.

Status: **phases 24 to 28 built, 2026-11-16** (server, sign-in UI, sync,
plan on the account, app lock) and run locally end to end; not deployed,
waiting on the owner tasks of §09, and the shells wait on the
secure-storage and biometric plugins (architecture §45). Phases 29 and 30
(legal surface, QA, release) are not started. Decisions taken
are in §07; calls the analyst made alone are in §08; open questions are
in §09. Companion documents: `docs/plan-accounts.md` (the design this PRD
was written from), `docs/architecture.md` Part IV (§28 onwards, which
also lists the points it refined here), `docs/prd-meetings.md`. Target
release: **1.6.0**.

Not legal advice. US-11 is an engineering checklist; a lawyer reads the
new Terms and Privacy Policy before the release (§06).

---

## 00. Vocabulary

| Term | Meaning | Today in code / UI |
|---|---|---|
| **Account** | An email address the user proved they own, with a PIN, on our server. Optional | does not exist |
| **Signed out** | Using the app with no account: everything on the device, as in 1.5.0 | the only mode |
| **Email code** | A 6-digit number sent to the email, valid 10 minutes, used to prove ownership | does not exist |
| **PIN** | Four digits chosen by the user, the same on every device of the account | does not exist |
| **New device** | A phone or browser the account has not signed in on yet | — |
| **Session** | The proof, kept on a device, that it is signed in | does not exist |
| **App lock** | The screen that asks for the PIN or biometrics when a signed-in app is opened | does not exist |
| **Biometrics** | Face ID, Touch ID, Android fingerprint or face, Windows Hello: whatever the device offers. The operating system answers yes or no; Stack'd never sees a face or a fingerprint | does not exist |
| **Sync** | Copying changes between the device and the account, both ways | does not exist |
| **Record** | One board, task, note or meeting, or the shared settings: the unit that syncs | `S.lists`, `S.tasks`, `S.notes`, `S.meetings` |
| **Conflict** | The same record changed on two devices before they synced | — |
| **Merge** | What happens the first time a device with data signs in to an account with data | — |
| **Subscriber id** | The random per-device id the proxy uses today for the plan | `S.plan.subscriberId` |
| **Account email** | A message the account needs to work: code, new device, PIN changed, account deleted. Never marketing | does not exist |
| **Release** | Any change of `VERSION` in `sw.js`, whether it reaches the web, TestFlight or Google Play | README, "Every later release" |
| **Security review** | A run of `/security-review` over everything changed since the previous release | does not exist |

---

## 01. Problem Statement

### The core problem
Stack'd keeps everything on one device. A task typed on the phone does not
exist on the PC, a meeting summarised at the desk cannot be read on the
train, and a lost or replaced phone takes every board with it. People who
use both a phone and a PC have to choose one, or keep two separate copies.

### Why now
- 1.5.0 added paid plans. A plan bought on the phone does not work in the
  browser, because the browser is a different anonymous device.
  `prd-meetings.md` deferred this to "accounts, in a later release".
- The plan is identified by an unauthenticated id in a request header.
  Anyone who learns an id can spend that subscriber's allowance.
- The public release is ahead. Registration is the point where consumer
  and privacy law starts to apply to the app, so the rules have to be
  built in with it, not after it.

### Current workarounds
Using only one device; retyping; emailing notes to oneself; no backup at
all beyond the phone's own.

---

## 02. Goals & Non-Goals

### Goals — users can
- Keep using Stack'd with no account, with nothing changed and nothing
  sent anywhere.
- Create an account in under a minute: confirm they are an adult, type an
  email, enter the code from the email, choose a PIN.
- Sign in on a second device with the email, a new code and the PIN, and
  find their boards, notes and meetings there.
- Edit on any device, online or offline, and see the change on the others
  without pressing anything.
- Open the app on a signed-in device with the PIN, or with Face ID, Touch
  ID or the device's equivalent.
- Use a plan bought on the phone in the browser on the PC.
- See which devices are signed in, sign one out, or sign out everywhere.
- Download everything the account holds, and delete the account and all
  of it, from inside the app.
- Read, before registering, exactly what is stored and where.

### Goals — the owner can
- Launch registration without the six exposures named in §11 and with the
  obligations of a data controller covered.
- Release knowing that every change since the last release went through a
  security review.

### Non-Goals — this release does not include
- **Syncing recordings.** Audio stays on the device that recorded it; the
  meeting, its transcript, minutes and actions sync.
- **Sign in with Apple or Google buttons**, or passwords.
- Sharing a board, a note or a meeting with another person; teams.
- End-to-end encryption of synced content.
- Marketing email, newsletters, product announcements by email.
- Live sync over an open connection; changes arrive when the app starts,
  regains focus or finishes an edit.
- Buying a plan in the browser. The browser *uses* a plan bought on a
  phone; it still cannot sell one.
- Analytics, session replay or crash reporting services.
- Users under 18.
- Changing the account's email address (a Could, §04).

---

## 03. User Stories with Acceptance Criteria

Every criterion must hold on mobile (≤ 899 px) and desktop (≥ 900 px), in
light and dark mode, and survive a reload. Touch targets are ≥ 44 × 44 px;
everything is keyboard operable; text contrast ≥ 4.5 : 1. "Device" means a
real iPhone and a real Android phone. "PC" means the web app in a desktop
browser.

### US-01 — Stack'd without an account
*As a user who does not want an account, I want the app to work as it does
today.*

- [ ] AC-01.1 A fresh install opens on the boards with no sign-in screen.
      No feature that works in 1.5.0 asks for an account.
- [ ] AC-01.2 A signed-out device sends nothing to the server except the
      two Meetings buttons, as in 1.5.0; no request is made at start-up
      for account or sync purposes.
- [ ] AC-01.3 The only entry points to an account are **Settings ›
      Account** ("Sign in to sync across your devices") and one dismissible
      line in the Plan section on the web ("Have a plan on your phone?
      Sign in"). No pop-ups, no badges, no reminders.
- [ ] AC-01.4 A 1.5.0 store opens in 1.6.0 with every task, note and
      meeting intact and signed out.

### US-02 — Register
*As a new user, I want to create an account quickly and know what I am
agreeing to.*

- [ ] AC-02.1 Registration is four steps in one sheet, with a visible
      step count and Back on each: **Age**, **Email**, **Code**, **PIN**.
- [ ] AC-02.2 **Age.** The question is "What year were you born?" with a
      year picker, no default year. It is not a tick box and does not
      mention the age required before the answer.
- [ ] AC-02.3 A year that makes the user younger than 18 on 1 January of
      the current year ends the flow with "Accounts are for adults. You
      can keep using Stack'd on this device without one." The device
      refuses the Age step for the next 24 hours, so changing the year
      does not work. Nothing is sent to the server.
- [ ] AC-02.4 The server stores only that 18+ was confirmed and when;
      the year is never stored or sent.
- [ ] AC-02.5 **Email.** One field, validated for shape. Under it, the
      sentence "By continuing you accept the Terms and the Privacy
      Policy", each linked and opening without losing the form. There are
      no pre-ticked boxes and no marketing option.
- [ ] AC-02.6 **Code.** Six digits, one field that accepts paste and the
      keyboard's one-time-code suggestion. The code is valid for 10
      minutes and 5 attempts; "Send a new code" is available after 60
      seconds. A wrong, expired or used code says which it is.
- [ ] AC-02.7 The server's answer to the Email step is identical whether
      or not the email already has an account, in content and in timing
      as far as the app can observe. The difference shows only after a
      correct code: a new email goes to "Choose a PIN", a known one to
      "Enter your PIN".
- [ ] AC-02.8 The version of the Terms and of the Privacy Policy that was
      accepted, and the time, are recorded with the account. When either
      changes, the next sign-in shows what changed and asks again.
- [ ] AC-02.9 Requests for codes are limited per email (5 an hour) and per
      network address; the limit shows as "Too many attempts, try again
      in n minutes".

### US-03 — The PIN
*As an account holder, I want one short code that works on all my devices
and cannot be guessed by trying.*

- [ ] AC-03.1 A new account chooses a PIN of exactly four digits, entered
      twice. Four identical digits and straight runs (1234, 4321) are
      refused with a reason.
- [ ] AC-03.2 The PIN is the same on the phone and the PC; setting it once
      is enough.
- [ ] AC-03.3 The PIN alone never signs anyone in. On a new device it is
      asked only after a correct email code.
- [ ] AC-03.4 Five wrong PINs in a row lock the PIN for the account on
      every device. The screen says so and offers "Reset with an email
      code". The count survives closing the app and switching device.
- [ ] AC-03.5 **Reset**: email code, then a new PIN. A reset signs out
      every other device and sends an account email (US-09).
- [ ] AC-03.6 **Change** (Settings › Account): current PIN, then the new
      one twice. Other devices ask for the new PIN at their next unlock.
- [ ] AC-03.7 The server keeps no readable PIN. What it stores cannot be
      turned back into the PIN by someone who obtains the database alone.
- [ ] AC-03.8 The Settings text and the Privacy Policy describe the PIN as
      a lock on the app. Neither says or implies that it encrypts data.

### US-04 — A second device, and the list of devices
*As an account holder, I want to add my PC or a new phone and stay in
control of where I am signed in.*

- [ ] AC-04.1 Signing in on a new device: email, code, PIN. No age step
      and no acceptance step unless a document changed (AC-02.8).
- [ ] AC-04.2 A device stays signed in until the user signs out, the
      session is revoked, or it has not been used for 90 days.
- [ ] AC-04.3 **Settings › Account** shows the email, the sync status
      (US-05), and **Devices**: one row per signed-in device with its kind
      (iPhone, Android, browser on Windows / macOS / other), the date it
      signed in, when it was last active, and "This device" on the
      current one.
- [ ] AC-04.4 Each other device has **Sign out**; below the list is
      **Sign out everywhere**. Either takes effect on the affected device
      at its next contact with the server, at most one focus later.
- [ ] AC-04.5 A sign-in on a new device sends an account email naming the
      kind of device and the time (US-09).
- [ ] AC-04.6 On the PC the session is not readable by page scripts. On
      the phones it is kept in the system's protected storage.

### US-05 — Sync
*As a user with two devices, I want what I do on one to be on the other
without thinking about it.*

- [ ] AC-05.1 These sync: boards with their lanes; tasks with every field
      including subtasks, schedule, tags and their link to a meeting;
      notes with body, checklist, colour and tags; meetings with title,
      transcript, speaker names, minutes and actions; priority levels;
      labels; the date format. Archived and deleted items sync with their
      status and their 30-day countdown.
- [ ] AC-05.2 These never leave the device: recordings and their size and
      duration, open Transcribe / Summarise jobs, the note draft, the
      theme, the current board, List ∕ Kanban, the sort orders, the "do
      not show again" notices, the proxy override.
- [ ] AC-05.3 A meeting recorded on the phone shows on the PC with its
      transcript and minutes and, where the audio would be, the line
      "Recording is on the device that made it". Playback, "tap a line to
      hear it" and Transcribe are offered only where the audio is.
- [ ] AC-05.4 Sync runs when the app starts, when it regains focus or
      returns to the foreground, when the network comes back, and within
      5 seconds after an edit. Nothing has to be pressed. **Sync now** in
      Settings › Account does it on demand.
- [ ] AC-05.5 Every edit works offline and is kept on the device. Offline
      edits made on two devices are both delivered when each reconnects.
- [ ] AC-05.6 **Conflict rule:** when the same record was changed on two
      devices, the later change wins for that record as a whole; other
      records are unaffected. A device whose clock is wrong cannot win
      every conflict.
- [ ] AC-05.7 A record deleted forever on one device disappears from the
      others. A record changed on one device after it was deleted forever
      on another stays deleted.
- [ ] AC-05.8 Status is visible without opening Settings: no indicator
      when synced; a small dot on the Settings entry while changes wait;
      the Account section says "Synced just now", "Syncing…", "Offline,
      n changes will sync" or "Sync paused" with the reason and a retry.
- [ ] AC-05.9 A reminder fires on each signed-in device that has
      notifications allowed; completing the task on one device stops the
      reminder on the others at their next sync.
- [ ] AC-05.10 An account can only ever read or write its own records. A
      request for another account's data is refused whatever ids it
      carries.
- [ ] AC-05.11 Sync of 500 tasks, 500 notes and 50 meetings completes in
      under 10 seconds on a first sign-in and in under 2 seconds when
      nothing changed.

### US-06 — First sign-in with data already on the device, and signing out
*As a user who used Stack'd before creating an account, I want to keep
what I have.*

- [ ] AC-06.1 The sample boards and tasks a fresh install shows are not
      uploaded when the user never changed them, so a second device does
      not double them.
- [ ] AC-06.2 Device has data, account is empty: the data is uploaded
      without a question.
- [ ] AC-06.3 Device is empty or untouched, account has data: the
      account's data is downloaded without a question.
- [ ] AC-06.4 Both have data: one dialog with two choices, **Merge**
      (default: "Keep everything from this device and from your account")
      and **Use my account** ("Replace what is on this device"), each with
      counts of boards, tasks, notes and meetings on both sides.
- [ ] AC-06.5 Before either choice is applied, a copy of the device's
      data is kept on the device for 30 days. Settings › Account shows
      "Restore this device's data from before sign-in" while it exists.
- [ ] AC-06.6 **Sign out** asks: "Keep a copy on this device" or "Remove
      from this device". In the browser the second is the default; on the
      phones the first. Unsynced changes are sent first, or the dialog
      says how many would be lost.
- [ ] AC-06.7 After "Keep a copy", the device is signed out and works as
      a signed-out device with that data. Signing in again later follows
      AC-06.2 to AC-06.4.
- [ ] AC-06.8 "Keep a copy" never removes a recording. "Remove from this
      device" removes the meetings and therefore their recordings: the
      dialog counts the recordings that exist only on this device and
      asks a second time before deleting them.

### US-07 — App lock: PIN and biometrics
*As an account holder, I want to open the app quickly without typing, and
I do not want someone who picks up my phone to read my meetings.*

- [ ] AC-07.1 A signed-in app opens on a lock screen with a four-dot PIN
      pad and, where the device has biometrics, the system prompt shown
      at once. A correct PIN or a successful biometric check opens the
      app where the user left it.
- [ ] AC-07.2 The lock returns after the app has been in the background
      or the tab hidden for 5 minutes. Settings › Account › **App lock**:
      "Immediately", "After 5 minutes" (default), "After 1 hour", "Off".
      Turning it off, or changing it, asks for the PIN.
- [ ] AC-07.3 Unlock works with no network, by PIN and by biometrics.
- [ ] AC-07.4 **Biometrics** is a switch in the same section, shown only
      where the device supports it and off until the user turns it on
      (which asks for the PIN once). iPhone: Face ID or Touch ID. Android:
      fingerprint or face through the system prompt. The PIN pad is always
      available as the fallback.
- [ ] AC-07.5 Wrong PINs at the lock screen count towards the same five
      as AC-03.4 when the device is online; offline, five wrong attempts
      impose a wait that doubles each time, starting at 30 seconds.
- [ ] AC-07.6 Reminders still fire while the app is locked; their text
      shows the task title as today.
- [ ] AC-07.7 Signed-out devices have no lock (there is no PIN to check).
- [ ] AC-07.8 The lock screen is announced to screen readers as "Stack'd
      is locked", each digit key is labelled, and the dots announce how
      many digits are entered, not which.

### US-08 — The plan follows the account
*As a subscriber, I want the plan I pay for on every device I sign in on.*

- [ ] AC-08.1 After sign-in, the plan and the monthly allowance belong to
      the account. A plan bought on the phone unlocks Transcribe and
      Summarise in the browser on the PC, with one shared allowance.
- [ ] AC-08.2 A plan bought before the account existed moves to the
      account at sign-in on the device that bought it, with what was
      already used this month. Nothing is bought twice and nothing resets.
- [ ] AC-08.3 On a signed-in device the proxy takes the identity from the
      session. An id typed into a request header cannot spend an
      account's allowance.
- [ ] AC-08.4 Signed-out devices keep the 1.5.0 behaviour: the anonymous
      id, the store's Restore purchases, the same allowance rules.
- [ ] AC-08.5 The browser still offers no purchase. Its Plan section shows
      the plan and the bars when the account has one, and "Subscribe in
      the Stack'd app on iPhone or Android, then sign in here" otherwise.
- [ ] AC-08.6 The owner can make an account a tester by its email, and
      the old allow-list of device ids keeps working for signed-out
      devices. No tester's email is written in the public repository.
      Settings shows the account email where it showed the subscriber id,
      and keeps the id for signed-out devices.
- [ ] AC-08.7 Signing out returns the device to its anonymous id and, if
      the store account still owns the purchase, Restore purchases brings
      the plan back there as in 1.5.0.

### US-09 — Account emails
*As an account holder, I want to hear from Stack'd only when my account
needs it.*

- [ ] AC-09.1 Exactly five messages exist: the sign-in code; "New sign-in
      to your account"; "Your PIN was changed"; "Your PIN was reset and
      other devices were signed out"; "Your account was deleted". There is
      no welcome message and no newsletter.
- [ ] AC-09.2 Each is plain, short, in English, sent from an address at
      `stackdplatform.com`, and ends with the owner's legal name and
      contact address and the line "You receive this because of activity
      on your Stack'd account."
- [ ] AC-09.3 The code message contains the code, how long it is valid,
      and "If you did not ask for this, ignore this message." It contains
      no link that signs anyone in.
- [ ] AC-09.4 The sending domain passes SPF, DKIM and DMARC; a code sent
      to Gmail, Outlook and iCloud arrives in the inbox within 30 seconds.
- [ ] AC-09.5 No email address is used for anything other than these
      messages. Adding marketing email later requires a new PRD with a
      separate, unticked opt-in, an unsubscribe link in every message and
      a postal address.

### US-10 — My data: export and delete
*As an account holder, I want a copy of what you hold and a way to remove
all of it.*

- [ ] AC-10.1 **Settings › Account › Export my data** downloads one JSON
      file with the account's email, its creation date, the accepted
      document versions, the device list and every synced record.
- [ ] AC-10.2 **Settings › Account › Delete account** explains what is
      removed (the account and everything synced to it, on the server and
      for every device), what is not (data kept on this device if the
      user chooses, recordings), and that a store subscription must be
      cancelled in the App Store or Google Play separately, with the link
      to do it.
- [ ] AC-10.3 Deleting asks for the PIN, or an email code if the PIN is
      locked, then for a typed confirmation. It offers "Keep a copy on
      this device" first.
- [ ] AC-10.4 After deletion nothing of the account remains on the server:
      records, sessions, the PIN data, the consent record and the email.
      The purchase service is told to forget the subscriber. A final
      account email confirms it. The same email can register again later
      as a new, empty account.
- [ ] AC-10.5 A public page, `account-deletion.html`, explains the same
      steps and gives the contact address for someone who cannot open the
      app. Its URL is the one given to Google Play.
- [ ] AC-10.6 Every other signed-in device signs itself out at its next
      contact with the server and keeps or removes local data as that
      device's own sign-out default says (AC-06.6).

### US-11 — Trust and the legal surface
*As the owner, I want registration to launch without the exposures listed
in §11, and as a user I want what the app says about my data to be true.*

- [ ] AC-11.1 `privacy.html` is rewritten and dated: who is responsible
      and how to reach them; what is stored for an account (email, synced
      content, device list, accepted versions, 18+ confirmation time);
      why; that it is stored in the EU; how long (AC-11.3); which
      companies process it and for what; transfers outside the EU; the
      user's rights and how to use them in the app; the right to complain
      to a data protection authority; that signed-out use stores nothing
      on the server. The sentences "It has no accounts" and "There is no
      sync and no backup" are gone.
- [ ] AC-11.2 The Meetings paragraph still says that Transcribe and
      Summarise keep nothing on the server, and now also says that a
      signed-in user's transcripts and minutes are stored by sync.
      `terms.html` says the user is responsible for having the right to
      store what other people said, that accounts are for people aged 18
      or over, and gives a contact for copyright complaints.
- [ ] AC-11.3 Retention as stated and as built: codes 10 minutes; a
      session unused for 90 days is removed; a record deleted forever
      leaves a marker for 90 days so other devices learn of it, then
      nothing; a deleted account is removed at once.
- [ ] AC-11.4 The in-app disclosure (Settings › Meetings & AI) and the
      Account section link to the same policy and agree with it.
- [ ] AC-11.5 **Renewal terms next to the button.** Every plan card, in
      Settings and in the "This needs a plan" sheet, shows directly above
      its Subscribe button: the price per month, "renews automatically
      every month", and "cancel any time in App Store / Google Play
      settings". The paragraph below the cards may stay; it no longer
      carries this alone.
- [ ] AC-11.6 **No third-party requests.** Loading and using the app
      contacts only the app's own domain and the proxy. `npm run check`
      fails when an HTML, CSS or JS file under the shell references any
      other origin (fonts, scripts, images, analytics). A
      Content-Security-Policy on the web app enforces the same list.
- [ ] AC-11.7 Server logs contain no email address, PIN, code, network
      address or user content.
- [ ] AC-11.8 The App Store privacy labels and the Google Play Data
      safety form state: email address and user content, linked to the
      user, used for app functionality, not used for tracking; data is
      encrypted in transit; deletion can be requested (AC-10.5).
- [ ] AC-11.9 A processing agreement is in place with each company named
      in AC-11.1 before the release (owner task, recorded in §09).

### US-12 — A domain of its own for the web app
*As an account holder on a PC, I want my session where no other website's
page can reach it.*

- [ ] AC-12.1 The web app is served from `app.stackdplatform.com`. The
      Terms, the Privacy Policy and the deletion page are under it, and
      the links in the app and in the store listings point there.
- [ ] AC-12.2 The old `github.io` address keeps working for one release,
      signed-out only, with a banner: "Stack'd has moved to
      app.stackdplatform.com" and **Download my data** (a file the new
      address can import from Settings). It offers no sign-in.
- [ ] AC-12.3 The installed PWA at the old address shows the same banner;
      installing from the new address works and Lighthouse "installable"
      still passes.
- [ ] AC-12.4 The phone apps are unaffected by the move.

### US-13 — Security review before every release
*As the owner, I want no release to go out with changes nobody checked for
security problems.*

- [ ] AC-13.1 Before every release (§00: any change of `VERSION`),
      `/security-review` is run over everything changed since the previous
      release, the proxy included.
- [ ] AC-13.2 A finding rated high is fixed before the release. Any other
      finding is fixed, or listed with the reason it was accepted.
- [ ] AC-13.3 `docs/qa-report.md` gets a **Security review** entry per
      release: date, the range of commits reviewed, findings and what was
      done with each. A release without this entry is not complete.
- [ ] AC-13.4 The rule is written where releases are described (README,
      `.agents/vibe-coding-workflow.md`) so it holds for releases after
      1.6.0, whatever they contain.
- [ ] AC-13.5 For 1.6.0 the review explicitly covers: the sign-in
      endpoints and their rate limits; how the code, the PIN and the
      session are stored; that one account cannot reach another's records
      (AC-05.10); the cookie and cross-origin rules; secrets absent from
      the repository and the client; logs (AC-11.7); the merge and import
      paths as inputs from outside.
- [ ] AC-13.6 1.6.0 is built on a release branch and merged to `main` at
      release, so that the review sees the release as one set of pending
      changes and unfinished phases never reach the live web app.

### US-14 — Platform parity and accessibility
- [ ] AC-14.1 Registration, sign-in, the lock, sync, export and deletion
      work in the PWA, in the iOS shell and in the Android shell. From
      `file://` the Account section says an account needs http(s), as the
      AI steps do.
- [ ] AC-14.2 The code and PIN fields use the numeric keyboard, accept
      paste, never trigger password managers' "save password" for the
      PIN, and move focus forward on completion.
- [ ] AC-14.3 Every error in the flows is text next to the field, is
      announced to screen readers, and does not rely on colour.
- [ ] AC-14.4 New files are in the service-worker shell list;
      `check-shell.mjs` passes; `app.bundle.js` is rebuilt. Native
      requirements: the Face ID usage string on iOS; the biometric
      permission on Android.

---

## 04. Scope — MoSCoW

### Must have
US-01, US-02, US-03, US-04, US-05, US-06, US-08, US-09, US-10, US-11,
US-12, US-13, US-14. From US-07: the PIN lock (AC-07.1 to 07.3, 07.5 to
07.8) and biometrics on iPhone and Android (AC-07.4).

### Should have
- Windows Hello and Touch ID in the browser on the PC as a biometric
  unlock.
- A per-account switch "Do not sync meetings", for users who want
  transcripts to stay on one device.
- `npm audit` on the app and the proxy as part of the release gate.
- A one-page breach runbook and a one-table record of processing in
  `docs/`.

### Could have
- Changing the account's email address (new email code plus PIN).
- A "last synced from" line on each record's detail.
- Import of the export file into a signed-out device.

### Won't have (this release)
Everything in §02 Non-Goals.

---

## 05. Technical Notes & Constraints

### Tech stack
Unchanged on the client: vanilla ES modules, no framework, one
`localStorage` document, the existing Capacitor shells. The server stays
the one Cloudflare Worker in `proxy/`, which gains a database in the EU
and an email sender. The design, the tables and the endpoints proposed
are in `docs/plan-accounts.md` §3; the architect confirms or changes
them.

### Data
- No migration of `stackd-v2` and no new field in it. Sync bookkeeping
  lives under its own keys, so a signed-out store is byte-for-byte what
  1.5.0 would write.
- `meeting.recording` and `meeting.jobs` are stripped before a meeting
  leaves the device and preserved when one arrives.

### Constraints & dependencies
- **The domain move (US-12) comes first**; the browser session design
  depends on it.
- The iOS project is generated in CI, so the Face ID usage string and the
  biometric plugin are added in the workflow, not in a committed project.
- Cloudflare KV cannot count PIN attempts safely; the counters need the
  transactional database.
- A new native plugin means a new store build for iOS and Android; the
  web can release earlier than the phones but must not offer biometrics
  the phones do not have yet.
- Owner inputs block specific criteria: legal name and contact address
  (AC-09.2, AC-11.1), the email provider and DNS (AC-09.4), the
  processing agreements (AC-11.9), the store forms (AC-11.8).

---

## 06. Success Metrics

### Key metrics
- 100 % of Must criteria pass on a real iPhone, a real Android phone and
  Chrome at 1280 px, light and dark.
- Registration takes under 60 seconds from "Sign in" to the first sync,
  the email included.
- A change made on one device is on the other within 5 seconds of that
  device gaining focus.
- In the merge tests (both sides with data, offline edits on both, a
  delete against an edit) zero records are lost and zero are duplicated.
- A 1.5.0 store opens signed out in 1.6.0 with zero lost tasks, notes or
  meetings.
- The network panel shows zero requests to any origin other than the app
  and the proxy, signed in and signed out.
- A plan granted to a test account unlocks the AI steps on the phone and
  on the PC, and one summary used on either lowers the bar on both.
- The 1.6.0 security review ends with no open finding rated high.
- No console errors; `npm run check` passes with the new sync and
  third-party-origin checks.

### Definition of done
Each phase in §10 ends with its AC checklist ticked and a commit on the
release branch. The release is done when: QA has walked this document
per `agents/qa_tester.md` on two phones and a PC and appended to
`docs/qa-report.md`; the security review entry is in that report
(AC-13.3); a lawyer has read `privacy.html` and `terms.html`; the owner
tasks of §09 are ticked; `VERSION` is bumped, the bundle rebuilt, the
README updated, and the branch merged to `main`.

---

## 07. Decisions taken (2026-11-13)

| # | Question | Decision |
|---|---|---|
| Q1 | Is an account required? | **Optional.** The app works without one; signing in turns on sync. |
| Q2 | How do people sign in? | **Email code, then a 4-digit PIN** set in the app, the same on phone and PC, replaceable by Face ID, Touch ID and the device's equivalents. |
| Q3 | "Usable with Apple ID": biometrics or a Sign in with Apple button? | **Face ID / Touch ID.** No Sign in with Apple or Google button. |
| Q4 | What syncs in the first version? | **Everything except audio.** |
| Q5 | Minimum age to register | **18+.** |
| Q6 | Security review | **`/security-review` runs before every release**, not only this one. |

---

## 08. Calls made without a question

Each follows from a decision above and can be reversed by editing the AC
it names.

- **Backend: the existing Worker with a database, not a second service**
  (plan §3.1). One place holds personal data.
- **The web app moves to `app.stackdplatform.com`** (US-12). On
  `github.io` every other project of the same GitHub account shares the
  browser's storage with the app.
- **The age question asks for a year, stores nothing but the yes**
  (AC-02.2 to 02.4). A neutral question with no retry is what the
  regulators' guidance describes; storing a birth date would be data the
  app has no use for.
- **A new device needs the email code and the PIN** (AC-03.3). Four digits
  have 10 000 values; they are safe only behind a second proof and a
  five-try lock (AC-03.4).
- **Theme, current board, view and sort orders stay per device**
  (AC-05.2). A phone and a PC are legitimately set up differently.
  Priority levels, labels and the date format sync because records refer
  to them.
- **One conflict rule, per record, later change wins** (AC-05.6). Field by
  field merging is more code than the problem deserves for one person
  with two devices.
- **Reminders fire on every device** (AC-05.9). Choosing one "primary"
  device is a setting nobody would find.
- **App lock defaults to "After 5 minutes"** (AC-07.2) and can be turned
  off: the PIN exists for sign-in whether or not the user wants a lock.
- **Sign-out default differs by platform** (AC-06.6): a browser may be a
  shared PC; a phone rarely is.
- **Five account emails and no others** (AC-09.1), so the rules for
  marketing email never apply by accident.
- **The copyright contact goes in the Terms; registering a DMCA agent is
  an owner option** (AC-11.2, §09). Nothing a user adds is shown to
  anyone else in this release.
- **1.6.0 is built on a release branch** (AC-13.6). Earlier releases
  pushed each phase to `main`, which deploys the web app; a half-built
  sign-in must not be live, and `/security-review` reviews pending
  changes on the current branch.

---

## 09. Open questions and risks

### Owner tasks (each blocks the criteria named)
- [ ] Legal name and contact address for the policy and the email footer
      (AC-09.2, AC-11.1).
- [ ] Choose the email provider; add the DNS records (AC-09.4).
- [ ] Create the EU database; set up `app.stackdplatform.com` on
      Cloudflare hosting (US-12). Not a GitHub Pages custom domain: that
      would redirect the old address and strand the data stored there
      (architecture §28).
- [ ] Accept the processing agreements: hosting, email, purchases,
      speech-to-text, AI model (AC-11.9).
- [ ] Update the App Store privacy labels and the Play Data safety form;
      give Play the deletion URL (AC-11.8, AC-10.5).
- [ ] A lawyer's read of `privacy.html` and `terms.html` (§06).
- [ ] Optional: register a DMCA agent with the US Copyright Office.

### Open questions
- Which country's rules does the owner's establishment bring (the
  supervising data protection authority named in the policy)?
- Does the old `github.io` address redirect after one release, or show
  the banner for longer?
- Should a meeting's transcript be excluded from sync by default for
  users on the Free plan, who never sent it to the server at all? (The
  Should-have switch covers it manually.)

### Risks
| Risk | Mitigation |
|---|---|
| The first merge loses or doubles data | AC-06.1 and AC-06.5; the merge rules are covered by a new check script before any UI exists. |
| Two devices edit one record offline and one edit is lost | Stated as the rule (AC-05.6); the loss is one record's older version, never a whole board. |
| Sign-in email goes to spam | AC-09.4 is tested on three providers before the release. |
| A 4-digit PIN is guessed | Never the only proof on a new device; five tries; reset signs everything out and emails the owner of the account. |
| Someone who controls the user's mailbox resets the PIN | True of any reset by email, and accepted: the mailbox is the root of trust. A reset is never silent (AC-03.5). |
| Someone with the unlocked device reads the data in the browser's storage | Stated honestly (AC-03.8); encryption at rest is a later release (§02). |
| The domain move strands browser users | AC-12.2 keeps the old address alive with an export. |
| Store review objects to account rules | Sign-in is optional, deletion is in the app, there is no third-party login. |
| The policy and the product drift apart again | The policy version is stored per account (AC-02.8); US-11 is a release gate. |
| The security review becomes a formality | It has a written output per release (AC-13.3) and named targets for this one (AC-13.5). |

---

## 10. Delivery plan (phases, for the architecture doc to refine)

| Phase | Content | Stories | Size |
|---|---|---|---|
| 23 | Owner prerequisites, release branch, the new domain | US-12, AC-13.6 | S |
| 24 | Sign-in on the server: codes, PIN, sessions, emails | US-02, US-03, US-04, US-09 (server half) | L |
| 25 | Registration and sign-in UI, age step, acceptance, devices | US-02, US-03, US-04 | M |
| 26 | Sync engine, merge, sign-out, status | US-05, US-06 | L |
| 27 | The plan follows the account | US-08 | M |
| 28 | App lock: PIN and biometrics | US-07 | M |
| 29 | Export, delete, legal pages, renewal terms, no-third-party check | US-10, US-11 | M |
| 30 | QA, security review, release 1.6.0 | US-13, US-14, US-01 regression | M |

About 48 hours of focused build plus owner tasks and device time
(`docs/plan-accounts.md` §6 has the detail per phase).

---

## 11. The six exposures this release is checked against

From the two videos the owner supplied (2026-11-13). Both list the same
six.

| # | Exposure | Stack'd in 1.5.0 | Covered by |
|---|---|---|---|
| 1 | Sign-up never asks for age | No sign-up exists | AC-02.2 to AC-02.4, AC-11.2 |
| 2 | Fonts loaded from another company's servers | Already self-hosted | AC-11.6 keeps it so |
| 3 | Session replay or keystroke analytics on by default | None | AC-11.6, AC-11.7; §02 Non-Goals |
| 4 | Marketing email without an unsubscribe link or a postal address | No email sent | AC-09.1, AC-09.2, AC-09.5 |
| 5 | Subscription button without the renewal terms next to it | Price on the card, terms one paragraph below | AC-11.5 |
| 6 | No registered agent for copyright complaints about user uploads | Nothing users add is shown to others | AC-11.2, §09 owner option |
