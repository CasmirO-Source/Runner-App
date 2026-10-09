// Email one-time code sign-in, end to end through the local mail catcher
// (PRD 5.1, 9.3, Appendix A #4, #24, #25).
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { api, callProfile, deleteUsersByEmailSuffix, latestEmailTo, unique } from './helpers.ts';

const run = unique();
const suffix = `-${run}@example.com`;
const email = `otp${suffix}`;

after(async () => {
  await deleteUsersByEmailSuffix(suffix);
});

describe('email code sign-in', () => {
  let code = '';
  let token = '';

  test('requesting a code sends an email with the code and no link', async () => {
    const r = await api('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
    assert.equal(r.status, 200);
    const msg = await latestEmailTo(email);
    assert.ok(msg, 'email arrived');
    assert.equal(msg.Subject, 'Your sign-in code');
    const body = `${msg.Text} ${msg.HTML}`;
    code = /\b(\d{6})\b/.exec(msg.Text || msg.HTML)?.[1] ?? '';
    assert.match(code, /^\d{6}$/);
    assert.doesNotMatch(body, /https?:\/\/|<a\s/i, 'no links');
    assert.ok(!body.includes(String.fromCharCode(0x2014)), 'no em dash');
  });

  test('a second code for the same address within 12 minutes is refused', async () => {
    const r = await api('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
    assert.equal(r.status, 429);
  });

  test('a wrong code is refused', async () => {
    const wrong = code === '000000' ? '111111' : '000000';
    const r = await api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: wrong } });
    assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
  });

  test('the right code signs in with a one-hour access token', async () => {
    const r = await api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code } });
    assert.equal(r.status, 200);
    assert.equal(r.json.expires_in, 3600);
    assert.ok(r.json.refresh_token);
    token = r.json.access_token;
  });

  test('a code works only once', async () => {
    const r = await api('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: code } });
    assert.ok(r.status >= 400, `status ${r.status}`);
  });

  test('signing out ends the session on the server straight away', async () => {
    const out = await api('/auth/v1/logout?scope=local', { method: 'POST', token });
    assert.equal(out.status, 204);
    const user = await api('/auth/v1/user', { token });
    assert.ok(user.status === 401 || user.status === 403, `auth: ${user.status}`);
    const fn = await callProfile(token, { action: 'update', avatar_id: 1 });
    assert.equal(fn.status, 401, 'Edge Function refuses the old token');
  });

  test(
    'code requests are limited per IP address',
    { skip: 'The local Auth server does not enforce per-IP limits. Checked against the hosted dev project in milestone 1 step 9.' },
    () => {},
  );
});

describe('the password route the app never uses', () => {
  const pwEmail = `pw${suffix}`;

  test('weak passwords are refused', async () => {
    const r = await api('/auth/v1/signup', { method: 'POST', body: { email: pwEmail, password: 'weakpass' } });
    assert.equal(r.status, 422);
  });

  test('a password sign-up gets no session until the email address is proved', async () => {
    const r = await api('/auth/v1/signup', { method: 'POST', body: { email: pwEmail, password: 'Str0ng!Passw0rd#2026' } });
    assert.ok(r.status === 200 || r.status === 429, `status ${r.status}`);
    assert.equal(r.json?.access_token, undefined);
  });

  test('password sign-in is refused while the address is unproved', async () => {
    const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: pwEmail, password: 'Str0ng!Passw0rd#2026' } });
    assert.equal(r.json?.access_token, undefined);
    assert.ok(r.status >= 400, `status ${r.status}`);
  });

  test('anonymous sign-in is switched off', async () => {
    const r = await api('/auth/v1/signup', { method: 'POST', body: {} });
    assert.ok(r.status >= 400, `status ${r.status}`);
    assert.equal(r.json?.access_token, undefined);
  });
});

