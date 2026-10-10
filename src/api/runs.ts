import { supabase } from '@/lib/supabase';
import type { LogResult, MateRun, MyRun } from '@/types/run';

import { fromFunctionError, NETWORK_ERROR } from './errors';
import type { Result } from './profile';

// Your own runs (the access rules return only yours). Superseded runs (manual
// runs replaced by a Health run) are left out.
export async function listMyRuns(): Promise<Result<MyRun[]>> {
  const { data, error } = await supabase
    .from('runs')
    .select('id, source, started_at, distance_m, duration_s, status, flag_reasons, created_at')
    .neq('status', 'superseded')
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: data as MyRun[] };
}

export async function listLeagueRuns(leagueId: string): Promise<Result<MateRun[]>> {
  const { data, error } = await supabase.rpc('league_runs', { p_league_id: leagueId });
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: data as MateRun[] };
}

// Runs are only ever written through the run-manual Edge Function.
export async function logManualRun(input: { started_at: string; distance_m: number; duration_s: number }): Promise<Result<LogResult>> {
  const { data, error } = await supabase.functions.invoke<LogResult>('run-manual', { body: input });
  if (error || !data) return { ok: false, error: await fromFunctionError(error) };
  return { ok: true, data };
}
