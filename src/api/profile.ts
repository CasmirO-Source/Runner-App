import { supabase } from '@/lib/supabase';
import type { MyProfile, StrideEstimate } from '@/types/profile';

import { fromFunctionError, NETWORK_ERROR, type AppError } from './errors';

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

// Reads the signed-in user's own profile, private fields included. Returns null
// if they have not set one up yet. The database picks the row from the login
// token, so this can never return someone else's profile.
export async function getMyProfile(): Promise<Result<MyProfile | null>> {
  const { data, error } = await supabase.rpc('get_my_profile').maybeSingle<MyProfile>();
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: data ?? null };
}

export type CreateProfileInput = {
  display_name: string;
  avatar_id: number;
  over_18: true;
  estimate?: StrideEstimate;
};

// Profiles are only ever written through the profile Edge Function. The app
// has no write access to the table.
export async function createProfile(input: CreateProfileInput): Promise<Result<MyProfile>> {
  const { data, error } = await supabase.functions.invoke<{ profile: MyProfile }>('profile', {
    body: { action: 'create', ...input },
  });
  if (error || !data) return { ok: false, error: await fromFunctionError(error) };
  return { ok: true, data: data.profile };
}
