# Stack'd — Minimalist Todo

A minimalist todo PWA, started from turn 2 of the [Claude Design canvas](https://claude.ai/design/p/5d967b89-bc7c-4714-901c-d044de541cbc?file=Stackd+Screens.dc.html)
("Stack'd Minimalist Todo App") and restyled in the Stack'd Finance language:
Inter + Manrope, soft surfaces, rounded cards, frosted bottom nav, light + dark.

Current version: **1.2.0** — reminder notifications on the web and in the
iOS app, on top of 1.1.0's editable task fields, Move / Copy / Archive /
Delete, Archived and Deleted folders, a calendar for dates with recurring
tasks, and the Finance design. Requirements and plan live in
[`docs/prd.md`](docs/prd.md) and [`docs/architecture.md`](docs/architecture.md);
the release QA pass is in [`docs/qa-report.md`](docs/qa-report.md).

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

Offline: the service worker (`sw.js`) precaches the whole app shell, fonts
included (Inter and Manrope are self-hosted, no Google Fonts request), so the
installed app works with no connection. Data stays in localStorage on-device.
When you change app files, bump `VERSION` in `sw.js` and run `npm run check`.

To distribute through the App Store instead, see **iOS / App Store** below.

Note: deploying to any static host (GitHub Pages, Netlify, Cloudflare Pages…)
is enough; HTTPS is required for install + service worker on real devices.

## Vocabulary

- **Board** — Work, Personal, Shopping, Family… (the sidebar / Boards menu).
- **Lane** — Backlog, In Progress, Done (the kanban columns of a board).
- **Folder** — Archived and Deleted.

## What's implemented

- **Onboarding** — first visit only ("Simplify. Focus. Achieve.")
- **Board, list view** — round completion circles, semantic chips (red for
  overdue or High, amber for due within 3 days or Medium), List ∕ Kanban
  segmented control, Sort (manual / due date + time / priority)
- **Board, kanban** — Backlog / In Progress / Done lanes; completing a task
  moves its card to Done (repeating tasks excepted, see below)
- **Navigation** — mobile: sticky frosted header plus a floating bottom pill
  (Boards · Tasks · Folders) and a round **+**; desktop: sidebar with Boards
  and Folders, each with live counts
- **Task detail** — tap the title to rename; rows for **Due date**,
  **Priority**, **Tags** (picker with suggestions from every tag in use),
  **Move** (board + lane) and **Reminder**; subtasks with a progress bar
- **⋯ menu** — **Move**, **Copy** (any board and lane; subtasks come over
  unticked), **Archive**, **Delete**
- **Dates** — a calendar dialog (Monday first, month and year arrows) for a
  start date, due date and time, **Repeat** (daily / weekly / monthly /
  yearly) and a **Reminder** offset. Keyboard: arrows, PageUp/PageDown,
  Home/End, Enter; Tab stays inside, Esc closes
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
  - *Priorities:* rename, recolour (red, amber, green, blue, violet, gray),
    reorder (drives Sort by priority), add or delete levels; deleting one
    leaves its tasks with no priority
  - *Labels:* every tag in use plus ones created here; rename across all
    tasks (renaming onto an existing label merges them), add, delete
  - *Automations:* the built-in "completed tasks move to Done" rule; custom
    rules are a placeholder for now (kanban "Edit rules" opens this section)
- **Gestures** — double-tap / double-click completes, long-press deletes,
  drag rows to reprioritize in manual sort, drag kanban cards between lanes
  (hold-and-drag on touch)
- **Persistence** — localStorage key `stackd-v2`. A `stackd-v1` store from
  1.0 is migrated once on first launch and left in place for rollback; the
  old reminder presets become a due time when the task had a due date.
  Reminders add two small keys: `stackd-reminders-fired` (which reminders a
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
  formatting (pure, so Node can test it)
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
  - `folders.js` — Archived / Deleted screens
  - `schedule.js` — the dates dialog
  - `movecopy.js` — board + lane picker for Move and Copy
  - `tagpicker.js` — tag picker
  - `settings.js` — Settings: theme, priorities, labels, automations
  - `addsheet.js` — add-task sheet
  - `actions.js` — archive / delete / restore / move / complete, with toasts
  - `primitives.js` — toast, confirm dialog, context menu
  - `icons.js` — inline SVG icons
- `styles/` — `variables.css` (Finance tokens, light + dark), `base.css`,
  `components.css`, `screens.css`, `fonts.css`
- `fonts/` — self-hosted Inter + Manrope (woff2)
- `scripts/` — `build-www.mjs` (Capacitor copy), `check-dates.mjs`,
  `check-reminders.mjs`, `check-store.mjs`, `check-shell.mjs`,
  `bundle.mjs` + `bundle-lib.mjs` (build `app.bundle.js`), `check-bundle.mjs`
- `docs/` — `prd.md`, `architecture.md`, `qa-report.md`
- `manifest.webmanifest` — PWA install metadata (name, colors, icons)
- `sw.js` — service worker: precached app shell, stale-while-revalidate,
  opens the task when a reminder notification is tapped
- `icons/` — app icons (192/512, maskable, apple-touch-icon)

## iOS / App Store

The same web code is wrapped with [Capacitor](https://capacitorjs.com) and
built in the cloud by [Codemagic](https://codemagic.io) — no Mac required.

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
- `codemagic.yaml` — two workflows. Since 1.2.0 they create the iOS project
  with `npx cap add ios --packagemanager CocoaPods`: Capacitor 8 otherwise
  creates a Swift Package Manager project, which has no Podfile or
  `App.xcworkspace` for the `pod install` and build steps below.
  - `ios-release` — signed `.ipa` to TestFlight. Triggered by pushing a
    `v*` tag (e.g. `git tag v1.1.0 && git push --tags`).
  - `ios-debug` — unsigned compile check, for verifying the build works.
    Run it once after any change to how scripts load (1.1.0 moved to ES
    modules).

`ios/` and `android/` are git-ignored and generated in CI, so no Xcode project
is committed. Once you have a Mac and need to customize `Info.plist`,
entitlements, or capabilities, drop those lines from `.gitignore` and commit
`ios/` instead.

### Before the first Codemagic build

1. App Store Connect: create the bundle id `com.eugeniocalva.stackd`.
2. Codemagic > Integrations > App Store Connect: add an API key named
   **`StackdAppStoreKey`** (the name `codemagic.yaml` refers to).
3. Push a `v*` tag. Codemagic issues the certificate and provisioning
   profile itself — no manual signing setup.

`submit_to_app_store` is deliberately `false`; it ships to TestFlight only
until the store listing is complete.

### Note on App Store review

Apple's Guideline 4.2 (Minimum Functionality) rejects apps that are only a
repackaged website. Offline support helps; the strongest native capability
here is the task **Reminder**, which since 1.2.0 schedules real local
notifications through `@capacitor/local-notifications` (PRD US-10).

The app reaches the plugin through the object Capacitor injects
(`window.Capacitor.Plugins.LocalNotifications`), because there is no bundler
to resolve `import ... from '@capacitor/local-notifications'`. It has been
verified against a stand-in for that object, not yet on an iPhone: run the
`ios-debug` workflow and try a reminder on a device before tagging a release.
