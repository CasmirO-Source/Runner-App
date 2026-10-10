-- Migration 6: runs (PRD 6, 8.2, 10, milestone 3).
--
-- Who can do what
--   Signed in:  read your own runs (including flagged ones and the reasons).
--               Read your league-mates' accepted runs as distance, date and
--               source only, through public.league_runs (owner decision 7).
--               No writes at all.
--   Server:     records runs only through public.record_run, called by the
--               manual-entry and Health-sync Edge Functions with the caller's
--               user ID from their verified token.
--
-- Every run goes through the same checks (PRD 6.4), whatever its source.
-- Runs that fail are saved as "flagged" with the reasons, excluded from every
-- total, written to the audit log and listed in a review queue that only the
-- Supabase dashboard can see.
--
-- Trust note (owner decision 4): the server cannot check Health data itself.
-- A run marked as coming from Health is only as trustworthy as the copy of the
-- app that sent it. The checks below, duplicate detection, rate limits and
-- the review queue are the mitigations.

-- Runs ------------------------------------------------------------------------
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- 'health' (Apple Health or Health Connect: verified), 'manual'
  -- (unverified). Screenshots join in milestone 4.
  source text not null
    constraint run_source check (source in ('health', 'manual')),

  started_at timestamptz not null,
  -- Whole metres and seconds. The wide bounds only keep nonsense out of the
  -- table; the real limits are the checks in record_run, which flag runs.
  distance_m integer not null
    constraint run_distance_sane check (distance_m between 1 and 1000000),
  duration_s integer not null
    constraint run_duration_sane check (duration_s between 1 and 604800),

  -- accepted:   counts.
  -- flagged:    failed a check; counts for nothing; in the review queue.
  -- superseded: a manual run replaced by an overlapping Health run.
  status text not null
    constraint run_status check (status in ('accepted', 'flagged', 'superseded')),
  flag_reasons text[] not null default '{}'
    constraint run_flag_reasons check (
      flag_reasons <@ array['distance_out_of_range', 'pace_out_of_range', 'in_future', 'too_old', 'daily_total_exceeded']::text[]
    ),
  superseded_by uuid references public.runs (id) on delete set null,

  -- Health runs only: the workout's own ID on the phone (so syncing twice
  -- never adds it twice) and the app that recorded it (owner decision 4).
  external_id text
    constraint run_external_id_length check (char_length(external_id) between 1 and 200),
  source_app text
    constraint run_source_app_format check (source_app ~ '^[A-Za-z0-9._-]{1,200}$'),
  constraint health_fields_only_for_health check (
    source = 'health' or (external_id is null and source_app is null)
  ),

  created_at timestamptz not null default now(),
  constraint flagged_has_reasons check ((status = 'flagged') = (cardinality(flag_reasons) > 0))
);

comment on table public.runs is
  'Every run, from every source. Readable by its owner; league-mates see distance, date and source through league_runs. Written only through record_run.';

create index runs_by_user_and_start on public.runs (user_id, started_at);
create unique index runs_one_per_health_workout on public.runs (user_id, external_id) where external_id is not null;

-- Flagged runs are now a sensitive action recorded in the audit log (PRD 9.6).
alter table private.audit_log drop constraint audit_action;
alter table private.audit_log add constraint audit_action
  check (action in ('league_member_removed', 'league_closed', 'run_flagged'));
alter table private.audit_log add column run_id uuid;

-- Review queue for the Supabase dashboard only (PRD 6.4, 5.7). In the private
-- schema, so the app can never reach it.
create view private.flagged_runs_queue
with (security_invoker = true)
as
  select r.id, r.user_id, r.source, r.started_at, r.distance_m, r.duration_s, r.flag_reasons, r.created_at
  from public.runs as r
  where r.status = 'flagged'
  order by r.created_at desc;

revoke all on private.flagged_runs_queue from public, anon, authenticated, service_role;

-- Access ------------------------------------------------------------------------
alter table public.runs enable row level security;

create policy runs_select_own
  on public.runs for select to authenticated
  using ((select private.session_is_active()) and user_id = (select auth.uid()));

revoke all on table public.runs from public, anon, authenticated, service_role;
grant select (id, source, started_at, distance_m, duration_s, status, flag_reasons, created_at)
  on table public.runs to authenticated;

-- Recording a run -------------------------------------------------------------------
-- The only way a run is written. Server only, and checks its caller.
--
-- Returns one of:
--   accepted   saved and counting
--   flagged    saved, failed a check (reasons returned), counts for nothing
--   duplicate  not saved: overlaps another run, or this Health workout is
--              already recorded
--   rejected   not saved: a Health workout typed in by hand rather than
--              recorded by a device (PRD 6.2)
create function public.record_run(
  p_user_id uuid,
  p_source text,
  p_started_at timestamptz,
  p_distance_m integer,
  p_duration_s integer,
  p_external_id text,
  p_source_app text,
  p_user_entered boolean
)
returns table (status text, run_id uuid, reasons text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ends_at timestamptz;
  v_reasons text[] := '{}';
  v_status text;
  v_id uuid;
  v_day date;
  v_day_total bigint;
  v_overlap record;
  v_health_overlap boolean := false;
  v_manual_overlaps uuid[] := '{}';
  v_max_age interval;
begin
  perform private.require_server();

  if coalesce(p_source, '') not in ('health', 'manual') or p_distance_m is null or p_duration_s is null
     or p_distance_m < 1 or p_duration_s < 1 or p_started_at is null then
    raise exception 'invalid_run' using errcode = 'P0001';
  end if;

  -- One run at a time per runner, so the overlap and daily-total checks
  -- cannot be raced by two requests at once.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 42));

  if p_source = 'health' then
    if coalesce(p_user_entered, true) then
      -- Unknown counts as typed in: only device-recorded workouts are trusted.
      return query select 'rejected'::text, null::uuid, array['health_user_entered']::text[];
      return;
    end if;
    if p_external_id is null then
      raise exception 'invalid_run' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.runs as r where r.user_id = p_user_id and r.external_id = p_external_id) then
      return query select 'duplicate'::text, null::uuid, array['already_recorded']::text[];
      return;
    end if;
  end if;

  v_ends_at := p_started_at + make_interval(secs => p_duration_s);

  -- Overlapping runs (PRD 6.4: "overlapping time ranges for the same user
  -- across sources"). Superseded runs no longer count as overlapping.
  for v_overlap in
    select r.id, r.source from public.runs as r
    where r.user_id = p_user_id
      and r.status in ('accepted', 'flagged')
      and tstzrange(r.started_at, r.started_at + make_interval(secs => r.duration_s)) && tstzrange(p_started_at, v_ends_at)
  loop
    if v_overlap.source = 'health' then
      v_health_overlap := true;
    else
      v_manual_overlaps := array_append(v_manual_overlaps, v_overlap.id);
    end if;
  end loop;

  -- Owner decision 8: a manual run that overlaps anything is a duplicate; a
  -- Health run that overlaps only manual runs replaces them.
  if v_health_overlap or (p_source = 'manual' and cardinality(v_manual_overlaps) > 0) then
    return query select 'duplicate'::text, null::uuid, array['overlaps_another_run']::text[];
    return;
  end if;

  -- The checks (PRD 6.4). Every failing check is recorded, not just the first.
  if p_distance_m < 500 or p_distance_m > 100000 then
    v_reasons := array_append(v_reasons, 'distance_out_of_range');
  end if;
  -- Pace between 2:30 and 15:00 per km: 150 to 900 seconds per 1000 m.
  if p_duration_s::numeric * 1000 < 150::numeric * p_distance_m
     or p_duration_s::numeric * 1000 > 900::numeric * p_distance_m then
    v_reasons := array_append(v_reasons, 'pace_out_of_range');
  end if;
  -- Typed-in runs: up to 7 days old. Verified Health runs: up to 120 days, so
  -- a new runner's history counts for Stride and analytics from day one (PRD
  -- 1.1, sections 6.2 and 6.4). Leagues and duels only count runs inside
  -- their own dates, so old runs cannot change a competition.
  v_max_age := case when p_source = 'health' then interval '120 days' else interval '7 days' end;
  if p_started_at > now() then
    v_reasons := array_append(v_reasons, 'in_future');
  elsif p_started_at < now() - v_max_age then
    v_reasons := array_append(v_reasons, 'too_old');
  end if;
  -- Daily total, per calendar day in UK time, counting runs that still count.
  v_day := (p_started_at at time zone 'Europe/London')::date;
  select coalesce(sum(r.distance_m), 0) into v_day_total from public.runs as r
  where r.user_id = p_user_id
    and r.status = 'accepted'
    and not (r.id = any (v_manual_overlaps))
    and (r.started_at at time zone 'Europe/London')::date = v_day;
  if v_day_total + p_distance_m > 150000 then
    v_reasons := array_append(v_reasons, 'daily_total_exceeded');
  end if;

  v_status := case when cardinality(v_reasons) > 0 then 'flagged' else 'accepted' end;

  insert into public.runs (user_id, source, started_at, distance_m, duration_s, status, flag_reasons, external_id, source_app)
  values (
    p_user_id, p_source, p_started_at, p_distance_m, p_duration_s, v_status, v_reasons,
    case when p_source = 'health' then p_external_id end,
    case when p_source = 'health' then p_source_app end
  )
  returning id into v_id;

  if cardinality(v_manual_overlaps) > 0 then
    update public.runs as r set status = 'superseded', superseded_by = v_id
    where r.id = any (v_manual_overlaps);
  end if;

  if v_status = 'flagged' then
    insert into private.audit_log (actor_id, action, run_id) values (p_user_id, 'run_flagged', v_id);
  end if;

  return query select v_status, v_id, v_reasons;
end;
$$;

revoke all on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean) to service_role;

-- Standings with real distances ---------------------------------------------------------
-- Replaces the milestone 2 version (which showed 0 km). Now runs with the
-- owner's rights, because a member must see totals built from other members'
-- runs, which they cannot read directly. So it checks membership itself: a
-- non-member, or a signed-out session, gets no rows.
--
-- Season: the current one unless another is given (past seasons, final
-- standings). Current season: current members. Past seasons: everyone who
-- was a member at any point in that season.
-- A run counts if it is accepted, started within the season and, in a
-- verified-only league, came from Health. Runs from the whole season count,
-- including before the runner joined: a season is the calendar month for
-- everyone, so someone joining on the 15th is not two weeks behind.
-- Ties: whoever reached their total first, then name.
drop function public.league_standings(uuid);

create function public.league_standings(p_league_id uuid, p_season_id uuid default null)
returns table (place integer, user_id uuid, display_name text, avatar_id smallint, distance_m integer, run_count integer)
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
    t.run_count
  from totals as t
  join public.profiles as p on p.id = t.user_id
  cross join allowed
  where allowed.ok
  order by place;
$$;

revoke all on function public.league_standings(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.league_standings(uuid, uuid) to authenticated;

-- League-mates' runs ---------------------------------------------------------------------
-- Owner decision 7 (PRD 8.2): members see each other's runs as distance,
-- date and source only. Never start time, duration or anything else. Same
-- counting rules as the standings, current season only. Checks membership.
create function public.league_runs(p_league_id uuid)
returns table (user_id uuid, display_name text, run_date date, distance_m integer, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.user_id,
    p.display_name,
    (r.started_at at time zone 'Europe/London')::date as run_date,
    r.distance_m,
    r.source
  from public.league_members as m
  join public.leagues as l on l.id = m.league_id
  join public.seasons as s on now() >= s.starts_at and now() < s.ends_at
  join public.runs as r
    on r.user_id = m.user_id
   and r.status = 'accepted'
   and r.started_at >= s.starts_at and r.started_at < s.ends_at
   and (not l.verified_only or r.source = 'health')
  join public.profiles as p on p.id = m.user_id
  where m.league_id = p_league_id
    and m.left_at is null
    and (select private.session_is_active())
    and private.is_league_member(p_league_id)
  order by r.started_at desc
  limit 100;
$$;

revoke all on function public.league_runs(uuid) from public, anon, authenticated, service_role;
grant execute on function public.league_runs(uuid) to authenticated;
