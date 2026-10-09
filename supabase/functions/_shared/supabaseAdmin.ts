import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The server's Supabase client. It uses the secret (service role) key, which
// skips row-level security, so it only ever exists here inside Edge Functions
// (PRD 9.1 rule 3). Supabase injects the key as an environment variable; it is
// never in Git, .env or the app. The database grants still limit what this
// role can do (see the migrations).
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('Server key is not configured');
}

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = Deno.env.get('SUPABASE_URL');
    if (!url) throw new Error('SUPABASE_URL is not configured');
    client = createClient(url, secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}
