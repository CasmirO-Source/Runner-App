import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, validateSupabaseConfig } from '../../src/lib/envGuard.ts';

// Builds an unsigned, fake JWT with the given role. Never a real key.
function fakeJwt(role: string): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ iss: 'supabase', role })}.fake-signature`;
}

const URL_OK = 'https://abcdefghijklmnop.supabase.co';

test('accepts an anon JWT', () => {
  assert.equal(validateSupabaseConfig(URL_OK, fakeJwt('anon'), false).url, URL_OK);
});

test('accepts a publishable key', () => {
  assert.doesNotThrow(() => validateSupabaseConfig(URL_OK, 'sb_publishable_abc123', false));
});

test('refuses a service role JWT', () => {
  assert.throws(() => validateSupabaseConfig(URL_OK, fakeJwt('service_role'), false), /service role/);
});

test('refuses a secret key', () => {
  assert.throws(() => validateSupabaseConfig(URL_OK, 'sb_secret_abc123', false), /secret key/);
});

test('refuses an authenticated-user JWT and unknown key formats', () => {
  assert.throws(() => validateSupabaseConfig(URL_OK, fakeJwt('authenticated'), false), ConfigError);
  assert.throws(() => validateSupabaseConfig(URL_OK, 'not-a-key', false), ConfigError);
});

test('refuses missing values', () => {
  assert.throws(() => validateSupabaseConfig(undefined, fakeJwt('anon'), true), /missing/);
  assert.throws(() => validateSupabaseConfig(URL_OK, '', true), /missing/);
});

test('requires https outside development', () => {
  assert.throws(() => validateSupabaseConfig('http://abcdefghijklmnop.supabase.co', fakeJwt('anon'), false), /https/);
  assert.throws(() => validateSupabaseConfig('http://127.0.0.1:54321', fakeJwt('anon'), false), /https/);
});

test('allows plain http only to a local stack in development', () => {
  assert.doesNotThrow(() => validateSupabaseConfig('http://127.0.0.1:54321', fakeJwt('anon'), true));
  assert.doesNotThrow(() => validateSupabaseConfig('http://192.168.1.20:54321', fakeJwt('anon'), true));
  assert.throws(() => validateSupabaseConfig('http://example.com', fakeJwt('anon'), true), /https/);
});
