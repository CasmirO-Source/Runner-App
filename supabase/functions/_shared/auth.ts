import type { SupabaseClient } from '@supabase/supabase-js';

import { HttpError } from './http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Works out who is calling from the login token in the Authorization header
// (PRD 9.1 rule 2, Appendix A #4 and #34). The user ID always comes from here,
// never from anything in the request body.
//
// auth.getUser() asks Supabase Auth to check the token, rather than only
// checking its signature. That means a session ended by signing out, or a
// deleted user, is refused immediately, not just when the token expires.
export async function requireUserId(admin: SupabaseClient, req: Request): Promise<string> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(header);
  if (!match) {
    throw new HttpError(401, 'not_signed_in', 'Please sign in again.');
  }
  const { data, error } = await admin.auth.getUser(match[1]);
  const id = data?.user?.id;
  if (error || !id || !UUID.test(id)) {
    throw new HttpError(401, 'not_signed_in', 'Please sign in again.');
  }
  return id;
}
