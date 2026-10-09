// Shared helpers for integration tests. These run against the LOCAL Supabase
// stack only (started with `npx supabase start`), through the same public API
// routes the app and any attacker would use. Run them with
// `npm run test:integration`, which supplies the environment below.
import { execFileSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run the tests with npm run test:integration.`);
  return value;
};

export const env = {
  apiUrl: required('API_URL'),
  publishableKey: required('PUBLISHABLE_KEY'),
  serviceRoleKey: required('SERVICE_ROLE_KEY'),
  mailpitUrl: required('MAILPIT_URL'),
  dbContainer: process.env.DB_CONTAINER ?? 'supabase_db_Runner-App',
};

// Never point these tests at a hosted project: they create and delete users
// with the local stack's admin key.
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.apiUrl)) {
  throw new Error('Integration tests only run against the local Supabase stack.');
}

const adminHeaders = {
  apikey: env.serviceRoleKey,
  Authorization: `Bearer ${env.serviceRoleKey}`,
  'Content-Type': 'application/json',
};

export const unique = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// A display name that passes every rule and is unique to this run.
export const testName = (prefix: string): string => `${prefix}${unique().slice(-10)}`.slice(0, 20);

export type TestUser = { id: string; email: string; token: string; client: SupabaseClient };

// Signs a fresh user in without sending email (the admin API hands back the
// one-time code). The real email journey is tested separately in auth.test.ts.
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${unique()}@example.com`;
  const link = await fetch(`${env.apiUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ type: 'magiclink', email }),
  }).then((r) => r.json());
  const otp = link.email_otp ?? link.properties?.email_otp;
  const session = await fetch(`${env.apiUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: env.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', email, token: otp }),
  }).then((r) => r.json());
  if (!session.access_token) throw new Error(`Could not sign in test user ${label}`);
  return { id: session.user.id, email, token: session.access_token, client: userClient(session.access_token) };
}

export function userClient(token: string): SupabaseClient {
  return createClient(env.apiUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function deleteUsers(users: Array<TestUser | undefined>): Promise<void> {
  for (const user of users) {
    if (user) await fetch(`${env.apiUrl}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: adminHeaders });
  }
}

export async function deleteUsersByEmailSuffix(suffix: string): Promise<void> {
  const list = await fetch(`${env.apiUrl}/auth/v1/admin/users?per_page=1000`, { headers: adminHeaders }).then((r) => r.json());
  for (const u of list.users ?? []) {
    if (typeof u.email === 'string' && u.email.endsWith(suffix)) {
      await fetch(`${env.apiUrl}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: adminHeaders });
    }
  }
}

export type ApiResponse = { status: number; json: any; headers: Headers };

// Raw HTTP call to the API gateway, exactly as a script or attacker could make.
// token: a user's access token, or omitted to call as a signed-out visitor.
export async function api(
  path: string,
  options: { token?: string; method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    apikey: env.publishableKey,
    Authorization: `Bearer ${options.token ?? env.publishableKey}`,
    ...(options.body !== undefined || options.rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  const res = await fetch(`${env.apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

export const callProfile = (token: string | undefined, body: unknown, options: Parameters<typeof api>[1] = {}) =>
  api('/functions/v1/profile', { method: 'POST', token, body, ...options });

// Reads or resets state directly in the local database (as the database
// owner) so tests can check what really changed, independently of the API.
export function sql(query: string): string {
  return execFileSync('docker', ['exec', env.dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

export function resetRateLimits(): void {
  sql('delete from private.rate_limits');
}

// Rate limits use one-minute windows aligned to the clock. Start a burst early
// in a window so it cannot straddle two windows and reset halfway.
export async function waitForFreshMinute(): Promise<void> {
  const second = new Date().getSeconds();
  if (second > 40) await new Promise((r) => setTimeout(r, (61 - second) * 1000));
}

export async function latestEmailTo(address: string): Promise<{ Subject: string; Text: string; HTML: string } | null> {
  for (let i = 0; i < 30; i++) {
    const list = await fetch(`${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`).then((r) => r.json());
    if (list.messages?.length) {
      return fetch(`${env.mailpitUrl}/api/v1/message/${list.messages[0].ID}`).then((r) => r.json());
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export const isDenied = (r: ApiResponse): boolean => (r.status === 401 || r.status === 403) && r.json?.code === '42501';
