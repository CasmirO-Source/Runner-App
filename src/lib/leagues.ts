// League helpers for the app. Display and quick feedback only: the server
// and database make every real decision (Appendix A #15).
//
// Pure module so it can be unit tested in Node.

export const CODE_LENGTH = 10;
const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

// People type codes any way: ignore case, spaces and hyphens.
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function looksLikeCode(raw: string): boolean {
  const code = normaliseCode(raw);
  return code.length === CODE_LENGTH && CODE_ALPHABET.test(code);
}

// "ABCDEFGHJK" becomes "ABCDE FGHJK", easier to read out or copy by eye.
export function formatCode(code: string): string {
  return `${code.slice(0, 5)} ${code.slice(5)}`;
}

const NAME_PATTERN = /^[A-Za-z0-9]+([ '-][A-Za-z0-9]+)*$/;

export function normaliseLeagueName(raw: string): string {
  return raw.trim().replace(/ +/g, ' ');
}

export function leagueNameProblem(raw: string): string | null {
  const name = normaliseLeagueName(raw);
  if (name.length < 3) return 'League names need at least 3 characters.';
  if (name.length > 30) return 'League names can be up to 30 characters.';
  if (!NAME_PATTERN.test(name)) return 'Use letters, numbers, spaces, apostrophes and hyphens only.';
  return null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Seasons are stored by their first day ("2026-10-01").
export function seasonName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS[m - 1] ?? 'This month';
}

// Whole days until the season ends, counting today if any of it is left.
export function daysLeft(endsAt: string, now: Date = new Date()): number {
  const ms = new Date(endsAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

export function daysLeftLabel(endsAt: string, now: Date = new Date()): string {
  const d = daysLeft(endsAt, now);
  if (d === 0) return 'Season over';
  if (d === 1) return 'Last day';
  return `${d} days left`;
}

export const inviteLink = (code: string): string => `runnerapp://join/${code}`;

export function shareMessage(leagueName: string, code: string): string {
  return [
    `Join my league "${leagueName}" on Runner App.`,
    `Code: ${formatCode(code)} (works for 7 days)`,
    `Or open: ${inviteLink(code)}`,
  ].join('\n');
}

// "17 October", in the phone's own time zone.
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

type Placed = { place: number; user_id: string; display_name: string; distance_m: number };

// "2nd of 4. 3.2 km behind Jordan" (PRD 5.2 and 13.3). Null if you are not
// in the table.
export function standingLine(rows: Placed[], myId: string): string | null {
  const i = rows.findIndex((r) => r.user_id === myId);
  if (i < 0) return null;
  const me = rows[i];
  const place = `${ordinalPlace(me.place)} of ${rows.length}`;
  if (rows.length === 1) return `${place}. Invite your mates to race them.`;
  if (i === 0) {
    const next = rows[1];
    const lead = me.distance_m - next.distance_m;
    return lead === 0 ? `${place}. Level with ${next.display_name}.` : `${place}. ${(lead / 1000).toFixed(1)} km ahead of ${next.display_name}.`;
  }
  const above = rows[i - 1];
  const gap = above.distance_m - me.distance_m;
  return gap === 0 ? `${place}. Level with ${above.display_name}.` : `${place}. ${(gap / 1000).toFixed(1)} km behind ${above.display_name}.`;
}

function ordinalPlace(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
