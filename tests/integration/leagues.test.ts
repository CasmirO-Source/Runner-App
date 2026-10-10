// Milestone 2 acceptance (PRD section 14): invite codes expire and are
// rate-limited; non-members get nothing back from any league query.
// Also Appendix A #5, #33, #34 and #49: every request naming a league is
// checked against the caller, and each league is walled off from every other.
//
// Cast: A owns league X and B is a member; C owns league Y; D belongs to no
// league. Every call goes through the public API, as a modified app or script
// could make it.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  api,
  callFunction,
  createRunner,
  deleteUsers,
  isDenied,
  resetRateLimits,
  sql,
  type TestUser,
} from './helpers.ts';

let A: TestUser;
let B: TestUser;
let C: TestUser;
let D: TestUser;
let X: string;
let Y: string;
let code = '';
const extra: TestUser[] = [];

const league = (token: string, body: unknown) => callFunction('league', token, body);
const invite = (token: string, body: unknown) => callFunction('league-invite', token, body);
const join = (token: string, body: unknown) => callFunction('league-join', token, body);
const member = (token: string, body: unknown) => callFunction('league-member', token, body);

beforeEach(() => resetRateLimits());

before(async () => {
  resetRateLimits();
  [A, B, C, D] = [await createRunner('lgA'), await createRunner('lgB'), await createRunner('lgC'), await createRunner('lgD')];
  const x = await league(A.token, { action: 'create', name: 'Leeds Lunch Club' });
  const y = await league(C.token, { action: 'create', name: "Cas's Crew" });
  assert.equal(x.status, 201, 'setup: league X');
  assert.equal(y.status, 201, 'setup: league Y');
  X = x.json.league.id;
  Y = y.json.league.id;
  const i = await invite(A.token, { action: 'create', league_id: X });
  code = i.json.invite.code;
  const j = await join(B.token, { code });
  assert.equal(j.json.status, 'joined', 'setup: B joins X');
});

after(async () => {
  resetRateLimits();
  // Leagues reference profiles, so close them before deleting the users.
  sql(`delete from public.leagues where owner_id in (${[A, B, C, D, ...extra].filter(Boolean).map((u) => `'${u.id}'`).join(',')})`);
  await deleteUsers([A, B, C, D, ...extra]);
});

describe('Non-members get nothing back from any league query (acceptance)', () => {
  // Every column a member is allowed to read, so an empty answer means the
  // access rules hid the rows (select=* is refused outright, because some
  // columns are never granted).
  const reads = (leagueId: string) => [
    `/rest/v1/leagues?select=id,name,owner_id,verified_only,member_limit,created_at&id=eq.${leagueId}`,
    `/rest/v1/league_members?select=league_id,user_id,role,joined_at&league_id=eq.${leagueId}`,
    `/rest/v1/invite_codes?select=league_id,code,created_at,expires_at&league_id=eq.${leagueId}`,
  ];

  for (const who of ['C (in another league)', 'D (in no league)']) {
    test(`${who}: every table read for league X is empty`, async () => {
      const user = who.startsWith('C') ? C : D;
      for (const path of reads(X)) {
        const r = await api(path, { token: user.token });
        assert.equal(r.status, 200, path);
        assert.deepEqual(r.json, [], path);
      }
    });

    test(`${who}: standings for league X are empty`, async () => {
      const user = who.startsWith('C') ? C : D;
      const r = await api('/rest/v1/rpc/league_standings', { token: user.token, method: 'POST', body: { p_league_id: X } });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, []);
    });
  }

  test('listing every league shows only your own', async () => {
    const c = await api('/rest/v1/leagues?select=id', { token: C.token });
    assert.deepEqual(c.json.map((l: { id: string }) => l.id), [Y]);
    const d = await api('/rest/v1/leagues?select=id', { token: D.token });
    assert.deepEqual(d.json, []);
    const members = await api('/rest/v1/league_members?select=league_id', { token: C.token });
    assert.ok(members.json.every((m: { league_id: string }) => m.league_id === Y));
  });

  test('members see their league, its members and standings', async () => {
    const l = await api(`/rest/v1/leagues?select=id,name&id=eq.${X}`, { token: B.token });
    assert.deepEqual(l.json, [{ id: X, name: 'Leeds Lunch Club' }]);
    const m = await api(`/rest/v1/league_members?select=user_id,role&league_id=eq.${X}`, { token: B.token });
    assert.deepEqual(m.json.map((r: { user_id: string }) => r.user_id).sort(), [A.id, B.id].sort());
    const s = await api('/rest/v1/rpc/league_standings', { token: B.token, method: 'POST', body: { p_league_id: X } });
    assert.equal(s.json.length, 2);
    assert.deepEqual(Object.keys(s.json[0]).sort(), ['avatar_id', 'display_name', 'distance_m', 'place', 'user_id']);
  });

  test('only the owner can see the invite code', async () => {
    const owner = await api(`/rest/v1/invite_codes?select=code&league_id=eq.${X}`, { token: A.token });
    assert.deepEqual(owner.json, [{ code }]);
    const memberView = await api(`/rest/v1/invite_codes?select=code&league_id=eq.${X}`, { token: B.token });
    assert.deepEqual(memberView.json, []);
  });

  test('select=* is refused, because some columns are never shown', async () => {
    for (const path of [`/rest/v1/leagues?select=*&id=eq.${X}`, `/rest/v1/league_members?select=*&league_id=eq.${X}`, `/rest/v1/invite_codes?select=*`]) {
      const r = await api(path, { token: A.token });
      assert.ok(isDenied(r), `${path}: ${r.status} ${r.json?.code}`);
    }
  });

  test('hidden columns cannot be read or filtered on', async () => {
    const closed = await api(`/rest/v1/leagues?select=closed_at&id=eq.${X}`, { token: A.token });
    assert.ok(isDenied(closed), `${closed.status} ${closed.json?.code}`);
    const left = await api(`/rest/v1/league_members?select=user_id&left_at=is.null`, { token: A.token });
    assert.ok(isDenied(left), `${left.status} ${left.json?.code}`);
    const revoked = await api(`/rest/v1/invite_codes?select=code&revoked_at=is.null`, { token: A.token });
    assert.ok(isDenied(revoked), `${revoked.status} ${revoked.json?.code}`);
  });

  test('signed-out visitors get nothing', async () => {
    for (const path of [...reads(X), '/rest/v1/seasons?select=id']) {
      const r = await api(path, {});
      assert.ok(r.status === 401 || r.status === 403, `${path}: ${r.status}`);
    }
  });

  test('seasons are readable when signed in', async () => {
    const r = await api('/rest/v1/seasons?select=month,starts_at,ends_at&order=month', { token: D.token });
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 2);
  });
});

describe("Requests naming someone else's league are refused", () => {
  test('an outsider cannot change, invite to, revoke or manage league X', async () => {
    const calls = [
      league(C.token, { action: 'update', league_id: X, name: 'Taken Over' }),
      invite(C.token, { action: 'create', league_id: X }),
      invite(C.token, { action: 'revoke', league_id: X }),
      member(C.token, { action: 'remove', league_id: X, user_id: B.id }),
      member(C.token, { action: 'leave', league_id: X }),
    ];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 404, JSON.stringify(r.json));
    const name = sql(`select name from public.leagues where id = '${X}'`);
    assert.equal(name, 'Leeds Lunch Club');
  });

  test('a member cannot do what only the owner can', async () => {
    const calls = [
      league(B.token, { action: 'update', league_id: X, verified_only: true }),
      invite(B.token, { action: 'create', league_id: X }),
      invite(B.token, { action: 'revoke', league_id: X }),
      member(B.token, { action: 'remove', league_id: X, user_id: A.id }),
    ];
    for (const r of await Promise.all(calls)) assert.equal(r.status, 404, JSON.stringify(r.json));
  });

  test('a made-up league ID gets the same answer as someone else\'s league', async () => {
    const r = await league(C.token, { action: 'update', league_id: crypto.randomUUID(), name: 'Ghost League' });
    assert.equal(r.status, 404);
  });

  test('fields the server sets are refused: owner, limit and IDs', async () => {
    for (const body of [
      { action: 'create', name: 'Sneaky League', owner_id: B.id },
      { action: 'create', name: 'Sneaky League', member_limit: 20 },
      { action: 'update', league_id: Y, name: 'Sneaky League', owner_id: D.id },
    ]) {
      const r = await league(C.token, body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const r = await join(D.token, { code, user_id: B.id });
    assert.equal(r.status, 400);
  });

  test('no direct writes to league tables, and no direct calls to the server functions', async () => {
    const writes = [
      api('/rest/v1/leagues', { token: B.token, method: 'POST', body: { name: 'Direct League', owner_id: B.id } }),
      api(`/rest/v1/leagues?id=eq.${X}`, { token: A.token, method: 'PATCH', body: { member_limit: 20 } }),
      api('/rest/v1/league_members', { token: D.token, method: 'POST', body: { league_id: X, user_id: D.id, role: 'member' } }),
      api(`/rest/v1/league_members?league_id=eq.${X}&user_id=eq.${B.id}`, { token: A.token, method: 'DELETE' }),
      api('/rest/v1/invite_codes', { token: A.token, method: 'POST', body: { league_id: X, code: 'ABCDEFGHJK', created_by: A.id } }),
    ];
    for (const r of await Promise.all(writes)) assert.ok(isDenied(r), `${r.status} ${r.json?.code}`);
    for (const fn of ['join_league', 'create_league', 'remove_league_member', 'create_invite_code']) {
      const r = await api(`/rest/v1/rpc/${fn}`, { token: D.token, method: 'POST', body: {} });
      assert.ok(r.status >= 400, `${fn}: ${r.status}`);
    }
    assert.equal(sql(`select count(*) from public.league_members where league_id = '${X}' and left_at is null`), '2');
  });
});

describe('Creating leagues', () => {
  test('one open league per runner', async () => {
    const r = await league(A.token, { action: 'create', name: 'Second League' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'league_limit_reached');
  });

  test('names are checked, with a message for each problem', async () => {
    const cases: [string, number][] = [
      ['ab', 400],
      ['<b>Club</b>', 400],
      ['Admin Crew', 422],
      ['f-u-c-k club', 422],
    ];
    for (const [name, status] of cases) {
      const r = await league(D.token, { action: 'create', name });
      assert.equal(r.status, status, name);
      assert.ok(r.json.error.fields?.name, name);
    }
  });

  test('creating is limited to 5 attempts per day', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await league(A.token, { action: 'create', name: `Extra League ${i}` })).status);
    assert.deepEqual(statuses.slice(0, 5), [409, 409, 409, 409, 409]);
    assert.equal(statuses[5], 429);
  });

  test('the owner can rename and switch on verified-only', async () => {
    const r = await league(C.token, { action: 'update', league_id: Y, name: "Cas's Crew 2", verified_only: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.league.verified_only, true);
  });
});

describe('Invite codes expire, can be revoked, and are rate-limited (acceptance)', () => {
  test('codes are typed any way: case, spaces and hyphens are ignored', async () => {
    const messy = `${code.slice(0, 5).toLowerCase()} - ${code.slice(5)}`;
    const r = await join(B.token, { code: messy });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'already_member');
  });

  test('a new code replaces the old one', async () => {
    const fresh = await invite(C.token, { action: 'create', league_id: Y });
    const newer = await invite(C.token, { action: 'create', league_id: Y });
    assert.equal(fresh.status, 201);
    const old = await join(D.token, { code: fresh.json.invite.code });
    assert.equal(old.status, 404);
    assert.equal(old.json.error.code, 'invalid_code');
    assert.match(newer.json.invite.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
  });

  test('an expired code is refused with the same message as a wrong one', async () => {
    const i = await invite(C.token, { action: 'create', league_id: Y });
    sql(`update public.invite_codes set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where code = '${i.json.invite.code}'`);
    const expired = await join(D.token, { code: i.json.invite.code });
    const wrong = await join(D.token, { code: 'ABCDEFGHJK' });
    assert.equal(expired.status, 404);
    assert.deepEqual(expired.json.error.message, wrong.json.error.message);
  });

  test('a revoked code is refused', async () => {
    const i = await invite(C.token, { action: 'create', league_id: Y });
    const revoke = await invite(C.token, { action: 'revoke', league_id: Y });
    assert.equal(revoke.json.revoked, true);
    const r = await join(D.token, { code: i.json.invite.code });
    assert.equal(r.status, 404);
  });

  test('a full league gives the same message, without naming the league', async () => {
    const i = await invite(A.token, { action: 'create', league_id: X });
    code = i.json.invite.code;
    sql(`update public.leagues set member_limit = 2 where id = '${X}'`);
    const r = await join(D.token, { code });
    sql(`update public.leagues set member_limit = 8 where id = '${X}'`);
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'invalid_code');
    assert.equal(r.json.league_id, undefined);
  });

  test('joining is limited to 10 attempts per hour per user', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await join(D.token, { code: 'ABCDEFGHJK' })).status);
    assert.ok(statuses.slice(0, 10).every((s) => s === 404), statuses.join(','));
    assert.equal(statuses[10], 429);
  });

  test('people joining at the same moment cannot pass the member limit', async () => {
    for (let i = 0; i < 5; i++) extra.push(await createRunner(`rush${i}`));
    resetRateLimits();
    const z = await league(extra[0].token, { action: 'create', name: 'Rush Hour Club' });
    sql(`update public.leagues set member_limit = 3 where id = '${z.json.league.id}'`);
    const zc = (await invite(extra[0].token, { action: 'create', league_id: z.json.league.id })).json.invite.code;
    const results = await Promise.all(extra.slice(1).map((u) => join(u.token, { code: zc })));
    const joined = results.filter((r) => r.status === 200).length;
    assert.equal(joined, 2, results.map((r) => r.status).join(','));
    assert.equal(sql(`select count(*) from public.league_members where league_id = '${z.json.league.id}' and left_at is null`), '3');
  });
});

describe('Leaving and removal end access at once', () => {
  test('the owner removes B, and B immediately sees nothing of league X', async () => {
    const r = await member(A.token, { action: 'remove', league_id: X, user_id: B.id });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'removed');
    assert.deepEqual((await api(`/rest/v1/leagues?select=id&id=eq.${X}`, { token: B.token })).json, []);
    assert.deepEqual((await api(`/rest/v1/league_members?select=user_id&league_id=eq.${X}`, { token: B.token })).json, []);
    const s = await api('/rest/v1/rpc/league_standings', { token: B.token, method: 'POST', body: { p_league_id: X } });
    assert.deepEqual(s.json, []);
    assert.equal(sql(`select count(*) from private.audit_log where action = 'league_member_removed' and league_id = '${X}' and target_user_id = '${B.id}'`), '1');
  });

  test('the owner cannot remove themselves', async () => {
    const r = await member(A.token, { action: 'remove', league_id: X, user_id: A.id });
    assert.equal(r.status, 400);
  });

  test('the owner can leave only as the last member, which closes the league', async () => {
    const i = await invite(A.token, { action: 'create', league_id: X });
    assert.equal((await join(D.token, { code: i.json.invite.code })).status, 200);
    const blocked = await member(A.token, { action: 'leave', league_id: X });
    assert.equal(blocked.status, 409);
    const dLeaves = await member(D.token, { action: 'leave', league_id: X });
    assert.equal(dLeaves.json.status, 'left');
    const closes = await member(A.token, { action: 'leave', league_id: X });
    assert.equal(closes.json.status, 'closed');
    assert.deepEqual((await api(`/rest/v1/leagues?select=id&id=eq.${X}`, { token: A.token })).json, []);
    const again = await join(B.token, { code: i.json.invite.code });
    assert.equal(again.status, 404, 'codes for a closed league stop working');
    const fresh = await league(A.token, { action: 'create', name: 'Leeds Evening Club' });
    assert.equal(fresh.status, 201, 'after closing, A can start a new league');
  });
});
