-- Migration 9: estimated Stride (PRD 1.3, section 4.5, milestone 5).
--
-- Two self-reported answers give an estimated Stride until a runner is
-- placed: a recent 5 km time (or "not sure") and typical weekly km.
--
-- Who can do what
--   Signed in:  read anyone's estimated Stride (shown with "est."), like the
--               real one. The two answers are private: readable only by the
--               runner, through get_my_profile.
--   Server:     sets the answers only through set_stride_estimate, called by
--               the profile Edge Function with the user ID from the verified
--               token. Refused once the runner is placed.
--
-- An estimate never counts for anything (PRD 4.5): it is not in
-- rating_history, not used for placement, handicap duels or the fall limit.

alter table public.profiles
  add column estimate_5k_s integer
    constraint profile_estimate_5k_range check (estimate_5k_s between 780 and 5400),
  add column estimate_weekly_km smallint
    constraint profile_estimate_km_range check (estimate_weekly_km between 0 and 150),
  add column estimated_stride smallint
    constraint profile_estimated_stride_range check (estimated_stride between 0 and 3000),
  -- All three together, or none; a 5 km time needs weekly km with it.
  add constraint profile_estimate_complete check (
    (estimate_weekly_km is null) = (estimated_stride is null)
    and (estimate_5k_s is null or estimate_weekly_km is not null)
  );

comment on column public.profiles.estimate_5k_s is 'Self-reported recent 5 km time in seconds, or empty for "not sure". Private (PRD 4.5).';
comment on column public.profiles.estimate_weekly_km is 'Self-reported typical weekly km. Private (PRD 4.5).';
comment on column public.profiles.estimated_stride is 'Estimated Stride from the two answers, shown with "est." until placed (PRD 4.5).';

-- The estimate is public, like the real Stride. The answers are not.
grant select (estimated_stride) on table public.profiles to authenticated;

-- Setting an estimate ------------------------------------------------------------------------
-- Uses the same formula as the real Stride (private.speed_score and
-- private.stride_from), so there is one source of truth. "Not sure" (no 5 km
-- time) means no speed score. p_weekly_km null clears the estimate.
--
-- Returns the new estimated Stride, or raises:
--   already_placed  the runner has a real Stride now
--   invalid_estimate  values outside the ranges (also database constraints)
create function public.set_stride_estimate(p_user_id uuid, p_5k_s integer, p_weekly_km integer)
returns smallint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stride smallint;
  v_estimate smallint;
begin
  perform private.require_server();

  if p_user_id is null
     or (p_5k_s is not null and p_5k_s not between 780 and 5400)
     or (p_weekly_km is not null and p_weekly_km not between 0 and 150)
     or (p_5k_s is not null and p_weekly_km is null) then
    raise exception 'invalid_estimate' using errcode = 'P0001';
  end if;

  select p.stride into v_stride from public.profiles as p where p.id = p_user_id for update;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
  if v_stride is not null then
    raise exception 'already_placed' using errcode = 'P0001';
  end if;

  if p_weekly_km is not null then
    select f.stride into v_estimate
    from private.stride_from(coalesce(private.speed_score(p_5k_s), 0), p_weekly_km) as f;
  end if;

  update public.profiles
  set estimate_5k_s = p_5k_s, estimate_weekly_km = p_weekly_km, estimated_stride = v_estimate
  where id = p_user_id;

  return v_estimate;
end;
$$;

revoke all on function public.set_stride_estimate(uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_stride_estimate(uuid, integer, integer) to service_role;

-- Standings: now with the estimate as well ---------------------------------------------------
-- Same as migration 8, plus estimated_stride, so an unplaced runner's tier can
-- be shown with "est." in the league table.
drop function public.league_standings(uuid, uuid);

create function public.league_standings(p_league_id uuid, p_season_id uuid default null)
returns table (place integer, user_id uuid, display_name text, avatar_id smallint, distance_m integer, run_count integer, stride smallint, estimated_stride smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with season as (
    select s.id, s.starts_at, s.ends_at
    from public.seasons as s
    where (p_season_id is null and now() >= s.starts_at and now() < s.ends_at)
       or s.id = p_season_id
  ),
  allowed as (
    select (select private.session_is_active()) and private.is_league_member(p_league_id) as ok
  ),
  league as (
    select l.id, l.verified_only from public.leagues as l where l.id = p_league_id
  ),
  current_season as (
    select (p_season_id is null or p_season_id = (
      select s.id from public.seasons as s where now() >= s.starts_at and now() < s.ends_at
    )) as yes
  ),
  members as (
    select distinct on (m.user_id) m.user_id, m.joined_at, m.left_at
    from public.league_members as m, season, current_season
    where m.league_id = p_league_id
      and (
        (current_season.yes and m.left_at is null)
        or (not current_season.yes and m.joined_at < season.ends_at and (m.left_at is null or m.left_at > season.starts_at))
      )
    order by m.user_id, m.joined_at desc
  ),
  totals as (
    select
      mem.user_id,
      coalesce(sum(r.distance_m), 0)::integer as distance_m,
      count(r.id)::integer as run_count,
      max(r.started_at + make_interval(secs => r.duration_s)) as reached_at
    from members as mem
    cross join season
    cross join league
    left join public.runs as r
      on r.user_id = mem.user_id
     and r.status = 'accepted'
     and r.started_at >= season.starts_at and r.started_at < season.ends_at
     and (not league.verified_only or r.source = 'health')
    group by mem.user_id
  )
  select
    (row_number() over (order by t.distance_m desc, t.reached_at asc nulls last, p.display_name))::integer as place,
    t.user_id,
    p.display_name,
    p.avatar_id,
    t.distance_m,
    t.run_count,
    p.stride,
    p.estimated_stride
  from totals as t
  join public.profiles as p on p.id = t.user_id
  cross join allowed
  where allowed.ok
  order by place;
$$;

revoke all on function public.league_standings(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.league_standings(uuid, uuid) to authenticated;
