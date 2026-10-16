# Stack'd — Minimalist Todo

Working prototype implementing turn 2 of the [Claude Design canvas](https://claude.ai/design/p/5d967b89-bc7c-4714-901c-d044de541cbc?file=Stackd+Screens.dc.html)
("Stack'd Minimalist Todo App"). Modernist design system: flat, zero radius,
Archivo, 2px rules, one red accent.

## Run

Any static server works — no build step, no dependencies:

```bash
npx http-server -p 8123 -c-1 .
```

Then open http://localhost:8123. (Opening `index.html` directly also works,
but the service worker / install features need http(s).)

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

Offline: the service worker (`sw.js`) precaches the app shell and caches the
Archivo font at runtime, so the installed app works with no connection. Data
stays in localStorage on-device. When you change app files, bump `VERSION` in
`sw.js` so installed clients pick up the update.

To distribute through the App Store instead, see **iOS / App Store** below.

Note: deploying to any static host (GitHub Pages, Netlify, Cloudflare Pages…)
is enough; HTTPS is required for install + service worker on real devices.

## What's implemented

- **Onboarding** (1a) — first visit only ("Simplify. Focus. Achieve.")
- **List view** (2a / 2g) — round completion circles, due/priority/tag chips,
  minimal List ∕ Kanban text switcher with red underline, Sort control
  (manual / due date / priority)
- **Lists menu** (2b) — mobile screen; desktop sidebar (2g) with "+ New list"
- **Kanban** (2c / 2h) — Backlog / In Progress / Done lanes; the one
  automation: completing a task moves its card to Done (with timestamp note)
- **Task detail** (2d) — subtasks with progress bar, add/remove subtasks,
  reminder presets, delete
- **Add-task sheet** (2e) — title, Due / Priority / Tags / List chips,
  "Pick date…" opens a native date picker, "+ Add tag" creates tags
- **Dark mode** (2f) — follows system (`prefers-color-scheme`)
- **Gestures** — double-tap/double-click completes, long-press deletes,
  drag rows (handle on mobile, row itself on desktop) to reprioritize in
  manual sort, drag kanban cards between lanes (hold-and-drag on touch)
- **Persistence** — localStorage (`stackd-v1`), seeded with the design's
  sample data on first run

## Files

- `index.html` — shell
- `ds.css` — Modernist design-system tokens + components (from the design
  project, extended with dark-mode token overrides)
- `app.css` — screen layouts (mobile-first, desktop ≥900px)
- `app.js` — entry point (ES module): `render()` and global listeners
- `src/store.js` — state, persistence, selectors, mutations
- `src/dates.js` — local-time date helpers and due-date formatting
- `src/util.js` — ids, HTML escaping, app root
- `src/ui/` — one module per screen: `shell.js` (onboarding, lists menu,
  desktop sidebar), `board.js` (list, table, kanban, gestures),
  `detail.js`, `addsheet.js`
- `docs/` — `prd.md` (acceptance criteria) and `architecture.md` (v2 plan)
- `manifest.webmanifest` — PWA install metadata (name, colors, icons)
- `sw.js` — service worker: offline app shell + font caching
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
    `v*` tag (e.g. `git tag v1.0.0 && git push --tags`).
  - `ios-debug` — unsigned compile check, for verifying the build works.

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
native capability — the highest-value one here is wiring the task
**Reminder** field to actual local notifications
(`@capacitor/local-notifications`). It is currently a stored label only, with
no scheduling behind it.
