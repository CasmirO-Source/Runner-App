import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  daysLeft,
  daysLeftLabel,
  formatCode,
  leagueNameProblem,
  looksLikeCode,
  normaliseCode,
  seasonName,
  shareMessage,
} from '../../src/lib/leagues.ts';

test('codes: typed any way, shown in two groups', () => {
  assert.equal(normaliseCode(' abcde-fghjk '), 'ABCDEFGHJK');
  assert.equal(normaliseCode('ABCDE FGHJK'), 'ABCDEFGHJK');
  assert.ok(looksLikeCode('abcde fghjk'));
  assert.ok(!looksLikeCode('ABCDEFGHJ'), 'too short');
  assert.ok(!looksLikeCode('ABCDEFGHJ0'), 'zero is not in the alphabet');
  assert.ok(!looksLikeCode('ABCDEFGHIK'), 'I is not in the alphabet');
  assert.equal(formatCode('ABCDEFGHJK'), 'ABCDE FGHJK');
});

test('league names match the server rules', () => {
  assert.equal(leagueNameProblem("Sam's Run-Club 2"), null);
  assert.equal(leagueNameProblem('  Leeds   Lunch  Club '), null);
  assert.match(leagueNameProblem('ab') ?? '', /at least 3/);
  assert.match(leagueNameProblem('a'.repeat(31)) ?? '', /up to 30/);
  assert.match(leagueNameProblem('<b>Club</b>') ?? '', /letters, numbers/);
  assert.match(leagueNameProblem('Zürich Club') ?? '', /letters, numbers/);
  assert.match(leagueNameProblem('Club--Name') ?? '', /letters, numbers/);
});

test('season names', () => {
  assert.equal(seasonName('2026-10-01'), 'October');
  assert.equal(seasonName('2027-01-01'), 'January');
});

test('days left counts part days and stops at zero', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(daysLeft('2026-11-01T00:00:00Z', now), 22);
  assert.equal(daysLeft('2026-10-10T18:00:00Z', now), 1);
  assert.equal(daysLeft('2026-10-10T11:00:00Z', now), 0);
  assert.equal(daysLeftLabel('2026-10-10T18:00:00Z', now), 'Last day');
  assert.equal(daysLeftLabel('2026-10-01T00:00:00Z', now), 'Season over');
  assert.equal(daysLeftLabel('2026-11-01T00:00:00Z', now), '22 days left');
});

test('share message has the code, its lifetime and the link, with no em dash', () => {
  const msg = shareMessage('Leeds Lunch Club', 'ABCDEFGHJK');
  assert.match(msg, /ABCDE FGHJK/);
  assert.match(msg, /7 days/);
  assert.match(msg, /runnerapp:\/\/join\/ABCDEFGHJK/);
  assert.ok(!msg.includes(String.fromCharCode(0x2014)));
});

test('short dates', async () => {
  const { shortDate } = await import('../../src/lib/leagues.ts');
  assert.match(shortDate('2026-10-17T12:00:00Z'), /^1[67] October$/);
});
