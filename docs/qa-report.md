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
