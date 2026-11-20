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
| AC-07.1 model choice | the benchmark | **Verified 2026-10-21:** Summarise from the website against the deployed Worker on a 402-segment, 58-minute Teams transcript returned minutes, decisions, open questions and 11 actions with resolved due dates; one summary charged. Still open: `proxy/benchmark/run.mjs` on five transcripts to choose between the small and mid tiers for `SUMMARY_MODEL`. |
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

### Addendum 2026-10-21 — live Worker

- Deployed on `https://minimalist-api.stackdplatform.com` (custom domain on
  the `stackdplatform.com` zone; the account's workers.dev subdomain has no
  certificate at the edge, TLS alert 40 for every name under it).
- Setup lessons, now handled in code or docs: the app opened from disk
  (`file://`) cannot reach the proxy and now says so; the tester id is per
  browser and per origin; `wrangler secret put` must run from `proxy/`
  (or with `--name stackd-proxy`); in Windows PowerShell 5.1 a pasted or
  piped secret can arrive empty, so the dashboard (Settings › Variables and
  Secrets) is the reliable way to set it; a user-level Anthropic key needs
  `ANTHROPIC_WORKSPACE_ID`, a "Not linked" workspace key does not.
- Defect found and fixed: long action titles were clipped by a single-line
  field; they now wrap.

---

# 1.6.0 (in progress): security reviews

One entry per build that leaves the repository, as `docs/prd-accounts.md`
US-13 requires. The full QA walk of 1.6.0 is added above this section when
the release is ready.

## Security review: 2026-11-13, Phase 23, before the TestFlight build

- **Reviewed:** `main` (`81f75f8`) to `release/1.6.0` (`21ee226`), one
  commit, 25 files: the new web address, the security headers, export and
  import, the old-address banner. No account, sign-in or sync code exists
  yet. `VERSION` is unchanged (`stackd-v1.5.0`); this is a test build, not
  the 1.6.0 release.
- **How:** `/security-review` in Claude Code. A read-only review that
  traced the code; nothing was executed, so no exploit file was tried
  against a running app.
- **Result: no finding rated high or medium.**
- **Looked at closely and cleared:**
  - *Imported file → page.* Every field `importFile()` accepts was traced
    to where it is drawn. Ids, colours, lanes, priorities, dates and
    statuses pass an anchored pattern or an allow-list before they are
    stored (`src/backup.js`); free text is escaped where it is drawn; note
    bodies go through `sanitize()`. Each record is rebuilt field by field,
    so unknown keys are dropped.
  - *Imported file → device settings.* `replaceRecords()` never assigns
    the plan, the subscriber id, the proxy address, the theme, a recording
    key or an open job from the file, and the export contains none of
    them.
  - *`_headers`.* Scripts are limited to the app's own files with no
    inline allowance; connections to the app and the proxy only; framing
    refused.
  - *`.github/workflows/site.yml`.* Push to `main` and manual start only,
    read-only token, no value from an event reaches a shell, secrets are
    passed to the two steps that need them.
  - *Proxy.* The only change adds the app's new origin to the exact-match
    list.
- **Accepted, not fixed (below the bar, with the reason):**
  - `style-src 'unsafe-inline'` in the policy: the app sets inline
    `style` attributes (allowance bars); no HTML injection was found that
    could use it. Tighten when those styles move to classes.
  - `scripts/serve.mjs`: a malformed percent sequence in a URL stops the
    server, and it does not check the `Host` header. It is a developer
    tool bound to `localhost`, never deployed.
  - On the web host the policy blocks a custom proxy address set under
    Settings › Developer. Intended: the override is for local development,
    where the header is not sent.
- **Not covered by this review:** the proxy's own test suite fails on a
  test this phase did not touch (an assertion expecting the `pro` tier);
  it blocks the proxy deploy workflow and is tracked separately.

## Security review: 2026-11-14, inline lane rename, before the TestFlight build

- **Reviewed:** the change on top of `release/1.6.0` at `0e936c4`: three
  files (`src/ui/board.js`, `styles/screens.css`, the rebuilt
  `app.bundle.js`). Tapping a kanban lane's name now edits it in place.
  `VERSION` is unchanged (`stackd-v1.5.0`); this is a test build.
- **How:** the diff (about 45 lines of source) was read line by line
  against the `/security-review` criteria. The full multi-agent run was
  not repeated for a change this small; Phase 23 underneath it was
  reviewed in the entry above.
- **Result: no finding.**
- **Looked at and cleared:**
  - *Lane name → page.* The name is drawn through `esc()` both as the
    button's text and inside its `aria-label`; `esc()` covers both quote
    characters, so a name cannot leave the attribute.
  - *Edit field.* Built with `createElement` and filled through `.value`,
    so the name is never parsed as HTML. The typed name goes to the
    existing `renameLane()`, unchanged.
  - *Lane id in `data-lane-rename`.* Same pattern as the existing
    `data-lane` and `data-lane-menu`; ids are made by the app, and an
    imported file's ids must match the strict pattern in `src/backup.js`.
  - No new request, stored key, permission or dependency.

## Engineer's check: 2026-11-16, phases 31 to 33 (`docs/prd-improvements.md` US-01 to US-10)

Not the QA walk and not the release gate: what the engineer verified
before offering the phases for commit. `VERSION` is unchanged
(`stackd-v1.5.0`); `/security-review` has not been run on these changes.

- **Automated:** `npm run check` green. New assertions: the origin lane
  within a session and after a restart, Done pinned and locked, board
  reorder / archive / delete / restore / purge and the last board
  (`check-store.mjs`); board status and Done order through export and
  import, a file with no live board refused (`check-backup.mjs`); no
  reminder for a card on an archived or deleted board
  (`check-reminders.mjs`).
- **In the browser preview, 375 px, by scripted pointer, touch and key
  events:** AC-01.1 (board scroll kept on tick and untick), AC-01.2,
  AC-02.1 to 02.3, AC-03.1 (ring computed as an inset 2 px shadow, no
  outline), AC-04.1 to 04.5, AC-05.1 (250 ms in, `leaving` class, removed
  after the fade), AC-06.1 to 06.3, AC-07.1 to 07.3, AC-08.1 to 08.3 (three
  titles at 18 px / 800), AC-09.1 to 09.3, AC-10.1 to 10.6, 10.8, 10.9.
- **At 1280 px:** sidebar label, board drag in the sidebar, tap opens the
  board, mouse hold shows the badge and the release does not open the
  card, a press elsewhere removes the badge, plain titles without chevron.
- **Not verified:**
  - Nothing was looked at: the preview pane could not take screenshots in
    this session, so layout, spacing, colours in light and dark, and every
    animation (lane ring fade, toast fade, menu slide, badge pop) are
    checked by computed style only.
  - No real finger: hold timing against scrolling, the swipe against the
    browser's own gestures, and haptics need both phones (QA, Phase 30).
  - AC-02.4 (a board that moved Done in 1.5.0) and AC-01.3 are covered by
    the store checks, not in the browser.
  - Reduced motion (AC-03.2, AC-07.4) relies on the existing global rule
    in `base.css`; not exercised.
  - Screen readers.
- **Left as it was, on purpose:** the main menu's "Synced 2 min ago · free
  account" line and the sidebar's sample user are placeholders from 1.0;
  phases 25 and 26 replace them with the real account and sync status.

## Engineer's check: 2026-11-16, phases 24 to 28 (accounts, sync, plan, app lock)

Not the QA walk and not the release gate. `VERSION` unchanged; nothing
deployed; `/security-review` not run on these changes.

- **Automated:** `npm run check` green with two new checks:
  `check-sync.mjs` (canonical form, hash, wire forms without recording /
  jobs / reminder state, diff and tombstones, the clock, the merge
  decision, nothing sent while signed out; then the app's engine end to
  end against the real Worker on `node:sqlite`, with a second device over
  HTTP: upload, no echo, remote edit applied with its own `updatedAt`,
  delete wins, a hostile note body sanitised) and `check-lock.mjs` (lock
  timing, offline waits, the device verifier, the age boundary and its
  24-hour refusal, offline unlock). `proxy` `npm test` green with
  `test/accounts.mjs`: codes (wrong, expired, used, five tries, 60 s,
  five an hour), identical answers for known and unknown emails, register
  rules, cookie vs bearer, cookie without an allowed Origin refused,
  lockout on every device, reset signs out the others, change and
  `pin_required`, sync outcomes (older, deleted, clock clamp, paging,
  limits), isolation between accounts, re-accept, tester flag, legacy
  usage carried over, sign-out, 90-day idle, export, delete leaves
  nothing, retention, and no email / PIN / code in any log line.
- **In the browser preview, 375 px, against `wrangler dev` with a local
  D1:** no request to the proxy while signed out; Create an account (age
  with no default, email with the two links, code with the 60 s resend,
  weak PIN refused, PIN twice); session cookie not readable by the page
  and no token in storage; first sync uploaded 20 records; an edit synced
  within the debounce; reload opens on "Stack'd is locked", a wrong PIN
  says how many tries are left, the right one opens the app; sign out
  with Keep a copy keeps the data and ends the session on the server;
  signing in again with data on both sides shows Merge / Use my account
  with counts, and Merge keeps the 30-day copy with its Restore row.
- **Not verified:** no screenshots (the pane could not draw this
  session), so layout and dark mode are unchecked; desktop width not
  walked; both phones (no secure-storage or biometric plugin yet, so the
  shells offer no sign-in); a real mail provider; two real browsers at
  once; 500 / 500 / 50 records timing (AC-05.11); Remove from this
  device and Delete account in the browser (covered by the proxy tests
  and the code path only).

## Engineer's check: 2026-11-16, phases 34 and 35 (shared boards)

Not the QA walk and not the release gate; nothing deployed;
`/security-review` not run on these changes.

- **Automated:** `npm run check` green (check-sync now also shares a board
  from the app, has a second person accept and add a card, receives an
  invitation, loses a board its owner deleted, and deletes one for
  everyone); `proxy` `npm test` green with `test/sharing.mjs`.
- **In the browser preview against `wrangler dev`, 375 px:** New board →
  Personal / Shared; a bad address refused in place; the board created
  with the "Shared" mark; the people sheet (owner, invited, Withdraw /
  Remove, Invite people); a second person (scripted over HTTP) accepted
  and added a card, which appeared after a sync, and the mark became
  "Shared · 2"; an invitation from that person showed as a card in the
  menu with a dot on the Boards button and its spoken label, Accept
  added the board, and being removed took it away with "You are no
  longer on …"; Settings › Shared boards listed it; Delete for everyone
  from the board row's Delete key left the board in Deleted › Boards with
  its card and the other person got `gone`. **1280 px:** the mark and the
  people sheet in the desktop header, the account line in the sidebar.
  No console errors.
- **Not verified:** screenshots (still unavailable), dark mode, two real
  people on two devices, the phones (no sign-in there yet), the
  signed-out "Sharing needs an account" path in the browser.

## Engineer's check: 2026-11-16, phase 29 (legal surface, draft)

- **Automated:** `npm run check` green; `check-origins` reports 5
  placeholders in `privacy.html` and 3 in `terms.html` and would fail at
  `VERSION` 1.6.0; the effective dates match `src/legal.js`; no inline
  script in the three pages; `npm run build -- --site` copies the deletion
  page.
- **In the preview, 375 px:** the three pages load with no console error
  and no sideways scroll; the plan cards show the renewal line above the
  button; the Meetings & AI disclosure reads the signed-in variant with
  the policy link; Settings › Account shows the two links. The new dates
  made the existing local account show "The Terms or the Privacy Policy
  changed", sync paused with that reason, and Read and accept resumed it.
- **Found on the way:** after an edit, a browser that had the service
  worker kept running the old files until it was cleared. Expected with
  stale-while-revalidate and a `VERSION` that has not changed; the release
  bump handles it, nothing to fix.
- **Not verified:** the pages in dark mode by eye; a lawyer's read.

## Security review: 2026-11-16, all of 1.6.0, before the release

- **Reviewed:** `main` (`81f75f8`) to `release/1.6.0` (`25c6872`): every
  1.6.0 phase (23 to 35), 86 files, the proxy included. This is the review
  AC-13.1 asks for before `VERSION` changes; the targets of AC-13.5 were
  given to the reviewer by name.
- **How:** `/security-review` in Claude Code: one pass that traced the
  code, then a second, independent pass on each candidate finding. Both
  read the code; neither ran an exploit. The fix below was then tested
  against the Worker (proxy tests, `check-sync`) and in the browser
  preview against `wrangler dev`.
- **Result: one finding, rated high (confidence 9/10), fixed.**
- **Finding 1: a shared board could be opened under someone else's board
  id.**
  - *What:* `POST /v1/spaces` took the space id from the client, checking
    only that no space had it. Board ids are predictable: every new device
    has the samples `work`, `personal`, `shopping` and `family`, and a
    deleted space's id is known to its former members. Anyone who knew a
    person's email could open a space called "Work" under the id `work`
    and invite them. When that person tapped **Accept**:
    1. their device attached the space to its own Work board (`setShares`);
    2. it uploaded that board and every card on it into the attacker's
       space (`collect` chose the scope by id alone);
    3. it removed them from the personal records.
    Deleting the space afterwards then wiped the board from all of the
    victim's devices.
  - *Fix, server:* the server makes the id (`s_` and 16 random
    characters, `proxy/src/spaces.js`) and ignores any id the client
    sends; `createShared` (`src/share.js`) builds the board under the id
    it gets back.
  - *Fix, app (defence in depth):*
    - `setShares` (`src/store.js`) updates boards that are already shared
      and never turns a personal board into a shared one.
    - `collect` (`src/sync.js`) gives a space its board only when the
      board on the device is the shared one.
    - `applyInbound` ignores a space whose id is a personal board on the
      device, and never changes or deletes a card that the device holds
      on another board.
  - *Tests:*
    - `proxy/test/sharing.mjs` checks that a sent id (a former space's,
      and `work`) is ignored.
    - `check-sync` forces the collision in the database and checks that
      the personal board and its cards stay personal and nothing from the
      space lands on it. That check fails with the app fix taken out.
- **Looked at closely and cleared (AC-13.5):**
  - *Sign-in endpoints and their rate limits.* The email code is six
    random digits, kept as an HMAC and compared in constant time; it lasts
    10 minutes and allows 5 tries, counted in the database. The ticket is
    32 random bytes, kept as its hash and tied to its email. The PIN
    allows 5 tries, counted on the server for all devices.
  - *How the code, the PIN and the session are stored.* The PIN is kept
    as PBKDF2 (100k rounds) of a peppered HMAC with its own salt; a reset
    needs an email ticket and signs out every device. The session token
    is 32 bytes, kept only as its hash, and expires after 90 days idle.
    On the web the cookie is `HttpOnly; Secure; SameSite=Strict;
    Path=/v1`.
  - *One account cannot reach another's records.* Every personal query is
    bound to the session's user. Space records are keyed by space and
    checked against membership. Only the owner invites, removes or
    deletes, and an invitation is answered only by the email it was sent
    to.
  - *Cookie and cross-origin rules.* Origins come from an exact allow-list
    and are never reflected. A cookie request needs an allowed `Origin`.
    The custom `X-Stackd-App` header forces a preflight.
  - *Secrets absent from the repository and the client.* `.dev.vars` and
    `.wrangler/` are ignored by git. The peppers in `wrangler.dev.toml`
    are marked as public placeholders. `check-origins` finds no
    key-shaped string in 122 files.
  - *Logs (AC-11.7).* Only error messages, stacks and retention counts
    are logged, never an email, a code, a token or content. The server
    tests check the captured output for emails.
  - *Merge, sync and import as outside input.* Every incoming record is
    rebuilt field by field (`cleanRemote`), and every name, email and card
    title is drawn through `esc()`. Note bodies are sanitised. SQL values
    are always bound, and table names come from constants.
  - *Also cleared.*
    - The developer mail endpoint needs `DEV_MAIL=1`, the stub provider
      and a localhost host.
    - The service worker caches same-origin GETs only.
    - The workflows run on push or by hand, with read-only tokens.
    - Account deletion leaves no row behind.
- **Accepted, not fixed (below the bar, with the reason):**
  - An account's id was accepted as an anonymous subscriber id, which gave
    its AI allowance without a session. The id is 24 random characters
    and is returned to no one else, so there was no way to learn it.
    *Fixed afterwards:* a request without a session whose subscriber id is
    an account's gets `401 signed_out` on every AI route
    (`proxy/src/index.js`). The app always sends the device's own id there,
    so no real client is affected; `proxy/test/accounts.mjs` checks the
    four routes and fails without the fix.
  - A space's card can land on the first personal board of a member whose
    device has not received the space's board record yet (the
    `firstBoard` fallback in `cleanTask`). This lets someone put content
    on the board but not read anything. *Fixed afterwards:* such cards wait
    on the device, unapplied, until their board arrives (`applyInbound`,
    `src/sync.js`), and a space card is never applied to another board;
    `check-sync` sends cards before their board and fails without the fix.
  - The production `ALLOWED_ORIGINS` listed `http://localhost:8123` and
    `:8124`. This could not be exploited, because the cookie is
    `SameSite=Strict` and the shells send a bearer token. *Fixed
    afterwards:* the ports are gone from `proxy/wrangler.toml` (local runs
    use `wrangler.dev.toml`), and `check-origins` fails if a localhost
    port comes back.
- **Not covered by this review:** the iOS and Android shells with the
  secure-storage and biometric plugins, which are not chosen yet. They
  need their own review before the shells offer sign-in.

## Security review: 2026-11-16, the fixes, before the TestFlight build

- **Reviewed:** what changed on `release/1.6.0` after the full review above
  (`25c6872`): `2797a23`, `a11b407`, `b285fe3` and `2d14d04`, plus the
  README for 1.6.0. `VERSION` is unchanged (`stackd-v1.5.0`); this is a
  test build, not the 1.6.0 release.
- **How:** these commits are the review's own findings being fixed.
  Each was read against the `/security-review` criteria when it was
  written. Each comes with a test that fails without it: `sharing.mjs` and
  `check-sync` for the space ids and held cards, `accounts.mjs` for the
  subscriber id, `check-origins` for the origin list. The full multi-agent
  run was not repeated.
- **Result: no new finding.**
  - *Server-made space ids.* The id comes from the server's CSPRNG
    (`newId`), and the client's `boardId` is ignored. The app checks the
    returned id against the id pattern before using it.
  - *Origins.* The list only got shorter, plus `https://localhost`. That
    origin is not exploitable for the same reason as before: the cookie is
    `SameSite=Strict`, and the apps send a bearer token.
  - *Held cards.* The held changes are the server's own answers, cleaned
    by `cleanRemote` like every other change when they are applied. They
    live only in the sync document of that space and go when the space
    goes.
  - *Subscriber id.* There is one more bound query, and its database
    error path answers 500 without detail.
- **What the build contains for testers:** the kanban, navigation and
  board changes. Sign-in stays hidden in the apps until the
  secure-storage plugin is chosen, so accounts, sync and shared boards
  cannot be tried from this build. The Privacy and Terms links point to
  `app.stackdplatform.com`, which is not deployed yet.

## Owner's manual test: 2026-11-17, TestFlight build 10

The owner walked `docs/prd-improvements.md` on an iPhone (build 10,
`078f110`). These criteria passed as built: AC-01.1–01.4, 02.1, 02.3,
02.4, 03.1, 03.2, 04.1, 04.3, 04.5, 04.6, US-05, 07.2, 07.4, 08.1–08.3,
09.3, 10.1–10.8, 12.1. AC-11.1 was not tested.

Changed after the test (architecture §48; the PRD marks each with the date):

| Point | What was found | What was done |
|---|---|---|
| AC-02.2 | Done's disabled "⋯" | No lane has a "⋯". Lanes are dragged by holding them outside their cards, a long hold gives the X, and removal asks first. Cards go to the leftmost lane, or to Deleted if only Done is left; Backlog comes back on the next card (AC-02.5–02.7). |
| AC-04.2 | The card's X sat high | Halfway down the card. Measured 30.3 px above and below on a 75 px card. |
| AC-04.4 | "Delete" looked low in the red button | Dialog labels trimmed to cap height. In Chrome: 18.2 px above and below on a 48 px button. Safari supports the trim from iOS 18.2. |
| US-04 | No way back from an open card by swiping | Swipe right: the card slides off over its board (AC-04.7). |
| US-06 | Hint under Boards in the menu | Removed. |
| AC-07.1 | The menu jumped in | It follows the finger, with the page dimming, and springs back if released early. |
| AC-07.3 | A swipe on a done task, a note, a meeting, an archived row or a Settings card opened the menu | Nothing happens on items. It works from gaps and titles, and always from the left edge. |
| AC-09.1 | The tiles sat in a large white sheet | The tiles alone over the blurred page, rising in turn. |
| AC-09.2 | Board not visible in New task | Board is the first row, preselected. |
| AC-09.2, AC-10.9 | A black area around the iPhone keyboard (note, board name) | The iOS workflow gives the window the app background, and the keyboard follows the theme (AC-09.4). **To check on the next build.** |
| AC-12.2 | Sign-in appeared in the app; the year wheel opened over the question; then "No connection" | The app should not offer sign-in yet: New board › Shared › Sign in skipped the check. It is now checked on every way in, and New board does not ask Personal or Shared in the app. The year list stays closed until tapped. "No connection" was the live Worker, which has no accounts deployed; expected. |
| AC-12.11 | Terms and Privacy open nothing | Their address, `app.stackdplatform.com`, is not deployed yet. Left for the website work. |
| US-13 | Not testable | It is the release process (security review per release; entries in this report), not an app feature. |

- **Verified in the browser preview** (375 × 812, touch emulation, real
  pointer and touch events):
  - lane drag, drop bar and saved order;
  - lane X, removal to the leftmost lane, removal to Deleted, Backlog
    returning;
  - the card X centred;
  - swipes doing nothing on a row and on a Settings card, opening from the
    edge and from a gap, a slow short swipe springing back, the card swipe
    showing its board underneath;
  - the "+" grid;
  - the Board row first;
  - the sign-in guard with a simulated app;
  - the birth-year focus.
- **Checks:** `npm run check` passes, with new store checks for lane
  removal, Backlog returning and lane reorder.
- **Not verified:**
  - real finger timing;
  - the keyboard background (iOS only);
  - Safari's rendering of the trimmed labels.
- **Security:**
  - no new request, storage or permission;
  - the tiles' `style="--i"` attribute is allowed by the existing
    `style-src 'unsafe-inline'`;
  - the workflow change edits only the generated `AppDelegate.swift`;
  - the sign-in fix removes a way into a flow the device cannot complete.

### Owner's review of build 11 (2026-11-18): the keyboard surround

- **Seen:** a light app on a phone in dark mode still had a dark band around
  the keyboard's rounded corners, and the keyboard was dark. Sampled from
  the screenshot: #0c0f18, the app's dark background.
- **Cause:** the build-11 patch did land, but it picked light or dark from
  the phone. `Keyboard.setStyle` never ran at launch: `applyTheme`
  returned early because `pretheme.js` had already set `data-theme`.
- **Fix** (architecture §48):
  - `theme.js` always tells the shell the app's setting;
  - the iOS workflow adds a `stackdTheme` handler that sets the window's
    light or dark (unspecified for 'system').
- **Verified:**
  - the workflow step run against Capacitor's own iOS template: the import,
    the launch call and the class land, and the step's guards pass;
  - in the browser preview, `data-theme-setting` is set at launch;
  - a stub handler receives light, dark, system and light as the setting
    changes, and nothing when it does not.
- **Not verified:** the Swift compiles only in CI; the look on a device
  comes with the next TestFlight build.
- **Security:**
  - the handler accepts three fixed strings and only changes light or dark;
  - no new request, storage or permission.

### Owner's review of build 11 (2026-11-18): the swipe to the right

- **Seen:** the swipe stutters while dragging, and two bottom bars and two
  "+" show during it. The owner chose to tune the current swipe (not to
  rebuild it on native scrolling), for both swipes, with the bottom bar
  staying in place.
- **Measured before** (preview, 375 px): the event that recognised the
  swipe took 19.4 ms, building the whole menu. The moving layer had 127
  nodes, the bottom bar and two frosted elements.
- **Fix** (architecture §48): layers built when the finger lands, nothing
  frosted in a moving layer, fades as their own layers, the bottom bar
  left in place, the swipe claimed after 8 px.
- **Measured after:** the recognising event takes 1.9 ms (menu) and 2.8 ms
  (open card). The menu layer has 91 nodes, no bar and nothing frosted.
- **Verified in the preview:**
  - one bottom bar and one "+" during both swipes;
  - the Boards tab lights up at release, and the menu opens;
  - a short swipe springs back; a tap and a vertical move leave no layer;
  - a touch the page is already scrolling starts no swipe;
  - the open card slides off its board, and nothing is left behind;
  - no console errors; `npm run check` passes.
- **Not verified:** the frame rate on an iPhone, which only a TestFlight
  build shows. A web view may also limit finger-following to 60 frames a
  second, which this change cannot lift.
- **Security:** no new request, storage or permission.

### Apple's SDK warning on builds 11 and 12 (2026-11-18): ITMS-90725

- **Seen:** App Store Connect accepted both builds with a warning: built
  with the iOS 26.5 SDK, and from April 2027 only the iOS 27 SDK (Xcode 27)
  or later is accepted.
- **Fix:** `ios-testflight.yml` runs on GitHub's `xcode-27` image, selects
  the newest released Xcode on it (never a beta or a release candidate) and
  fails if the iOS SDK is older than `MIN_IOS_SDK` (27).
- **Checked here:** the selection picks 27.2 from the image's list and
  skips beta and release-candidate names; the guard passes 27.2 and refuses
  26.5. The installed Capacitor template already has a scene delegate.
- **Test build** (run 13, commit 59de0fe, no upload): Xcode 27.2 (27B52),
  iOS SDK 27.2. Capacitor 8.5, the pods and the `AppDelegate.swift` patch
  compile; archive, signing and the .ipa checks pass.
- **Not verified yet:** how a build made with the iOS 27 SDK looks and
  behaves on the phone. That comes with the next TestFlight upload.
- **Limits:** the image is a GitHub "preview", so runs may queue. Apple
  raises this floor every spring, so the warning returns for the next SDK.

### Store age signals, phases 2 to 4 (2026-11-19)

- **Built** (`docs/prd-age-signals.md` §10):
  - the plugin `@capawesome/capacitor-age-signals` 0.5.1, reviewed and
    pinned;
  - `src/agesignal.js`;
  - the sign-in, paywall and approval gates;
  - the plugin checks in both workflows, and the iOS entitlement behind
    `vars.IOS_DECLARED_AGE_RANGE`.
- **Checks:** `npm run check` passes, with the new `check-age`.
- **Preview** (fake store answers): every gate behaves as specified; no
  console errors.
- **Not verified:** the paywall gate (no store purchases on the web), any
  device, the native builds with the plugin.
- **Security:**
  - the plugin was read before it was installed, and the installed copy
    matches;
  - the age answer stays in memory and is never sent;
  - the fake is reachable only from code, and the plugin's own fake refuses
    release builds;
  - no new request from our code.

### Build 14 (2026-11-20): a beta Xcode behind a plain name

- **Seen:** build 14 (commit 253b317) passed and uploaded, but its log
  shows `Xcode 27.3`, build 27C5020n, archived from
  `/Applications/Xcode_27.3_beta.app`. The image links `Xcode_27.3.app`
  and `Xcode_27.3.0.app` to the beta, and the selection filtered only the
  names, so it picked the beta.
- **Effect:** Apple does not accept builds made with a beta Xcode for App
  Store release; build 14 may also be refused for TestFlight testing.
  Build 15 should replace it.
- **Fix:** the selection resolves each name to the real app (`pwd -P`)
  before leaving out betas and release candidates.
- **Verified on build 15** (run 44689614793, commit d9dc63b, uploaded): with
  the same image (27.3 beta linked under plain names), the selection picked
  Xcode 27.2, build 27B52, iOS SDK 27.2, and every compile and link step
  ran from `/Applications/Xcode_27.2.app`.
- **Also from build 14:** the age-signals plugin compiled and signed with
  Xcode 27; the entitlement step was skipped, as intended.
