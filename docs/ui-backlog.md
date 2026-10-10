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
- Tabs appear only when their feature exists, so there are never empty or "coming soon" tabs:
  - Milestone 3: Home, League, Run, You.
  - Milestone 6: Duels.
  - Milestone 7: Pro (locked preview for free users).
- Keep to 5 tabs at most (the iPhone tab bar shows 5 before hiding the rest under "More"). The final set is decided at the design pass; one option is Home, League, Run, Duels, You, with Pro reached from Home and You.
- The League tab opens your league's table directly; with more than one league, a switcher sits at the top.
- Sign out moves from Home to the You tab.

### Design pass (after the MVP features, before the friends test or at the milestone 9 design audit)

- Home as tiles with rounded corners. Each tile should carry real content (your league position, a live duel score), not just an icon and a label, so it does not become the banned "rows of icon boxes" pattern (Appendix B #8).
- Swiping between tabs needs an extra package (a pager view). Ask before adding.
- Rounded cards on solid surfaces; no coloured borders (B #5), no glass (B #6), no fade-only presses (B #14).

### Not now, and why

- **Matchmaking against strangers (the Arena):** out of scope for version 1 (PRD section 3; planned for version 2 in section 15). No tile or "coming soon" entry: out-of-scope items are not built, even partially.
- **1v1 against friends:** milestone 6. Its tile and tab arrive with duels.
- **Pro analytics:** milestone 7. Its locked preview arrives then.

## Other improvements noted

- Opening an invite link while signed out loses the code after sign-in; the runner has to type it. Keep the code through sign-in.
- Onboarding (18+ check, name, avatar) stays as three short steps: PRD 13.3 and Appendix B #8 ask for one idea per screen. Sign-in itself is remembered on the phone, so it is a one-off.
