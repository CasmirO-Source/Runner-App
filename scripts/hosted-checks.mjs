// Checks that can only be proved on the hosted Supabase project, because the
// local stack behaves differently (milestone 1 step 9):
//   * CORS: no wildcard "any website" header on the Edge Function.
//   * Per-IP limit on sign-in code requests.
//   * Realtime public channels switched off.
// Plus spot checks that the migrations and settings arrived, and the
// screenshot reader's kill switch (milestone 4).
//
// Uses only the public URL and publishable key from .env (never a secret).
// Run it yourself in a terminal: it emails you a sign-in code (or, while the
// project still uses Supabase's default email, a sign-in link). Type the code,
// or paste the link address, into this script. Do not click the link: that
// uses it up. The code, link and session never leave this script.
//
//   node --env-file=.env scripts/hosted-checks.mjs
//
// Afterwards, sign-in requests from this network may be refused for a few
// minutes: the per-IP checks deliberately empty the allowance.
//
// Supabase's per-IP limits are token buckets that hold about 30 requests,
// whatever rate is configured; the configured rate is how fast the bucket
// refills. So the checks keep sending until refused, up to 35 requests.
import { createInterface } from 'node:readline/promises';
import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  console.error('Refusing to run: EXPO_PUBLIC_SUPABASE_URL is not a hosted Supabase project. Run with --env-file=.env (not .env.local).');
  process.exit(1);
}
if (!key || key.startsWith('sb_secret_')) {
  console.error('Refusing to run: needs the publishable key, never a secret key.');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
const call = (path, { method = 'GET', token, body, headers = {} } = {}) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => r.json().catch(() => null);

// A 64 by 64 greyscale gradient as a real PNG, built here so the check needs
// no image files.
function gradientPng() {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  const rows = Buffer.alloc(65 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) rows[y * 65 + 1 + x] = x * 4;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const allowsAnySite = (r) => r.headers.get('access-control-allow-origin') === '*' || r.headers.get('access-control-allow-origin') === 'https://evil.example';

async function realtimeSubscribe(token) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (token) client.realtime.setAuth(token);
  const channel = client.channel(`hosted-check-${Date.now()}`);
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 10000);
    channel.subscribe((s) => {
      if (s !== 'JOINING') {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  await client.removeAllChannels();
  return status;
}

// 1. Signed-out checks ------------------------------------------------------
console.log('\nSigned-out checks');
let r = await call('/rest/v1/profiles?select=id');
check('signed-out visitors cannot read profiles', r.status === 401 || r.status === 403, String(r.status));
r = await call('/rest/v1/', { headers: { Accept: 'application/openapi+json' } });
const spec = await json(r);
check('the API lists no tables or functions to visitors', r.status !== 200 || Object.keys(spec?.paths ?? {}).every((p) => p === '/'), String(r.status));
r = await call('/graphql/v1', { method: 'POST', body: { query: '{ __typename }' } });
check('GraphQL is not available', r.status !== 200, String(r.status));
r = await call('/rest/v1/profiles?select=id', { headers: { 'Accept-Profile': 'graphql_public' } });
check('only the public schema is served', r.status === 406, String(r.status));
r = await call('/functions/v1/profile', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } });
const refusal = await json(r);
check('Edge Function refuses visitors', r.status === 401, String(r.status));
// With verify_jwt on, Supabase's gateway refuses requests with no login token
// before our code runs. Those refusals are Supabase's, carry its own CORS
// header and contain no data. Our function's own replies are checked in the
// signed-in section.
if (refusal?.code === 'UNAUTHORIZED_NO_AUTH_HEADER' || refusal?.code === 'UNAUTHORIZED_INVALID_JWT_FORMAT') {
  console.log(`info  refused by Supabase's gateway (verify_jwt), not our code. Its CORS header: ${r.headers.get('access-control-allow-origin') ?? 'none'}. No data in the reply.`);
} else {
  check('Edge Function reply does not allow other websites (CORS)', !allowsAnySite(r), r.headers.get('access-control-allow-origin') ?? 'no header');
}
r = await call('/functions/v1/profile', {
  method: 'OPTIONS',
  headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
});
console.log(`info  browser preflight from another website: ${r.status}, CORS header ${r.headers.get('access-control-allow-origin') ?? 'none'}`);
const publicRealtime = await realtimeSubscribe(null);
check('Realtime public channels are switched off (visitor)', publicRealtime !== 'SUBSCRIBED', `${publicRealtime}${publicRealtime === 'SUBSCRIBED' ? ': set Realtime to private channels only (Management API private_only, see docs/supabase-dashboard-settings.md)' : ''}`);

// 2. Signed-in checks (your own account) -----------------------------------
console.log('\nSigned-in checks: a sign-in email will be sent to you (your address must be on your Supabase team)');
const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question('Your email address: ')).trim().toLowerCase();
r = await call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
const otpReply = r.status === 200 ? null : await json(r);
check('sign-in email requested', r.status === 200, `${r.status} ${otpReply?.error_code ?? ''}`);
if (r.status === 429) {
  // Explain which limit refused the request, rather than a bare 429.
  const reason = {
    over_email_send_rate_limit:
      "the email limits: one email per address every 12 minutes, and Supabase's default email service sends very few emails per hour per project. Try again later, or finish the Resend setup.",
    over_request_rate_limit: 'the per-IP limit (2 sign-in requests per 5 minutes from this network). Wait 5 minutes.',
  }[otpReply?.error_code] ?? 'a Supabase Auth rate limit.';
  console.log(`info  refused by ${reason} The signed-in checks need a fresh email, so they are skipped this run.`);
}
const answer = otpReply ? '' : (await rl.question('6-digit code, or the sign-in link address (copy it, do not click it). Enter to skip: ')).trim();
rl.close();

// Accept either the code, or a Supabase sign-in link from which the one-time
// token is read. Only links to this project are accepted.
let verifyBody = null;
if (/^\d{6}$/.test(answer)) {
  verifyBody = { type: 'email', email, token: answer };
} else if (answer) {
  try {
    const link = new URL(answer);
    const linkToken = link.searchParams.get('token');
    const linkType = link.searchParams.get('type');
    if (link.origin === url && link.pathname === '/auth/v1/verify' && linkToken && ['magiclink', 'signup', 'email'].includes(linkType)) {
      verifyBody = { type: linkType === 'signup' ? 'signup' : 'magiclink', token_hash: linkToken };
    } else {
      console.log('That link is not a sign-in link for this project. Skipping signed-in checks.');
    }
  } catch {
    console.log('That is neither a 6-digit code nor a link. Skipping signed-in checks.');
  }
}

let token = null;
if (verifyBody) {
  r = await call('/auth/v1/verify', { method: 'POST', body: verifyBody });
  const session = await json(r);
  token = session?.access_token ?? null;
  check('sign-in works', !!token, `${r.status} ${session?.error_code ?? ''}`);
  check('access token lasts 1 hour', session?.expires_in === 3600, String(session?.expires_in));
}

if (token) {
  r = await call('/rest/v1/profiles?select=home_city', { token });
  check('signed-in users cannot read private profile fields', (r.status === 401 || r.status === 403) && (await json(r))?.code === '42501', String(r.status));
  r = await call('/rest/v1/rpc/get_my_profile', { method: 'POST', token, body: {} });
  const mine = await json(r);
  check('get_my_profile works for the signed-in user', r.status === 200, String(r.status));
  if (r.status === 200 && mine.length === 0) {
    // Create a test profile for your account (dev project only), so the
    // sign-out check below has something real to hide.
    const name = `Check_${Math.random().toString(36).slice(2, 10)}`;
    const created = await call('/functions/v1/profile', { method: 'POST', token, body: { action: 'create', display_name: name, avatar_id: 1, over_18: true } });
    check('profile created through the Edge Function', created.status === 201, `${created.status} ${name}`);
  }
  r = await call('/rest/v1/', { token, headers: { Accept: 'application/openapi+json' } });
  const paths = Object.keys((await json(r))?.paths ?? {}).sort().join(' ');
  check('the API lists only the allow-listed routes', r.status !== 200 || paths === '/ /invite_codes /league_members /leagues /profiles /rpc/get_my_profile /rpc/league_runs /rpc/league_standings /runs /seasons', paths || String(r.status));
  r = await call('/functions/v1/profile', { method: 'POST', token, body: { action: 'update' }, headers: { Origin: 'https://evil.example' } });
  const body = await json(r);
  check('Edge Function answers with its own error format', r.status === 400 && body?.error?.code === 'nothing_to_change', `${r.status} ${body?.error?.code ?? ''}`);
  check('Edge Function sets nosniff and no-store', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('cache-control') === 'no-store');
  check("our Edge Function's own replies do not allow other websites (CORS)", !allowsAnySite(r), r.headers.get('access-control-allow-origin') ?? 'no header');
  const signedInRealtime = await realtimeSubscribe(token);
  check('Realtime public channels are switched off (signed in)', signedInRealtime !== 'SUBSCRIBED', signedInRealtime);
  // Leagues (milestone 2). Uses your own league if you run one, otherwise
  // starts "Hosted Check League". The invite code made here is stopped again
  // at the end, so no live code is left behind.
  console.log('\nLeague checks');
  const fn = (name, body) => call(`/functions/v1/${name}`, { method: 'POST', token, body });
  r = await call('/rest/v1/seasons?select=month,starts_at,ends_at&order=month', { token });
  const seasons = await json(r);
  check('seasons exist for this month and next', r.status === 200 && seasons.length >= 2, `${r.status} ${seasons?.length ?? 0}`);
  const me = (await json(await call('/rest/v1/rpc/get_my_profile', { method: 'POST', token, body: {} })))?.[0];
  r = await call('/rest/v1/leagues?select=id,name,owner_id', { token });
  let myLeague = ((await json(r)) ?? []).find((l) => l.owner_id === me?.id);
  if (!myLeague) {
    r = await fn('league', { action: 'create', name: 'Hosted Check League' });
    myLeague = (await json(r))?.league;
    check('league created through the Edge Function', r.status === 201, String(r.status));
  }
  if (myLeague) {
    r = await fn('league', { action: 'create', name: 'Second Check League' });
    check('one open league per runner', r.status === 409, String(r.status));
    r = await call(`/rest/v1/leagues?select=id&id=eq.${myLeague.id}`, { token });
    check('the owner can see their league', ((await json(r)) ?? []).length === 1, String(r.status));
    r = await call(`/rest/v1/leagues?select=*&id=eq.${myLeague.id}`, { token });
    check('select=* on leagues is refused (some columns are never shown)', r.status === 401 || r.status === 403, String(r.status));
    r = await fn('league-invite', { action: 'create', league_id: myLeague.id });
    const inviteCode = (await json(r))?.invite?.code;
    check('the owner makes an invite code', r.status === 201 && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/.test(inviteCode ?? ''), String(r.status));
    r = await call(`/rest/v1/invite_codes?select=code&league_id=eq.${myLeague.id}`, { token });
    check('the owner can see the code', ((await json(r)) ?? []).length === 1, String(r.status));
    r = await fn('league-join', { code: inviteCode?.toLowerCase() });
    check('joining your own league reports already a member', (await json(r))?.status === 'already_member', String(r.status));
    r = await fn('league-join', { code: 'ABCDEFGHJK' });
    check('a wrong code gets the standard refusal', r.status === 404 && (await json(r))?.error?.code === 'invalid_code', String(r.status));
    r = await fn('league-member', { action: 'remove', league_id: myLeague.id, user_id: me?.id });
    check('the owner cannot remove themselves', r.status === 400, String(r.status));
    const stranger = crypto.randomUUID();
    r = await fn('league', { action: 'update', league_id: stranger, name: 'Ghost League' });
    check("a league you are not in gets 'not found'", r.status === 404, String(r.status));
    r = await call('/rest/v1/rpc/league_standings', { method: 'POST', token, body: { p_league_id: stranger } });
    check('standings for a league you are not in are empty', r.status === 200 && ((await json(r)) ?? []).length === 0, String(r.status));
    r = await call('/rest/v1/rpc/join_league', { method: 'POST', token, body: { p_user_id: me?.id, p_code: inviteCode } });
    check('the server-only join function cannot be called directly', r.status >= 400, String(r.status));
    r = await fn('league-invite', { action: 'revoke', league_id: myLeague.id });
    check('the code is stopped again', (await json(r))?.revoked === true, String(r.status));
    r = await fn('league-join', { code: inviteCode });
    check('a stopped code is refused', r.status === 404, String(r.status));
    for (const path of [`/rest/v1/leagues?select=id&id=eq.${myLeague.id}`, `/rest/v1/league_members?select=user_id&league_id=eq.${myLeague.id}`]) {
      const visitor = await call(path);
      check(`signed-out visitors cannot read ${path.split('?')[0].split('/').pop()}`, visitor.status === 401 || visitor.status === 403, String(visitor.status));
    }
  }

  // Runs (milestone 3). Logs two typed-in runs for your account (dev data):
  // one normal, one that fails the checks. Times are spread randomly over
  // the last few days so running the script again does not overlap.
  console.log('\nRun checks');
  const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();
  const normalAt = ago(1 + Math.random() * 60);
  r = await fn('run-manual', { started_at: normalAt, distance_m: 2000, duration_s: 600 });
  let logged = await json(r);
  check('a normal typed-in run is accepted', r.status === 201 && logged?.status === 'accepted', `${r.status} ${logged?.status ?? logged?.error?.code ?? ''}`);
  r = await fn('run-manual', { started_at: normalAt, distance_m: 2000, duration_s: 600 });
  check('the same run again is refused as a duplicate', r.status === 409, String(r.status));
  r = await fn('run-manual', { started_at: ago(70 + Math.random() * 40), distance_m: 300, duration_s: 900 });
  logged = await json(r);
  check('a run failing the checks is saved as flagged, with reasons', logged?.status === 'flagged' && logged.reasons?.length === 2, `${r.status} ${JSON.stringify(logged?.reasons ?? null)}`);
  r = await fn('run-manual', { started_at: ago(2), distance_m: 2000, duration_s: 600, source: 'health' });
  check('the app cannot choose the source', r.status === 400, String(r.status));
  r = await call('/rest/v1/runs?select=id,status,flag_reasons&order=started_at.desc&limit=50', { token });
  const myRuns = (await json(r)) ?? [];
  check('you can see your own runs, including flagged ones', r.status === 200 && myRuns.some((x) => x.status === 'flagged'), `${r.status} ${myRuns.length}`);
  r = await call('/rest/v1/runs?select=*', { token });
  check('select=* on runs is refused (some columns are never shown)', r.status === 401 || r.status === 403, String(r.status));
  r = await call('/rest/v1/runs', { method: 'POST', token, body: { source: 'health', started_at: ago(3), distance_m: 42195, duration_s: 9000, status: 'accepted' } });
  check('runs cannot be written directly', r.status === 401 || r.status === 403, String(r.status));
  r = await call('/rest/v1/rpc/record_run', { method: 'POST', token, body: { p_user_id: me?.id, p_source: 'health', p_started_at: ago(3), p_distance_m: 42195, p_duration_s: 9000, p_external_id: 'x', p_source_app: 'x', p_user_entered: false } });
  check('the server-only record_run cannot be called directly', r.status >= 400, String(r.status));
  if (myLeague) {
    r = await call('/rest/v1/rpc/league_standings', { method: 'POST', token, body: { p_league_id: myLeague.id } });
    const meRow = ((await json(r)) ?? []).find((x) => x.user_id === me?.id);
    check('your league table counts your accepted runs', r.status === 200 && (meRow?.distance_m ?? 0) >= 2000, `${r.status} ${meRow?.distance_m ?? 'none'}`);
    r = await call('/rest/v1/rpc/league_runs', { method: 'POST', token, body: { p_league_id: myLeague.id } });
    const mateRow = ((await json(r)) ?? [])[0];
    check('league runs show distance, date and source only', r.status === 200 && mateRow && Object.keys(mateRow).sort().join(',') === 'display_name,distance_m,run_date,source,user_id', `${r.status} ${mateRow ? Object.keys(mateRow).join(',') : 'none'}`);
  }
  r = await call('/rest/v1/rpc/league_runs', { method: 'POST', token, body: { p_league_id: crypto.randomUUID() } });
  check("runs for a league you are not in are empty", r.status === 200 && ((await json(r)) ?? []).length === 0, String(r.status));
  const visitorRuns = await call('/rest/v1/runs?select=id');
  check('signed-out visitors cannot read runs', visitorRuns.status === 401 || visitorRuns.status === 403, String(visitorRuns.status));

  // Screenshot reader (milestone 4). Sends a plain grey gradient, which is
  // not a run, so nothing is saved. Before the Anthropic key is set the
  // reader must say it is switched off (the kill switch); after, the image
  // must get through the checks and cleaning on the hosted runtime and come
  // back as "not a run". Manual entry was checked above either way.
  console.log('\nScreenshot checks');
  r = await fn('screenshot-read', { image: gradientPng().toString('base64') });
  const readReply = await json(r);
  const readerOff = r.status === 503 && readReply?.error?.code === 'reader_off';
  if (readerOff) {
    check('with no Anthropic key the reader is switched off and offers manual entry', /Type your run in instead/.test(readReply.error.message ?? ''), readReply.error.code);
  } else {
    check('with the key set, a picture that is not a run is cleaned, read and refused', r.status === 422 && readReply?.error?.code === 'not_a_run', `${r.status} ${readReply?.error?.code ?? ''}`);
    r = await fn('screenshot-read', { image: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1').toString('base64') });
    check('a GIF is refused by its contents', r.status === 415 && (await json(r))?.error?.code === 'unsupported_image', String(r.status));
  }
  r = await fn('screenshot-confirm', { reading_id: crypto.randomUUID(), started_at: ago(2), distance_m: 5000, duration_s: 1500 });
  check('confirming a reading that is not yours (or does not exist) is refused', r.status === 404 && (await json(r))?.error?.code === 'reading_unavailable', String(r.status));
  r = await fn('screenshot-confirm', { reading_id: crypto.randomUUID(), started_at: ago(2), distance_m: 5000, duration_s: 1500, source: 'screenshot' });
  check('the app cannot add fields to a confirmation', r.status === 400, String(r.status));
  r = await call('/rest/v1/rpc/save_screenshot_reading', { method: 'POST', token, body: { p_user_id: me?.id, p_dhash: 1, p_distance_m: 5000, p_duration_s: 1500, p_run_date: '2026-01-01', p_start_time: null, p_source_app: null } });
  check('the server-only reading functions cannot be called directly', r.status >= 400, String(r.status));

  // Sign-out must kill the token everywhere at once (migration 4).
  r = await call('/rest/v1/profiles?select=id&limit=1', { token });
  const sawBefore = (await json(r))?.length ?? 0;
  r = await call('/auth/v1/logout?scope=local', { method: 'POST', token });
  check('sign out accepted', r.status === 204, String(r.status));
  const fnAfter = await call('/functions/v1/profile', { method: 'POST', token, body: { action: 'update' } });
  check('after sign-out the Edge Function refuses the old token', fnAfter.status === 401, String(fnAfter.status));
  const restAfter = await call('/rest/v1/profiles?select=id&limit=1', { token });
  const rowsAfter = restAfter.status === 200 ? ((await json(restAfter))?.length ?? 0) : 0;
  check('after sign-out the REST API returns nothing for the old token', rowsAfter === 0, `before: ${sawBefore} row(s), after: ${restAfter.status} ${rowsAfter} row(s)`);
  if (sawBefore === 0) console.log('info  no profiles exist yet on this project, so the REST sign-out check proves less than it could.');
}

// 3. Per-IP limits (run last: they empty this network's allowance).
// Made-up addresses and wrong codes: nothing is created and no email is sent,
// so only the per-IP limiter can refuse these. It is recognised by its own
// error code, so no other limit can make these checks pass by accident.
async function untilRefused(label, makeRequest) {
  const seen = {};
  for (let i = 1; i <= 35; i++) {
    const res = await makeRequest(i);
    const code = (await json(res))?.error_code ?? '';
    if (res.status === 429 && code === 'over_request_rate_limit') {
      check(`${label} are refused once this network's allowance is used up`, true, `refused at request ${i}; before that ${JSON.stringify(seen)}`);
      return;
    }
    seen[`${res.status} ${code}`] = (seen[`${res.status} ${code}`] ?? 0) + 1;
  }
  check(`${label} are refused once this network's allowance is used up`, false, `no per-IP refusal within 35 requests: ${JSON.stringify(seen)}`);
}

console.log('\nPer-IP limits (buckets of about 30, refilled at 2 and 10 per 5 minutes)');
const run = Date.now();
await untilRefused('sign-in code requests', (i) =>
  call('/auth/v1/otp', { method: 'POST', body: { email: `ip-limit-check-${run}-${i}@example.com`, create_user: false } }),
);
await untilRefused('code guesses', (i) =>
  call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: `ip-limit-check-${run}@example.com`, token: String(100000 + i) } }),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
