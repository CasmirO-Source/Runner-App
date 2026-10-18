-- Stride rating (milestone 5): the formula, qualifying runs, placement, the
-- 60 and 120 day windows, thin windows, the weekly fall cap, instant rise,
-- sandbagging, history and permissions (PRD 4, docs/milestone-5-plan.md).
--
-- Runs are recorded through record_run as the server, exactly as Health sync
-- will. Times are relative to now, so the tests work on any date. Row-level
-- security on rating_history is also tested through the real API
-- (tests/integration/stride.test.ts).
begin;
create extension if not exists pgtap with schema extensions;
-- Run as postgres (the hosted CLI logs in with a separate role that cannot
-- use the extensions schema), and look for pgTAP in the extensions schema.
set local role postgres;
set local search_path = extensions, public;
select no_plan();

-- Cast ------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
select ('a5000000-0000-4000-8000-00000000000' || n)::uuid, 'stride' || n || '@example.com', 'authenticated', 'authenticated'
from generate_series(1, 7) as n;
insert into public.profiles (id, display_name, avatar_id, over_18)
select ('a5000000-0000-4000-8000-00000000000' || n)::uuid, 'Stride Runner ' || n, n, true
from generate_series(1, 7) as n;
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('b5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', now(), now());

create function pg_temp.id(p text) returns uuid language sql as
  $$ select ('a5000000-0000-4000-8000-00000000000' || right(p, 1))::uuid $$;
create function pg_temp.as_server() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;

-- A verified Health run, n days ago, in one of eight 3-hour slots that day,
-- so runs never overlap.
create function pg_temp.health(who text, days_ago int, slot int, metres int, seconds int)
returns table (status text, run_id uuid, reasons text[])
language sql as $$
  select * from public.record_run(
    pg_temp.id(who), 'health',
    date_trunc('hour', now()) - make_interval(days => days_ago, hours => slot * 3),
    metres, seconds, gen_random_uuid()::text, 'com.apple.health', false)
$$;
create function pg_temp.stride(who text) returns smallint language sql as
  $$ select stride from public.profiles where id = pg_temp.id(who) $$;
create function pg_temp.placement(who text) returns smallint language sql as
  $$ select placement_runs from public.profiles where id = pg_temp.id(who) $$;
create function pg_temp.latest(who text) returns public.rating_history language sql as $$
  select * from public.rating_history where user_id = pg_temp.id(who) order by created_at desc, id desc limit 1
$$;
create function pg_temp.history_count(who text) returns int language sql as
  $$ select count(*)::int from public.rating_history where user_id = pg_temp.id(who) $$;

select pg_temp.as_server();

-- 1. The formula (PRD 4.3) ----------------------------------------------------------------
select is(round(private.riegel_t5(1500, 5000), 1), 1500.0, 'Riegel: a 5 km is its own 5 km equivalent');
select is(round(private.riegel_t5(3000, 10000), 1), 1438.9, 'Riegel: 10 km in 50:00 is a 23:59 5 km');
select is(round(private.riegel_t5(6300, 21097), 1), 1369.5, 'Riegel: a half marathon in 1:45:00 is a 22:50 5 km');
select is((select stride from private.stride_from(private.speed_score(1500), 15)), 919,
  'PRD reference: 25 minute 5 km and 15 km a week is about 920 (Pacer)');
select is((select stride from private.stride_from(private.speed_score(1200), 40)), 1643,
  'PRD reference: 20 minute 5 km and 40 km a week is about 1640 (Strider)');
select is(private.speed_score(2710), 0::numeric, 'slower than 1.85 m/s (45:03): speed score 0');
select is(private.speed_score(780), 1::numeric, 'faster than 6.41 m/s (13:00): speed score 1');
select is(private.speed_score(600), 1::numeric, 'speed score never goes above 1');
select is((select volume_score from private.stride_from(0, 120)), 1::numeric, 'volume score capped at 60 km a week');
select is((select stride from private.stride_from(1, 60)), 3000, 'the most anyone can score is 3000');
select is((select stride from private.stride_from(0, 0)), 0, 'the least is 0');

-- 2. Qualifying runs and placement (R1) -----------------------------------------------------
select is(pg_temp.placement('R1'), 0::smallint, 'a new runner has 0 of 3 placement runs');
select pg_temp.health('R1', 2, 0, 2999, 900);
select is(pg_temp.placement('R1'), 0::smallint, 'under 3 km does not qualify');
select pg_temp.health('R1', 3, 0, 21101, 7000);
select is(pg_temp.placement('R1'), 0::smallint, 'over 21.1 km does not qualify');
select public.record_run(pg_temp.id('R1'), 'manual', now() - interval '4 days', 5000, 1500, null, null, null);
select is(pg_temp.placement('R1'), 0::smallint, 'a typed-in run never counts');
select pg_temp.health('R1', 5, 0, 5000, 600);
select is(pg_temp.placement('R1'), 0::smallint, 'a flagged Health run (impossible pace) never counts');
select pg_temp.health('R1', 100, 0, 3000, 900);
select is(pg_temp.placement('R1'), 1::smallint, 'exactly 3 km qualifies, and 100 days ago is inside the 120 days: Placing 1 of 3');
select pg_temp.health('R1', 6, 0, 21100, 7200);
select is(pg_temp.placement('R1'), 2::smallint, 'exactly 21.1 km qualifies: Placing 2 of 3');
select is(pg_temp.stride('R1'), null::smallint, 'no Stride before placement');
select is(pg_temp.history_count('R1'), 0, 'no rating history before placement');
create temp table placed as select run_id from pg_temp.health('R1', 7, 0, 5000, 1500);
select isnt(pg_temp.stride('R1'), null::smallint, 'the third qualifying run places the runner');
select is(pg_temp.placement('R1'), 3::smallint, 'placement shows 3 of 3');
select is(pg_temp.history_count('R1'), 1, 'one rating, from the run that placed them');
select is((pg_temp.latest('R1')).run_id, (select run_id from placed), 'the rating records the run that caused it (PRD 4.4)');
select public.record_run(pg_temp.id('R1'), 'manual', now() - interval '30 hours', 5000, 1200, null, null, null);
select is(pg_temp.history_count('R1'), 1, 'a typed-in run after placement does not recalculate');

-- 3. The PRD reference runner, end to end (R2) -----------------------------------------------
-- 25 minute 5 km runs, and 60 km in the last 4 weeks (15 km a week). The two
-- long runs are over 21.1 km, so they add volume but not speed (decision 5).
select pg_temp.health('R2', 2, 0, 22500, 8100);
select pg_temp.health('R2', 3, 0, 22500, 8100);
select pg_temp.health('R2', 4, 0, 5000, 1500);
select pg_temp.health('R2', 5, 0, 5000, 1500);
select pg_temp.health('R2', 6, 0, 5000, 1500);
select is(pg_temp.stride('R2'), 919::smallint, 'a 25 minute 5 km runner doing 15 km a week scores 919');
select results_eq(
  $$ select t5_median_s, weekly_km, window_days, speed_score, volume_score from pg_temp.latest('R2') $$,
  $$ values (1500.0::numeric, 15.00::numeric, 60::smallint, 0.32529::numeric, 0.25000::numeric) $$,
  'every number behind the rating is kept, so it can be explained'
);

-- 4. Sandbagging (PRD 4.4, M5 acceptance) ------------------------------------------------------
-- Ten deliberately slow 5 km runs (40 minutes each).
select pg_temp.health('R2', d, 1, 5000, 2400) from generate_series(7, 16) as d;
select is((pg_temp.latest('R2')).t5_median_s, 1500.0::numeric, 'ten slow runs leave the speed part unchanged: only the best three count');
select ok(pg_temp.stride('R2') >= 919, 'ten slow runs do not lower Stride (the extra distance can only add volume)');

-- 5. The 60 and 120 day windows, and the weekly fall cap (R3) -------------------------------------
-- Three fast runs (20:00) 61 to 63 days ago: no run in the last 30 days, so
-- the 120-day window is used and they count.
select pg_temp.health('R3', d, 0, 5000, 1200) from generate_series(61, 63) as d;
select results_eq($$ select window_days, t5_median_s from pg_temp.latest('R3') $$,
  $$ values (120::smallint, 1200.0::numeric) $$, 'no run in the last 30 days: the last 120 days count');
-- Three slower runs (25:00) in the last week: the window drops to 60 days and
-- the old fast runs fall out of it.
select pg_temp.health('R3', d, 0, 5000, 1500) from generate_series(1, 3) as d;
select results_eq($$ select window_days, t5_median_s from pg_temp.latest('R3') $$,
  $$ values (60::smallint, 1500.0::numeric) $$, 'with recent runs, only the last 60 days count: a fast run 61 days ago is ignored');
select ok((pg_temp.latest('R3')).calculated < pg_temp.stride('R3'), 'the formula fell further than Stride was allowed to');
select is(pg_temp.stride('R3')::int, (select max(stride) from public.rating_history where user_id = pg_temp.id('R3')) - 150,
  'a fall is limited to 150 below the highest Stride of the last 7 days');
-- A week later it may fall another 150 (ratings moved 8 days into the past).
create temp table r3_before as select pg_temp.stride('R3') as stride;
update public.rating_history set created_at = created_at - interval '8 days' where user_id = pg_temp.id('R3');
select pg_temp.health('R3', 4, 0, 5000, 1500);
select is(pg_temp.stride('R3')::int, (select stride from r3_before) - 150, 'the next week it can fall another 150');

-- Only old fast runs and some 31 to 33 days ago: still no run in the last 30
-- days, so the 120-day window keeps the fast ones (R4).
select pg_temp.health('R4', d, 0, 5000, 1200) from generate_series(61, 63) as d;
select pg_temp.health('R4', d, 0, 5000, 1500) from generate_series(31, 33) as d;
select results_eq($$ select window_days, t5_median_s from pg_temp.latest('R4') $$,
  $$ values (120::smallint, 1200.0::numeric) $$, 'the 120-day window applies until there is a run in the last 30 days');

-- 6. Thin windows (decision 3, R5) ----------------------------------------------------------------
select pg_temp.health('R5', d, 0, 5000, 1500) from generate_series(100, 102) as d;
-- Time passes: the placement runs are now over 120 days old.
update public.runs set started_at = started_at - interval '25 days' where user_id = pg_temp.id('R5');
select pg_temp.health('R5', 1, 0, 5000, 2400);
select is((pg_temp.latest('R5')).t5_median_s, 1500.0::numeric, 'one slow run in an otherwise empty window changes nothing');
select pg_temp.health('R5', 2, 0, 5000, 1200);
select is((pg_temp.latest('R5')).t5_median_s, 1500.0::numeric, 'with two runs, the slower one is used, and it cannot lower the speed part');
select pg_temp.health('R5', 3, 0, 5000, 1250);
select is((pg_temp.latest('R5')).t5_median_s, 1250.0::numeric, 'with three runs, the median of the best three applies again');
select is(pg_temp.placement('R5'), 3::smallint, 'placed for good, even after the placement runs aged out');

-- 7. Instant rise (R6) ------------------------------------------------------------------------------
select pg_temp.health('R6', d, 0, 5000, 1500) from generate_series(1, 3) as d;
create temp table r6_before as select pg_temp.stride('R6') as stride;
select pg_temp.health('R6', d, 1, 5000, 1200) from generate_series(4, 6) as d;
select ok(pg_temp.stride('R6') > (select stride from r6_before), 'faster runs raise Stride');
select is(pg_temp.stride('R6')::int, (pg_temp.latest('R6')).calculated::int, 'a rise applies in full, at once');

-- 8. The rise-then-drop loophole (decision 2, R7) -----------------------------------------------------
-- Stride was 2000 three days ago and is 1900 now. The floor is 150 below the
-- 7-day high (1850), not 150 below today's value (1750).
select pg_temp.health('R7', d, 0, 5000, 1500) from generate_series(1, 3) as d;
insert into public.rating_history (user_id, run_id, stride, calculated, speed_score, volume_score, t5_median_s, weekly_km, window_days, created_at)
select pg_temp.id('R7'), (pg_temp.latest('R7')).run_id, 2000, 2000, 0.9, 0.5, 900, 30, 60, now() - interval '3 days';
update public.profiles set stride = 1900 where id = pg_temp.id('R7');
select pg_temp.health('R7', 4, 0, 5000, 1500);
select is(pg_temp.stride('R7'), 1850::smallint, 'a fall is measured from the highest Stride of the week');

-- 9. Permissions -----------------------------------------------------------------------------------
select ok(not has_column_privilege('authenticated', 'public.profiles', 'stride', 'UPDATE'), 'signed-in users cannot write a Stride');
select ok(not has_column_privilege('service_role', 'public.profiles', 'stride', 'UPDATE'), 'even the server role cannot write a Stride');
select ok(not has_column_privilege('service_role', 'public.profiles', 'placement_runs', 'UPDATE'), 'or a placement count');
select ok(not has_table_privilege('authenticated', 'public.rating_history', 'INSERT, UPDATE, DELETE'), 'signed-in users cannot write rating history');
select ok(not has_table_privilege('service_role', 'public.rating_history', 'SELECT, INSERT, UPDATE, DELETE'), 'the server role has no access to rating history');
select ok(not has_table_privilege('anon', 'public.rating_history', 'SELECT'), 'signed-out visitors cannot read rating history');
select ok(not has_function_privilege(r, 'private.recalculate_stride(uuid, uuid)', 'EXECUTE'), r || ' cannot run the recalculation')
from unnest(array['anon', 'authenticated', 'service_role']) as r;
select isnt_empty(
  $$ select 1 from pg_policies where tablename = 'rating_history' and qual like '%session_is_active()%' and qual like '%auth.uid()%' $$,
  'rating history: your own rows only, with a live session'
);

-- 10. The league table carries Stride (PRD 5.2) ------------------------------------------------------
create temp table league as select id from public.create_league(pg_temp.id('R2'), 'Stride Test Club', false);
insert into public.league_members (league_id, user_id, role) select id, pg_temp.id('R1'), 'member' from league;
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.id('R2'),
  'session_id', 'b5000000-0000-4000-8000-000000000002')::text, true);
select results_eq(
  $$ select display_name, stride from public.league_standings((select id from league)) order by display_name $$,
  $$ select display_name, stride from public.profiles where id in (pg_temp.id('R1'), pg_temp.id('R2')) order by display_name $$,
  'each runner''s Stride is in the league table'
);

-- 11. Estimated Stride (PRD 4.5) ---------------------------------------------------------------------
-- Uses the same formula: the PRD reference runner's answers give 919.
select pg_temp.as_server();
insert into auth.users (id, email, aud, role) values ('a5000000-0000-4000-8000-000000000009', 'stride9@example.com', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, avatar_id, over_18) values ('a5000000-0000-4000-8000-000000000009', 'Stride Runner 9', 9, true);
select is(public.set_stride_estimate(pg_temp.id('R9'), 1500, 15), 919::smallint, 'a 25 minute 5 km and 15 km a week estimates 919, the same as the real formula');
select results_eq($$ select estimate_5k_s, estimate_weekly_km, estimated_stride, stride from public.profiles where id = pg_temp.id('R9') $$,
  $$ values (1500, 15::smallint, 919::smallint, null::smallint) $$, 'the answers and the estimate are kept; the real Stride stays empty');
select is(public.set_stride_estimate(pg_temp.id('R9'), null, 10), 125::smallint, '"not sure" about 5 km: volume only (10 km a week gives 125)');
select is(pg_temp.history_count('R9'), 0, 'an estimate never goes in the rating history');
select is(pg_temp.placement('R9'), 0::smallint, 'an estimate never counts towards placement');
select throws_ok($$ select public.set_stride_estimate(pg_temp.id('R9'), 700, 10) $$, 'P0001', 'invalid_estimate', 'a 5 km under 13 minutes is refused');
select throws_ok($$ select public.set_stride_estimate(pg_temp.id('R9'), 1500, 151) $$, 'P0001', 'invalid_estimate', 'over 150 km a week is refused');
select throws_ok($$ select public.set_stride_estimate(pg_temp.id('R9'), 1500, null) $$, 'P0001', 'invalid_estimate', 'a 5 km time needs weekly km with it');
select is(public.set_stride_estimate(pg_temp.id('R9'), null, null), null::smallint, 'an estimate can be cleared');
select is((select estimated_stride from public.profiles where id = pg_temp.id('R9')), null::smallint, 'and is gone');
select throws_ok($$ select public.set_stride_estimate(pg_temp.id('R2'), 1500, 15) $$, 'P0001', 'already_placed', 'once placed, an estimate cannot be set');
-- A high estimate does not hold up the real Stride at placement (no fall limit applies to it).
select public.set_stride_estimate(pg_temp.id('R9'), 780, 150);
select pg_temp.health('R9', d, 0, 5000, 1800) from generate_series(1, 3) as d;
select ok(pg_temp.stride('R9') < 1000, 'at placement the real Stride replaces a boastful estimate completely');
select is((select estimated_stride from public.profiles where id = pg_temp.id('R9')), 3000::smallint, 'the estimate is kept, to show how it compared');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'estimate_5k_s', 'SELECT'), 'other runners cannot see the answers');
select ok(has_column_privilege('authenticated', 'public.profiles', 'estimated_stride', 'SELECT'), 'the estimate itself is public, like a Stride');
select ok(not has_column_privilege('service_role', 'public.profiles', 'estimated_stride', 'UPDATE'), 'the server can only set an estimate through the function');
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.id('R9'))::text, true);
select throws_ok($$ select public.set_stride_estimate(pg_temp.id('R9'), 1500, 15) $$, '42501', null, 'a signed-in user cannot set an estimate directly');

select * from finish();
rollback;
