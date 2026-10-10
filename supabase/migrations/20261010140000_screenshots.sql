-- Migration 7: the screenshot reader (PRD 6.3, 6.4, 11, milestone 4).
--
-- Who can do what
--   Signed in:  nothing new. A screenshot run is an ordinary row in runs, read
--               the same way as before. The readings table is never reachable
--               from the app (PRD 8.2: screenshot_hashes, server only).
--   Server:     saves what Claude read from a screenshot (save_screenshot_reading)
--               and, once the runner confirms, records the run
--               (confirm_screenshot_reading). Both called only by the
--               screenshot Edge Functions, with the user ID from the verified
--               token.
--
-- The screenshot itself is never stored anywhere (PRD 1.2, 6.3). Only the
-- values read from it and its fingerprint are kept:
--   * a 64-bit perceptual hash (dHash), which matches visually identical
--     images, so the same screenshot cannot be used twice, by anyone;
--   * the distance, time, date, start time (if shown) and app name.
-- An unconfirmed reading expires after an hour and is then deleted. A
-- confirmed reading is kept, because its fingerprint is what blocks reuse.

-- Screenshot runs ------------------------------------------------------------------------
-- 'screenshot': read by AI from a screenshot and confirmed by the runner
-- without changes (PRD 6.1). Unverified: never counts in verified-only leagues,
-- and (from milestone 5) never affects Stride or handicap duels (PRD 11.6).
alter table public.runs drop constraint run_source;
alter table public.runs add constraint run_source check (source in ('health', 'manual', 'screenshot'));

comment on column public.runs.source is
  'health: Apple Health or Health Connect (verified). manual: typed in. screenshot: read from a screenshot and confirmed unchanged. Only health is verified.';

-- Readings -----------------------------------------------------------------------------------
create table private.screenshot_hashes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- dHash of the re-encoded image: 64 bits, stored as a signed bigint.
  dhash bigint not null,

  -- What the reader found. The bounds only keep nonsense out; the real run
  -- checks happen in record_run when the runner confirms.
  distance_m integer not null
    constraint reading_distance_sane check (distance_m between 1 and 1000000),
  duration_s integer not null
    constraint reading_duration_sane check (duration_s between 1 and 604800),
  run_date date not null,
  -- Null when the screenshot does not show a start time (PRD 1.2): the runner
  -- adds it, and the run keeps screenshot status.
  start_time time(0)
    constraint reading_start_time_minutes check (start_time is null or extract(second from start_time) = 0),
  source_app text
    constraint reading_source_app_format check (source_app ~ '^[A-Za-z0-9 .&''+-]{1,40}$'),

  -- pending: read, waiting for the runner to confirm (for one hour).
  -- used:    confirmed. Saved as a screenshot run if unchanged, as a typed-in
  --          run if the runner changed anything (PRD 6.3), or not saved at all
  --          if it duplicated another run.
  status text not null default 'pending'
    constraint reading_status check (status in ('pending', 'used')),
  saved_as text
    constraint reading_saved_as check (saved_as in ('screenshot', 'manual')),
  run_id uuid references public.runs (id) on delete set null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  used_at timestamptz,
  constraint reading_used_fields check (
    (status = 'used') = (used_at is not null and saved_as is not null)
  )
);

comment on table private.screenshot_hashes is
  'Values read from screenshots and their perceptual hashes (PRD 6.3, 6.4). Never the image. Server only.';

-- Reuse checks look for the same values first, then compare hashes.
create index screenshot_hashes_by_values on private.screenshot_hashes (distance_m, duration_s, run_date);
create index screenshot_hashes_pending_expiry on private.screenshot_hashes (expires_at) where status = 'pending';

-- RLS on with no policies: nobody from the app, in any role, can read or
-- write it. The functions below run with the owner's rights.
alter table private.screenshot_hashes enable row level security;
revoke all on table private.screenshot_hashes from public, anon, authenticated, service_role;

-- A reused screenshot is a cheating signal, so attempts go in the audit log
-- (PRD 9.6, 10) for the review queue.
alter table private.audit_log drop constraint audit_action;
alter table private.audit_log add constraint audit_action
  check (action in ('league_member_removed', 'league_closed', 'run_flagged', 'screenshot_reused'));

-- Unconfirmed readings are deleted once they expire (data minimisation).
select cron.schedule(
  'screenshot-readings-cleanup',
  '*/15 * * * *',
  $$delete from private.screenshot_hashes where status = 'pending' and expires_at < now()$$
);

-- Recording a run: now with screenshot runs ------------------------------------------------
-- Same function as migration 6 with three changes:
--   1. 'screenshot' is an accepted source.
--   2. Screenshot runs follow the typed-in rules: up to 7 days old (PRD 6.4).
--   3. For duplicates, screenshot runs behave like typed-in runs: one that
--      overlaps anything is a duplicate, and a Health run that overlaps only
--      unverified runs replaces them (owner decision 8, milestone 3).
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
  v_reasons text[] := '{}';
  v_status text;
  v_id uuid;
  v_day date;
  v_day_total bigint;
  v_overlap record;
  v_health_overlap boolean := false;
  v_unverified_overlaps uuid[] := '{}';
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

  return query select v_status, v_id, v_reasons;
end;
$$;

-- create or replace keeps the existing grants; restated so this file shows them.
revoke all on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_run(uuid, text, timestamptz, integer, integer, text, text, boolean) to service_role;

-- Saving a reading ------------------------------------------------------------------------------
-- Called by screenshot-read after Claude has read the image. Returns one of:
--   new       saved; the runner now has an hour to confirm it
--   existing  this runner already has the same reading waiting (for example
--             the app sent the same screenshot twice): that one is returned
--   reused    refused: the same screenshot has been used before, by anyone
--
-- What counts as the same screenshot: the same distance, time and date AND a
-- fingerprint at most 8 bits (of 64) different. Both are needed. A dHash is
-- built from a 9 by 8 pixel thumbnail, so two different runs shown in the
-- same app's layout can have near-identical fingerprints; matching the values
-- as well stops them being mistaken for each other. Small changes to the
-- image (re-saving, a different phone's compression) change only a few bits.
create function public.save_screenshot_reading(
  p_user_id uuid,
  p_dhash bigint,
  p_distance_m integer,
  p_duration_s integer,
  p_run_date date,
  p_start_time time,
  p_source_app text
)
returns table (status text, reading_id uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_match record;
  v_id uuid;
  v_expires timestamptz;
begin
  perform private.require_server();

  if p_user_id is null or p_dhash is null or p_distance_m is null or p_duration_s is null or p_run_date is null then
    raise exception 'invalid_reading' using errcode = 'P0001';
  end if;

  -- One reading at a time for these values, across all users, so two people
  -- sending the same screenshot at the same moment cannot both get through.
  perform pg_advisory_xact_lock(
    hashtextextended(p_distance_m::text || '|' || p_duration_s::text || '|' || p_run_date::text, 7)
  );

  for v_match in
    select h.id, h.user_id, h.status, h.expires_at
    from private.screenshot_hashes as h
    where h.distance_m = p_distance_m
      and h.duration_s = p_duration_s
      and h.run_date = p_run_date
      and (h.status = 'used' or h.expires_at > now())
      and bit_count((h.dhash # p_dhash)::bit(64)) <= 8
    order by (h.user_id = p_user_id and h.status = 'pending') asc
  loop
    -- Sorted so any match that blocks (used, or someone else's) comes first.
    if v_match.status = 'used' or v_match.user_id <> p_user_id then
      insert into private.audit_log (actor_id, action) values (p_user_id, 'screenshot_reused');
      return query select 'reused'::text, null::uuid, null::timestamptz;
      return;
    end if;
    return query select 'existing'::text, v_match.id, v_match.expires_at;
    return;
  end loop;

  insert into private.screenshot_hashes (user_id, dhash, distance_m, duration_s, run_date, start_time, source_app)
  values (p_user_id, p_dhash, p_distance_m, p_duration_s, p_run_date, p_start_time, p_source_app)
  returning id, expires_at into v_id, v_expires;

  return query select 'new'::text, v_id, v_expires;
end;
$$;

revoke all on function public.save_screenshot_reading(uuid, bigint, integer, integer, date, time, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_screenshot_reading(uuid, bigint, integer, integer, date, time, text) to service_role;

-- Confirming a reading ---------------------------------------------------------------------------
-- Called by screenshot-confirm with what the runner confirmed. The server, not
-- the app, decides what kind of run it becomes (PRD 6.3):
--   * exactly the values read (distance, time and date; and the start time,
--     if the screenshot showed one): a screenshot run;
--   * the screenshot showed no start time and the runner added one: still a
--     screenshot run;
--   * anything changed: a typed-in run, which also counts towards the
--     typed-in limit of 10 a day (PRD 9.3), so this cannot be used to get
--     round it.
-- Times in screenshots are taken as UK time, like every other day boundary in
-- the app.
--
-- A reading is used once. Someone else's reading, an expired one or a used
-- one all get the same answer, so nothing is given away about other runners.
--
-- Returns status (accepted, flagged, duplicate or rate_limited), the run ID,
-- the reasons a run was flagged, what it was saved as, and for rate_limited
-- the seconds to wait.
create function public.confirm_screenshot_reading(
  p_user_id uuid,
  p_reading_id uuid,
  p_started_at timestamptz,
  p_distance_m integer,
  p_duration_s integer
)
returns table (status text, run_id uuid, reasons text[], saved_as text, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_reading record;
  v_local timestamp;
  v_unchanged boolean;
  v_source text;
  v_limit record;
  v_run record;
begin
  perform private.require_server();

  if p_user_id is null or p_reading_id is null or p_started_at is null or p_distance_m is null or p_duration_s is null then
    raise exception 'invalid_run' using errcode = 'P0001';
  end if;

  -- Locked, so a double tap cannot confirm the same reading twice.
  select h.* into v_reading
  from private.screenshot_hashes as h
  where h.id = p_reading_id and h.user_id = p_user_id
  for update;

  if not found or v_reading.status <> 'pending' or v_reading.expires_at <= now() then
    raise exception 'reading_unavailable' using errcode = 'P0001';
  end if;

  v_local := p_started_at at time zone 'Europe/London';
  v_unchanged := p_distance_m = v_reading.distance_m
    and p_duration_s = v_reading.duration_s
    and v_local::date = v_reading.run_date
    and (v_reading.start_time is null or date_trunc('minute', v_local)::time = v_reading.start_time);
  v_source := case when v_unchanged then 'screenshot' else 'manual' end;

  if v_source = 'manual' then
    -- Same scope and limit as the run-manual function (PRD 9.3).
    select * into v_limit from public.consume_rate_limit('run_manual', p_user_id::text, 10, 86400);
    if not v_limit.allowed then
      return query select 'rate_limited'::text, null::uuid, '{}'::text[], v_source, v_limit.retry_after_seconds;
      return;
    end if;
  end if;

  select * into v_run
  from public.record_run(p_user_id, v_source, p_started_at, p_distance_m, p_duration_s, null, null, null);

  update private.screenshot_hashes as h
  set status = 'used', used_at = now(), saved_as = v_source, run_id = v_run.run_id
  where h.id = p_reading_id;

  return query select v_run.status, v_run.run_id, v_run.reasons, v_source, 0;
end;
$$;

revoke all on function public.confirm_screenshot_reading(uuid, uuid, timestamptz, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_screenshot_reading(uuid, uuid, timestamptz, integer, integer) to service_role;
