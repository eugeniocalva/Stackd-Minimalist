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

To distribute through the App Store / Play Store instead, wrap this same code
with [Capacitor](https://capacitorjs.com) (Play Store also accepts PWAs
directly via a Trusted Web Activity) — no code changes needed.

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
- `app.js` — state, rendering, gestures, persistence
- `manifest.webmanifest` — PWA install metadata (name, colors, icons)
- `sw.js` — service worker: offline app shell + font caching
- `icons/` — app icons (192/512, maskable, apple-touch-icon)
