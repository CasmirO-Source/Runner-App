// Milestone 5: Stride and the estimated Stride through the real API
// (PRD 4, 4.5, 8.2).
//
// Cast: A is placed (three verified runs), B is a league-mate with no runs,
// C signs up with an estimate. Verified runs are seeded through record_run in
// the database, exactly as Health sync will call it, because Health sync does
// not exist yet (milestone 3, parked).
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { api, callFunction, callProfile, createRunner, createUser, deleteUsers, isDenied, resetRateLimits, sql, testName, type TestUser } from './helpers.ts';

let A: TestUser;
let B: TestUser;
let C: TestUser | undefined;
let L: string;

function verifiedRun(user: TestUser, daysAgo: number, metres: number, seconds: number): void {
  sql(`select set_config('request.jwt.claims', '{"role":"service_role"}', false);
       select public.record_run('${user.id}', 'health', date_trunc('hour', now()) - interval '${daysAgo} days',
         ${metres}, ${seconds}, gen_random_uuid()::text, 'com.apple.health', false);`);
}

beforeEach(() => resetRateLimits());

before(async () => {
  resetRateLimits();
  [A, B] = [await createRunner('strideA'), await createRunner('strideB')];
  for (const d of [1, 2, 3]) verifiedRun(A, d, 5000, 1500);
  L = (await callFunction('league', A.token, { action: 'create', name: 'Stride Club' })).json.league.id;
  const code = (await callFunction('league-invite', A.token, { action: 'create', league_id: L })).json.invite.code;
  assert.equal((await callFunction('league-join', B.token, { code })).status, 200, 'setup: B joins');
});

after(async () => {
  resetRateLimits();
  sql(`delete from public.leagues where owner_id = '${A.id}'`);
  await deleteUsers([A, B, C]);
});

describe('Stride', () => {
  test('a placed runner reads their own rating history', async () => {
    const r = await api('/rest/v1/rating_history?select=stride,run_id,window_days', { token: A.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 1);
    assert.equal(r.json[0].window_days, 60);
  });

  test("nobody else can read someone's rating history (PRD 8.2)", async () => {
    const r = await api('/rest/v1/rating_history?select=stride', { token: B.token });
    assert.deepEqual(r.json, []);
    const visitor = await api('/rest/v1/rating_history?select=stride');
    assert.ok(visitor.status === 401 || visitor.status === 403);
  });

  test('Stride is public like a display name; the estimate answers are not', async () => {
    const r = await api(`/rest/v1/profiles?select=stride,placement_runs,estimated_stride&id=eq.${A.id}`, { token: B.token });
    assert.equal(r.status, 200);
    assert.ok(r.json[0].stride > 0);
    assert.equal(r.json[0].placement_runs, 3);
    const answers = await api(`/rest/v1/profiles?select=estimate_5k_s&id=eq.${A.id}`, { token: B.token });
    assert.ok(isDenied(answers), 'the 5 km answer is private');
  });

  test('the league table carries each runner\'s Stride and estimate', async () => {
    const s = await api('/rest/v1/rpc/league_standings', { token: B.token, method: 'POST', body: { p_league_id: L } });
    const a = s.json.find((row: { user_id: string }) => row.user_id === A.id);
    const b = s.json.find((row: { user_id: string }) => row.user_id === B.id);
    assert.ok(a.stride > 0);
    assert.equal(b.stride, null, 'B is not placed');
  });

  test('nobody can write a Stride or rating history through the API', async () => {
    assert.ok(isDenied(await api(`/rest/v1/profiles?id=eq.${B.id}`, { token: B.token, method: 'PATCH', body: { stride: 3000 } })));
    const insert = await api('/rest/v1/rating_history', {
      token: B.token,
      method: 'POST',
      body: { run_id: crypto.randomUUID(), stride: 3000, calculated: 3000, speed_score: 1, volume_score: 1, t5_median_s: 780, weekly_km: 60, window_days: 60 },
    });
    assert.ok(isDenied(insert));
    const recalc = await api('/rest/v1/rpc/recalculate_stride', { token: B.token, method: 'POST', body: { p_user_id: B.id, p_run_id: crypto.randomUUID() } });
    assert.ok(recalc.status >= 400, 'the recalculation is not reachable');
    const direct = await api('/rest/v1/rpc/set_stride_estimate', { token: B.token, method: 'POST', body: { p_user_id: B.id, p_5k_s: 780, p_weekly_km: 150 } });
    assert.ok(direct.status >= 400, 'the estimate function is server only');
  });

  test('typed-in runs never change Stride (PRD 10)', async () => {
    const before = await api(`/rest/v1/profiles?select=stride&id=eq.${A.id}`, { token: A.token });
    const r = await callFunction('run-manual', A.token, { started_at: new Date(Date.now() - 5 * 86400_000).toISOString(), distance_m: 5000, duration_s: 1100 });
    assert.equal(r.status, 201);
    const after = await api(`/rest/v1/profiles?select=stride&id=eq.${A.id}`, { token: A.token });
    assert.equal(after.json[0].stride, before.json[0].stride);
  });
});

describe('Estimated Stride (PRD 4.5)', () => {
  test('a new runner can give an estimate when signing up', async () => {
    C = await createUser('strideC');
    const r = await callProfile(C.token, {
      action: 'create',
      display_name: testName('Est'),
      avatar_id: 2,
      over_18: true,
      estimate: { five_k_s: 1500, weekly_km: 15 },
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.profile.estimated_stride, 919, 'the same formula as the real Stride');
    assert.equal(r.json.profile.stride, null);
  });

  test('the estimate can be changed or cleared until placed', async () => {
    let r = await callProfile(B.token, { action: 'estimate', estimate: { five_k_s: null, weekly_km: 10 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.estimated_stride, 125, '"not sure" about 5 km: volume only');
    r = await callProfile(B.token, { action: 'estimate', estimate: null });
    assert.equal(r.json.profile.estimated_stride, null);
  });

  test('answers outside the ranges, or extra fields, are refused', async () => {
    let r = await callProfile(B.token, { action: 'estimate', estimate: { five_k_s: 700, weekly_km: 10 } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.fields.estimate, /13 and 90 minutes/);
    r = await callProfile(B.token, { action: 'estimate', estimate: { five_k_s: 1500, weekly_km: 151 } });
    assert.equal(r.status, 400);
    r = await callProfile(B.token, { action: 'estimate', estimate: { five_k_s: 1500, weekly_km: 10, stride: 3000 } });
    assert.equal(r.status, 400);
  });

  test('once placed, the estimate is closed', async () => {
    const r = await callProfile(A.token, { action: 'estimate', estimate: { five_k_s: 780, weekly_km: 150 } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'already_placed');
  });
});
