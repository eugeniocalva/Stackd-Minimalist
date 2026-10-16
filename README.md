# Stack'd — Minimalist Todo

A minimalist todo PWA, started from turn 2 of the [Claude Design canvas](https://claude.ai/design/p/5d967b89-bc7c-4714-901c-d044de541cbc?file=Stackd+Screens.dc.html)
("Stack'd Minimalist Todo App") and restyled in the Stack'd Finance language:
Inter + Manrope, soft surfaces, rounded cards, frosted bottom nav, light + dark.

Current version: **1.1.0** — editable task fields, Move / Copy / Archive /
Delete, Archived and Deleted folders, a calendar for dates with recurring
tasks, and the Finance design. Requirements and plan live in
[`docs/prd.md`](docs/prd.md) and [`docs/architecture.md`](docs/architecture.md);
the release QA pass is in [`docs/qa-report.md`](docs/qa-report.md).

## Run

**Windows: double-click `start-stackd.cmd`.** It serves the folder on
http://localhost:8123 and opens the app in your default browser. Close the
window to stop it. It needs [Node.js](https://nodejs.org); if port 8123 is
taken, run it as `set STACKD_PORT=8124 & start-stackd.cmd`.

Opening `index.html` directly does **not** work: the app is ES modules,
which browsers refuse to load from `file://`, so the page stays blank.

Anywhere else, any static server works — no build step, no runtime
dependencies:

```bash
npx http-server -p 8123 -c-1 .
```

Then open http://localhost:8123.

Checks (Node only, no test framework):

```bash
npm run check
```

It runs `scripts/check-dates.mjs` (date maths: month ends, leap years, DST,
recurrence, chip labels) and `scripts/check-shell.mjs` (the service-worker
precache list matches the files on disk — a missing entry breaks the offline
install silently).

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
- **Dark mode** — follows the system (`prefers-color-scheme`); all text meets
  WCAG AA contrast (4.5:1) in both themes
- **Gestures** — double-tap / double-click completes, long-press deletes,
  drag rows to reprioritize in manual sort, drag kanban cards between lanes
  (hold-and-drag on touch)
- **Persistence** — localStorage key `stackd-v2`. A `stackd-v1` store from
  1.0 is migrated once on first launch and left in place for rollback; the
  old reminder presets become a due time when the task had a due date

## Files

- `start-stackd.cmd` — Windows double-click launcher (local server + browser)
- `index.html` — shell (loads `app.js` as an ES module)
- `app.js` — entry point: `render()`, routing, global listeners
- `src/store.js` — state, v1 → v2 migration, selectors, every mutation
- `src/dates.js` — local-time date maths, recurrence, formatting (pure, so
  Node can test it)
- `src/util.js` — ids, HTML escaping, app root
- `src/ui/` — one module per screen or overlay:
  - `shell.js` — onboarding, Boards menu, bottom nav, desktop sidebar
  - `board.js` — list, table, kanban, chips, gestures
  - `detail.js` — task detail, ⋯ menu, read-only archived / deleted view
  - `folders.js` — Archived / Deleted screens
  - `schedule.js` — the dates dialog
  - `movecopy.js` — board + lane picker for Move and Copy
  - `tagpicker.js` — tag picker
  - `addsheet.js` — add-task sheet
  - `actions.js` — archive / delete / restore / move / complete, with toasts
  - `primitives.js` — toast, confirm dialog, context menu
  - `icons.js` — inline SVG icons
- `styles/` — `variables.css` (Finance tokens, light + dark), `base.css`,
  `components.css`, `screens.css`, `fonts.css`
- `fonts/` — self-hosted Inter + Manrope (woff2)
- `scripts/` — `build-www.mjs` (Capacitor copy), `check-dates.mjs`,
  `check-shell.mjs`
- `docs/` — `prd.md`, `architecture.md`, `qa-report.md`
- `manifest.webmanifest` — PWA install metadata (name, colors, icons)
- `sw.js` — service worker: precached app shell, stale-while-revalidate
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
- `codemagic.yaml` — two workflows:
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
repackaged website. Offline support helps, but the strongest fix is real
native capability — the highest-value one here is turning the task
**Reminder** into actual local notifications
(`@capacitor/local-notifications`). Since 1.1.0 every task stores a due date,
time and reminder offset, so the data is ready; nothing schedules a
notification yet (PRD US-10, deferred).
