import type { SupabaseClient } from '@supabase/supabase-js';

import { HttpError } from './http.ts';

export type RateLimit = {
  scope: string;
  limit: number;
  windowSeconds: number;
};

// PRD 9.3: any Edge Function, any user: 60 per minute per IP. The same cap is
// applied per user as well, because the IP can be shared or spoofed.
export const ANY_FUNCTION_PER_IP: RateLimit = { scope: 'any_function_ip', limit: 60, windowSeconds: 60 };
export const ANY_FUNCTION_PER_USER: RateLimit = { scope: 'any_function_user', limit: 60, windowSeconds: 60 };

// Counts one request and throws HTTP 429 with a Retry-After header when the
// limit is reached. If the counter cannot be reached, the request is refused
// (fail closed): an outage must never switch rate limiting off.
export async function enforceRateLimit(admin: SupabaseClient, rule: RateLimit, subject: string): Promise<void> {
  const { data, error } = await admin
    .rpc('consume_rate_limit', {
      p_scope: rule.scope,
      p_subject: subject,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    })
    .single<{ allowed: boolean; retry_after_seconds: number }>();

  if (error || !data) {
    throw new HttpError(503, 'unavailable', 'We could not handle that just now. Try again in a minute.');
  }
  if (!data.allowed) {
    const seconds = Math.max(1, data.retry_after_seconds);
    throw new HttpError(429, 'rate_limited', `Slow down. Try again in ${seconds} seconds.`, {
      'Retry-After': String(seconds),
    });
  }
}
