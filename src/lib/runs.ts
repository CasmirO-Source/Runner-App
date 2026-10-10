// Run helpers for the app: reading what the runner types, and showing runs.
// Quick feedback only; the server makes every decision (Appendix A #15).
//
// Pure module so it can be unit tested in Node.

// "5", "5.2" or "5,2" kilometres to whole metres. Null if not a number.
export function parseDistanceKm(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(text)) return null;
  const metres = Math.round(Number(text) * 1000);
  return metres > 0 ? metres : null;
}

// "25:30" (minutes and seconds) or "1:05:30" (hours, minutes, seconds) to
// seconds. Null if not a valid time.
export function parseDuration(raw: string): number | null {
  const parts = raw.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  if (s >= 60 || (nums.length === 3 && m >= 60)) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

// "HH:MM" to hours and minutes, or null.
export function parseClock(raw: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

export function formatKm(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Minutes and seconds per kilometre, for example "5:00 /km".
export function formatPace(metres: number, seconds: number): string {
  const perKm = Math.round((seconds * 1000) / metres);
  return `${Math.floor(perKm / 60)}:${String(perKm % 60).padStart(2, '0')} /km`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDay(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The days a run can be logged for: today and the 7 before it (PRD 6.4).
export function dayOptions(now: Date = new Date()): { label: string; date: Date }[] {
  return Array.from({ length: 8 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : shortDay(date);
    return { label, date };
  });
}

// The start time as an ISO string, in the phone's own time zone.
export function startTime(day: Date, clock: { h: number; m: number }): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.h, clock.m).toISOString();
}

// Monday 00:00 of the current week, in the phone's own time zone.
export function weekStart(now: Date = new Date()): Date {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
}

export type RunRow = {
  started_at: string;
  distance_m: number;
  status: string;
};

// This week's distance and number of runs: accepted runs only, as everywhere.
export function weekTotals(runs: RunRow[], now: Date = new Date()): { metres: number; count: number } {
  const from = weekStart(now).getTime();
  const counted = runs.filter((r) => r.status === 'accepted' && new Date(r.started_at).getTime() >= from);
  return { metres: counted.reduce((sum, r) => sum + r.distance_m, 0), count: counted.length };
}

// Why a run was flagged, in plain words (the codes come from the server).
const REASONS: Record<string, string> = {
  distance_out_of_range: 'Runs need to be between 0.5 km and 100 km.',
  pace_out_of_range: 'That pace is outside 2:30 to 15:00 per km.',
  in_future: 'That start time is in the future.',
  too_old: "Runs older than 7 days can't be added.",
  daily_total_exceeded: 'That takes you over 150 km for the day.',
};

export function reasonText(code: string): string {
  return REASONS[code] ?? 'It did not pass our checks.';
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// How a run was logged, in words. Only Health runs are verified.
export function sourceLabel(source: string): string {
  if (source === 'health') return 'Verified';
  if (source === 'screenshot') return 'Screenshot';
  return 'Typed in';
}

// The instant at hh:mm UK time on a UK calendar date ("2026-10-09"). The
// screenshot reader reports dates and times as the screenshot shows them, and
// the server reads them as UK time, whatever time zone the phone is in.
export function ukInstant(date: string, clock: { h: number; m: number }): string {
  const [y, mo, d] = date.split('-').map(Number);
  const wanted = Date.UTC(y, mo - 1, d, clock.h, clock.m);
  // Start from the same wall time in UTC, then correct by the UK offset at
  // that moment. Twice, so the answer is right next to a clock change.
  let guess = wanted;
  for (let i = 0; i < 2; i++) guess = wanted - ukOffsetMs(guess);
  return new Date(guess).toISOString();
}

function ukOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(at / 60000) * 60000;
}

// "2026-10-09" as "Fri 9 Oct", without time zone surprises.
export function dateLabel(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  return shortDay(new Date(y, mo - 1, d));
}

// Which of the day options (today and the 7 before) is this calendar date, or
// -1 if it is further back.
export function dayIndex(options: { date: Date }[], date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return options.findIndex((o) => o.date.getFullYear() === y && o.date.getMonth() === mo - 1 && o.date.getDate() === d);
}
