# CLAUDE.md

Standing instructions for every Claude Code session in this repository.

## Before any work

1. Read `PRD.md` completely, including Appendices A, B and C. It is the source of truth. If this file and the PRD disagree, the PRD wins. Point out the conflict to the owner.
2. Find the current milestone (see "Milestone status" below and PRD section 14). Build **one milestone at a time**. Do not start the next milestone, or any part of it, until the owner has approved the current one as done.
3. Before writing code for a milestone, give the owner a plain-English plan (files, tables, access rules, tests) and wait for approval.

## Milestone status

| Milestone | Status |
|---|---|
| M1 Foundations | Done. Approved by the owner on 10 October 2026. See `docs/milestone-1-review.md`, including its open items |
| M2 Leagues | Done. Approved by the owner on 10 October 2026. See `docs/milestone-2-review.md` |
| M3 Runs | **Parked** (owner decision, 10 October 2026). Built, tested and deployed: tab bar, runs database, checks, duplicates, standings, manual entry. Waiting for an Android phone or the Apple Developer account: development build, Health sync (with history import), Apple and Google sign-in. See `docs/milestone-3-plan.md` |
| M4 Screenshot reader | In progress (started while M3 is parked, with the owner's approval) |
| M5 to M9 | Not started. Do not build. |

**Parked milestone reminder (owner instruction):** while any milestone is parked, begin every reply to the owner with a one-line reminder of what is parked and what it is waiting for. Before TestFlight, the parked M3 items must be finished: Apple requires Sign in with Apple, and PRD 5.1 requires Apple and Google sign-in to work before TestFlight.

Update this table when the owner approves a milestone as done.

## Standing rules (PRD section 0)

- Build in the milestone order in PRD section 14. Finish and test each milestone before starting the next.
- Sections 9 (security), 10 (anti-cheat) and 11 (AI safety) are requirements, not suggestions. Never weaken, skip or "temporarily" disable them to make something work. If a requirement blocks progress, stop and explain the problem.
- Ask before adding any library, service, package or feature not named in the PRD. This includes dev tools and test runners.
- Explain what each piece does in plain English when you build it. After each step, say what was built and why. The owner must be able to explain every security decision.
- All user-facing copy is UK English. Never use em dashes (U+2014) anywhere: copy, code, comments or docs. No emojis in headings or buttons.
- Out-of-scope items (below) must not be built, even partially.
- Only create the database tables the current milestone needs.
- Appendices A, B and C apply to every milestone. Before saying a milestone is done: run all tests, list every item in A, B and C that applies to what the milestone built, and say how each one is met.

## Running the checks

Needs Docker Desktop running and the local stack started (`npx supabase start`).

| Command | What it checks |
|---|---|
| `npm run typecheck` | App and test code types |
| `npm run typecheck:functions` | Edge Functions, with Deno |
| `npm run test:unit` | Pure logic: env guard, secure storage, contrast, age check, validation |
| `npm run test:db` | pgTAP: RLS on every table, exact grants, function permissions, constraints, rate limiter |
| `npm run test:integration` | Real API calls as two users against the local stack (the milestone 1 acceptance test) |
| `npm run lint` | ESLint with Expo's rules, no warnings allowed |
| `npm run design:check` | Appendix B: em dashes anywhere; gradients, blur, banned fonts and icons, emojis, raw colours and spacing in app code |
| `npm run audit:check` | npm audit, with dated exceptions in `audit-exceptions.json` |
| `npm run audit:functions` | Edge Function packages (deno.json): audited, and supabase-js kept equal to the app's |

CI (`.github/workflows/ci.yml`) runs all of these on every push, plus gitleaks over the whole Git history.

When a migration adds a table, function or grant, update the expected lists in `supabase/tests/database/00_security_baseline.test.sql` in the same change. That test failing is the point: it makes every new permission a deliberate decision.

## Supabase rules

- Development project: London (`eu-west-2`). Never public, never holds real user data. Production project is created only in M9, from the same migrations.
- Row-level security is on for every table from the migration that creates it. Deny by default.
- New tables are **not** automatically exposed to the API. Every table gets explicit, minimal grants in its own migration, matching PRD section 8.2. Grant only the columns and operations actually needed, and only to the roles that need them.
- If you hit a permission error, explain the cause to the owner. **Never fix it by granting broad access** (no `grant all`, no blanket grants to `anon` or `authenticated`, no disabling RLS, no `using (true)` write policies).
- Any `security definer` function sets a fixed, empty `search_path`, checks who called it, and has `execute` revoked from `public`, `anon` and `authenticated` unless a caller genuinely needs it.
- Clients never insert or update runs, ratings, memberships, duels or subscriptions directly. Those go through Edge Functions that validate input.
- All schema changes are migrations in `supabase/migrations`. Never change the dev schema by hand in the dashboard.

## Security rules (PRD section 9, summary)

Access control
1. RLS on every table, matching section 8.2. A table without RLS fails the build.
2. Every Edge Function reads the user from the verified auth token. Never trust user IDs, roles or league IDs sent by the app without checking on the server.
3. The service role key exists only in Edge Function secrets. The app ships with the public anon key only.
4. Database roles have the minimum permissions needed.
5. No admin screens, routes or functions in the app. Admin work happens in the Supabase dashboard behind two-factor login.

Input handling
6. Every Edge Function validates input with a strict zod schema and rejects unexpected fields.
7. No SQL is ever built from strings containing user input. Supabase client, parameterised queries or database functions only.
8. User text is shown as plain text, length-limited and character-restricted.
9. File uploads: type and size checked server-side, re-encoded, metadata stripped, private bucket, signed links expire after 5 minutes.

Rate limits
- Every endpoint returns HTTP 429 with a retry time when a limit is hit. Limits apply per user and per IP. See the table in section 9.3.

Secrets and code
10. No secrets in the app bundle, in Git or in logs. Never put the service role key, database password or any secret in the app, in `.env` or in a commit. Only `.env.example` with placeholder values is committed. gitleaks runs on every commit and over the whole history in CI.
11. Logs never contain tokens, passwords, emails, health data or full request bodies.
12. Users see generic error messages with a reference code. Detailed errors go only to the error reporter.
13. Production builds ship without source maps or debug screens.
14. Tokens are stored with expo-secure-store, never plain storage.
15. `npm audit` and Dependabot. No unmaintained packages.

Webhooks and payments
16. Webhooks verify their signature or authorisation header before doing anything.
17. Subscription status is only ever read from the server.

Resilience
18. Daily backups with a tested restore before any external user joins.
19. Alerts on error spikes and unusual API spend.
20. `audit_log` records sensitive actions.
21. Written breach plan: report reportable breaches to the ICO within 72 hours.

## Out of scope for version 1 (PRD section 3): never build, even partially

- Public matchmaking against strangers (the Arena) and weekly lobbies
- Forfeits, forfeit videos or any user video
- Any real money: stakes, pots, payouts, wallets, transfers
- Prize events, sponsors, run clubs
- Chat or messaging between users
- User-uploaded profile photos (preset avatars only)
- Strava API integration
- A web app version
- Any AI feature other than the screenshot reader
- Storing GPS routes or any location trail from a run
- Height, weight or body composition, and any comparison or advice based on them
- Training plans that change day by day, injury diagnosis or any medical advice

Also everything in PRD section 15 (future versions).

## Banned design (PRD section 13.2 and Appendix B)

None of these may appear anywhere: app, store screenshots or any website. `scripts/design-check` enforces what it can in CI.

| # | Banned | Do this instead |
|---|---|---|
| 1 | Purple-to-blue gradients | Flat near-black and off-white with one orange accent |
| 2 | Gradient text in headings | Solid colour headings in the condensed display font |
| 3 | Emojis in headings or buttons | Words only. Native icons, used sparingly |
| 4 | Inter as the only font | Barlow Condensed for numbers and headings, system font for body |
| 5 | Cards with coloured borders | Spacing, background shades and thin neutral dividers |
| 6 | Glassmorphism | Solid, opaque surfaces |
| 7 | Low-contrast dark mode | Every pair meets WCAG AA (4.5 to 1 for body text) in both modes |
| 8 | Rows of three icon boxes | Real content. One idea per onboarding screen |
| 9 | Small badges above headlines | No pill labels over titles. Tiers sit next to names |
| 10 | Lucide icons everywhere | SF Symbols on iPhone, Material Symbols on Android |
| 11 | Unstyled default component libraries | Own small component set built from design tokens |
| 12 | Fade-in on scroll | Content appears immediately |
| 13 | Cursor-following effects | None |
| 14 | Buttons that only fade on press | Pressed state changes colour or size and gives a light vibration |
| 15 | Inconsistent spacing | Spacing tokens only: 4, 8, 12, 16, 24, 32, 48 |
| 16 | Em dashes in any copy | None, anywhere |
| 17 | Generic buzzword copy | Specific, number-led, British copy ("3.2 km behind Jordan") |
| 18 | Serif italic accent words | No serif fonts, no italic emphasis words |
| 19 | Space Grotesk with Instrument Serif | Not used |
| 20 | Grain texture over gradients | No textures, no gradients |

All colours, fonts and spacing live in one design tokens file. Screens use tokens only. Before a milestone is done, screenshot every new screen and check it against this table.
