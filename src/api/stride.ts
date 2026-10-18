import { supabase } from '@/lib/supabase';
import type { MyProfile, StrideEstimate } from '@/types/profile';

import { fromFunctionError, NETWORK_ERROR } from './errors';
import type { Result } from './profile';

export type Rating = { stride: number; created_at: string };

// Your own rating history, oldest first (the access rules return only yours).
export async function getMyRatingHistory(): Promise<Result<Rating[]>> {
  const { data, error } = await supabase
    .from('rating_history')
    .select('stride, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: (data as Rating[]).reverse() };
}

// Sets, changes or clears (null) your estimate, through the profile Edge
// Function. Refused once you are placed.
export async function saveEstimate(estimate: StrideEstimate | null): Promise<Result<MyProfile>> {
  const { data, error } = await supabase.functions.invoke<{ profile: MyProfile }>('profile', {
    body: { action: 'estimate', estimate },
  });
  if (error || !data) return { ok: false, error: await fromFunctionError(error) };
  return { ok: true, data: data.profile };
}
