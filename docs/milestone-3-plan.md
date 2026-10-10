# Milestone 3 plan: Runs

Approved by the owner on 10 October 2026.

## Order of work

1. Bottom tab bar (Home, League, You). Run and Activity arrive with step 3, completing the five tabs adopted by the owner (Home, League, Run, Activity, You; see `docs/ui-backlog.md`).
2. Database: `runs`, validation (PRD 6.4), duplicates, flagged runs excluded and queued for review in the dashboard, standings with real distances, final standings and past seasons (deferred from milestone 2).
3. Manual entry: Edge Function (10 per day), the Run tab, and the Activity tab with your runs list (status, and the reason if flagged).
4. Development build with EAS. Waits for the owner's Apple Developer Program and Expo accounts.
5. Health sync (Apple Health, Health Connect) with the health-data consent screen (PRD 12). 30 syncs per hour.
6. Apple and Google sign-in.
7. Hosted deploy, checks and the milestone 3 review.

Steps 1 to 3 work in Expo Go.

## Owner decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Tab icons | `expo-symbols` approved (may change later) |
| 2 | Accounts | None yet. Do the Expo Go work first; steps 4 to 6 wait for the accounts |
| 3 | Packages | Each one asked about separately, after checking maintenance and licence |
| 4 | Trust in "verified" runs | Accepted: the server cannot check Health data itself; mitigated by plausibility checks, duplicates, rate limits, the flagged queue and recording the source app. Stated in the review |
| 5 | Per-kilometre splits | Milestone 7 |
| 6 | Background sync | Milestone 6; milestone 3 syncs on app open and pull-to-refresh |
| 7 | What league members see | Each other's runs: distance, date and source only (PRD 8.2). Duration, times and the rest stay private |
| 8 | Duplicates | A manual run overlapping an existing run is rejected; a Health run overlapping an earlier manual run replaces it (recorded) |
| 9 | Several accounts on one device | Milestone 9, with a privacy check |
| 10 | Withdrawing health consent | Syncing stops at once; runs already synced are kept; account deletion (milestone 9) removes everything |
| 11 | Whole-month counting | Runs from the whole season count in a league, including before the runner joined (Claude's choice in step 2, open to the owner overruling) |
| 12 | History import (PRD 1.1) | Verified Health runs up to 120 days old are accepted, so placement, Stride and analytics work from day one; typed-in runs stay at 7 days. Built into `record_run` in step 2; the import itself is part of step 5 |
