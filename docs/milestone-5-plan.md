# Milestone 5 plan: Stride rating

Status: **approved by the owner on 17 October 2026**, with the estimated Stride added (decision 10, PRD 1.3).

PRD: section 4 (the rating), 4.4 (anti-gaming), 5.2 (tier on the leaderboard), 8.2 (`rating_history`: owner reads, database function writes), 10 (anti-cheat), 11.6 (screenshot runs never affect Stride), 13.3 (Home and You screens), 14 (M5).

PRD acceptance: "unit tests cover the formula, the 150-point weekly fall cap, the 60 and 120 day windows and placement; sandbagging runs do not lower Stride."

## Read this first: what runners will see in the MVP

Stride counts **verified runs only** (PRD 4.3, 10, 11.6): runs synced from Apple Health or Health Connect. Health sync is the parked part of milestone 3. So until that is finished, every real runner will show **"Placing 0 of 3"**, and nobody will have a Stride number. Typed-in and screenshot runs can never count, by design.

Milestone 5 can still be built and fully tested now: the database tests create verified runs directly, through the same `record_run` function Health sync will use. The moment Health sync lands, ratings appear with no further work. This makes the parked milestone 3 work (an Android phone, or the Apple Developer account) the real gate for Stride being visible.

## What gets built

### 1. Database (migration 8, `stride`)

**New table `rating_history`** (PRD 8.1). One row each time a runner's Stride is calculated:

| Column | Meaning |
|---|---|
| `id` | Random ID |
| `user_id` | Whose rating |
| `run_id` | The verified run that caused this calculation (PRD 4.4) |
| `stride` | The Stride shown after this run, 0 to 3000 |
| `calculated` | What the formula gave before the weekly fall cap |
| `speed_score`, `volume_score` | S and W, 0 to 1, so every number can be explained |
| `t5_median_s` | The 5 km-equivalent time the speed score used |
| `weekly_km` | Average weekly verified km over the last 4 weeks |
| `window_days` | 60 or 120 |
| `created_at` | When |

**Two new columns on `profiles`:** `stride` (empty until placed) and `placement_runs` (0 to 3). Written only by the database function below; nobody can write them through the API, including the server role.

**Functions:**
- `private.stride_score(t5, weekly_km)`: the pure formula (steps 2 to 4 of PRD 4.3). No data access, so it can be tested on its own with exact numbers.
- `private.recalculate_stride(user, run)`: the single function that recalculates a runner's Stride (PRD 4.4). It reads their verified runs, applies the windows, placement and fall cap, writes `rating_history` and updates `profiles`. It cannot be run by any API role.
- `record_run` (changed): after saving an **accepted Health run**, it calls `recalculate_stride` in the same transaction. Typed-in, screenshot, flagged and duplicate runs never trigger it. This also fixes the cosmetic lint warning from milestone 4.
- `league_standings` (changed): also returns each runner's `stride` (empty if unplaced), so the table can show the tier next to the name.

**Who can see what** (PRD 8.2 and 4.1):

| Data | Who can read | Who can write |
|---|---|---|
| `profiles.stride`, `placement_runs` | Anyone signed in, like the display name ("shown on every profile") | Only `recalculate_stride` |
| `rating_history` | The runner themselves only (row-level security with the live-session check) | Only `recalculate_stride` |
| Stride in the league table | Members of that league (existing membership check) | |

No new Edge Functions and no new rate limits: nothing new can be sent to the server. Stride changes only as a side effect of a verified run.

### 2. App

| File | What |
|---|---|
| `src/lib/stride.ts` | Tier from a number (Rookie 0 to 699 ... Elite 2200 to 3000), "Placing 1 of 3", chart scaling. Pure, unit tested. The formula is **not** copied here: the database is the single source of truth |
| `src/api/stride.ts` | Read your own history |
| `src/components/StrideSummary.tsx` | Big Stride number in the display font with the tier beside it, or "Placing 1 of 3" with one line on what counts |
| `src/components/StrideChart.tsx` | History chart drawn from plain views (bars on the spacing scale), so no chart package is needed |
| Home tab | Your Stride under your name (PRD 13.3 screen 3) |
| You tab | Stride, tier, history chart, and a short "How Stride works" explainer (PRD 13.3 screen 8) |
| League table (`StandingsTable`) | Tier as a word next to the name (PRD 5.2; Appendix B #9 allows tiers next to names, never as a pill over a title) |

## How the rules will work (PRD 4.3 and 4.4, with the gaps filled in)

1. **Qualifying run:** from Health, accepted (passed every check), 3 km to 21.1 km inclusive.
2. **5 km equivalent:** `t5 = t x (5000 / d) ^ 1.06` (Riegel).
3. **Speed window:** the last 60 days. If there is no qualifying run in the last 30 days, the last 120 days.
4. **Speed:** the median of the best three `t5` in the window, then `S = clamp((5000 / t5 - 1.85) / (6.41 - 1.85), 0, 1)`.
5. **Volume:** `W = min(verified km in the last 28 days / 4 / 60, 1)`.
6. **Stride:** `round(3000 x (0.75 S + 0.25 W))`. Checked against the PRD's reference points: a 25 minute 5 km runner doing 15 km a week scores 919; a 20 minute runner doing 40 km a week scores 1643.
7. **Placement:** "Placing n of 3" until three qualifying runs in the last 120 days. Once placed, always placed.
8. **Slow fall, instant rise:** a rise applies at once. A fall is limited so that Stride is never more than 150 below its highest value in the last 7 days.
9. **Sandbagging:** slow runs never lower Stride, because only the best three efforts count (tested with ten deliberately slow runs).
10. **Recalculation:** after every verified run, in the single database function, inside the same transaction as the run.

## Decisions for the owner

The PRD leaves these open. My recommendation comes first in each.

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | Nothing is visible until Health sync exists (see the top of this plan) | **Accept**, as the PRD says | Letting typed-in or screenshot runs count would make Stride gameable (PRD 10, 11.6) |
| 2 | What exactly is "at most 150 points per week"? | **Never more than 150 below the highest Stride in the last 7 days** | The stricter reading. A looser one ("150 below where you were 7 days ago") lets someone rise then drop 400 in a week |
| 3 | The window has fewer than three qualifying runs (for example back from injury with one run) | **Widen to 120 days. If still fewer than three, the speed part can rise from the runs there (using the slower of two; one run alone changes nothing) but cannot fall** | "Median of the best three" needs three. Without this rule, adding a slow run to a thin window could lower Stride, which is sandbagging by another route |
| 4 | Placement: three qualifying runs ever, or recent? | **Three in the last 120 days**, then placed for good | A rating built from runs a year old would be wrong on day one. 120 days matches the history import |
| 5 | Volume: all verified km, or only qualifying runs (3 to 21.1 km)? | **All verified km** that passed the checks | The PRD says "average weekly verified km", and a 25 km long run is real training volume |
| 6 | Recalculate only after runs, or also nightly? | **Only after runs**, as the PRD says | Simple, and every change has a run that caused it. The cost: a runner who stops running keeps their Stride rather than decaying. A nightly job can be added later if the Arena (version 2) needs it |
| 7 | Who sees a runner's Stride? | **Anyone signed in**, like the display name. History: only the runner | PRD 4.1: "shown on every profile and next to names on leaderboards" |
| 8 | History chart | **Bars drawn from plain views, no new package** | A line chart would need `react-native-svg` (Expo-maintained). Ask again in the design pass if the bars look too plain |
| 9 | Where the formula lives | **Only in the database** | One source of truth, and clients can never compute or write a rating (PRD 4.4). The app only turns numbers into tier names |
| 10 | Estimated Stride (owner, 17 October 2026) | **Added (PRD 4.5).** Two answers (recent 5 km time or "not sure", typical weekly km) give an estimate from the same database formula, shown with "est." Answers private, estimate public. Never counts for anything; closed and replaced at placement; "You said Pacer. Your runs say Strider." | Removes the empty "Placing 0 of 3" for new runners without letting self-reports touch the real rating (a boastful estimate would otherwise take weeks to fall at 150 a week) |

## Tests

**Database (pgTAP, new `06_stride.test.sql`)**, covering the PRD acceptance:
- **Formula:** both PRD reference points (919 and 1643); the limits (a 5 km slower than 45:03, which is 1.85 m/s, gives S = 0; faster than 13:00, which is 6.41 m/s, gives S = 1; volume capped at 60 km a week; Stride 0 to 3000); the Riegel conversion for a 10 km and a half marathon.
- **Qualifying runs:** 2999 m does not count, 3000 m and 21100 m do, 21101 m does not; typed-in, screenshot, flagged and superseded runs never count and never trigger a calculation.
- **Windows:** a fast run 61 days ago is ignored when there is a run in the last 30 days; it counts (120-day window) when there is not; a run 121 days ago never counts.
- **Placement:** 0, 1, 2 then 3 runs; "placed for good" once a run ages out.
- **Fall cap:** a big drop is limited to 150 below the 7-day peak; it continues falling the next week; a rise applies in full at once; the peak rule closes the rise-then-drop loophole.
- **Sandbagging:** ten slow runs after placement leave Stride unchanged; a thin window (decision 3) cannot be used to lower it.
- **History:** every calculation is in `rating_history` with its run.
- **Access:** a runner reads only their own history; league-mates and other users get nothing; signed-out visitors get nothing; nobody can write `stride`, `placement_runs` or `rating_history` through the API, including the server role; `recalculate_stride` cannot be called by any API role.
- **Baseline:** the new table, grants and function list added to `00_security_baseline` on purpose.

**Unit (`tests/unit/stride.test.ts`):** tier boundaries (699 and 700, 2199 and 2200, 0 and 3000), placement text, chart scaling.

**Integration:** through the real API with two runners: own history readable, someone else's not; `profiles.stride` visible to a signed-in user; the league table carries Stride; direct writes refused. (Verified runs are seeded through `record_run` in the database, since Health sync does not exist yet.)

**Mutation checks:** break the fall cap, let a typed-in run count, and grant history to everyone; each must fail a test.

**Hosted:** the new database tests on the dev project, and Stride columns spot-checked in `check:hosted`.

**Before calling it done:** all suites, CI, Appendices A, B and C item by item, and screenshots of the new Home, You and league table views in light and dark mode (by the owner or Charles, since this Mac has no simulator).

## Order of work

1. Migration 8 and the database tests (the rating itself).
2. App: summary, chart, Home, You and the league table tier, with unit and integration tests.
3. Deploy to dev, hosted checks, review.

## Not in this milestone

Handicap duels and the "unplaced runners cannot duel" rule (milestone 6), the fitness trend chart and race predictions (milestone 7, Pro), Health sync itself (milestone 3, parked), and any nightly recalculation (decision 6).

## Progress

| Step | Status |
|---|---|
| 1. Migration 8 (`stride`) and database tests | Done, committed (`9d89412`). 53 tests; four mutation checks caught |
| Estimated Stride | Built: PRD 1.3, migration 9 (`stride_estimate`, `set_stride_estimate`), profile Edge Function (`estimate` on create, `estimate` action), 17 database tests, integration tests |
| 2. App | Built: `src/lib/stride.ts`, `StrideSummary`, `StrideChart`, `EstimateForm`, onboarding step 3 of 4 (optional), estimate screen, Home, You and league table tier. 100 unit, 310 database and 135 integration tests pass |
| 3. Deploy to dev, hosted checks, review | Next |
