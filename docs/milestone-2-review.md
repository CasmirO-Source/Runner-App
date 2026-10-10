# Milestone 2 review: Leagues

Status: **ready for owner approval**. Milestone 2 is marked done in `CLAUDE.md` only after the owner approves this review.

- Reviewed: 10 October 2026, branch `m2-leagues`, commit `0dbce98` (plus this document).
- Development project: `svhdlybvqigqrfwywlib`. Migration 5 and four league functions applied on 10 October 2026.

## 1. What milestone 2 built (PRD section 14)

| PRD item | Built |
|---|---|
| Create | `league` Edge Function and `public.create_league`; Start a league screen |
| Invite codes and links | 10-character codes from an alphabet without look-alikes, 7-day expiry, revocable, one active code per league; share sheet message with the code and a `runnerapp://join/CODE` link |
| Join | `league-join` Edge Function and `public.join_league`, which locks the league while it counts members; Join a league screen |
| Leave, remove | `league-member` Edge Function; the owner removes, members leave, the owner leaves only as the last member (closes the league); removals and closures in `audit_log` |
| Monthly seasons | `seasons` table, one row per calendar month in Europe/London time, created by a daily `pg_cron` job; countdown on home and league screens |
| Leaderboard | `public.league_standings` and the league table screen (place, avatar, name, distance) |

Tables created: `seasons`, `leagues`, `league_members`, `invite_codes`, `private.audit_log`. Nothing from milestone 3 or later was built.

## 2. Acceptance tests

PRD: "invite codes expire and are rate-limited; non-members get nothing back from any league query."

**Met**, locally (`tests/integration/leagues.test.ts`) and on the hosted project (`check:hosted`, and the league database tests run on the hosted database).

- **Non-members get nothing.** A member of another league, and a runner in no league, get empty results reading a league's details, members, invite code and standings through the REST API, and "not found" from every Edge Function action naming that league. Members cannot do owner-only actions. Direct writes to the tables and direct calls to the server-only functions are refused. Signed-out visitors get nothing.
- **Codes expire and are revocable.** Expired, revoked, replaced and made-up codes, codes for a closed league and codes for a full league all get the same reply. A full league is never named.
- **Codes are rate-limited.** The 11th join attempt in an hour is refused with HTTP 429 (PRD 9.3: 10 per hour per user).
- **The member limit holds under pressure.** Four runners joining a league with two places left at the same moment: exactly two get in.
- **Access ends at once.** A removed member, or one who has left, sees nothing of the league straight away.

Proof the tests catch real mistakes: switching a league access rule to "any signed-in user sees every league" made 5 tests fail; a rule without the live-session check and an extra column grant were each caught by the database tests. All were reverted.

## 3. Test results (10 October 2026)

| Suite | Result |
|---|---|
| Lint, type checks (app, tests, 5 Edge Functions), design check (116 files) | Pass |
| Unit tests | 81 of 81 |
| Database tests (pgTAP), local | 152 of 152 (68 new for leagues) |
| Security baseline and league database tests, hosted dev project | 95 of 95; rolled back, no leftovers |
| Integration tests, local | 91 of 91 (30 new for leagues); 3 hosted-only skips |
| Hosted checks (`check:hosted`) | 38 of 38 (17 new for leagues) |
| npm audit gates (app and Edge Function packages) | Pass; the 2 milestone 1 exceptions still apply (review by 9 November 2026) |
| gitleaks, whole history | No leaks |
| App bundles, iOS and Android | Build; no source maps; no secret key patterns |
| CI on GitHub | Not yet run for `m2-leagues` (open item: push the branch) |
| Supabase security advisor, dev project | 2 new informational findings (section 7) |

## 4. Appendix A: items milestone 2 touches

Items not listed are unchanged from `docs/milestone-1-review.md`.

| # | Item | Status | How milestone 2 meets it |
|---|---|---|---|
| 5 | No authorisation checks | Met | Every league action checks ownership or membership in the database, inside the same transaction as the change. |
| 6 | Users accessing other users' data | Met | Two-user and three-league tests through the API (section 2), plus hosted database tests. |
| 7 | Open database permissions | Met | RLS on all five new tables from the migration that creates them; no write policies for app users; build fails if any table lacks RLS. |
| 12 | Verbose errors | Met | Database refusals are fixed codes mapped to our own messages (`_shared/dbErrors.ts`); no database text reaches users or logs. |
| 15 | Client-side-only checks | Met | One open league per runner, member limit, code expiry and ownership are enforced in the database; the app only hides buttons. |
| 16 | Missing input validation | Met | Strict zod schemas with unknown fields refused (including `owner_id`, `member_limit`, `user_id`), plus constraints on names, codes, roles and dates. |
| 17 | SQL injection | Met | All league logic is in database functions taking typed parameters; no SQL is built from user input. Junk codes are refused by format check. |
| 19 | XSS | Met | League names are shown as plain text; ASCII-only with restricted characters. |
| 28 | Missing rate limits | Met | Create league 5 per day, join by code 10 per hour (PRD 9.3), invite codes 20 per day, plus the 60 per minute per IP and per user on every function. |
| 33 | IDOR | Met | League IDs are random UUIDs. Someone else's league and a made-up ID get the same "not found", so leagues cannot be probed. |
| 34 | Trusting user-controlled IDs | Met | The acting user always comes from the verified token; IDs in the body are checked against membership and ownership. |
| 41 | Excessive database permissions | Met | Column-level grants only; seven server functions callable by the server role only, each checking its caller (a new baseline rule now enforces this for every such function); two membership-check functions take only a league ID and look only at the caller's own membership. |
| 42 | No audit logs | Met | `private.audit_log` records member removals and league closures, by ID only, unreachable from the app. |
| 46 | Missing security headers | Met | The four new functions use the shared framework (JSON type, `nosniff`, `no-store`, no CORS header from our code). |
| 49 | Tenant isolation | Met | Each league is walled off from every other (section 2). Duels follow in milestone 6. |

## 5. Appendix B: design checklist for the new screens

New screens: home (your leagues), start a league, join a league, league (table, invite, members), league settings. New components: `LinkButton`, `ListItem`, `ToggleRow`, `StandingsTable`, all built from tokens and passing the design check.

| # | Status for milestone 2 |
|---|---|
| 1, 2, 6, 20 Gradients, glass, textures | Met: none (design check) |
| 3 Emojis | Met: none (design check) |
| 4, 18, 19 Fonts | Met: Barlow Condensed and system font only, no italics |
| 5 Coloured borders | Met: table rows use thin neutral dividers; list rows are solid surfaces |
| 7 Contrast | Met: only existing tested colour pairs used; the switch uses accent and input-border tokens |
| 8 Rows of three icon boxes | Met: none |
| 9 Badges above headlines | Met: none added |
| 10 Lucide | Met: no icon library |
| 11 Untouched component styles | Met: own components; the phone's own switch and share sheet, coloured from tokens |
| 12 Fade-in | Met: none |
| 14 Fade-only presses | Met: list rows and link buttons change background and size and vibrate |
| 15 Spacing | Met: tokens only (design check) |
| 16 Em dashes | Met: none anywhere (design check, unit test on the share message) |
| 17 Buzzword copy | Met: plain, specific copy ("3 of 8 places taken", "That code doesn't work. Ask for a new one.") |

**Visual check: open.** Claude has not seen the new screens. The owner screenshots each new screen in light and dark mode and checks it against this table.

## 6. Appendix C: legal checklist

| # | Status for milestone 2 |
|---|---|
| 1 Images and fonts | No new assets. |
| 3 Unsubscribe | No new emails or notifications. |
| 7 Breach plan | Still open from milestone 1 (before the friends test). |
| 10 Chatbot | None. Leagues add no messaging between users; Realtime public channels stay off. |
| Online Safety Act basics (PRD 12) | League names are user-generated: screened like display names. Reporting and blocking are milestone 9, before launch. |

## 7. Decisions, deviations and findings

| Topic | Decision or finding | By |
|---|---|---|
| Leaderboard | Places, avatars and names now; distance 0 until runs (M3); Stride tier in M5 | Owner (plan 1) |
| Season end | Season model, countdown and monthly rollover now; final standings and past seasons in M3 | Owner (plan 2) |
| Creating before M8 | Everyone gets Pro's allowance: 1 open league of up to 8 | Owner (plan 3) |
| Owner leaving | Only as the last member, which closes the league | Owner (plan 4) |
| Invite codes | Owner only sees and shares; one active code | Owner (plan 5) |
| Invite links | `runnerapp://` scheme; only fills in the code, joining takes a tap. Universal links need a domain (M9). Links do not open in Expo Go; they will in the development build (M3) | Owner (plan 6) |
| Blocking | Not built (M9); the join function has a clear place for it | Owner (plan 7) |
| League names | 3 to 30 characters, same screen as display names (so "Moral Support Runners" is refused because "support" is reserved) | Owner (plan 8) |
| Verified only | Stored and editable now, applied in M3 | Owner (plan 9) |
| Membership history | Leaving sets `left_at` rather than deleting, for past seasons | Plan |
| Account deletion (M9) | `leagues.owner_id` refuses deletion of an owner's profile until M9 decides what happens to their league | Plan |
| Advisor: `audit_log` has no access rules | Intended: server only | Plan |
| Advisor: `invite_codes.created_by` has no index | Accepted for now: at most one active code per league; add with the next migration that touches the table | Plan |
| Invite link while signed out | The code is lost after sign-in; the runner types it. Improve later | Plan |

## 8. Open items

Before approving milestone 2:

- [ ] Screenshot the new screens in light and dark mode and check them against section 5 (two accounts make it easiest: one starts a league, the other joins).
- [ ] Push `m2-leagues` so CI runs on GitHub, and confirm all three jobs pass.

Dependabot has opened four pull requests. They need checking before merging, not merging blind:

- [ ] ESLint 10 (major): check `eslint-config-expo` supports it.
- [ ] Expo SDK group: only versions Expo has tested together; SDK upgrades by hand with `npx expo install --fix`.
- [ ] `@types/node` 26 (major): CI runs Node 24, so types should stay on 24 unless CI moves.
- [ ] TypeScript 7 (major): check Expo supports it first.

Carried over from milestone 1 (before the friends test): Sentry and alerts, daily backups, breach plan, verified Resend domain.
