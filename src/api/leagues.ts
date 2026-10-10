import { supabase } from '@/lib/supabase';
import type { Invite, League, Season, Standing } from '@/types/league';

import { fromFunctionError, NETWORK_ERROR } from './errors';
import type { Result } from './profile';

// Reads go straight to the database, where the access rules return only the
// caller's own leagues. Every change goes through an Edge Function.

const LEAGUE_COLUMNS = 'id, name, owner_id, verified_only, member_limit, created_at';

export async function listMyLeagues(): Promise<Result<League[]>> {
  const { data, error } = await supabase.from('leagues').select(LEAGUE_COLUMNS).order('created_at');
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: data as League[] };
}

export async function getLeague(id: string): Promise<Result<League | null>> {
  const { data, error } = await supabase.from('leagues').select(LEAGUE_COLUMNS).eq('id', id).maybeSingle();
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: (data as League | null) ?? null };
}

export async function getStandings(leagueId: string): Promise<Result<Standing[]>> {
  const { data, error } = await supabase.rpc('league_standings', { p_league_id: leagueId });
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: data as Standing[] };
}

// Only the owner gets a row back (access rules). An expired code is treated
// as no code.
export async function getActiveInvite(leagueId: string): Promise<Result<Invite | null>> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('code, expires_at')
    .eq('league_id', leagueId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: (data as Invite | null) ?? null };
}

export async function getCurrentSeason(): Promise<Result<Season | null>> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('seasons')
    .select('id, month, starts_at, ends_at')
    .lte('starts_at', now)
    .gt('ends_at', now)
    .maybeSingle();
  if (error) return { ok: false, error: NETWORK_ERROR };
  return { ok: true, data: (data as Season | null) ?? null };
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body });
  if (error || !data) return { ok: false, error: await fromFunctionError(error) };
  return { ok: true, data };
}

export const createLeague = (name: string, verifiedOnly: boolean) =>
  call<{ league: League }>('league', { action: 'create', name, verified_only: verifiedOnly });

export const updateLeague = (leagueId: string, changes: { name?: string; verified_only?: boolean }) =>
  call<{ league: League }>('league', { action: 'update', league_id: leagueId, ...changes });

export const createInvite = (leagueId: string) =>
  call<{ invite: Invite }>('league-invite', { action: 'create', league_id: leagueId });

export const revokeInvite = (leagueId: string) =>
  call<{ revoked: boolean }>('league-invite', { action: 'revoke', league_id: leagueId });

export const joinLeague = (code: string) =>
  call<{ status: 'joined' | 'already_member'; league_id: string }>('league-join', { code });

export const leaveLeague = (leagueId: string) =>
  call<{ status: 'left' | 'closed' }>('league-member', { action: 'leave', league_id: leagueId });

export const removeMember = (leagueId: string, userId: string) =>
  call<{ status: 'removed' }>('league-member', { action: 'remove', league_id: leagueId, user_id: userId });
