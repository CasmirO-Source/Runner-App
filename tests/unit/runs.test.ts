import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dateLabel,
  dayIndex,
  dayOptions,
  formatDuration,
  formatKm,
  formatPace,
  ordinal,
  parseClock,
  parseDistanceKm,
  parseDuration,
  reasonText,
  sourceLabel,
  startTime,
  ukInstant,
  weekStart,
  weekTotals,
} from '../../src/lib/runs.ts';

test('distance: kilometres typed any common way', () => {
  assert.equal(parseDistanceKm('5'), 5000);
  assert.equal(parseDistanceKm('5.2'), 5200);
  assert.equal(parseDistanceKm(' 10,55 '), 10550);
  assert.equal(parseDistanceKm('0.001'), 1);
  assert.equal(parseDistanceKm('0'), null);
  assert.equal(parseDistanceKm('-3'), null);
  assert.equal(parseDistanceKm('five'), null);
  assert.equal(parseDistanceKm('1e3'), null);
  assert.equal(parseDistanceKm('5.2.1'), null);
});

test('duration: mm:ss or h:mm:ss', () => {
  assert.equal(parseDuration('25:30'), 1530);
  assert.equal(parseDuration('1:05:30'), 3930);
  assert.equal(parseDuration('90:00'), 5400, 'minutes over 60 are fine without hours');
  assert.equal(parseDuration('25:60'), null);
  assert.equal(parseDuration('1:60:00'), null);
  assert.equal(parseDuration('25'), null);
  assert.equal(parseDuration('0:00'), null);
  assert.equal(parseDuration('a:b'), null);
});

test('clock', () => {
  assert.deepEqual(parseClock('07:30'), { h: 7, m: 30 });
  assert.deepEqual(parseClock('7:05'), { h: 7, m: 5 });
  assert.equal(parseClock('24:00'), null);
  assert.equal(parseClock('7.30'), null);
});

test('formatting', () => {
  assert.equal(formatKm(5230), '5.2 km');
  assert.equal(formatDuration(1530), '25:30');
  assert.equal(formatDuration(3930), '1:05:30');
  assert.equal(formatPace(5000, 1500), '5:00 /km');
  assert.equal(formatPace(5000, 1530), '5:06 /km');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(22), '22nd');
});

test('the 8 days a run can be logged for', () => {
  const days = dayOptions(new Date(2026, 9, 10, 15, 0));
  assert.equal(days.length, 8);
  assert.equal(days[0].label, 'Today');
  assert.equal(days[1].label, 'Yesterday');
  assert.equal(days[2].label, 'Thu 8 Oct');
  assert.equal(days[7].date.getDate(), 3);
});

test('start time is the chosen day and clock in local time', () => {
  const iso = startTime(new Date(2026, 9, 9), { h: 7, m: 30 });
  const d = new Date(iso);
  assert.equal(d.getDate(), 9);
  assert.equal(d.getHours(), 7);
  assert.equal(d.getMinutes(), 30);
});

test('week totals count accepted runs since Monday only', () => {
  const now = new Date(2026, 9, 10, 12); // Saturday
  assert.equal(weekStart(now).getDate(), 5); // Monday 5 October
  const runs = [
    { started_at: new Date(2026, 9, 6, 7).toISOString(), distance_m: 5000, status: 'accepted' },
    { started_at: new Date(2026, 9, 9, 7).toISOString(), distance_m: 3000, status: 'accepted' },
    { started_at: new Date(2026, 9, 9, 18).toISOString(), distance_m: 400, status: 'flagged' },
    { started_at: new Date(2026, 9, 4, 7).toISOString(), distance_m: 10000, status: 'accepted' },
  ];
  assert.deepEqual(weekTotals(runs, now), { metres: 8000, count: 2 });
});

test('every flag reason has a plain message, with a safe fallback', () => {
  for (const code of ['distance_out_of_range', 'pace_out_of_range', 'in_future', 'too_old', 'daily_total_exceeded']) {
    assert.notEqual(reasonText(code), reasonText('unknown_code'));
  }
  assert.ok(!reasonText('too_old').includes(String.fromCharCode(0x2014)));
});

test('screenshot times are read as UK time, whatever the phone says (summer and winter)', () => {
  assert.equal(ukInstant('2026-07-15', { h: 7, m: 30 }), '2026-07-15T06:30:00.000Z'); // BST, UTC+1
  assert.equal(ukInstant('2026-12-01', { h: 7, m: 30 }), '2026-12-01T07:30:00.000Z'); // GMT
  assert.equal(ukInstant('2026-03-29', { h: 0, m: 30 }), '2026-03-29T00:30:00.000Z'); // before the clocks go forward at 01:00
  assert.equal(ukInstant('2026-03-29', { h: 9, m: 0 }), '2026-03-29T08:00:00.000Z'); // after
  assert.equal(ukInstant('2026-10-25', { h: 9, m: 0 }), '2026-10-25T09:00:00.000Z'); // after the clocks go back
  assert.equal(ukInstant('2026-01-01', { h: 23, m: 59 }), '2026-01-01T23:59:00.000Z');
});

test('a reading date matches one of the day buttons, or none if older than 7 days', () => {
  const days = dayOptions(new Date(2026, 9, 10, 12));
  assert.equal(dayIndex(days, '2026-10-10'), 0);
  assert.equal(dayIndex(days, '2026-10-09'), 1);
  assert.equal(dayIndex(days, '2026-10-03'), 7);
  assert.equal(dayIndex(days, '2026-10-02'), -1);
  assert.equal(dayIndex(days, '2026-10-11'), -1);
});

test('reading dates and sources in words', () => {
  assert.equal(dateLabel('2026-10-09'), 'Fri 9 Oct');
  assert.equal(sourceLabel('health'), 'Verified');
  assert.equal(sourceLabel('manual'), 'Typed in');
  assert.equal(sourceLabel('screenshot'), 'Screenshot');
});
