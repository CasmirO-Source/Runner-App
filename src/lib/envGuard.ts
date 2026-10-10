// Checks the two public Supabase values before the app uses them.
//
// The app bundle is public: anyone can unpack it and read every value in it.
// That is fine for the anon (publishable) key, because row-level security
// decides what it can do. It is a disaster for the service role (secret) key,
// which skips row-level security entirely. This guard makes the app refuse to
// start if a secret key is ever pasted into .env by mistake.
//
// Pure function with no React Native imports, so it can be unit tested in Node.

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Plain http is only allowed in development, and only to this machine or the
// local network (for the local Supabase stack running in Docker).
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string') {
      return payload.role;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
  isDev: boolean,
): SupabaseConfig {
  if (!url || !key) {
    throw new ConfigError('Supabase URL or anon key is missing. Copy .env.example to .env and fill it in.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_URL is not a valid URL.');
  }
  const isLocalHttp = parsed.protocol === 'http:' && LOCAL_HOST.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(isDev && isLocalHttp)) {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_URL must use https.');
  }

  if (key.startsWith('sb_secret_')) {
    throw new ConfigError('A Supabase secret key was found in the app config. Remove it now and rotate it in the dashboard.');
  }
  if (key.startsWith('sb_publishable_')) {
    return { url, anonKey: key };
  }
  const role = decodeJwtRole(key);
  if (role === 'service_role') {
    throw new ConfigError('The Supabase service role key was found in the app config. Remove it now and rotate it in the dashboard.');
  }
  if (role !== 'anon') {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_ANON_KEY is not a recognised anon or publishable key.');
  }
  return { url, anonKey: key };
}
