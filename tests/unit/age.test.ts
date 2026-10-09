import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkAge } from '../../src/lib/age.ts';

const today = { day: 9, month: 10, year: 2026 };

test('18 today is allowed', () => {
  assert.equal(checkAge({ day: 9, month: 10, year: 2008 }, today), 'ok');
});

test('18 tomorrow is not', () => {
  assert.equal(checkAge({ day: 10, month: 10, year: 2008 }, today), 'under18');
});

test('clearly adult and clearly under 18', () => {
  assert.equal(checkAge({ day: 1, month: 1, year: 1990 }, today), 'ok');
  assert.equal(checkAge({ day: 1, month: 1, year: 2015 }, today), 'under18');
});

test('impossible dates are invalid', () => {
  assert.equal(checkAge({ day: 31, month: 2, year: 2000 }, today), 'invalid');
  assert.equal(checkAge({ day: 29, month: 2, year: 2001 }, today), 'invalid');
  assert.equal(checkAge({ day: 0, month: 5, year: 2000 }, today), 'invalid');
  assert.equal(checkAge({ day: 5, month: 13, year: 2000 }, today), 'invalid');
  assert.equal(checkAge({ day: 1, month: 1, year: 1850 }, today), 'invalid');
  assert.equal(checkAge({ day: 1, month: 1, year: 2030 }, today), 'invalid');
  assert.equal(checkAge({ day: Number.NaN, month: 1, year: 2000 }, today), 'invalid');
});

test('leap day birthday counts from 1 March in non-leap years', () => {
  const born = { day: 29, month: 2, year: 2008 };
  assert.equal(checkAge(born, { day: 28, month: 2, year: 2026 }), 'under18');
  assert.equal(checkAge(born, { day: 1, month: 3, year: 2026 }), 'ok');
});

test('a 29 February birth date in a leap year is accepted as a real date', () => {
  // 18 is not a multiple of 4, so nobody born on 29 February turns 18 in a
  // leap year. Check the date itself is handled and an older runner passes.
  assert.equal(checkAge({ day: 29, month: 2, year: 2008 }, { day: 29, month: 2, year: 2028 }), 'ok');
  assert.equal(checkAge({ day: 29, month: 2, year: 2012 }, { day: 28, month: 2, year: 2030 }), 'under18');
  assert.equal(checkAge({ day: 29, month: 2, year: 2012 }, { day: 1, month: 3, year: 2030 }), 'ok');
});
