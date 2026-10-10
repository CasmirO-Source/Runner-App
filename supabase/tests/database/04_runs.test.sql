-- Runs (milestone 3): the checks from PRD 6.4, duplicates (owner decision
-- 8), Health rules (PRD 6.2), the audit log, standings with real distances
-- and league-mates' runs (owner decision 7).
--
-- Times are relative to now, and checks that depend on the day use a fixed
-- UK calendar day two or more days ago, so the tests work on any date.
begin;
create extension if not exists pgtap with schema extensions;
-- Run as postgres (the hosted CLI logs in with a separate role that cannot
-- use the extensions schema), and look for pgTAP in the extensions schema.
set local role postgres;
set local search_path = extensions, public;
select no_plan();

-- Cast ------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('c0000000-0000-4000-8000-000000000001', 'r1@example.com', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000002', 'r2@example.com', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000003', 'r3@example.com', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000004', 'r4@example.com', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, avatar_id, over_18) values
  ('c0000000-0000-4000-8000-000000000001', 'Runner One', 1, true),
  ('c0000000-0000-4000-8000-000000000002', 'Runner Two', 2, true),
  ('c0000000-0000-4000-8000-000000000003', 'Runner Three', 3, true),
  ('c0000000-0000-4000-8000-000000000004', 'Runner Four', 4, true);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', now(), now()),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', now(), now()),
  ('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', now(), now()),
  ('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000004', now(), now());

create temp table ids (name text primary key, id uuid);
insert into ids values
  ('R1', 'c0000000-0000-4000-8000-000000000001'), ('R2', 'c0000000-0000-4000-8000-000000000002'),
  ('R3', 'c0000000-0000-4000-8000-000000000003'), ('R4', 'c0000000-0000-4000-8000-000000000004');
create function pg_temp.id(p text) returns uuid language sql as $$ select id from ids where name = p $$;
create function pg_temp.as_server() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
-- A signed-in member with a live session.
create function pg_temp.as_runner(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'role', 'authenticated', 'sub', pg_temp.id(p),
    'session_id', 'd0000000-0000-4000-8000-00000000000' || right(p, 1))::text, true)
$$;
-- 10:00 UK time on the day n days ago.
create function pg_temp.uk(days_ago int, hh int, mm int default 0) returns timestamptz language sql as $$
  select (((now() at time zone 'Europe/London')::date - days_ago) + make_time(hh, mm, 0)) at time zone 'Europe/London'
$$;
create function pg_temp.manual(who text, at timestamptz, metres int, seconds int) returns table (status text, run_id uuid, reasons text[])
language sql as $$ select * from public.record_run(pg_temp.id(who), 'manual', at, metres, seconds, null, null, null) $$;
create function pg_temp.health(who text, at timestamptz, metres int, seconds int, ext text, typed boolean default false)
returns table (status text, run_id uuid, reasons text[])
language sql as $$ select * from public.record_run(pg_temp.id(who), 'health', at, metres, seconds, ext, 'com.apple.health', typed) $$;

select pg_temp.as_server();

-- Only the server can record runs ----------------------------------------------------------
select pg_temp.as_runner('R1');
select throws_ok($$ select * from pg_temp.manual('R1', now() - interval '1 hour', 5000, 1500) $$, '42501', null,
  'a signed-in user cannot record a run directly');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from pg_temp.manual('R1', now() - interval '1 hour', 5000, 1500) $$, '42501', null, 'no token: refused');
select pg_temp.as_server();
select throws_ok($$ select * from public.record_run(pg_temp.id('R1'), 'strava', now(), 5000, 1500, null, null, null) $$,
  'P0001', 'invalid_run', 'unknown sources are refused');
select throws_ok($$ select * from public.record_run(pg_temp.id('R1'), null, now(), 5000, 1500, null, null, null) $$,
  'P0001', 'invalid_run', 'a missing source is refused');

-- The checks (PRD 6.4) ------------------------------------------------------------------
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 8), 5000, 1500) $$,
  $$ values ('accepted', '{}'::text[]) $$, 'a normal 5 km in 25 minutes is accepted');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 10), 400, 180) $$,
  $$ values ('flagged', array['distance_out_of_range']) $$, 'under 0.5 km is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(3, 1), 101000, 36000) $$,
  $$ values ('flagged', array['distance_out_of_range']) $$, 'over 100 km is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 12), 5000, 600) $$,
  $$ values ('flagged', array['pace_out_of_range']) $$, 'faster than 2:30 per km is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 13), 1000, 1200) $$,
  $$ values ('flagged', array['pace_out_of_range']) $$, 'slower than 15:00 per km is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 14), 1000, 150) $$,
  $$ values ('accepted', '{}'::text[]) $$, 'exactly 2:30 per km is allowed');
select results_eq($$ select status, reasons from pg_temp.manual('R1', pg_temp.uk(2, 15), 300, 600) $$,
  $$ values ('flagged', array['distance_out_of_range', 'pace_out_of_range']) $$, 'every failing check is recorded');
select results_eq($$ select status, reasons from pg_temp.manual('R1', now() + interval '1 day', 5000, 1500) $$,
  $$ values ('flagged', array['in_future']) $$, 'a run in the future is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R1', now() - interval '8 days', 5000, 1500) $$,
  $$ values ('flagged', array['too_old']) $$, 'a run more than 7 days ago is flagged');
select results_eq($$ select status, reasons from pg_temp.health('R4', now() - interval '100 days', 5000, 1500, 'history-1') $$,
  $$ values ('accepted', '{}'::text[]) $$, 'a verified Health run from 100 days ago is accepted (history import)');
select results_eq($$ select status, reasons from pg_temp.health('R4', now() - interval '121 days', 5000, 1500, 'history-2') $$,
  $$ values ('flagged', array['too_old']) $$, 'a Health run more than 120 days ago is flagged');
select results_eq($$ select status, reasons from pg_temp.manual('R4', now() - interval '100 days' + interval '2 hours', 5000, 1500) $$,
  $$ values ('flagged', array['too_old']) $$, 'a typed-in run from 100 days ago is still flagged');

-- Daily total: 150 km per UK calendar day.
select results_eq($$ select status from pg_temp.manual('R2', pg_temp.uk(4, 0, 10), 50000, 14400) $$, $$ values ('accepted') $$, 'day total 50 km');
select results_eq($$ select status from pg_temp.manual('R2', pg_temp.uk(4, 4, 20), 50000, 14400) $$, $$ values ('accepted') $$, 'day total 100 km');
select results_eq($$ select status from pg_temp.manual('R2', pg_temp.uk(4, 8, 30), 50000, 14400) $$, $$ values ('accepted') $$, 'day total exactly 150 km is allowed');
select results_eq($$ select status, reasons from pg_temp.manual('R2', pg_temp.uk(4, 13), 1000, 300) $$,
  $$ values ('flagged', array['daily_total_exceeded']) $$, 'going over 150 km in a day is flagged');
select results_eq($$ select status from pg_temp.manual('R2', pg_temp.uk(3, 13), 1000, 300) $$,
  $$ values ('accepted') $$, 'the next day starts a new total');

-- Flagged runs are in the audit log and the review queue.
select is((select count(*)::int from private.audit_log where action = 'run_flagged' and actor_id = pg_temp.id('R1')), 7,
  'every flagged run is in the audit log');
select is((select count(*)::int from private.flagged_runs_queue where user_id = pg_temp.id('R1')), 7,
  'every flagged run is in the review queue');
select is((select count(*)::int from private.flagged_runs_queue where user_id = pg_temp.id('R2')), 1,
  'the review queue lists only flagged runs');

-- Duplicates and Health rules (PRD 6.2, 6.4; owner decision 8) ----------------------------------
insert into ids select 'M1', run_id from pg_temp.manual('R3', pg_temp.uk(2, 9), 5000, 1800);
select results_eq($$ select status, run_id, reasons from pg_temp.manual('R3', pg_temp.uk(2, 9, 15), 3000, 1200) $$,
  $$ values ('duplicate', null::uuid, array['overlaps_another_run']) $$, 'an overlapping manual run is rejected, not saved');
insert into ids select 'H1', run_id from pg_temp.health('R3', pg_temp.uk(2, 9, 5), 5200, 1800, 'workout-1');
select results_eq($$ select status, superseded_by from public.runs where id = pg_temp.id('M1') $$,
  $$ values ('superseded', pg_temp.id('H1')) $$, 'a Health run replaces the overlapping manual run, and says so');
select results_eq($$ select status, source_app from public.runs where id = pg_temp.id('H1') $$,
  $$ values ('accepted', 'com.apple.health') $$, 'the Health run is accepted, with the app that recorded it');
select results_eq($$ select status, reasons from pg_temp.health('R3', pg_temp.uk(2, 9, 5), 5200, 1800, 'workout-1') $$,
  $$ values ('duplicate', array['already_recorded']) $$, 'syncing the same workout again adds nothing');
select results_eq($$ select status, reasons from pg_temp.health('R3', pg_temp.uk(2, 9, 20), 3000, 900, 'workout-2') $$,
  $$ values ('duplicate', array['overlaps_another_run']) $$, 'a Health run overlapping another Health run is rejected');
select results_eq($$ select status, reasons from pg_temp.manual('R3', pg_temp.uk(2, 9, 20), 3000, 900) $$,
  $$ values ('duplicate', array['overlaps_another_run']) $$, 'a manual run overlapping a Health run is rejected');
select results_eq($$ select status, run_id, reasons from pg_temp.health('R3', pg_temp.uk(2, 16), 5000, 1500, 'workout-3', true) $$,
  $$ values ('rejected', null::uuid, array['health_user_entered']) $$, 'a workout typed into Health by hand is rejected (PRD 6.2)');
select results_eq($$ select status from pg_temp.health('R3', pg_temp.uk(2, 17), 5000, 1500, 'workout-4', null) $$,
  $$ values ('rejected') $$, 'if the app cannot say how the workout was recorded, it is rejected');
select throws_ok($$ select * from public.record_run(pg_temp.id('R3'), 'health', pg_temp.uk(2, 18), 5000, 1500, null, 'x', false) $$,
  'P0001', 'invalid_run', 'a Health run must carry its workout ID');
select is((select count(*)::int from public.runs where user_id = pg_temp.id('R3') and external_id = 'workout-3'), 0,
  'rejected runs are not saved');
insert into ids select 'M2', run_id from public.record_run(pg_temp.id('R3'), 'manual', pg_temp.uk(3, 7), 5000, 1500, 'sneaky', 'com.fake', null);
select results_eq($$ select external_id, source_app from public.runs where id = pg_temp.id('M2') $$,
  $$ values (null::text, null::text) $$, 'Health-only fields are never stored on a manual run');

-- Standings with real distances --------------------------------------------------------------
-- League L (normal): R1 owns, R2 and R3 are members. League V (verified only): R3 owns, R1 member.
-- The counting rules must work on any date, so inside this rolled-back test
-- the real current season is swapped for one covering the last 10 days (S),
-- and a past season P covers 10 days ago to yesterday.
delete from public.seasons where now() >= starts_at and now() < ends_at;
insert into public.seasons (month, starts_at, ends_at) values
  ('2001-01-01', now() - interval '10 days', now() + interval '1 day'),
  ('2002-01-01', now() - interval '10 days', now() - interval '1 day');
insert into ids select 'S', id from public.seasons where month = '2001-01-01';
insert into ids select 'P', id from public.seasons where month = '2002-01-01';
insert into ids select 'L', id from public.create_league(pg_temp.id('R1'), 'Counting Club', false);
insert into ids select 'V', id from public.create_league(pg_temp.id('R3'), 'Verified Club', true);
insert into public.league_members (league_id, user_id, role) values
  (pg_temp.id('L'), pg_temp.id('R2'), 'member'), (pg_temp.id('L'), pg_temp.id('R3'), 'member'),
  (pg_temp.id('V'), pg_temp.id('R1'), 'member');
-- Everyone joined 9 days ago, so they were members during season P.
update public.league_members set joined_at = now() - interval '9 days' where league_id in (pg_temp.id('L'), pg_temp.id('V'));

-- R1 accepted: 5.0 + 1.0 = 6.0 km. R2 accepted: 150 + 1 = 151 km (the flagged 1 km does not count).
-- R3 accepted: 5.2 km Health + 5.0 km manual (M2); the superseded manual run does not count.
select pg_temp.as_runner('R2');
select results_eq(
  $$ select place, display_name, distance_m, run_count from public.league_standings(pg_temp.id('L'), pg_temp.id('S')) $$,
  $$ values (1, 'Runner Two', 151000, 4), (2, 'Runner Three', 10200, 2), (3, 'Runner One', 6000, 2) $$,
  'standings add up accepted runs only: flagged and superseded runs never count'
);
select pg_temp.as_runner('R1');
select results_eq(
  $$ select display_name, distance_m from public.league_standings(pg_temp.id('V'), pg_temp.id('S')) $$,
  $$ values ('Runner Three', 5200), ('Runner One', 0) $$,
  'a verified-only league counts Health runs only'
);
select pg_temp.as_runner('R4');
select is_empty($$ select * from public.league_standings(pg_temp.id('L'), pg_temp.id('S')) $$, 'a non-member gets no standings');
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.id('R2'))::text, true);
select is_empty($$ select * from public.league_standings(pg_temp.id('L'), pg_temp.id('S')) $$, 'a token without a live session gets nothing');

-- Ties: equal distance, whoever got there first is ahead.
select pg_temp.as_server();
insert into ids select 'T', id from public.create_league(pg_temp.id('R4'), 'Tie Club', false);
select pg_temp.manual('R4', pg_temp.uk(5, 9), 6000, 1800);
select pg_temp.as_runner('R4');
select results_eq(
  $$ select display_name, distance_m from public.league_standings(pg_temp.id('T'), pg_temp.id('S')) $$,
  $$ values ('Runner Four', 6000) $$, 'a one-member league'
);
select pg_temp.as_server();
insert into public.league_members (league_id, user_id, role, joined_at) values (pg_temp.id('T'), pg_temp.id('R1'), 'member', now() - interval '9 days');
select pg_temp.as_runner('R4');
select results_eq(
  $$ select place, display_name from public.league_standings(pg_temp.id('T'), pg_temp.id('S')) $$,
  $$ values (1, 'Runner Four'), (2, 'Runner One') $$,
  'equal distance: Runner Four reached 6 km days earlier, so is ahead'
);

-- Past seasons include members who have since left; the current season does not.
select pg_temp.as_server();
select public.leave_league(pg_temp.id('R2'), pg_temp.id('L'));
select pg_temp.as_runner('R1');
select ok(exists (select 1 from public.league_standings(pg_temp.id('L'), pg_temp.id('P')) where display_name = 'Runner Two' and distance_m = 151000),
  'a past season still shows a member who has since left, with their distance');
select ok(not exists (select 1 from public.league_standings(pg_temp.id('L')) where display_name = 'Runner Two'),
  'the current season shows current members only');

-- League-mates' runs (owner decision 7) ---------------------------------------------------------
select pg_temp.as_runner('R3');
select results_eq(
  $$ select display_name, distance_m, source from public.league_runs(pg_temp.id('L')) where display_name = 'Runner One' $$,
  $$ values ('Runner One', 1000, 'manual'), ('Runner One', 5000, 'manual') $$,
  'a league-mate sees distance and source of accepted current-season runs, newest first (flagged runs never)'
);
select ok(not exists (select 1 from public.league_runs(pg_temp.id('L')) where display_name = 'Runner Two'),
  'runs of someone who has left are no longer shown');
select is(
  (select ((proargnames)[2:6])::text from pg_proc where proname = 'league_runs'),
  '{user_id,display_name,run_date,distance_m,source}',
  'league_runs gives only user, name, date, distance and source: never start time or duration'
);
select pg_temp.as_runner('R4');
select is_empty($$ select * from public.league_runs(pg_temp.id('L')) $$, 'a non-member sees no runs');

select * from finish();
rollback;
