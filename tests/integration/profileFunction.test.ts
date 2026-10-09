// The profile Edge Function and the shared framework every function uses:
// input validation, error handling, security headers and rate limits
// (PRD 9.2, 9.3, Appendix A #12, #16, #27, #28, #46).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { callProfile, createUser, deleteUsers, resetRateLimits, sql, testName, waitForFreshMinute, type TestUser } from './helpers.ts';

let A: TestUser;
let B: TestUser;
let C: TestUser;
let D: TestUser;
let nameA: string;

before(async () => {
  resetRateLimits();
  A = await createUser('fn-a');
  B = await createUser('fn-b');
  C = await createUser('fn-c');
  D = await createUser('fn-d');
  nameA = testName('Sam Smith');
  const r = await callProfile(A.token, { action: 'create', display_name: `  ${nameA}  `, avatar_id: 3, over_18: true });
  assert.equal(r.status, 201, 'setup: A profile');
});

after(async () => {
  resetRateLimits();
  await deleteUsers([A, B, C, D]);
});

describe('creating a profile', () => {
  test('names are tidied (trimmed) and the profile belongs to the caller', async () => {
    const r = await callProfile(B.token, { action: 'create', display_name: testName('Jordan'), avatar_id: 4, over_18: true });
    assert.equal(r.status, 201);
    assert.equal(r.json.profile.id, B.id);
    assert.equal(r.json.profile.over_18, true);
  });

  test('a second create is refused', async () => {
    const r = await callProfile(A.token, { action: 'create', display_name: testName('Other'), avatar_id: 1, over_18: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'profile_exists');
  });

  test("someone else's name in different capitals or with underscores is taken", async () => {
    const r = await callProfile(C.token, { action: 'create', display_name: nameA.toUpperCase().replace(/ /g, '_'), avatar_id: 1, over_18: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'name_taken');
    assert.match(r.json.error.fields.display_name, /taken/);
  });

  test('reserved and offensive names are refused with a friendly message', async () => {
    for (const name of ['Admin', 'f_u_c_k']) {
      const r = await callProfile(C.token, { action: 'create', display_name: name, avatar_id: 1, over_18: true });
      assert.equal(r.status, 422, name);
      assert.match(r.json.error.fields.display_name, /isn't allowed/);
    }
  });

  test('under 18 is refused', async () => {
    const r = await callProfile(C.token, { action: 'create', display_name: testName('Young'), avatar_id: 1, over_18: false });
    assert.equal(r.status, 400);
    assert.ok(r.json.error.fields.over_18);
  });

  test('bad fields each get their own message', async () => {
    const r = await callProfile(C.token, { action: 'create', display_name: 'x<script>', avatar_id: 99, home_city: '<b>', over_18: true });
    assert.equal(r.status, 400);
    assert.ok(r.json.error.fields.display_name);
    assert.ok(r.json.error.fields.avatar_id);
    assert.ok(r.json.error.fields.home_city);
  });

  test('wrong types are refused', async () => {
    const r = await callProfile(C.token, { action: 'create', display_name: 123, avatar_id: '1', over_18: 'true' });
    assert.equal(r.status, 400);
  });

  test('unknown actions are refused', async () => {
    const r = await callProfile(C.token, { action: 'delete' });
    assert.equal(r.status, 400);
  });
});

describe('updating a profile', () => {
  test('the caller can change their name, avatar and city', async () => {
    const r = await callProfile(A.token, { action: 'update', display_name: testName('Fast Sam'), avatar_id: 7, home_city: "King's Lynn" });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.avatar_id, 7);
    assert.equal(r.json.profile.home_city, "King's Lynn");
  });

  test('an empty city clears it', async () => {
    const r = await callProfile(A.token, { action: 'update', home_city: '' });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.home_city, null);
  });

  test('over_18 cannot be changed', async () => {
    const r = await callProfile(A.token, { action: 'update', over_18: false });
    assert.equal(r.status, 400);
  });

  test('an update with nothing in it is refused', async () => {
    const r = await callProfile(A.token, { action: 'update' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'nothing_to_change');
  });

  test('updating before creating a profile is refused', async () => {
    const r = await callProfile(C.token, { action: 'update', avatar_id: 2 });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'profile_missing');
  });
});

describe('request handling', () => {
  test('only POST is accepted', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const r = await callProfile(A.token, method === 'GET' || method === 'DELETE' ? undefined : {}, { method });
      assert.equal(r.status, 405, method);
    }
  });

  test('non-JSON bodies are refused', async () => {
    const r = await callProfile(A.token, undefined, { rawBody: 'hello', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.status, 415);
  });

  test('broken JSON is refused', async () => {
    const r = await callProfile(A.token, undefined, { rawBody: '{"action":"update",' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'invalid_json');
  });

  test('oversized bodies are refused', async () => {
    const r = await callProfile(A.token, undefined, { rawBody: JSON.stringify({ action: 'update', display_name: 'a'.repeat(20000) }) });
    assert.equal(r.status, 413);
  });

  test('errors carry a code, a readable message and a reference, never internals', async () => {
    const r = await callProfile(A.token, { action: 'update' });
    assert.equal(typeof r.json.error.code, 'string');
    assert.equal(typeof r.json.error.message, 'string');
    assert.match(r.json.error.ref, /^[0-9a-f]{8}$/);
    assert.doesNotMatch(JSON.stringify(r.json), /stack|violates|constraint|postgres|at \w+ \(/i);
  });

  test('responses set the security headers', async () => {
    const r = await callProfile(A.token, { action: 'update', avatar_id: 3 });
    assert.match(r.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test(
    'no CORS header allows browser access',
    { skip: 'The local API gateway adds a wildcard CORS header to every route. Checked against the hosted dev project in milestone 1 step 9.' },
    () => {},
  );
});

describe('rate limits', () => {
  test('profile edits are capped at 20 per hour per user, with Retry-After', async () => {
    resetRateLimits();
    let last;
    for (let i = 0; i < 21; i++) {
      last = await callProfile(A.token, { action: 'update', avatar_id: (i % 12) + 1 });
    }
    assert.equal(last!.status, 429);
    assert.equal(last!.json.error.code, 'rate_limited');
    const wait = Number(last!.headers.get('retry-after'));
    assert.ok(wait > 0 && wait <= 3600, `retry-after ${wait}`);
  });

  // Every profile request also counts towards the 20 edits per hour cap, so
  // the 60 per minute limits are tested without one user reaching 20.

  test('one IP is capped at 60 requests a minute across users', async () => {
    resetRateLimits();
    await waitForFreshMinute();
    const users = [A, B, C, D];
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const r = await callProfile(users[i % users.length].token, { action: 'update' });
      statuses.push(r.status);
    }
    assert.equal(statuses.slice(0, 60).filter((s) => s === 429).length, 0, 'first 60 are not rate limited');
    assert.equal(statuses[60], 429, 'request 61 from the same IP is rate limited');
  });

  test('a user at 60 requests this minute is refused, even with a faked IP header', async () => {
    resetRateLimits();
    await waitForFreshMinute();
    // Use up C's per-user allowance for this minute through the same counting
    // function the Edge Functions call.
    sql(`do $$ begin
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      for i in 1..60 loop
        perform public.consume_rate_limit('any_function_user', '${C.id}', 60, 60);
      end loop;
    end $$`);
    const r = await callProfile(C.token, { action: 'update' }, { headers: { 'X-Forwarded-For': '203.0.113.77' } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    const other = await callProfile(D.token, { action: 'update' }, { headers: { 'X-Forwarded-For': '203.0.113.77' } });
    assert.notEqual(other.status, 429, 'other users are not affected');
  });
});
