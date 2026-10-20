# Stack'd — Minimalist Todo

A minimalist todo PWA, started from turn 2 of the [Claude Design canvas](https://claude.ai/design/p/5d967b89-bc7c-4714-901c-d044de541cbc?file=Stackd+Screens.dc.html)
("Stack'd Minimalist Todo App") and restyled in the Stack'd Finance language:
Inter + Manrope, soft surfaces, rounded cards, frosted bottom nav, light + dark.

Current version: **1.4.0** — a **Notes** area (Keep-style composer,
Notion-style list, colour bar, checklists, bold / italic / underline /
strikethrough, sort with manual order), **search** on Notes and on every
board, and an app-wide **date format** setting; on top of 1.3.0's Settings
(theme, priorities, labels, automations), 1.2.0's reminder notifications
and 1.1.0's editable task fields, Move / Copy / Archive / Delete, folders,
calendar and recurring tasks. Requirements and plan live in
[`docs/prd.md`](docs/prd.md), [`docs/prd-notes.md`](docs/prd-notes.md) and
[`docs/architecture.md`](docs/architecture.md); the release QA passes are in
[`docs/qa-report.md`](docs/qa-report.md).

## Run

**Quickest: double-click `index.html`.** Browsers refuse ES modules from
`file://`, so the page loads `app.bundle.js` instead: the same app, bundled
as one classic script. From disk, these don't work:

- **Reminders** — no notifications; the dates dialog says so.
- **Offline install** — no service worker and no web manifest, so no
  "Install app" and no offline cache (you don't need one from disk).
- **Your usual task list** — tasks opened from disk are stored separately
  from http://localhost:8123 and from the website; nothing moves between
  them. In Chrome and Edge, every page opened from disk shares one storage
  area, so another copy of this folder (a backup, an unzipped release)
  shows and edits the same tasks, and other local HTML files can read them.

**Full app on Windows: double-click `start-stackd.cmd`.** It serves the
folder on http://localhost:8123 and opens the app in your default browser.
Close the window to stop it. It needs [Node.js](https://nodejs.org); if
port 8123 is taken, run it as `set STACKD_PORT=8124 & start-stackd.cmd`.

Anywhere else, any static server works — no build step, no runtime
dependencies:

```bash
npx http-server -p 8123 -c-1 .
```

Then open http://localhost:8123.

Checks (Node, no test framework; run `npm install` once, for esbuild):

```bash
npm run check
```

After changing `app.js` or anything in `src/`, rebuild the disk copy with
`npm run bundle` and commit `app.bundle.js`; the check fails until you do.
Nothing runs the checks automatically, so run them before committing.

It runs:

- `scripts/check-dates.mjs` — date maths (month ends, leap years, recurrence,
  chip labels, reminder times), then re-runs itself with the time zone pinned
  to Lisbon, New York, Sydney and Tokyo to prove DST handling anywhere.
- `scripts/check-reminders.mjs` — the reminder engine: what fires, when, with
  what text, and how iOS pending notifications are reconciled.
- `scripts/check-store.mjs` — the store's reminder rules, run against the real
  `src/store.js` with a stand-in `localStorage`.
- `scripts/check-text.mjs` — the note-body sanitiser (whitelist, synonym
  mapping, nesting, Chrome and Word paste samples) and the search matcher
  (accents, case, every term must hit).
- `scripts/check-shell.mjs` — the service-worker precache list matches the
  files on disk (a missing entry breaks the offline install silently).
- `scripts/check-bundle.mjs` — `app.bundle.js` still matches the modules, so
  a double-clicked `index.html` never runs old code.

## Live

**https://eugeniocalva.github.io/Stackd-Minimalist/** — deployed by GitHub Pages
from `main`, so every push to `main` publishes. Bump `VERSION` in `sw.js` when
app files change, or installed clients keep the old cached shell.

## Platforms

Stack'd is a **PWA** — one codebase for all three platforms:

- **Browser (desktop/mobile)** — just open the URL.
- **Android** — open in Chrome → menu → **Install app** (or the install
  banner). Runs standalone with its own icon, splash, and offline support.
- **iPhone / iPad** — open in Safari → Share → **Add to Home Screen**.
  Runs standalone, respects the notch / home-indicator safe areas.

From 1.5.0 the same code also ships as **native apps** through Capacitor:
iOS via TestFlight / the App Store (see **iOS / App Store**) and Android
via the Play internal testing track (see **Android / Google Play**). The
native shells add what a browser cannot do: recording a meeting while the
screen is locked, and in-app subscriptions.

Offline: the service worker (`sw.js`) precaches the whole app shell, fonts
included (Inter and Manrope are self-hosted, no Google Fonts request), so the
installed app works with no connection. Data stays in localStorage on-device.
When you change app files, bump `VERSION` in `sw.js` and run `npm run check`.

To distribute through the App Store instead, see **iOS / App Store** below.

Note: deploying to any static host (GitHub Pages, Netlify, Cloudflare Pages…)
is enough; HTTPS is required for install + service worker on real devices.

## Vocabulary

- **Board** — Work, Personal, Shopping, Family… (the sidebar / Boards menu).
- **Lane** — the kanban columns of a board: Backlog, In Progress, Done to
  start with. Each board has its own; add, rename, reorder or delete them
  from the lane's ⋯ menu on the kanban. Done stays (it is where completed
  tasks go) and can only be renamed.
- **Folder** — Archived and Deleted, each with a Tasks ∕ Notes switch.
- **Note** — a title, formatted text, an optional checklist, tags and a
  colour; lives in the Notes area, not on a board.
- **Composer** — the "Take a note…" box at the top of Notes.

## What's implemented

- **Onboarding** — first visit only ("Simplify. Focus. Achieve.")
- **Board, list view** — round completion circles, semantic chips (red for
  overdue or High, amber for due within 3 days or Medium), List ∕ Kanban
  segmented control, Sort (manual, due date soonest or latest first, priority
  high or low first; the drag handle shows in manual sort only)
- **Board, kanban** — the board's lanes, sorted the same way inside each
  lane, plus an "Add lane" column; completing a task moves its card to Done
  (repeating tasks excepted, see below). Deleting a lane moves its tasks to
  the board's first lane. Hold a card to carry it to another lane: a copy
  follows the finger and the board scrolls when it nears an edge
- **Navigation** — mobile: sticky frosted header plus a floating bottom pill
  (Boards · Tasks · Notes · Folders) and a round **+** (a new task on a
  board, a new note on Notes); desktop: sidebar with Boards, Notes and
  Folders, each with live counts
- **Search** — a field at the top of every board (desktop inline, mobile
  behind a search icon) and of Notes: case- and accent-insensitive, every
  word must appear in the title, tags, subtasks, note text or checklist.
  Kanban lanes count "1 of 2", the kicker "3 of 12 tasks"; drags pause while
  a query is active. Esc clears, `/` focuses. The query clears when you
  switch board or area and survives opening an item and coming back
- **Notes** — the Notes area, with:
  - *Composer:* tap "Take a note…" for Title and note lines plus a toolbar:
    **Aa** (bold / italic / underline / strikethrough, also Ctrl+B / I / U
    and Ctrl+Shift+X), **Tags** (the shared tag picker), **Colour** (none or
    the six priority colours, shown as a thin bar on the left edge),
    **Checklist** (Enter adds an item, Backspace on an empty one removes it)
    and **Add** (or Ctrl+Enter). Leaving the composer, the screen or the app
    keeps the draft; it comes back as "Draft: …"
  - *List:* one flat list; each row shows the colour bar, title (or the first
    line of the text), tag chips (tap one to filter), checklist progress and
    the date that matches the sort. Sort: manual (drag the handle), created
    or edited, newest or oldest first
  - *Detail:* tap a row; edits save as you type; ticked items sink to the
    bottom; ⋯ gives **Copy**, **Archive**, **Delete**; a note left empty is
    removed
  - *Folders:* archived and deleted notes sit behind the Tasks ∕ Notes
    switch, with Restore, Delete, the 30-day purge and Empty folder
  - Note text is stored as a small HTML subset (line breaks and the four
    styles); everything else pasted in is stripped
- **Task detail** — tap the title to rename; rows for **Due date**,
  **Priority**, **Tags** (picker with suggestions from every tag in use),
  **Move** (board + lane) and **Reminder**; subtasks with a progress bar
- **⋯ menu** — **Move**, **Copy** (any board and lane; subtasks come over
  unticked), **Archive**, **Delete**
- **Dates** — a calendar dialog (Monday first, month and year arrows) for a
  start date, due date and time, **Repeat** (daily / weekly / monthly /
  yearly) and a **Reminder** offset. Keyboard: arrows, PageUp/PageDown,
  Home/End, Enter; Tab stays inside, Esc closes. Repeat is also a chip row
  on the add sheet and a row on the task detail; a rule set without a due
  date anchors to today
- **Repeating tasks** — completing one (checkbox, double-tap, Move or drag to
  Done) does not finish it: it stays in its lane and jumps to the next date
  (month ends clamp, missed periods are skipped), subtasks reset, Undo
  available
- **Archived folder** — archived tasks keep every field and where they came
  from; open one read-only, Restore it to its board and lane, or Delete it
- **Deleted folder** — every delete is soft (toast with Undo, no confirm);
  tasks stay 30 days, with a countdown and a disclaimer, then are purged at
  start-up. Delete forever and Empty folder ask first
- **Reminders** — set one in the dates dialog (at the due time, 10 min, 1 h,
  1 or 2 days before; tasks without a time use 09:00). The dialog shows when
  it will come and whether this device can show it; saving the first one asks
  to allow notifications. Tapping a notification opens the task.
  - *Web / installed PWA:* reminders fire while Stack'd is open in a tab or
    window (one tab checks for all), through the service worker. A reminder
    found late still fires if the task isn't overdue yet (or within 15 min);
    older ones lapse quietly. Several at once become one summary. On iPhone
    and iPad this needs Stack'd added to the Home Screen (iOS 16.4+).
  - *iOS app:* uses `@capacitor/local-notifications`, so reminders arrive even
    when the app is closed. Pending notifications are kept in step with the
    tasks after every change, at launch and on resume (soonest 60, iOS keeps
    64). Notifications are silent banners for now (no sound set).
- **Settings** — sidebar (desktop) or Boards menu (mobile):
  - *Appearance:* Light / Dark / System theme, applied before the first paint;
    all text meets WCAG AA contrast (4.5:1) in both themes
  - *Dates:* `dd/mm/yyyy`, `mm/dd/yyyy` or `yyyy-mm-dd`, defaulting to the
    device locale; used wherever a full date is written (note dates, task
    detail, folder rows, chips from a week out, reminder text). Chips keep
    Today / Tomorrow / weekdays; the calendar's typed date fields follow the
    device
  - *Priorities:* rename, recolour (red, amber, green, blue, violet, gray),
    reorder (drives Sort by priority), add or delete levels; deleting one
    leaves its tasks with no priority
  - *Labels:* every tag in use on tasks and notes plus ones created here;
    rename across all of them (renaming onto an existing label merges them),
    add, delete
  - *Automations:* the built-in "completed tasks move to Done" rule; custom
    rules are a placeholder for now (kanban "Edit rules" opens this section)
- **Gestures** — double-tap / double-click completes, long-press (with a
  haptic tick on the phone) or swipe left deletes, the circle on a row or
  kanban card completes, drag rows to reprioritize in manual sort, drag
  kanban cards between lanes (hold-and-drag on touch)
- **Persistence** — localStorage key `stackd-v2` (tasks, notes, settings).
  A `stackd-v1` store from 1.0 is migrated once on first launch and left in
  place for rollback; the old reminder presets become a due time when the
  task had a due date. The composer draft lives under `stackd-note-draft`,
  so a half-written note survives a reload. Reminders add two small keys: `stackd-reminders-fired` (which reminders a
  tab already showed, so other tabs don't repeat them) and
  `stackd-native-scheduled` (what the iOS app handed to the system)

## Files

- `start-stackd.cmd` — Windows double-click launcher (local server + browser)
- `index.html` — shell: loads `app.js` as an ES module, or `app.bundle.js`
  when opened from disk
- `app.bundle.js` — GENERATED classic-script copy of the app for `file://`
  (`npm run bundle`); never edit it by hand
- `src/boot.js` — first module; tells `index.html` the modules started
- `app.js` — entry point: `render()`, routing, global listeners
- `src/store.js` — state, v1 → v2 migration, selectors, every mutation
- `src/dates.js` — local-time date maths, recurrence, reminder times,
  formatting in the chosen date format (pure, so Node can test it)
- `src/richtext.js` — the note-body sanitiser and text extractor (pure), plus
  the inline-style commands the editor uses
- `src/search.js` — the search matcher for tasks and notes (pure)
- `src/reminders.js` — the reminder engine: plan, text, web firing rules,
  native reconcile (pure)
- `src/notify.js` — reminders on the device: permission, the web clock and
  service-worker notifications, the iOS LocalNotifications sync
- `src/util.js` — ids, HTML escaping, app root
- `src/theme.js` — resolves the theme preference to `data-theme` on `<html>`
- `src/ui/` — one module per screen or overlay:
  - `shell.js` — onboarding, Boards menu, bottom nav, desktop sidebar
  - `board.js` — list, table, kanban, chips, gestures
  - `detail.js` — task detail, ⋯ menu, read-only archived / deleted view
  - `folders.js` — Archived / Deleted screens, tasks and notes
  - `notes.js` — the Notes screen: composer, list, sort, search, tag filter
  - `noteeditor.js` — the note editor (title, text, checklist, tags, colour,
    Format row), shared by the composer and the detail
  - `notedetail.js` — note detail with autosave, ⋯ menu, read-only view
  - `search.js` — the search field (desktop inline, mobile icon)
  - `schedule.js` — the dates dialog
  - `movecopy.js` — board + lane picker for Move and Copy
  - `tagpicker.js` — tag picker
  - `settings.js` — Settings: theme, dates, priorities, labels, automations
  - `addsheet.js` — add-task sheet
  - `actions.js` — archive / delete / restore / move / complete, with toasts
  - `primitives.js` — toast, confirm dialog, context menu
  - `icons.js` — inline SVG icons
- `styles/` — `variables.css` (Finance tokens, light + dark), `base.css`,
  `components.css`, `screens.css`, `fonts.css`
- `fonts/` — self-hosted Inter + Manrope (woff2)
- `scripts/` — `build-www.mjs` (Capacitor copy), `check-dates.mjs`,
  `check-reminders.mjs`, `check-store.mjs`, `check-text.mjs`,
  `check-shell.mjs`, `bundle.mjs` + `bundle-lib.mjs` (build
  `app.bundle.js`), `check-bundle.mjs`
- `docs/` — `prd.md`, `prd-notes.md`, `architecture.md`, `qa-report.md`
- `manifest.webmanifest` — PWA install metadata (name, colors, icons)
- `sw.js` — service worker: precached app shell, stale-while-revalidate,
  opens the task when a reminder notification is tapped
- `icons/` — app icons (192/512, maskable, apple-touch-icon)

## iOS / App Store

The same web code is wrapped with [Capacitor](https://capacitorjs.com) and
built on GitHub's hosted Macs by `.github/workflows/ios-testflight.yml`, the
same approach as Stack'd Finance. No Mac required; macOS runners are free on a
public repository.

    npm install          # one time
    npm run build        # copies web assets into www/
    npx cap sync ios     # needs macOS

Layout:

- `capacitor.config.json` — app id `com.eugeniocalva.stackd`, name `Stack'd`
- `scripts/build-www.mjs` — copies the root web files into `www/`, the clean
  asset root Capacitor wraps. Source stays at the root so GitHub Pages keeps
  serving it directly; `www/` is generated and git-ignored.
- `assets/` — 1024px icon + light/dark splash sources. Opaque (no alpha
  channel), which App Store validation requires. `@capacitor/assets`
  generates every native size from these during the build.
- `scripts/ios/ExportOptions.plist` — App Store Connect export settings
  (cloud-managed signing, team `YA3DTZR26U`).
- `.github/workflows/ios-testflight.yml` — **manual only** (Actions tab >
  iOS to TestFlight > Run workflow), so nothing a fork or pull request does
  can reach the signing secrets. It runs `npm run check`, generates the iOS
  project with `npx cap add ios --packagemanager CocoaPods`, adds icons and
  splash screens, sets the version from `sw.js` (`stackd-v1.4.0` → 1.4.0) and
  the build number from the run number, declares
  `ITSAppUsesNonExemptEncryption = false`, archives, signs with Apple's
  cloud-managed certificate and checks the `.ipa`. With **upload** ticked it
  also sends the build to App Store Connect.

`ios/` is git-ignored and generated in CI, so no Xcode project is committed;
the workflow adds the two Meetings keys (`NSMicrophoneUsageDescription`,
`UIBackgroundModes = [audio]`) with PlistBuddy after generating it. Once you
have a Mac and need to customize `Info.plist`, entitlements, or capabilities
by hand, drop that line from `.gitignore` and commit `ios/` instead (as
Finance does). `android/` **is** committed (see below).

### First TestFlight build

Done once (2026-10-18): Apple Developer Program, the bundle id
`com.eugeniocalva.stackd`, and the App Store Connect app record
"Stack'd Minimalist".

1. **Secrets**: github.com/eugeniocalva/Stackd-Minimalist > Settings >
   Secrets and variables > Actions > New repository secret, three times:
   - `APPSTORE_API_KEY_ID` — the Key ID (the part of `AuthKey_XXXX.p8`
     after the underscore)
   - `APPSTORE_API_ISSUER_ID` — App Store Connect > Users and Access >
     Integrations > App Store Connect API, shown above the key list
   - `APPSTORE_API_KEY_P8` — the whole `.p8` file opened in a text editor,
     `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines
     included

   The key must have the **Admin** role: an App Manager key archives, then
   fails at export with "Cloud signing permission error". Stack'd Finance's
   team key can be reused.
2. **Dry run**: Actions > iOS to TestFlight > Run workflow, **upload**
   unticked. It builds, signs and checks the `.ipa` without sending anything
   to Apple (about 15 min).
3. **Upload**: run it again with **upload** ticked. App Store Connect needs a
   few minutes to an hour to process the build.
4. **Test**: App Store Connect > Stack'd Minimalist > TestFlight > Internal
   Testing > **+** a group, add yourself (internal testers need no Beta App
   Review), add the build. Install **TestFlight** from the App Store on the
   iPhone, accept the invite, install Stack'd.

Every later release: bump `VERSION` in `sw.js`, push, run the workflow with
upload ticked. Don't use "Adicionar para revisão" / "Add for Review" on the
App Store page until the store listing is ready; TestFlight doesn't need it.

## Android / Google Play

`android/` is committed: generated once with `npx cap add android`, then
hand-maintained for the recording permissions in `AndroidManifest.xml`, the
version plumbing and the upload-key signing config in `app/build.gradle`
(both read `-P` properties from CI, and fall back to `sw.js` and an unsigned
build locally). Icons and splash screens were generated with
`npx @capacitor/assets generate --android` from `assets/`.

`plugins/recording-service/` is a local Capacitor plugin (a `file:`
dependency in `package.json`, so run `npm install` after cloning) that keeps
a recording alive while the screen is locked: an Android foreground service
with a "Recording" notification; a no-op on iOS, where the audio background
mode does the job. `npx cap sync android` lists it with the other plugins.

- **`.github/workflows/android-play.yml`** — manual only, like the iOS one.
  It runs `npm run check`, builds `www/`, syncs the Android project, builds
  a signed `.aab` with the version from `sw.js` and the run number as
  `versionCode`, and inspects the bundle. With **upload** ticked it sends it
  to the Play **internal testing** track.
- **Secrets**: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (the upload keystore, made
  once with `keytool`, see the workflow header) and, for uploads,
  `PLAY_SERVICE_ACCOUNT_JSON`.
- **First release**: the Play Console app must exist with a first build
  uploaded by hand before the API accepts uploads; after that, tick
  **upload**.

To build locally instead, open `android/` in Android Studio after
`npm run build && npx cap sync android`.

### Note on App Store review

Apple's Guideline 4.2 (Minimum Functionality) rejects apps that are only a
repackaged website. Offline support helps; the strongest native capability
here is the task **Reminder**, which since 1.2.0 schedules real local
notifications through `@capacitor/local-notifications` (PRD US-10).

The app reaches the plugin through the object Capacitor injects
(`window.Capacitor.Plugins.LocalNotifications`), because there is no bundler
to resolve `import ... from '@capacitor/local-notifications'`. It has been
verified against a stand-in for that object, not yet on an iPhone: try a
reminder on the first TestFlight build.
