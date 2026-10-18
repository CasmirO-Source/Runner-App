import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDuration } from '../../src/lib/runs.ts';
import { barHeights, estimateVerdict, fiveKInRange, parseWeeklyKm, placingText, strideView, tableTier, tierFor } from '../../src/lib/stride.ts';

const parseFiveK = (raw: string) => fiveKInRange(parseDuration(raw));

test('tiers match PRD 4.2 at every boundary', () => {
  assert.equal(tierFor(0), 'Rookie');
  assert.equal(tierFor(699), 'Rookie');
  assert.equal(tierFor(700), 'Pacer');
  assert.equal(tierFor(1199), 'Pacer');
  assert.equal(tierFor(1200), 'Strider');
  assert.equal(tierFor(1699), 'Strider');
  assert.equal(tierFor(1700), 'Racer');
  assert.equal(tierFor(2199), 'Racer');
  assert.equal(tierFor(2200), 'Elite');
  assert.equal(tierFor(3000), 'Elite');
});

test('placement text', () => {
  assert.equal(placingText(0), 'Placing 0 of 3');
  assert.equal(placingText(2), 'Placing 2 of 3');
  assert.equal(placingText(7), 'Placing 3 of 3');
});

test('a real Stride wins over an estimate, and an estimate is always marked', () => {
  assert.deepEqual(strideView({ stride: 919, placement_runs: 3, estimated_stride: 2400 }), { kind: 'placed', value: 919, tier: 'Pacer' });
  assert.deepEqual(strideView({ stride: null, placement_runs: 1, estimated_stride: 1300 }), {
    kind: 'estimate',
    value: 1300,
    tier: 'Strider',
    placing: 'Placing 1 of 3',
  });
  assert.deepEqual(strideView({ stride: null, placement_runs: 0, estimated_stride: null }), { kind: 'placing', placing: 'Placing 0 of 3' });
  assert.equal(tableTier({ stride: 1700, estimated_stride: null }), 'Racer');
  assert.equal(tableTier({ stride: null, estimated_stride: 800 }), 'Pacer est.');
  assert.equal(tableTier({ stride: null, estimated_stride: null }), null);
});

test('how the estimate compared, once placed', () => {
  assert.equal(estimateVerdict({ stride: 1300, placement_runs: 3, estimated_stride: 900 }), 'You said Pacer. Your runs say Strider.');
  assert.equal(estimateVerdict({ stride: 900, placement_runs: 3, estimated_stride: 800 }), 'You said Pacer, and your runs agree.');
  assert.equal(estimateVerdict({ stride: null, placement_runs: 1, estimated_stride: 800 }), null);
  assert.equal(estimateVerdict({ stride: 900, placement_runs: 3, estimated_stride: null }), null);
});

test('5 km times: 13 to 90 minutes, typed as minutes and seconds', () => {
  assert.equal(parseFiveK('25:30'), 1530);
  assert.equal(parseFiveK('13:00'), 780);
  assert.equal(parseFiveK('1:30:00'), 5400);
  assert.equal(parseFiveK('12:59'), null);
  assert.equal(parseFiveK('1:30:01'), null);
  assert.equal(parseFiveK('25'), null);
  assert.equal(parseFiveK('fast'), null);
});

test('weekly km: whole numbers from 0 to 150', () => {
  assert.equal(parseWeeklyKm('0'), 0);
  assert.equal(parseWeeklyKm(' 25 '), 25);
  assert.equal(parseWeeklyKm('150'), 150);
  assert.equal(parseWeeklyKm('151'), null);
  assert.equal(parseWeeklyKm('12.5'), null);
  assert.equal(parseWeeklyKm('-3'), null);
});

test('chart bars scale to the highest value and never vanish', () => {
  assert.deepEqual(barHeights([1000, 500, 0], 96, 4), [96, 48, 4]);
  assert.deepEqual(barHeights([], 96, 4), []);
});
