// Milestone 1 acceptance test (PRD section 14, Appendix A #6, #33, #34, #49).
//
// Two signed-in users, A and B. A tries every route the backend offers to
// read B's private data or change B's profile, and to reach anything the app
// should never touch. Every attempt goes through the public API exactly as a
// modified app or a script with the public key could make it.
//
// Leagues do not exist yet (milestone 2). That milestone adds its own cases to
// this file: a member of one league sees nothing from another.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  api,
  callProfile,
  createUser,
  deleteUsers,

  isDenied,
  resetRateLimits,
  sql,
  testName,
  type TestUser,
} from './helpers.ts';

let A: TestUser;
let B: TestUser;
let nameA: string;
let nameB: string;

before(async () => {
  resetRateLimits();
  A = await createUser('iso-a');
  B = await createUser('iso-b');
  nameA = testName('RunnerA');
  nameB = testName('RunnerB');
  const ra = await callProfile(A.token, { action: 'create', display_name: nameA, avatar_id: 1, home_city: 'Leeds', over_18: true });
  const rb = await callProfile(B.token, { action: 'create', display_name: nameB, avatar_id: 2, home_city: 'Bristol', over_18: true });
  assert.equal(ra.status, 201, 'setup: A profile');
  assert.equal(rb.status, 201, 'setup: B profile');
});

after(async () => {
  await deleteUsers([A, B]);
});

const bRow = () => sql(`select display_name || '|' || avatar_id || '|' || coalesce(home_city, '') from public.profiles where id = '${B.id}'`);

describe("A cannot read B's private fields", () => {
  for (const column of ['home_city', 'over_18', 'created_at', 'updated_at', '*']) {
    test(`REST select=${column} on B's row is refused`, async () => {
      const r = await api(`/rest/v1/profiles?select=${encodeURIComponent(column)}&id=eq.${B.id}`, { token: A.token });
      assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
    });
  }

  test('supabase-js select of home_city is refused', async () => {
    const { data, error } = await A.client.from('profiles').select('home_city').eq('id', B.id);
    assert.equal(data, null);
    assert.equal(error?.code, '42501');
  });

  test('filtering on a private column is refused (no guessing by search)', async () => {
    const r = await api(`/rest/v1/profiles?select=id&home_city=eq.Bristol`, { token: A.token });
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
  });

  test("A sees only B's public fields (by design, PRD 8.2)", async () => {
    const r = await api(`/rest/v1/profiles?select=id,display_name,avatar_id&id=eq.${B.id}`, { token: A.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, [{ id: B.id, display_name: nameB, avatar_id: 2 }]);
  });

  test('get_my_profile returns only the caller, with their own private fields', async () => {
    const ra = await api('/rest/v1/rpc/get_my_profile', { token: A.token, method: 'POST', body: {} });
    assert.equal(ra.status, 200);
    assert.equal(ra.json.length, 1);
    assert.equal(ra.json[0].id, A.id);
    assert.equal(ra.json[0].home_city, 'Leeds');
    const rb = await api('/rest/v1/rpc/get_my_profile', { token: B.token, method: 'POST', body: {} });
    assert.deepEqual(rb.json.map((p: { id: string }) => p.id), [B.id]);
  });

  test("get_my_profile cannot be pointed at someone else's ID", async () => {
    const r = await api('/rest/v1/rpc/get_my_profile', { token: A.token, method: 'POST', body: { id: B.id } });
    assert.notEqual(r.status, 200, 'the function takes no arguments, so this call does not match it');
    const q = await api(`/rest/v1/rpc/get_my_profile?id=eq.${B.id}`, { token: A.token, method: 'POST', body: {} });
    assert.ok(q.status !== 200 || q.json.length === 0, 'a filter on the result can only narrow A\'s own row');
  });
});

describe("A cannot change B's profile, or write any profile directly", () => {
  test("REST update of B's row is refused and B is unchanged", async () => {
    const before = bRow();
    const r = await api(`/rest/v1/profiles?id=eq.${B.id}`, { token: A.token, method: 'PATCH', body: { display_name: 'Hacked' } });
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
    assert.equal(bRow(), before);
  });

  test('REST update of own row is refused (writes go through the Edge Function only)', async () => {
    const r = await api(`/rest/v1/profiles?id=eq.${A.id}`, { token: A.token, method: 'PATCH', body: { avatar_id: 5 } });
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
  });

  test('REST insert is refused', async () => {
    const r = await api('/rest/v1/profiles', {
      token: A.token,
      method: 'POST',
      body: { id: B.id, display_name: 'Imposter', avatar_id: 1, over_18: true },
    });
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
  });

  test("REST delete of B's row is refused and B still exists", async () => {
    const r = await api(`/rest/v1/profiles?id=eq.${B.id}`, { token: A.token, method: 'DELETE' });
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
    assert.notEqual(bRow(), '');
  });

  test("Edge Function refuses B's ID in the body", async () => {
    const before = bRow();
    for (const field of ['id', 'user_id', 'userId']) {
      const r = await callProfile(A.token, { action: 'update', [field]: B.id, display_name: 'Hacked' });
      assert.equal(r.status, 400, `${field}: ${r.status}`);
    }
    assert.equal(bRow(), before);
  });

  test("Edge Function update only ever changes the caller's own row", async () => {
    const before = bRow();
    const newName = testName('Renamed');
    const r = await callProfile(A.token, { action: 'update', display_name: newName });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.id, A.id);
    assert.equal(sql(`select display_name from public.profiles where id = '${A.id}'`), newName);
    assert.equal(bRow(), before);
  });
});

describe('A cannot touch rate limits or run server-only functions', () => {
  test('rate_limits is not reachable in the public schema', async () => {
    const r = await api('/rest/v1/rate_limits?select=*', { token: A.token });
    assert.ok(r.status >= 400, `status ${r.status}`);
  });

  test('asking for the private schema is refused', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const r = await api('/rest/v1/rate_limits?select=*', {
        token: A.token,
        method,
        body: method === 'POST' ? { bucket: 'x', window_start: new Date().toISOString(), hits: 0 } : undefined,
        headers: method === 'GET' ? { 'Accept-Profile': 'private' } : { 'Content-Profile': 'private' },
      });
      assert.equal(r.status, 406, `${method}: ${r.status} ${r.json?.code}`);
    }
  });

  test('consume_rate_limit cannot be called by a user, so limits cannot be used up or reset', async () => {
    const before = sql('select count(*) from private.rate_limits');
    const r = await api('/rest/v1/rpc/consume_rate_limit', {
      token: A.token,
      method: 'POST',
      body: { p_scope: 'any_function_user', p_subject: B.id, p_limit: 1, p_window_seconds: 60 },
    });
    assert.ok(r.status === 401 || r.status === 403 || r.status === 404, `status ${r.status}`);
    assert.equal(sql('select count(*) from private.rate_limits'), before);
  });

  test('private helper functions are not reachable', async () => {
    const r = await api('/rest/v1/rpc/display_name_is_clean', { token: A.token, method: 'POST', body: { p_name: 'x' } });
    assert.ok(r.status >= 400, `status ${r.status}`);
  });

  test('the API lists only the allow-listed routes to a signed-in user', async () => {
    const r = await api('/rest/v1/', { token: A.token, headers: { Accept: 'application/openapi+json' } });
    assert.equal(r.status, 200);
    // Server-only functions (create_league, join_league and so on) must never
    // appear here: signed-in users cannot run them.
    assert.deepEqual(Object.keys(r.json.paths).sort(), [
      '/',
      '/invite_codes',
      '/league_members',
      '/leagues',
      '/profiles',
      '/rating_history',
      '/rpc/get_my_profile',
      '/rpc/league_runs',
      '/rpc/league_standings',
      '/runs',
      '/seasons',
    ]);
  });
});

describe('Forged and missing tokens', () => {
  // A's real token with the user ID inside swapped for B's. The signature no
  // longer matches, so every route must refuse it.
  const forged = () => {
    const [header, payload, signature] = A.token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.sub = B.id;
    return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  };

  test('forged token is refused by the REST API', async () => {
    const r = await api('/rest/v1/rpc/get_my_profile', { token: forged(), method: 'POST', body: {} });
    assert.equal(r.status, 401);
  });

  test('forged token is refused by the Edge Function', async () => {
    const r = await callProfile(forged(), { action: 'update', display_name: 'Hacked' });
    assert.equal(r.status, 401);
  });

  test('signed-out visitors can read no profile data at all', async () => {
    const r = await api('/rest/v1/profiles?select=id,display_name', {});
    assert.ok(isDenied(r), `status ${r.status} code ${r.json?.code}`);
    const fn = await api('/rest/v1/rpc/get_my_profile', { method: 'POST', body: {} });
    assert.ok(fn.status === 401 || fn.status === 403 || fn.status === 404, `status ${fn.status}`);
  });

  test('signed-out visitors cannot call the Edge Function', async () => {
    const r = await callProfile(undefined, { action: 'create', display_name: 'Ghost', avatar_id: 1, over_18: true });
    assert.equal(r.status, 401);
  });

  test('the API lists nothing to a signed-out visitor', async () => {
    const r = await api('/rest/v1/', { headers: { Accept: 'application/openapi+json' } });
    assert.ok(r.status !== 200 || Object.keys(r.json.paths ?? {}).every((p) => p === '/'));
  });
});

describe('A signed-out token stops working on the REST API at once (migration 4)', () => {
  test('profile reads return nothing after sign-out', async () => {
    const E = await createUser('iso-e');
    try {
      const created = await callProfile(E.token, { action: 'create', display_name: testName('Leaver'), avatar_id: 4, over_18: true });
      assert.equal(created.status, 201);
      const before = await api('/rest/v1/rpc/get_my_profile', { token: E.token, method: 'POST', body: {} });
      assert.equal(before.json.length, 1, 'own profile visible while signed in');
      const list = await api('/rest/v1/profiles?select=id&limit=1', { token: E.token });
      assert.equal(list.json.length, 1, 'public fields visible while signed in');

      const out = await api('/auth/v1/logout?scope=local', { method: 'POST', token: E.token });
      assert.equal(out.status, 204);

      const after = await api('/rest/v1/rpc/get_my_profile', { token: E.token, method: 'POST', body: {} });
      assert.ok(after.status !== 200 || after.json.length === 0, 'own profile no longer readable');
      const listAfter = await api(`/rest/v1/profiles?select=id,display_name&id=eq.${B.id}`, { token: E.token });
      assert.ok(listAfter.status !== 200 || listAfter.json.length === 0, "others' public fields no longer readable");
    } finally {
      await deleteUsers([E]);
    }
  });
});

describe('Other routes are closed', () => {
  test('GraphQL is not available', async () => {
    const r = await api('/graphql/v1', { token: A.token, method: 'POST', body: { query: '{ __typename }' } });
    assert.notEqual(r.status, 200);
  });

  test('no storage buckets are visible', async () => {
    const { data } = await A.client.storage.listBuckets();
    assert.deepEqual(data ?? [], []);
  });

  test(
    'public Realtime broadcast between users is switched off',
    { skip: 'The local stack resets this setting on start. Checked against the hosted dev project in milestone 1 step 9 ("Allow public access" off).' },
    () => {},
  );
});
