// Checks that can only be proved on the hosted Supabase project, because the
// local stack behaves differently (milestone 1 step 9):
//   * CORS: no wildcard "any website" header on the Edge Function.
//   * Per-IP limit on sign-in code requests.
//   * Realtime public channels switched off.
// Plus spot checks that the migrations and settings arrived.
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
  check('the API lists only the allow-listed routes', r.status !== 200 || paths === '/ /profiles /rpc/get_my_profile', paths || String(r.status));
  r = await call('/functions/v1/profile', { method: 'POST', token, body: { action: 'update' }, headers: { Origin: 'https://evil.example' } });
  const body = await json(r);
  check('Edge Function answers with its own error format', r.status === 400 && body?.error?.code === 'nothing_to_change', `${r.status} ${body?.error?.code ?? ''}`);
  check('Edge Function sets nosniff and no-store', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('cache-control') === 'no-store');
  check("our Edge Function's own replies do not allow other websites (CORS)", !allowsAnySite(r), r.headers.get('access-control-allow-origin') ?? 'no header');
  const signedInRealtime = await realtimeSubscribe(token);
  check('Realtime public channels are switched off (signed in)', signedInRealtime !== 'SUBSCRIBED', signedInRealtime);
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
