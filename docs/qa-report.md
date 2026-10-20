# QA Report: Stack'd Minimalist 1.1.0

Date: 2026-10-16 · Role: QA tester (`agents/qa_tester.md`) · Build: `main`
plus the Phase 5 changes, service worker `stackd-v1.1.0`.

**Verdict: 🟢 Good to go for the web build.** Every Must and Should
acceptance criterion in `docs/prd.md` passes. US-10 (notifications) is
deferred by decision (PRD Q7). Before tagging for TestFlight, run the items
under "Not verified".

---

## Scope and method

- **Source of truth:** the acceptance criteria in `docs/prd.md`, US-01 to
  US-09.
- **Environment:** local `http-server`, Chromium (Claude in-app browser), at
  375×812 and 1280×800, in light and dark colour schemes, starting from fresh
  seed data and from a hand-built 1.0 (`stackd-v1`) store.
- **How:** 142 scripted checks that drive the real UI (clicks, pointer
  gestures, real keystrokes for the calendar) and read back `localStorage`;
  `npm run check` (date maths, precache list); and an automated contrast scan
  of every visible text element against its effective background. The scan
  was sanity-checked by re-injecting the old colour, which it flagged at
  4.02:1 and 3.50:1.

## Results by story

| Story | Criteria | Checks | Result |
|---|---|---|---|
| US-01 Edit task fields | 01.1 – 01.6 | 11 | Pass |
| US-02 Move | 02.1 – 02.5 | 6 | Pass |
| US-03 ⋯ menu | 03.1 – 03.4 | 7 | Pass |
| US-04 Copy | 04.1 – 04.3 | 6 | Pass |
| US-05 Archive + Archived folder | 05.1 – 05.8 | 18 | Pass |
| US-06 Soft delete + Deleted folder | 06.1 – 06.6 | 16 | Pass |
| US-07 Schedule popover | 07.1 – 07.8 | 29 | Pass |
| US-08 Recurring tasks | 08.1 – 08.6 | 10 | Pass |
| US-09 Design refresh | 09.1 – 09.10 | 27 | Pass |
| Layout, tokens, offline install | — | 12 | Pass |
| **Total** | | **142** | **0 failing** |

AC-03.3 (each menu item starts its flow) is covered by the Move, Copy,
Archive and Delete checks. AC-09.5 (detail layout) was checked visually.

## Defects found and fixed in this pass

| # | Defect | Criterion | Severity | Fix |
|---|---|---|---|---|
| 1 | Moving a repeating task to Done (Move sheet) marked it done and left it in Done | AC-08.1 | High | Choosing Done for a repeating task now completes it: it rolls forward in its lane, after changing board if one was picked. The store also refuses to put a repeating task in Done. |
| 2 | Deleting from the Archived folder offered no Undo | AC-06.1 | Medium | Undo now returns the task to Archived. |
| 3 | A double tap during the 400 ms completion flash advanced a repeating task twice | AC-08.1 | Medium | A completion already in flight ignores further taps. |
| 4 | Tertiary text (counts, hints, kickers, subtask totals) failed WCAG AA: as low as 3.78:1 in light and 3.06:1 in dark | AC-09.8 | High | Tokens changed to `#56657a` / `#8796ab`, at least 4.7:1 on every surface in both themes. |
| 5 | Filled danger button: white on red at 3.76:1 (light) and 2.77:1 (dark) | AC-09.8 | Medium | New tokens: `#dc2626` with white text (4.83:1), `#f87171` with dark text (6.92:1). |
| 6 | Subtask delete, drag grip and adjacent-month calendar days used the placeholder colour (about 1.5:1) | AC-09.8 | Medium | They use the tertiary colour (WCAG 1.4.11 asks 3:1 for controls). |
| 7 | Archived and deleted tasks could not be opened | AC-05.6 (Should) | Medium | Read-only detail with only Restore and Delete; folder rows open it; the sidebar highlights the folder. |
| 8 | Calendar not keyboard-operable; every change rebuilt the dialog, losing focus and half-typed dates | AC-07.7 (Should) | Medium | The dialog renders once and repaints only the grid and field states. Arrows, PageUp/PageDown (Shift for a year), Home/End and Enter work; Tab stays inside; Esc returns focus to the opener. |
| 9 | "Removed in 1 days" | AC-06.2 | Low | Singular form. |
| 10 | Gesture hint sat below the list instead of under the header | AC-09.3 | Low | Moved under the header. |
| 11 | Sorting by due date ignored the due time | — (found in review) | Low | Sorted by date and time; untimed tasks come last that day. |

## Not verified

- **iOS build:** the Codemagic `ios-debug` workflow was not run. 1.1.0 loads
  the app as ES modules, so confirm the Capacitor shell loads them before a
  `v*` tag. Start it by hand from the Codemagic dashboard.
- **Real touch:** long-press, double-tap and hold-and-drag were driven with
  synthetic pointer events, not on a phone.
- **Live resize between layouts:** the preview's viewport emulation sends no
  resize or media-query events, so each size was checked after a reload. The
  app re-renders on the standard media-query change event.
- **Lighthouse PWA audit:** not run. Instead, the manifest, icons and a fresh
  service worker were checked: it activated and precached all 31 shell
  files, each readable from the cache alone.
- **Reduced motion:** the CSS rule is present; the preference itself could
  not be emulated.
- **Other browsers:** Firefox and Safari were not tested.

## Observations (not blocking)

- Inputs use a filled background with no border, as in Stack'd Finance.
  Their outline against white cards is faint; WCAG 1.4.11 asks 3:1 for input
  boundaries. A 1 px border would fix it in a later pass.
- Three native browser dialogs remain, none in delete flows: New board, the
  add sheet's "+ Add tag", and the kanban "Edit rules" note.
- "Removed today" (AC-06.2) cannot appear in practice: a task is purged once
  30 days pass, so its last day reads "Removed in 1 day".
- Copying a repeating task into Done creates a done copy, as AC-04.2 states.
  Ticking it again reopens it to Backlog.

## How to re-run

```bash
npm run check
```

The browser checks were run interactively against `http://localhost:8123`
and are not part of the repository.

---

# Addendum: 1.2.0 — Reminder notifications (US-10)

Date: 2026-10-16 · Service worker `stackd-v1.2.0`.

**Verdict: 🟢 for the web; iOS needs a device run.** AC-10.1 passes. AC-10.2
is built and passes a contract test against a stand-in for the object iOS
injects, but it has not run on an iPhone.

## How it was checked

| Check | Result |
|---|---|
| `npm run check` — date maths incl. DST pinned to 4 zones, reminder engine, store rules on the real `store.js`, precache list | Pass |
| Mutation check — DST bugs re-introduced on purpose (whole-day offset as milliseconds; minute offset on wall-clock fields) | Both caught |
| Web end-to-end — headless Edge, notification permission granted, real service worker, real `getNotifications()` | 11/11 |
| Native contract — headless Edge with a stand-in `Capacitor.Plugins.LocalNotifications` (promise methods, empty `cancel` rejects, ISO dates back) | 24/24 |
| Adversarial review — 5 reviewers, 3 skeptics per finding, then a fix check and a critic | 20 findings → 15 confirmed (9 distinct) → all fixed; fix check found 4 more → fixed |

Web end-to-end covered: a timely reminder fires once with the right text and
tag; a stale one lapses; nothing repeats after reload; three at once become
one summary; a tap opens the task; the `#task=` link opens it from a cold
start; a late "1 day before" reminder on the due day says "Due today"; with
two tabs open only one fires, because only one holds the clock lock.

Native contract covered: no prompt at launch; permission asked only from the
Save tap, with user activation; payload uses a real `Date`, an integer id and
the task id in `extra`; change reschedules under the same id; archive, done
and delete cancel; restore schedules again; resume syncs; bursts coalesce;
`cancel([])` never happens; without permission, deletes still cancel and
nothing is scheduled; delivered reminders are recorded so a time-zone change
can't repeat them; a reminder saved 2 s before its moment survives a commit
inside the clamp window; a done, repeating task gets no promise and no prompt.

## Defects found and fixed

1. Late web reminders used the fire-time text ("Due tomorrow" on the due day). Now re-phrased when found more than 2 minutes late.
2. Re-phrasing every reminder made on-time "At time of due" read "Overdue". Fixed with the 2-minute rule.
3. Done tasks (with or without a repeat rule) were promised a reminder and Save asked for permission. Now "Reminders are off while the task is done".
4. The iPhone hint sent users to a Home Screen app without their tasks (separate storage on iOS) and said "iPhone" on iPad. Copy now says tasks don't move there.
5. Native never recorded delivery, so flying west could repeat a reminder. Now recorded from an absolute log of what was scheduled.
6. Native sync cancelled requests iOS still held when their moment looked past (clamp window, flying east). Held requests are now left alone; never-delivered but timely ones are delivered now.
7. Without permission, native sync skipped cancellations. Now always cancels; only scheduling needs permission.
8. A failed storage write could repeat a web reminder every minute. A per-tab record prevents it.
9. A notification tap could focus another site on the same origin (other GitHub Pages sites). Only windows in the app's scope are used.
10. The DST checks only worked in some machine time zones, and later could pass with every zone skipped. Zones are pinned in child processes and a missing zone fails.
11. The reminder time itself subtracted minutes on wall-clock fields, so "10 minutes before 02:05" on a spring-forward day fired 50 minutes late. Minute offsets now subtract real time; day offsets stay on the calendar.

## Not verified

- **iPhone:** no device run. Run the Codemagic `ios-debug` workflow, install
  a build, set a reminder a few minutes out, and check it arrives with the
  app closed and that tapping it opens the task. A tap that cold-launches the
  app may not deliver the "action performed" event with Capacitor 8's scene
  setup; the app still opens.
- **Codemagic:** `codemagic.yaml` now runs `npx cap add ios --packagemanager
  CocoaPods`, because Capacitor 8 otherwise creates a Swift Package Manager
  project with no Podfile or `App.xcworkspace`. The pipeline was never run
  before this change either.
- **iPhone/iPad Home Screen web app:** whether a foreground notification shows
  a banner, and whether the tap handler fires (WebKit bug 268797).
- **Sound:** iOS notifications are silent banners; no sound is set.

## Observations

- `npm audit` reports two critical advisories in `@capacitor/ios` and
  `@capacitor/android` 8.5.0, fixed in 8.5.1. They predate this change.
- The seed demo task "Prepare Q3 review deck" has a reminder; new users get
  it a week after onboarding if they allow notifications.
- Web reminders only fire while Stack'd is open in a tab or window; reliable
  background delivery is the iOS app.

---

# Addendum: 1.4.0 — Notes, search, date format

Date: 2026-10-18 · Role: QA tester (`agents/qa_tester.md`) · Build: `main`
after Phases 7–12 of `docs/architecture.md` §14, service worker
`stackd-v1.4.0`.

**Verdict: 🟢 Good to go for the web build.** 52 of the 54 acceptance
criteria in `docs/prd-notes.md` pass; the two left open need a real phone
and a disk / iOS run (see "Not verified"). One defect was found in this
pass and fixed before release.

## How it was checked

- **Source of truth:** `docs/prd-notes.md`, US-01 to US-09, with the
  decisions in its §07 and the calls in §08.
- **Environment:** local `http-server`, Chromium (Claude in-app browser), at
  1280×800 and 375×812, light and dark colour schemes, on the seed data
  plus the notes created during the walk.
- **How:** each phase ended with a scripted walk of its criteria through the
  real UI (clicks, real keystrokes into the composer and the search field,
  Ctrl+Enter / Esc / Ctrl+B shortcuts, synthetic pointer drags for reorder,
  a synthetic Word paste) with `localStorage` read back after every step;
  `npm run check` (dates in all three formats, reminder text, store rules
  for every note mutation, the sanitiser and the search matcher, precache
  list, bundle); and in this pass an accessibility-tree read of the
  composer, a tab-order read, an automated contrast scan of every visible
  text element on the Notes, note detail, folders and Settings screens in
  both themes, and a timing run with 504 notes.

## Results by story

| Story | Criteria | Result |
|---|---|---|
| US-01 Reach Notes | 01.1 – 01.5 | Pass |
| US-02 Composer | 02.1 – 02.10 | Pass · 02.11 see below |
| US-03 Note list | 03.1 – 03.8 | Pass (504 notes render in 88 ms; search re-render ≈ 120 ms after the 150 ms debounce) |
| US-04 Open and edit | 04.1 – 04.6 | Pass |
| US-05 Archive / delete / restore | 05.1 – 05.5 | Pass |
| US-06 Design, accessibility | 06.1 – 06.4 | Pass · 06.5 see below |
| US-07 Sort and manual order | 07.1 – 07.4 | Pass (task-row drag re-checked after the helper was generalised) |
| US-08 Search | 08.1 – 08.4 | Pass |
| US-09 Date format | 09.1 – 09.5 | Pass (first-run default came out `mm/dd/yyyy` on the en-US test browser) |
| Contrast, light + dark | 4 screens, 37–41 text nodes each | 0 below 4.5 : 1 |

## Defects found and fixed

During the phase walks (fixed in the phase's commit):

1. Tapping the **+** button on Notes expanded the composer and collapsed it again at once: the click-outside listener ran on the same event after the FAB's handler had re-rendered. Clicks whose target was already replaced by a render are now ignored.
2. The sanitiser turned a `</div><div>` boundary into two line breaks; caught by `check-text.mjs` before it reached the UI. Block boundaries are now one pending break.
3. On desktop, switching board cleared the search in state but the header had already drawn the field with the old text. The reset now runs before the header renders.
4. The mobile task list still drew the drag handle on filtered rows although dragging was disabled. Hidden while a query is active.

In this pass:

5. The note body (`contenteditable`) had no explicit `tabindex`, and Chromium reports such elements as outside the sequential focus order, so Tab from the title could skip it (AC-02.9). It now carries `tabindex="0"`; the order reads Title → note → checklist → toolbar → Add.

## Not verified

- **AC-02.11, on-screen keyboard:** the bottom nav hides while the composer
  is open and the card scrolls, but whether the toolbar and Add stay above
  an iOS or Android keyboard needs a real phone.
- **AC-06.5, file:// and the iOS shell:** `check-bundle.mjs` proves
  `app.bundle.js` matches the modules and the fallback in `index.html` is
  unchanged since 1.2.1, but the in-app browser cannot open `file://`
  pages, and no Capacitor build was run. Double-click `index.html`, and run
  the `ios-debug` Codemagic workflow, before tagging.
- **Safari / WebKit editing:** `contenteditable`, `execCommand` and the
  paste handler were exercised in Chromium only. Check bold / italic /
  underline / strikethrough, Enter inside the body, and a paste from Notes
  or Pages on an iPhone.
- **Touch drag** of note rows (grip handle, `touch-action: none`) on a real
  device; the walk used synthetic mouse pointer events.
- **Installed PWA update:** after this release's `VERSION` bump, confirm an
  installed client picks up the new shell on its second load.

## Observations

- The service worker is stale-while-revalidate, so the first load after a
  deploy still runs the previous modules and only the second load is
  current. Expected, and the reason the version bump matters for installed
  clients.
- `document.execCommand` is deprecated but still the only zero-dependency
  way to toggle inline styles; it is wrapped in one function
  (`richtext.js exec()`) for a later swap.
- Chromium's `tabIndex` getter returns −1 for an implicit `contenteditable`
  even where the element is reachable by Tab; the explicit attribute removes
  the doubt.
- The desktop header shows the search field permanently; with the sidebar,
  title, field, List ∕ Kanban control and Add button, the board header wraps
  to two lines below about 1100 px. Acceptable, noted for a later polish.


---

# QA Report: Stack'd Minimalist 1.5.0

Date: 2026-10-20 · Role: QA tester (`agents/qa_tester.md`) · Build: `main`
at the Phase 22 commit, service worker `stackd-v1.5.0`.

**Verdict: 🟡 Ship with caution to TestFlight and the Play internal track;
not yet a store release.** Every criterion of `docs/prd-meetings.md` that
a browser can exercise passes, with one defect found and fixed during the
pass. Seven criteria need a phone, a store sandbox or a provider key and
are listed under "Not verified"; the release is a store release only once
they are green.

---

## Scope and method

- **Source of truth:** the acceptance criteria in `docs/prd-meetings.md`,
  US-01 to US-12, plus the Should list.
- **Environment:** local `http-server` on 8123 and the Worker running
  locally with `wrangler dev` on 8787 (`STT_PROVIDER=stub`, no model key),
  Chromium (Claude in-app browser) at 639 px and 1280 px, dark scheme,
  fresh seed data plus the stores left by the phase-by-phase checks.
- **How:** 54 scripted checks driving the real UI through the DOM
  (clicks, synthesised pointer swipes, real input events, the paste sheet,
  the native-style dialogs) and reading back the store and `localStorage`,
  plus 11 more on the transcription slice after the Worker restart;
  `npm run check` (dates, reminders, store with the meetings, recordings
  and action-card invariants, text, transcript with a docx it builds, the
  AI client against a fake network, precache list, bundle) and `npm test`
  in `proxy/` (plans, pools, schema, entitlement, the request pipeline
  with the stub model and the stub transcriber). The in-app browser
  blocks the microphone, so recording was exercised with a synthetic WAV
  written through `src/media.js`, and the denied-permission path was the
  one the real `getUserMedia` call produced.

## Results by story

| Story | Criteria | Checks | Result |
|---|---|---|---|
| US-01 Reach Meetings | 01.1 – 01.5 | 4 | Pass |
| US-02 Meeting list | 02.1 – 02.7 | 6 | Pass |
| US-03 Meeting detail | 03.1 – 03.5 | 5 | Pass |
| US-04 Record audio | 04.1, 04.2, 04.4 – 04.9 | 7 | Pass (synthetic clip; see Not verified for 04.3 and real capture) |
| US-05 Transcribe | 05.1 – 05.6 | 7 | Pass against the stub provider |
| US-06 Transcript | 06.1 – 06.7 | 9 | Pass |
| US-07 Minutes | 07.1 – 07.5 | 6 | Pass (minutes injected: the model call needs a key; the failure path was the one exercised) |
| US-08 Action cards | 08.1 – 08.8 | 11 | Pass |
| US-09 Proxy and allowances | 09.1 – 09.6 | proxy tests | Pass |
| US-10 Archive / delete / restore | 10.1 – 10.4 | 5 | Pass |
| US-11 Settings, trust, parity | 11.1 – 11.4 | 3 | Pass (11.5 see Not verified) |
| US-12 Plans | 12.1, 12.2, 12.5 – 12.9 | 5 | Pass on the web variant (12.3, 12.4 see Not verified) |
| Should list | — | 3 | Pass (sort, inline edits, From meeting, Copy minutes, extra pasted shape) |
| Task-row regression (swipe, tap, double tap) | — | 4 | Pass |

## Defects found and fixed

| # | Where | What | Fix |
|---|---|---|---|
| 1 | Transcript block | After an inline text edit the "Transcript edited since" chip did not appear until something else re-rendered the screen (the edit saves quietly). | `transcriptview.js` re-renders once after the first edit that makes the minutes stale. |
| 2 | Summarise (Phase 16, during build) | The running state stayed on screen after a failure because the in-flight marker was cleared after the render. | `ai.js` settles the request before rendering the result. |
| 3 | Worker (Phase 16, during build) | A missing model key leaked the SDK's internal auth message to the app. | `summarise.js` answers `misconfigured` with a fixed message; details stay in the log. |

## Not verified

These need what the in-app browser cannot provide. Each has its procedure.

| Criterion | Needs | Procedure |
|---|---|---|
| AC-04.3 lock-screen recording | a TestFlight build and a Play internal build | `docs/benchmarks/background-recording.md`; fill in the table. If iOS stops the recorder, the native fallback in architecture §26. |
| AC-04.2 / 04.4 real capture | a phone or a desktop with a microphone | Record 30 s, stop, play back; then let one run to 30:00 and see the automatic stop. |
| AC-05.1 – 05.3 with the real provider | `ASSEMBLYAI_API_KEY` on the Worker | `proxy/benchmark/stt.mjs` on the three recordings (headset, phone on a table, two speakers overlapping), then Transcribe from the app. |
| AC-07.1 with the real model | `ANTHROPIC_API_KEY` on the Worker | `proxy/benchmark/run.mjs` on five transcripts, rate blind, set `SUMMARY_MODEL`; then Summarise from the app. The request shape in `summarise.js` is from the API reference and has not run. |
| AC-12.3 purchase, AC-12.4 restore | RevenueCat project, the SDK keys in `src/purchases.js`, store sandbox accounts | Buy Plus on one phone, use a summary, Restore on a second phone, upgrade to Pro, let the sandbox renewal lapse; check Settings › Plan each time. |
| AC-11.5 shells | the two builds | Smoke the Meetings area in both shells, including the file picker and the foreground-service notification on Android. |
| AC-02.3 row chip while a job runs | — | Seen during the Phase 16 and 20 checks (the chip renders from the persisted job); not re-counted here. |

Also pending on the owner's side before the store listings: the contact
email placeholder in `privacy.html` and `terms.html`, the RevenueCat
public keys, and the Worker secrets (`proxy/README.md`).

## Observations (not blocking)

- The local Worker's KV keeps the tester's pool across runs, so a second
  transcription in the same day showed 3480 s left rather than 3540 s.
  Correct behaviour (the proxy is the truth); worth knowing when testing.
- Chromium logs "Blocked call to navigator.vibrate" on synthesised clicks;
  real taps do not trigger it.
- Seeking past the end of a one-second clip ends playback at once, so the
  playing highlight never shows on a clip shorter than the segment time; a
  real recording is longer than its segments.
- The Summarise and Transcribe buttons show "Retry" after any failure,
  including a plan refusal when the paywall sheet was dismissed; pressing
  it re-opens the sheet. Acceptable.

## How to re-run

1. `npm run check` at the root and `npm test` in `proxy/`.
2. `npx http-server -p 8123 -c-1 .` and, in `proxy/`, `npm run dev` with a
   `.dev.vars` that sets `APP_TOKEN=stackd-app-2026-10`, `TESTERS=<your
   subscriber id>` and `STT_PROVIDER=stub`; in the app, Settings ›
   Meetings & AI › Developer → `http://localhost:8787`.
3. Walk US-01 to US-12 in `docs/prd-meetings.md` at 375 px and 1280 px,
   light and dark; the scripted checks above are the same walk done by
   hand.
