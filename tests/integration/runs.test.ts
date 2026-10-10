// Milestone 3: runs through the real API (PRD 6, 8.2, 9.3).
//
// Cast: A and B share a league; C is in no league with them. A logs runs by
// hand. Health sync arrives with the development build (steps 4 and 5); its
// rules are covered by the database tests (04_runs).
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { api, callFunction, createRunner, deleteUsers, isDenied, resetRateLimits, sql, type TestUser } from './helpers.ts';

let A: TestUser;
let B: TestUser;
let C: TestUser;
let L: string;
let V: string;

const log = (token: string, body: unknown) => callFunction('run-manual', token, body);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeEach(() => resetRateLimits());

before(async () => {
  resetRateLimits();
  [A, B, C] = [await createRunner('runA'), await createRunner('runB'), await createRunner('runC')];
  L = (await callFunction('league', A.token, { action: 'create', name: 'Run Test Club' })).json.league.id;
  const code = (await callFunction('league-invite', A.token, { action: 'create', league_id: L })).json.invite.code;
  assert.equal((await callFunction('league-join', B.token, { code })).status, 200, 'setup: B joins');
  V = (await callFunction('league', B.token, { action: 'create', name: 'Verified Test Club', verified_only: true })).json.league.id;
  const vcode = (await callFunction('league-invite', B.token, { action: 'create', league_id: V })).json.invite.code;
  assert.equal((await callFunction('league-join', A.token, { code: vcode })).status, 200, 'setup: A joins the verified league');
});

after(async () => {
  resetRateLimits();
  sql(`delete from public.leagues where owner_id in ('${A.id}', '${B.id}', '${C.id}')`);
  await deleteUsers([A, B, C]);
});

describe('Logging a run by hand', () => {
  test('a normal run is accepted and counts in the league table', async () => {
    const r = await log(A.token, { started_at: hoursAgo(2), distance_m: 5000, duration_s: 1500 });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'accepted');
    assert.deepEqual(r.json.reasons, []);
    const s = await api('/rest/v1/rpc/league_standings', { token: B.token, method: 'POST', body: { p_league_id: L } });
    const a = s.json.find((row: { user_id: string }) => row.user_id === A.id);
    assert.equal(a.distance_m, 5000);
  });

  test('a typed-in run does not count in a verified-only league', async () => {
    const s = await api('/rest/v1/rpc/league_standings', { token: A.token, method: 'POST', body: { p_league_id: V } });
    const a = s.json.find((row: { user_id: string }) => row.user_id === A.id);
    assert.equal(a.distance_m, 0);
  });

  test('a run failing checks is saved as flagged, with every reason, and counts for nothing', async () => {
    const r = await log(A.token, { started_at: hoursAgo(5), distance_m: 300, duration_s: 900 });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, 'flagged');
    assert.deepEqual(r.json.reasons, ['distance_out_of_range', 'pace_out_of_range']);
    const s = await api('/rest/v1/rpc/league_standings', { token: A.token, method: 'POST', body: { p_league_id: L } });
    assert.equal(s.json.find((row: { user_id: string }) => row.user_id === A.id).distance_m, 5000);
  });

  test('future and too-old runs are flagged with the right reason', async () => {
    const future = await log(A.token, { started_at: new Date(Date.now() + 86400_000).toISOString(), distance_m: 5000, duration_s: 1500 });
    assert.deepEqual(future.json.reasons, ['in_future']);
    const old = await log(A.token, { started_at: hoursAgo(24 * 8), distance_m: 5000, duration_s: 1500 });
    assert.deepEqual(old.json.reasons, ['too_old']);
  });

  test('an overlapping run is refused as a duplicate', async () => {
    const r = await log(A.token, { started_at: hoursAgo(2), distance_m: 4000, duration_s: 1200 });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'duplicate');
  });

  test('the app cannot choose the source, owner or status', async () => {
    for (const extra of [{ source: 'health' }, { user_id: B.id }, { status: 'accepted' }, { external_id: 'x' }]) {
      const r = await log(A.token, { started_at: hoursAgo(10), distance_m: 5000, duration_s: 1500, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
  });

  test('bad input is refused with a message per field', async () => {
    const r = await log(A.token, { started_at: 'yesterday', distance_m: -5, duration_s: 1.5 });
    assert.equal(r.status, 400);
    assert.ok(r.json.error.fields.started_at);
    assert.ok(r.json.error.fields.distance_m);
    assert.ok(r.json.error.fields.duration_s);
  });

  test('logging is limited to 10 per day per user (PRD 9.3)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await log(C.token, { started_at: hoursAgo(30 + i), distance_m: 2000, duration_s: 600 })).status);
    }
    assert.ok(statuses.slice(0, 10).every((s) => s === 201), statuses.join(','));
    assert.equal(statuses[10], 429);
  });

  test('signed-out visitors cannot log runs', async () => {
    const r = await callFunction('run-manual', undefined, { started_at: hoursAgo(1), distance_m: 5000, duration_s: 1500 });
    assert.equal(r.status, 401);
  });
});

describe('Who can see runs (PRD 8.2, owner decision 7)', () => {
  const cols = 'id,source,started_at,distance_m,duration_s,status,flag_reasons,created_at';

  test('you see all your own runs, including flagged ones and why', async () => {
    const r = await api(`/rest/v1/runs?select=${cols}&order=started_at.desc`, { token: A.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 3);
    assert.ok(r.json.some((run: { status: string; flag_reasons: string[] }) => run.status === 'flagged' && run.flag_reasons.length > 0));
  });

  test("a league-mate cannot read your runs table rows, only distance, date and source", async () => {
    const direct = await api(`/rest/v1/runs?select=${cols}`, { token: B.token });
    assert.ok(direct.json.every((run: { id: string }) => sql(`select user_id from public.runs where id = '${run.id}'`) === B.id));
    const mates = await api('/rest/v1/rpc/league_runs', { token: B.token, method: 'POST', body: { p_league_id: L } });
    assert.equal(mates.status, 200);
    const mine = mates.json.filter((run: { user_id: string }) => run.user_id === A.id);
    assert.equal(mine.length, 1, 'only accepted runs');
    assert.deepEqual(Object.keys(mine[0]).sort(), ['display_name', 'distance_m', 'run_date', 'source', 'user_id']);
  });

  test('someone outside the league sees none of your runs', async () => {
    const direct = await api(`/rest/v1/runs?select=${cols}&id=not.is.null`, { token: C.token });
    assert.ok(direct.json.every((run: { id: string }) => sql(`select user_id from public.runs where id = '${run.id}'`) === C.id));
    const mates = await api('/rest/v1/rpc/league_runs', { token: C.token, method: 'POST', body: { p_league_id: L } });
    assert.deepEqual(mates.json, []);
    const table = await api('/rest/v1/rpc/league_standings', { token: C.token, method: 'POST', body: { p_league_id: L } });
    assert.deepEqual(table.json, []);
  });

  test('hidden run details cannot be read or filtered on', async () => {
    for (const path of ['/rest/v1/runs?select=user_id', '/rest/v1/runs?select=external_id', '/rest/v1/runs?select=*', `/rest/v1/runs?select=id&user_id=eq.${B.id}`]) {
      const r = await api(path, { token: A.token });
      assert.ok(isDenied(r), `${path}: ${r.status} ${r.json?.code}`);
    }
  });

  test('nobody can write runs directly or call the server-only function', async () => {
    const insert = await api('/rest/v1/runs', {
      token: A.token,
      method: 'POST',
      body: { user_id: A.id, source: 'health', started_at: hoursAgo(3), distance_m: 42195, duration_s: 9000, status: 'accepted' },
    });
    assert.ok(isDenied(insert), `${insert.status}`);
    const patch = await api(`/rest/v1/runs?status=eq.flagged`, { token: A.token, method: 'PATCH', body: { status: 'accepted' } });
    assert.ok(isDenied(patch), `${patch.status}`);
    const rpc = await api('/rest/v1/rpc/record_run', {
      token: A.token,
      method: 'POST',
      body: { p_user_id: A.id, p_source: 'health', p_started_at: hoursAgo(3), p_distance_m: 42195, p_duration_s: 9000, p_external_id: 'x', p_source_app: 'x', p_user_entered: false },
    });
    assert.ok(rpc.status >= 400, `${rpc.status}`);
    assert.equal(sql(`select count(*) from public.runs where user_id = '${A.id}' and source = 'health'`), '0');
  });

  test('signed-out visitors see no runs', async () => {
    const r = await api('/rest/v1/runs?select=id', {});
    assert.ok(r.status === 401 || r.status === 403, `${r.status}`);
  });
});
