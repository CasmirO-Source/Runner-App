import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanCode, displayNameProblem, looksLikeEmail, normaliseDisplayName } from '../../src/lib/validation.ts';

test('display names match the server rules', () => {
  assert.equal(displayNameProblem('Sam'), null);
  assert.equal(displayNameProblem('Fast_Sam 99'), null);
  assert.equal(displayNameProblem('  Sam   Smith  '), null);
  assert.match(displayNameProblem('Al') ?? '', /at least 3/);
  assert.match(displayNameProblem('a'.repeat(21)) ?? '', /up to 20/);
  assert.match(displayNameProblem('Zoë') ?? '', /letters, numbers/);
  assert.match(displayNameProblem('<b>hi</b>') ?? '', /letters, numbers/);
  assert.equal(normaliseDisplayName('  Sam   Smith '), 'Sam Smith');
});

test('email shape check', () => {
  assert.ok(looksLikeEmail('  Cas@Example.co.uk '));
  assert.ok(!looksLikeEmail('cas@'));
  assert.ok(!looksLikeEmail('cas example.com'));
  assert.ok(!looksLikeEmail(`${'a'.repeat(250)}@x.com`));
});

test('codes keep digits only, max 6', () => {
  assert.equal(cleanCode(' 12 34-56 7'), '123456');
  assert.equal(cleanCode('abc'), '');
});
