// Stride for display: tiers, placement and the estimate (PRD 4.2, 4.4, 4.5).
// The formula itself lives only in the database, so the app can never compute
// or write a rating; this module only turns its numbers into words.
//
// Pure module so it can be unit tested in Node.

const TIERS: { name: string; from: number }[] = [
  { name: 'Elite', from: 2200 },
  { name: 'Racer', from: 1700 },
  { name: 'Strider', from: 1200 },
  { name: 'Pacer', from: 700 },
  { name: 'Rookie', from: 0 },
];

export function tierFor(stride: number): string {
  return (TIERS.find((t) => stride >= t.from) ?? TIERS[TIERS.length - 1]).name;
}

export type StrideFields = {
  stride: number | null;
  placement_runs: number;
  estimated_stride: number | null;
};

export type StrideView =
  | { kind: 'placed'; value: number; tier: string }
  | { kind: 'estimate'; value: number; tier: string; placing: string }
  | { kind: 'placing'; placing: string };

export function placingText(runs: number): string {
  return `Placing ${Math.min(Math.max(runs, 0), 3)} of 3`;
}

// What to show for a runner: their real Stride once placed, otherwise their
// estimate (always marked as one), otherwise their placement progress.
export function strideView(p: StrideFields): StrideView {
  if (p.stride !== null) return { kind: 'placed', value: p.stride, tier: tierFor(p.stride) };
  if (p.estimated_stride !== null) {
    return { kind: 'estimate', value: p.estimated_stride, tier: tierFor(p.estimated_stride), placing: placingText(p.placement_runs) };
  }
  return { kind: 'placing', placing: placingText(p.placement_runs) };
}

// The tier shown next to a name in the league table (PRD 5.2), or nothing.
export function tableTier(row: { stride: number | null; estimated_stride: number | null }): string | null {
  if (row.stride !== null) return tierFor(row.stride);
  if (row.estimated_stride !== null) return `${tierFor(row.estimated_stride)} est.`;
  return null;
}

// Once placed, how the estimate compared (PRD 4.5).
export function estimateVerdict(p: StrideFields): string | null {
  if (p.stride === null || p.estimated_stride === null) return null;
  const said = tierFor(p.estimated_stride);
  const real = tierFor(p.stride);
  return said === real ? `You said ${said}, and your runs agree.` : `You said ${said}. Your runs say ${real}.`;
}

// A 5 km time in seconds (from parseDuration in runs.ts) if it is from 13 to
// 90 minutes, the range the server accepts; otherwise null.
export function fiveKInRange(seconds: number | null): number | null {
  return seconds !== null && seconds >= 780 && seconds <= 5400 ? seconds : null;
}

// Typical weekly km as typed: a whole number from 0 to 150, or null.
export function parseWeeklyKm(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const km = Number(text);
  return km <= 150 ? km : null;
}

// Bar heights for the history chart: oldest first, scaled so the highest bar
// fills the chart. Every bar keeps a minimum height so a low rating is still
// visible.
export function barHeights(values: number[], maxHeight: number, minHeight: number): number[] {
  const top = Math.max(...values, 1);
  return values.map((v) => Math.max(minHeight, Math.round((v / top) * maxHeight)));
}
