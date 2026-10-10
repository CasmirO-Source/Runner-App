# UI backlog

Ideas and feedback for the app's layout and look. Navigation structure is built early (it gets harder to change as screens are added); visual polish waits for a dedicated design pass once the MVP features exist. Every item is checked against PRD 13 and Appendix B before it is built.

## Owner feedback, 10 October 2026

- Too many taps after signing in. Getting around should not take "endless clicks".
- Wanted: icons along the bottom that open a screen directly, like Nike Run Club's tabs (Home, Plans, Run, Club, Activity).
- Wanted: one screen showing the leaderboard, one for Pro analytics (locked for free users), and others to swipe between.
- Wanted: home actions as rounded square tiles: Start a league, Join with a code, 1v1 against friends, matchmaking against strangers.

## Plan

### Navigation (milestone 3, first step)

- A bottom tab bar using Expo Router's built-in tabs, with native icons (`expo-symbols`: SF Symbols on iPhone, Material Symbols on Android, as PRD 13.1 asks).
- **Five tabs, adopted by the owner on 10 October 2026** (the most an iPhone tab bar shows before "More"; the centre tab gives symmetry):

  | Position | Tab | Contents | Arrives |
  |---|---|---|---|
  | 1 | Home | League position, gap to the runner above, days left, any live duel, start or join a league | Now; position and gap in milestone 3 |
  | 2 | League | The table, league switcher, past seasons and final standings; later a Challenge button per mate | Now; past seasons milestone 3; challenges milestone 6 |
  | 3 (centre) | Run | Log a run: Health sync status, manual entry, later the screenshot upload (any running app, including Strava) | Milestone 3; screenshots milestone 4 |
  | 4 | Activity | Free: your runs with their status (and the reason if flagged), distance and runs per week. Pro: analytics, shown to free users as a locked preview with one real insight | Runs list milestone 3; Pro section milestone 7 |
  | 5 | You | Profile, Stride and rating history, duel record, settings, privacy, data export, delete account, Help | Now; filled over milestones 5, 6 and 9 |

- Tabs appear only when their feature exists, so there are never empty or "coming soon" tabs. Run and Activity arrive with manual entry (milestone 3).
- Duels live on Home (live duel card) and in the League table (Challenge), since they are always between league-mates. If duels turn out to be used constantly, Duels could take Home's place.
- Help and support: fixed help pages and a contact email inside You (PRD 12: support comes from people or fixed help pages).
- The League tab opens your league's table directly; with more than one league, a switcher sits at the top. Done in milestone 3 step 1.
- Sign out moved from Home to the You tab. Done in milestone 3 step 1.

### Design pass (after the MVP features, before the friends test or at the milestone 9 design audit)

- Home as tiles with rounded corners. Each tile should carry real content (your league position, a live duel score), not just an icon and a label, so it does not become the banned "rows of icon boxes" pattern (Appendix B #8).
- Swiping between tabs needs an extra package (a pager view). Ask before adding.
- Rounded cards on solid surfaces; no coloured borders (B #5), no glass (B #6), no fade-only presses (B #14).

- Accent colour: the owner considered forest green instead of signal orange (10 October 2026) and chose to keep orange for now and revisit here. A contrast-checked green set exists (light `#1F5C3A` with off-white button text; dark `#4CAF73` with near-black text, `#5DBB82` for green text), with the accent green doubling as "up". Switching needs PRD 13.1 and Appendix B #1 amended, then one tokens edit.

### Not now, and why

- **Matchmaking against strangers (the Arena):** out of scope for version 1 (PRD section 3; planned for version 2 in section 15). No tile or "coming soon" entry: out-of-scope items are not built, even partially.
- **1v1 against friends:** milestone 6. Its tile and tab arrive with duels.
- **Pro analytics:** milestone 7. Its locked preview arrives then.
- **An AI agent that answers running questions (owner idea, 10 October 2026):** not in version 1. PRD section 3 rules out any AI feature other than the screenshot reader; PRD 12 says "No AI support chatbot"; and PRD 5.6 and 12 require advice never to become medical advice, which is hard to guarantee when an AI answers anything. Pro coaching in version 1 is rule-based so every number can be explained and tested. "AI-written coaching summaries" is already listed for a future version (PRD 15); revisit this idea then, with a safety review.

## Other improvements noted

- Opening an invite link while signed out loses the code after sign-in; the runner has to type it. Keep the code through sign-in.
- Onboarding (18+ check, name, avatar) stays as three short steps: PRD 13.3 and Appendix B #8 ask for one idea per screen. Sign-in itself is remembered on the phone, so it is a one-off.
