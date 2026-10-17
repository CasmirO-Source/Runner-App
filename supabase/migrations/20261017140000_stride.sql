-- Migration 8: the Stride rating (PRD 4, milestone 5).
--
-- Who can do what
--   Signed in:  read anyone's current Stride and placement count, like their
--               display name (PRD 4.1: "shown on every profile and next to
--               names on leaderboards"). Read your own rating history only.
--               No writes at all.
--   Server:     nothing new. A rating changes only as a side effect of a
--               verified run being recorded (record_run), through one
--               database function that no API role can call (PRD 4.4).
--
-- The rules (PRD 4.3 and 4.4, with the owner's decisions in
-- docs/milestone-5-plan.md):
--   * Qualifying run: from Health, accepted, 3 km to 21.1 km.
--   * 5 km equivalent: t5 = t x (5000 / d) ^ 1.06 (Riegel).
--   * Speed window: 60 days; 120 if no qualifying run in the last 30 days,
--     or if 60 days hold fewer than three (decision 3).
--   * Speed: median of the best three t5. With fewer than three in the
--     window, speed can rise (from the slower of two) but never fall.
--   * Volume: all verified km in the last 28 days, per week, over 60.
--   * Stride = round(3000 x (0.75 speed + 0.25 volume)).
--   * Placement: three qualifying runs in the last 120 days, then placed for
--     good (decision 4).
--   * A fall is limited to 150 below the highest Stride of the last 7 days;
--     a rise applies at once (decision 2).

-- Current Stride on the profile ------------------------------------------------------
-- Empty until placed. Written only by private.recalculate_stride: no API role
-- has an update grant on these columns, not even the server.
alter table public.profiles
  add column stride smallint
    constraint profile_stride_range check (stride between 0 and 3000),
  add column placement_runs smallint not null default 0
    constraint profile_placement_range check (placement_runs between 0 and 3);

comment on column public.profiles.stride is 'Current Stride (PRD 4). Empty until placed. Written only by private.recalculate_stride.';
comment on column public.profiles.placement_runs is 'Qualifying runs towards placement, 0 to 3 ("Placing 1 of 3").';

-- Public, like the display name (decision 7).
grant select (stride, placement_runs) on table public.profiles to authenticated;

-- Rating history ---------------------------------------------------------------------------
-- One row per calculation, with the run that caused it (PRD 4.4), and every
-- number behind it so a rating can always be explained.
create table public.rating_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  -- The Stride shown after this run, and what the formula gave before the
  -- weekly fall limit.
  stride smallint not null
    constraint rating_stride_range check (stride between 0 and 3000),
  calculated smallint not null
    constraint rating_calculated_range check (calculated between 0 and 3000),
  speed_score numeric(6, 5) not null
    constraint rating_speed_range check (speed_score between 0 and 1),
  volume_score numeric(6, 5) not null
    constraint rating_volume_range check (volume_score between 0 and 1),
  t5_median_s numeric(8, 1) not null
    constraint rating_t5_positive check (t5_median_s > 0),
  weekly_km numeric(7, 2) not null
    constraint rating_weekly_km_positive check (weekly_km >= 0),
  window_days smallint not null
    constraint rating_window check (window_days in (60, 120)),
  -- The real clock time, not the transaction's start, so several ratings
  -- saved in one transaction (a history import) still sort in order.
  created_at timestamptz not null default clock_timestamp()
);

comment on table public.rating_history is
  'Every Stride calculation, with the verified run that caused it (PRD 4.4). Readable by its owner only. Written only by private.recalculate_stride.';

create index rating_history_by_user on public.rating_history (user_id, created_at desc);

alter table public.rating_history enable row level security;

-- Your own history only (PRD 8.2), and only with a live session.
create policy rating_history_select_own
  on public.rating_history for select to authenticated
  using ((select private.session_is_active()) and user_id = (select auth.uid()));

revoke all on table public.rating_history from public, anon, authenticated, service_role;
grant select (id, run_id, stride, calculated, speed_score, volume_score, t5_median_s, weekly_km, window_days, created_at)
  on table public.rating_history to authenticated;

-- The formula ---------------------------------------------------------------------------------
-- Pure arithmetic, no data access, so it can be tested with exact numbers.

-- Riegel 5 km equivalent, in seconds (PRD 4.3 step 1).
create function private.riegel_t5(p_duration_s integer, p_distance_m integer)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select p_duration_s::numeric * power(5000::numeric / p_distance_m, 1.06::numeric)
$$;

-- Speed and volume scores and the Stride they give (PRD 4.3 steps 2 to 4).
create function private.stride_from(p_speed_score numeric, p_weekly_km numeric)
returns table (volume_score numeric, stride integer)
language sql
immutable
strict
set search_path = ''
as $$
  select w, round(3000 * (0.75 * p_speed_score + 0.25 * w))::integer
  from (select least(p_weekly_km / 60, 1) as w) as x
$$;

create function private.speed_score(p_t5_s numeric)
returns numeric
language sql
immutable
strict
set search_path = ''
as $$
  select least(greatest((5000 / p_t5_s - 1.85) / (6.41 - 1.85), 0), 1)
$$;

-- The single recalculation (PRD 4.4) ------------------------------------------------------
-- Called only by record_run, inside the same transaction as the verified run
-- that caused it. Not security definer: it runs with record_run's rights,
-- and no API role may call it.
create function private.recalculate_stride(p_user_id uuid, p_run_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_prev smallint;
  v_placement integer;
  v_window integer;
  v_t5 numeric[];
  v_last record;
  v_speed numeric;
  v_t5_used numeric;
  v_candidate numeric;
  v_weekly_km numeric;
  v_volume numeric;
  v_calculated integer;
  v_peak integer;
  v_stride integer;
begin
  -- Locked, so two runs saved at once cannot interleave.
  select p.stride into v_prev from public.profiles as p where p.id = p_user_id for update;
  if not found then
    raise exception 'invalid_runner' using errcode = 'P0001';
  end if;

  -- Placement: qualifying runs in the last 120 days.
  select count(*) into v_placement
  from public.runs as r
  where r.user_id = p_user_id and r.source = 'health' and r.status = 'accepted'
    and r.distance_m between 3000 and 21100
    and r.started_at > now() - interval '120 days';

  if v_prev is null and v_placement < 3 then
    update public.profiles set placement_runs = v_placement where id = p_user_id;
    return;
  end if;

  -- Speed window (PRD 4.3 step 2, decision 3).
  v_window := case when exists (
    select 1 from public.runs as r
    where r.user_id = p_user_id and r.source = 'health' and r.status = 'accepted'
      and r.distance_m between 3000 and 21100
      and r.started_at > now() - interval '30 days'
  ) then 60 else 120 end;

  select coalesce(array_agg(t5 order by t5), '{}'::numeric[]) into v_t5
  from (
    select private.riegel_t5(r.duration_s, r.distance_m) as t5
    from public.runs as r
    where r.user_id = p_user_id and r.source = 'health' and r.status = 'accepted'
      and r.distance_m between 3000 and 21100
      and r.started_at > now() - make_interval(days => v_window)
    order by 1
    limit 3
  ) as best;

  if cardinality(v_t5) < 3 and v_window = 60 then
    v_window := 120;
    select coalesce(array_agg(t5 order by t5), '{}'::numeric[]) into v_t5
    from (
      select private.riegel_t5(r.duration_s, r.distance_m) as t5
      from public.runs as r
      where r.user_id = p_user_id and r.source = 'health' and r.status = 'accepted'
        and r.distance_m between 3000 and 21100
        and r.started_at > now() - interval '120 days'
      order by 1
      limit 3
    ) as best;
  end if;

  select h.speed_score, h.t5_median_s into v_last
  from public.rating_history as h
  where h.user_id = p_user_id
  order by h.created_at desc, h.id desc
  limit 1;

  if cardinality(v_t5) >= 3 then
    -- The median of the best three: slow runs never change it.
    v_t5_used := v_t5[2];
    v_speed := private.speed_score(v_t5_used);
  elsif v_last is null then
    -- Cannot happen: placement needs three qualifying runs in 120 days.
    raise exception 'invalid_rating_state' using errcode = 'P0001';
  else
    -- Thin window: keep the previous speed score, unless the slower of two
    -- recent runs beats it. One run alone changes nothing.
    v_speed := v_last.speed_score;
    v_t5_used := v_last.t5_median_s;
    if cardinality(v_t5) = 2 then
      v_candidate := private.speed_score(v_t5[2]);
      if v_candidate > v_speed then
        v_speed := v_candidate;
        v_t5_used := v_t5[2];
      end if;
    end if;
  end if;

  -- Volume: every verified km in the last 4 weeks (decision 5).
  select coalesce(sum(r.distance_m), 0) / 1000.0 / 4 into v_weekly_km
  from public.runs as r
  where r.user_id = p_user_id and r.source = 'health' and r.status = 'accepted'
    and r.started_at > now() - interval '28 days';

  select f.volume_score, f.stride into v_volume, v_calculated from private.stride_from(v_speed, v_weekly_km) as f;

  -- Slow fall, instant rise (decision 2): never more than 150 below the
  -- highest Stride of the last 7 days, counting the current one.
  if v_prev is null then
    v_stride := v_calculated;
  else
    select greatest(v_prev, coalesce(max(h.stride), 0)) into v_peak
    from public.rating_history as h
    where h.user_id = p_user_id and h.created_at > now() - interval '7 days';
    v_stride := greatest(v_calculated, v_peak - 150);
  end if;
  v_stride := least(greatest(v_stride, 0), 3000);

  insert into public.rating_history
    (user_id, run_id, stride, calculated, speed_score, volume_score, t5_median_s, weekly_km, window_days)
  values
    (p_user_id, p_run_id, v_stride, v_calculated, round(v_speed, 5), round(v_volume, 5), round(v_t5_used, 1), round(v_weekly_km, 2), v_window);

  update public.profiles set stride = v_stride, placement_runs = 3 where id = p_user_id;
end;
$$;

revoke all on function private.riegel_t5(integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.speed_score(numeric) from public, anon, authenticated, service_role;
revoke all on function private.stride_from(numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function private.recalculate_stride(uuid, uuid) from public, anon, authenticated, service_role;

-- Recording a run: now recalculates Stride ----------------------------------------------
-- Same as migration 7, plus the Stride call after an accepted Health run, and
-- explicit types on two empty-list defaults (the milestone 4 lint warning).
create or replace function public.record_run(
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
  v_reasons text[] := '{}'::text[];
  v_status text;
  v_id uuid;
  v_day date;
  v_day_total bigint;
  v_overlap record;
  v_health_overlap boolean := false;
  v_unverified_overlaps uuid[] := '{}'::uuid[];
  v_max_age interval;
begin
  perform private.require_server();

  if coalesce(p_source, '') not in ('health', 'manual', 'screenshot') or p_distance_m is null or p_duration_s is null
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
      v_unverified_overlaps := array_append(v_unverified_overlaps, v_overlap.id);
    end if;
  end loop;

  -- Owner decision 8: an unverified run (typed in or screenshot) that
  -- overlaps anything is a duplicate; a Health run that overlaps only
  -- unverified runs replaces them.
  if v_health_overlap or (p_source <> 'health' and cardinality(v_unverified_overlaps) > 0) then
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
  -- Typed-in and screenshot runs: up to 7 days old. Verified Health runs: up
  -- to 120 days, so a new runner's history counts for Stride and analytics
  -- from day one (PRD 1.1, sections 6.2 and 6.4). Leagues and duels only
  -- count runs inside their own dates, so old runs cannot change a competition.
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
    and not (r.id = any (v_unverified_overlaps))
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

  if cardinality(v_unverified_overlaps) > 0 then
    update public.runs as r set status = 'superseded', superseded_by = v_id
    where r.id = any (v_unverified_overlaps);
  end if;

  if v_status = 'flagged' then
    insert into private.audit_log (actor_id, action, run_id) values (p_user_id, 'run_flagged', v_id);
  end if;

  -- Stride (PRD 4.4): recalculated after every verified run, in the same
  -- transaction, by the single function below. Typed-in, screenshot and
  -- flagged runs never reach it (PRD 10, 11.6).
  if p_source = 'health' and v_status = 'accepted' then
    perform private.recalculate_stride(p_user_id, v_id);
  end if;

  return query select v_status, v_id, v_reasons;
end;
$$;

revoke all on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean) to service_role;

-- Standings: now with each runner's Stride ---------------------------------------------------
-- Same as migration 6, plus the Stride column, so the league table can show
-- the tier next to each name (PRD 5.2). Empty for runners not yet placed.
drop function public.league_standings(uuid, uuid);

create function public.league_standings(p_league_id uuid, p_season_id uuid default null)
returns table (place integer, user_id uuid, display_name text, avatar_id smallint, distance_m integer, run_count integer, stride smallint)
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
    p.stride
  from totals as t
  join public.profiles as p on p.id = t.user_id
  cross join allowed
  where allowed.ok
  order by place;
$$;

revoke all on function public.league_standings(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.league_standings(uuid, uuid) to authenticated;
