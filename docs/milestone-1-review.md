# Milestone 1 review: Foundations

Status: **ready for owner approval**. Milestone 1 is marked done in `CLAUDE.md` only after the owner approves this review.

- Reviewed: 10 October 2026, branch `m1-foundations`, commit `71903d5` (plus this document).
- Development project: `svhdlybvqigqrfwywlib` (London, `eu-west-2`). No production project exists (milestone 9).

## 1. What milestone 1 built (PRD section 14)

| PRD item | Built |
|---|---|
| Expo app | Expo SDK 57, TypeScript, Expo Router in `src/app`, iOS and Android only |
| Development Supabase project | Four migrations applied, `profile` Edge Function deployed, Auth, Realtime and email settings applied |
| `CLAUDE.md` | Standing rules, security rules, out-of-scope list, banned design list, how to run every check |
| Email one-time code sign-in | Code-only emails, 10-minute single-use codes, sign-in, code entry and three onboarding screens |
| Profiles | `public.profiles` with public and private fields, writes only through the `profile` Edge Function |
| RLS on every table | Both tables, from the migration that creates them; the build fails if any table lacks it |
| Rate-limit framework | `private.rate_limits`, atomic `consume_rate_limit()`, per-IP and per-user limits in every Edge Function, daily cleanup |
| CI with tests | GitHub Actions: three jobs, all passing |
| Secret scanning | gitleaks on every commit (local hook, fails closed) and over the whole history in CI |
| Dependency checks | npm audit gate with dated exceptions, Edge Function dependency audit, Dependabot |
| Design check script | `scripts/design-check.mjs` with its own tests, run in CI |

Tables created: `profiles`, `rate_limits`. No table, screen or function from a later milestone was built.

## 2. Acceptance test

PRD: "two test users in different leagues cannot read or change each other's data through any route, including direct API calls."

Owner decision: leagues are milestone 2, so milestone 1 proves isolation for every table and route that exists. Milestone 2 adds the league cases to `tests/integration/isolation.test.ts`.

Result: **met**. User A, using the public API exactly as a modified app or script could, cannot:

- read B's private fields (`home_city`, `over_18`, timestamps, `select *`), even by filtering on them;
- point `get_my_profile` at B;
- insert, update or delete any profile directly, B's or their own;
- change B's profile through the Edge Function by sending B's ID (`id`, `user_id`, `userId`);
- read, write or reset rate limits, or call any server-only function;
- use a forged token (A's token with B's ID swapped in);
- keep using a token after signing out (REST API, Edge Function and Auth all refuse it).

A can see B's display name and avatar, which PRD 8.2 intends. Signed-out visitors get nothing. GraphQL, storage and Realtime routes are closed.

Proof the tests catch real mistakes: a deliberate grant of `home_city` to signed-in users and RLS switched off made both the database tests and three isolation tests fail; reverting made them pass.

## 3. Test results (10 October 2026)

| Suite | Result |
|---|---|
| Lint (ESLint, no warnings allowed) | Pass |
| Type checks (app, tests, Edge Functions with Deno) | Pass |
| Design check (88 files) | Pass |
| Unit tests | 75 of 75 |
| Database tests (pgTAP), local | 84 of 84 |
| Security baseline (pgTAP), hosted dev project | 27 of 27 |
| Integration tests (real API, two users), local | 61 of 61; 3 skipped locally and run on the hosted project instead |
| Hosted checks (`npm run check:hosted`) | 21 of 21 |
| npm audit gate (app) | Pass; 2 accepted exceptions |
| npm audit gate (Edge Function packages) | Pass |
| gitleaks, whole history | No leaks |
| CI on GitHub (latest commit) | All three jobs pass |
| Supabase security advisor, dev project | 5 findings, all reviewed (section 7) |

The three local skips, and why: the local stack's gateway adds a wildcard CORS header to everything, its Auth server does not enforce per-IP limits, and its Realtime server resets the private-only setting on start. All three were checked against the hosted project.

## 4. Appendix A: security checklist

Status key: **Met**; **Met, platform limit** (met as far as Supabase allows, owner decision recorded); **Not yet** (the feature arrives in a later milestone); **Open** (an owner action outside the code).

| # | Item | Status | How it is met, and evidence |
|---|---|---|---|
| 1 | Exposed database credentials | Met | The app ships the publishable key only. The secret key exists only as an Edge Function environment variable that Supabase injects. The app refuses to start if a secret or service role key is configured (`src/lib/envGuard.ts`, unit tested). Bundle scan: no secret key patterns. |
| 2 | Public .env files | Met | `.gitignore` covers every `.env` variant; `.env` was never committed (checked in history); only `.env.example` with placeholders is committed. |
| 3 | Hardcoded API keys | Met | No keys in source. gitleaks with Supabase-specific rules blocks commits (tested with fake service role, secret, anon and database URL values). |
| 4 | Weak or missing authentication | Met | Supabase Auth email codes only; 6 digits, 10 minutes, single use (local and hosted tests). Every Edge Function rejects requests without a valid token (gateway `verify_jwt` and our own check with Supabase Auth). |
| 5 | No authorisation checks | Met | The profile function only ever writes the caller's own row, with the ID from the verified token. |
| 6 | Users accessing other users' data | Met | Automated two-user test (section 2), local and hosted. |
| 7 | Open database permissions | Met | RLS on every table, deny by default, no write policies for app users, signed-out users can do nothing. The database test that fails the build if any table lacks RLS runs in CI. |
| 8 | Misconfigured storage buckets | Not yet | No buckets exist (tested). Arrives with screenshots in milestone 4. |
| 9 | Admin routes | Met | None in the app. |
| 10 | Debug pages in production | Met for milestone 1 | Expo Router's `/_sitemap` debug page switched off; custom not-found screen; no test routes. The production build check is part of milestone 9. |
| 11 | Build logs leaking secrets | Met | CI uses no repository secrets, filters the local stack's throwaway keys from its output, prints no environment variables and uploads no artifacts. |
| 12 | Verbose errors | Met | Users see our own messages or "Something went wrong on our side… quote reference ab12cd34". Database messages are never passed on. Sentry is not connected yet (open item). |
| 13 | Leaked repos or history | Met | Repository private (checked). gitleaks scans the whole history in CI: no leaks. |
| 14 | Secrets in frontend code | Met | Bundle contains only the Supabase URL and publishable key. |
| 15 | Client-side-only checks | Met | Name rules, word screen, uniqueness, 18+ flag and rate limits are enforced on the server and in the database; app checks are for quick feedback only. |
| 16 | Missing input validation | Met | Strict zod schema in the Edge Function (unknown fields refused), 8 KB body cap, plus database constraints as a second layer. |
| 17 | SQL injection | Met | No SQL is built from user input. The rate-limit function uses inputs only as values and validates them. |
| 18 | NoSQL injection | Not applicable | Postgres only. JSON input still goes through zod. |
| 19 | XSS | Met | All text is rendered as plain text through one `Text` component. No web views. The email template inserts only the code. |
| 20 | CSRF | Met | Tokens travel in a header, never a cookie. |
| 21 | Insecure file uploads | Not yet | Milestone 4. |
| 22 | Path traversal | Not yet | Milestone 4. |
| 23 | SSRF | Met | The Edge Function only contacts the Supabase URL from its environment. No user-supplied addresses are fetched. |
| 24 | Broken password reset | Met | No passwords in the app. The password route Supabase cannot switch off requires a confirmed email and strong passwords (tested). Email changes need confirmation at the old address. |
| 25 | Weak session management | Met | 1-hour access tokens (hosted check), refresh token rotation, tokens in the Keychain or Keystore and never restored to another phone, sign-out ends the session on the server. Migration 4 makes the REST API refuse signed-out tokens at once (local and hosted tests). |
| 26 | Weak JWT secrets | Open | Confirm the dev project uses Supabase's generated asymmetric signing keys (owner, dashboard). |
| 27 | Overly permissive CORS | Met, platform limit | Our Edge Function sends no CORS header (hosted check). Supabase's gateway adds `*` to its own refusals of requests without a token (owner accepted: no data in those replies). The REST API echoes any website's origin; this is Supabase platform behaviour and cannot be configured. Low risk because tokens are never in cookies (#20). |
| 28 | Missing rate limits | Met, platform limit | Edge Functions: 60 per minute per IP and per user, 20 profile edits per hour, HTTP 429 with Retry-After (tested). Auth: 2 code requests and 10 verifications per 5 minutes per IP, but Supabase lets a burst of up to 30 through first and the burst cannot be changed (measured on the hosted project). One email per address per 12 minutes. AI spending cap: milestone 4. |
| 29 | Public test environments | Met | The dev project holds only the owner's own test account. Resend's test sender only delivers to the owner's address, so nobody else can complete sign-in. |
| 30 | Default credentials | Open | Owner to confirm the database password came from a password manager. No production or demo accounts exist. |
| 31 | Webhooks without verification | Not yet | Milestone 8. |
| 32 | Payment checks in the app | Not yet | Milestone 8. |
| 33 | IDOR | Met | All IDs are random UUIDs; every request is checked against the signed-in user on the server. |
| 34 | Trusting user-controlled IDs | Met | User ID only ever comes from the verified token (tested with three field names). |
| 35 | Logs with private data | Met for our code | Edge Function logs accept only an allow-listed set of fields (function, reference, error type, database error code). Verified: no names, emails, tokens or IPs in logs. Sentry scrubbing: when Sentry is added. |
| 36 | Source maps exposed | Met | Exports contain no source maps. Private upload to Sentry comes with Sentry. |
| 37 | Dependency vulnerabilities | Met, with dated exceptions | CI fails on high or critical. Two accepted (no fix exists, build tools only, review by 9 November 2026). Dependabot configured; Dependabot alerts in GitHub settings still to switch on (open). |
| 38 | Outdated packages | Met | Expo SDK 57 (latest). Dependabot monthly; Edge Function packages kept equal to the app's. |
| 39 | Prompt injection | Not yet | Milestone 4. |
| 40 | AI acting without permission | Not yet | Milestone 4. |
| 41 | Excessive database permissions | Met | Supabase's automatic grants revoked; exact grant lists enforced by tests. Three reviewed functions run with raised rights, each with an empty search path and a caller check. |
| 42 | No audit logs | Not yet | No sensitive actions exist yet; `audit_log` arrives with the first one (milestone 2, league removal). |
| 43 | No monitoring | Open | Sentry and spend alerts are not set up. Needed before the friends test (after milestone 6). |
| 44 | No backup plan | Not yet, note | Required before any external user joins. The free plan has no daily backups, so this needs a plan upgrade or another backup route before the friends test. |
| 45 | Public dashboards | Open | Owner to confirm two-factor login on Supabase, GitHub, Expo, Resend and Apple accounts. |
| 46 | Missing security headers | Met | Edge Function replies set JSON content type, `nosniff` and `no-store` (local and hosted). No web pages exist. |
| 47 | Cookie flags | Not applicable | No cookies. |
| 48 | Unencrypted sensitive data | Met | HTTPS to Supabase; tokens in secure storage; date of birth checked on the phone and never sent or stored. |
| 49 | Tenant isolation | Met for milestone 1 | Users are isolated (section 2). League isolation is milestone 2. |

## 5. Appendix B: design checklist

Enforcement in code: all colours, fonts, spacing, radii and line widths live in `src/theme/tokens.ts`. `scripts/design-check.mjs` fails CI on em dashes anywhere, gradients, blur or glass, Inter, Space Grotesk, Instrument Serif, Lucide, italics, serif fonts, emojis, raw colours or spacing outside the tokens file, and fade-only press effects.

Visual check: the owner reports screenshots of every new screen in light and dark mode (sign-in, code entry and error state, onboarding steps 1 to 3, home, "Sorry, not yet"). Claude has reviewed only the avatar screen in light mode. The owner checks the rest against this table, or shares them for review.

| # | Banned | Status | How |
|---|---|---|---|
| 1 | Purple-to-blue gradients | Met | No gradients (design check). Near-black, off-white, signal orange. |
| 2 | Gradient text in headings | Met | Solid colour headings in Barlow Condensed. |
| 3 | Emojis in headings or buttons | Met | Design check fails on any emoji in app code. |
| 4 | Inter as the only font | Met | Barlow Condensed for headings and labels, system font for body text. |
| 5 | Cards with coloured borders | Met | Only the text field has a border, in a neutral grey. |
| 6 | Glassmorphism | Met | Solid surfaces only (design check bans blur). |
| 7 | Low-contrast dark mode | Met | 46 colour pairs tested against WCAG AA in both modes. |
| 8 | Rows of three icon boxes | Met | One idea per onboarding screen; avatars four to a row. |
| 9 | Small badges above headlines | Owner to judge | No pill labels exist. The onboarding screens show plain "Step 1 of 3" text above the title, with no background or border. Remove it if it reads as a badge. |
| 10 | Lucide icons | Met | No icon library used. |
| 11 | Unstyled component libraries | Met | Own components built from tokens. |
| 12 | Fade-in on scroll | Met | Content appears immediately. |
| 13 | Cursor-following effects | Not applicable | Native app. |
| 14 | Buttons that only fade when pressed | Met | Buttons change colour and size and vibrate; avatars change background and size. |
| 15 | Inconsistent spacing | Met | Spacing tokens only (design check). |
| 16 | Em dashes | Met | Design check across every file, comments included. Two in Supabase-generated comments were removed. |
| 17 | Generic buzzword copy | Met | Plain, specific copy ("We'll email you a 6-digit code. No passwords.", "Wrong turn"). |
| 18 | Serif italic accent words | Met | No serif fonts, no italics loaded or used. |
| 19 | Space Grotesk with Instrument Serif | Met | Not used (design check). |
| 20 | Grain texture over a gradient | Met | No textures or gradients. |

## 6. Appendix C: legal checklist

| # | Risk | Status | How |
|---|---|---|---|
| 1 | Images taken from Google | Met | `docs/asset-licences.md`: Barlow Condensed (SIL Open Font License), avatars drawn in code, Expo's template icons not used. |
| 2 | No cookie banner | Not applicable yet | No analytics, cookies or website. PostHog arrives only after consent. |
| 3 | No unsubscribe link | Not applicable yet | Only sign-in emails (transactional). Notifications are milestone 6. |
| 4 | No "Do not sell" link | Met | UK only; no data sold or shared for advertising. |
| 5 | Another brand in the name | Open, later | Working name "Runner App". Check the UK trade mark register before choosing the real name. |
| 6 | No copyright agent | Not applicable | UK only. |
| 7 | Regulator not told after a breach | Open | The written breach plan (PRD 9.6 rule 21) does not exist yet. |
| 8 | Biometric data | Met | None collected. Secure storage does not use Face ID. |
| 9 | AI trained on user data | Not applicable yet | No AI in milestone 1. Note for the privacy policy: Resend (email) and Supabase (London) process personal data; Resend is US-based, so record the international transfer. |
| 10 | Chatbot makes up policy | Met | No chatbot. |

## 7. Deviations and owner decisions

| Topic | Decision or limitation | Decided by |
|---|---|---|
| Acceptance test | League cases move to milestone 2 | Owner |
| Profile writes | Edge Function only (stricter than PRD 8.2) | Owner |
| `home_city` | Private, owner only | Owner |
| Display names | ASCII only; unique ignoring case and treating `_` as a space | Owner |
| 18+ check | Date of birth checked on the phone; only "over 18: yes" stored | Plan |
| npm audit | `braces` and `node-forge` accepted until 9 November 2026: no fix exists, build tools only | Owner |
| `verify_jwt` | Kept on; the gateway's `*` CORS header on its own refusals accepted | Owner |
| REST API CORS | Echoes any origin; Supabase platform behaviour, not configurable; low risk (#20) | Platform |
| Auth per-IP limits | Burst of 30 always allowed; steady rate about 24 an hour against the PRD's 20 | Platform |
| Password route | Cannot be disabled; strong passwords and email confirmation required | Platform |
| Signed-out tokens | Migration 4: REST API refuses them at once (Option A) | Owner |
| Realtime | Private channels only, set through the Management API | Owner |
| Advisor: leaked-password protection | Left off: the app has no passwords | Owner |
| Advisor: authenticator-app two-factor | Off: not in the app's scope | Owner |
| Advisor: `get_my_profile` runs with raised rights | Accepted: no input, caller's row only, live session required | Plan |
| Advisor: `rate_limits` has no policies, unused index | Intended | Plan |
| Email | Custom SMTP through Resend; code-only templates | Owner |
| Supabase's `rls_auto_enable` | Hosted-only platform function, checked explicitly in tests | Plan |
| Install scripts | `unrs-resolver` install script denied | Plan |
| Node versions | CI on Node 24 (LTS); local Node 26 | Plan |

## 8. Open items for the owner

Before approving milestone 1:

- [ ] Look over the screenshots against section 5 (or share them for review), including the "Step 1 of 3" label (#9).
- [ ] GitHub: switch on Dependabot alerts and security updates (`docs/github-settings.md`). Branch protection needs a paid GitHub plan.
- [ ] Two-factor login on Supabase, GitHub, Expo, Resend and Apple accounts (A45).
- [ ] Confirm the dev project uses Supabase's generated asymmetric JWT signing keys (A26).
- [ ] Confirm the database password came from a password manager (A30).

Before the friends test (after milestone 6):

- [ ] Sentry with personal data scrubbing, and error and spend alerts (A12, A35, A36, A43).
- [ ] Daily backups and a tested restore (A44). Needs a paid Supabase plan or another backup route.
- [ ] Written breach plan, including the ICO 72-hour rule (PRD 9.6 rule 21, Appendix C #7).
- [ ] Verify a sending domain in Resend so testers can receive codes; then turn off open sign-ups on dev or keep an allow-list.

Housekeeping:

- [ ] Delete `.env.local` when testing the app against the hosted project instead of the local stack.
- [ ] Merge `m1-foundations` into `main` after approval.
