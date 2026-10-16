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
