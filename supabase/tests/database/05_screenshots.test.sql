-- Screenshot reader (milestone 4): readings, reuse detection, confirming,
-- and screenshot runs in record_run (PRD 6.3, 6.4, 8.2, 11).
--
-- Times are relative to now, so the tests work on any date.
begin;
create extension if not exists pgtap with schema extensions;
-- Run as postgres (the hosted CLI logs in with a separate role that cannot
-- use the extensions schema), and look for pgTAP in the extensions schema.
set local role postgres;
set local search_path = extensions, public;
select no_plan();

-- Cast ------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('e0000000-0000-4000-8000-000000000001', 's1@example.com', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000002', 's2@example.com', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000003', 's3@example.com', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, avatar_id, over_18) values
  ('e0000000-0000-4000-8000-000000000001', 'Shot One', 1, true),
  ('e0000000-0000-4000-8000-000000000002', 'Shot Two', 2, true),
  ('e0000000-0000-4000-8000-000000000003', 'Shot Three', 3, true);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', now(), now());

create temp table ids (name text primary key, id uuid);
insert into ids values
  ('S1', 'e0000000-0000-4000-8000-000000000001'), ('S2', 'e0000000-0000-4000-8000-000000000002'),
  ('S3', 'e0000000-0000-4000-8000-000000000003');
create function pg_temp.id(p text) returns uuid language sql as $$ select id from ids where name = p $$;
create function pg_temp.as_server() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
-- hh:mm UK time on the day n days ago.
create function pg_temp.uk(days_ago int, hh int, mm int default 0) returns timestamptz language sql as $$
  select (((now() at time zone 'Europe/London')::date - days_ago) + make_time(hh, mm, 0)) at time zone 'Europe/London'
$$;
create function pg_temp.uk_date(days_ago int) returns date language sql as $$
  select (now() at time zone 'Europe/London')::date - days_ago
$$;
create function pg_temp.save(who text, hash bigint, metres int, seconds int, day date, start time default null)
returns table (status text, reading_id uuid, expires_at timestamptz)
language sql as $$ select * from public.save_screenshot_reading(pg_temp.id(who), hash, metres, seconds, day, start, 'Strava') $$;
create function pg_temp.confirm(who text, reading uuid, at timestamptz, metres int, seconds int)
returns table (status text, run_id uuid, reasons text[], saved_as text, retry_after_seconds integer)
language sql as $$ select * from public.confirm_screenshot_reading(pg_temp.id(who), reading, at, metres, seconds) $$;

-- A screenshot's fingerprint, one 8 bits away (the same screenshot) and one
-- 9 bits away (a different screenshot).
create function pg_temp.h() returns bigint language sql as $$ select 1234567890123456789::bigint $$;
create function pg_temp.h8() returns bigint language sql as $$ select pg_temp.h() # 255 $$;
create function pg_temp.h9() returns bigint language sql as $$ select pg_temp.h() # 511 $$;

-- Only the server, and nobody from the app ------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'private.screenshot_hashes', 'select'), 'signed-in users cannot read readings');
select ok(not has_table_privilege('anon', 'private.screenshot_hashes', 'select'), 'signed-out visitors cannot read readings');
select ok(not has_table_privilege('service_role', 'private.screenshot_hashes', 'select'),
  'even the server role cannot read the table directly: only through the two functions');
select ok(not has_table_privilege('service_role', 'private.screenshot_hashes', 'insert'), 'the server role cannot write the table directly');

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.id('S1'),
  'session_id', 'f0000000-0000-4000-8000-000000000001')::text, true);
select throws_ok($$ select * from pg_temp.save('S1', pg_temp.h(), 5000, 1500, pg_temp.uk_date(1)) $$, '42501', null,
  'a signed-in user cannot save a reading directly');
select throws_ok($$ select * from pg_temp.confirm('S1', gen_random_uuid(), now(), 5000, 1500) $$, '42501', null,
  'a signed-in user cannot confirm a reading directly');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from pg_temp.save('S1', pg_temp.h(), 5000, 1500, pg_temp.uk_date(1)) $$, '42501', null, 'no token: refused');

select pg_temp.as_server();
select throws_ok($$ select * from pg_temp.save('S1', null, 5000, 1500, pg_temp.uk_date(1)) $$, 'P0001', 'invalid_reading',
  'a reading without a fingerprint is refused');

-- Saving readings and spotting reuse ----------------------------------------------------------
insert into ids select 'A', reading_id from pg_temp.save('S1', pg_temp.h(), 5000, 1500, pg_temp.uk_date(1), '07:30');
select ok(pg_temp.id('A') is not null, 'a new reading is saved');
select results_eq(
  $$ select status, start_time, source_app, expires_at between now() + interval '59 minutes' and now() + interval '61 minutes'
     from private.screenshot_hashes where id = pg_temp.id('A') $$,
  $$ values ('pending', '07:30'::time, 'Strava', true) $$,
  'it waits for confirmation for one hour'
);
select results_eq($$ select status, reading_id from pg_temp.save('S1', pg_temp.h8(), 5000, 1500, pg_temp.uk_date(1)) $$,
  $$ values ('existing', pg_temp.id('A')) $$, 'the same runner sending the same screenshot again gets the same reading back');
select results_eq($$ select status, reading_id from pg_temp.save('S2', pg_temp.h8(), 5000, 1500, pg_temp.uk_date(1)) $$,
  $$ values ('reused', null::uuid) $$, 'someone else sending the same screenshot is refused, even before it is confirmed');
select is((select count(*)::int from private.audit_log where action = 'screenshot_reused' and actor_id = pg_temp.id('S2')), 1,
  'the reuse attempt is in the audit log');
select results_eq($$ select status from pg_temp.save('S2', pg_temp.h9(), 5000, 1500, pg_temp.uk_date(1)) $$,
  $$ values ('new') $$, 'the same numbers in a clearly different screenshot (9 bits apart) are not reuse');
select results_eq($$ select status from pg_temp.save('S3', pg_temp.h(), 5010, 1500, pg_temp.uk_date(1)) $$,
  $$ values ('new') $$, 'a near-identical fingerprint with different numbers is a different run in the same app layout');

-- Confirming --------------------------------------------------------------------------------
select throws_ok($$ select * from pg_temp.confirm('S2', pg_temp.id('A'), pg_temp.uk(1, 7, 30), 5000, 1500) $$,
  'P0001', 'reading_unavailable', 'nobody can confirm someone else''s reading');
insert into ids select 'RunA', run_id from pg_temp.confirm('S1', pg_temp.id('A'), pg_temp.uk(1, 7, 30), 5000, 1500);
select results_eq($$ select source, status from public.runs where id = pg_temp.id('RunA') $$,
  $$ values ('screenshot', 'accepted') $$, 'confirming the values exactly as read saves a screenshot run');
select results_eq($$ select status, saved_as, run_id from private.screenshot_hashes where id = pg_temp.id('A') $$,
  $$ values ('used', 'screenshot', pg_temp.id('RunA')) $$, 'the reading is marked used and linked to the run');
select throws_ok($$ select * from pg_temp.confirm('S1', pg_temp.id('A'), pg_temp.uk(1, 12), 5000, 1500) $$,
  'P0001', 'reading_unavailable', 'a reading can only be confirmed once');
select results_eq($$ select status from pg_temp.save('S1', pg_temp.h(), 5000, 1500, pg_temp.uk_date(1)) $$,
  $$ values ('reused') $$, 'a used screenshot cannot be read again, even by its owner');

-- No start time on the screenshot: the runner adds one and it stays a screenshot run.
insert into ids select 'B', reading_id from pg_temp.save('S1', 111, 6000, 1980, pg_temp.uk_date(2));
select results_eq($$ select status, saved_as from pg_temp.confirm('S1', pg_temp.id('B'), pg_temp.uk(2, 18, 5), 6000, 1980) $$,
  $$ values ('accepted', 'screenshot') $$, 'adding the missing start time keeps screenshot status');

-- Anything changed: saved as a typed-in run (PRD 6.3).
insert into ids select 'C', reading_id from pg_temp.save('S1', 222, 8000, 2700, pg_temp.uk_date(3));
select results_eq($$ select status, saved_as from pg_temp.confirm('S1', pg_temp.id('C'), pg_temp.uk(3, 8), 8100, 2700) $$,
  $$ values ('accepted', 'manual') $$, 'a changed distance saves a typed-in run');
select is((select source from public.runs r join private.screenshot_hashes h on h.run_id = r.id where h.id = pg_temp.id('C')), 'manual',
  'and the run itself is typed-in');
insert into ids select 'D', reading_id from pg_temp.save('S1', 333, 4000, 1300, pg_temp.uk_date(3));
select results_eq($$ select saved_as from pg_temp.confirm('S1', pg_temp.id('D'), pg_temp.uk(4, 23, 30), 4000, 1300) $$,
  $$ values ('manual') $$, 'a different date saves a typed-in run');
insert into ids select 'E', reading_id from pg_temp.save('S1', 444, 3000, 1000, pg_temp.uk_date(5), '06:00');
select results_eq($$ select saved_as from pg_temp.confirm('S1', pg_temp.id('E'), pg_temp.uk(5, 6, 10), 3000, 1000) $$,
  $$ values ('manual') $$, 'changing a start time the screenshot showed saves a typed-in run');

-- Changed readings count towards the typed-in limit: 10 a day, shared with run-manual.
select public.consume_rate_limit('run_manual', pg_temp.id('S1')::text, 10, 86400) from generate_series(1, 7);
insert into ids select 'F', reading_id from pg_temp.save('S1', 555, 5000, 1600, pg_temp.uk_date(6));
select results_eq($$ select status, run_id, saved_as, retry_after_seconds > 0 from pg_temp.confirm('S1', pg_temp.id('F'), pg_temp.uk(6, 9), 5100, 1600) $$,
  $$ values ('rate_limited', null::uuid, 'manual', true) $$, 'over the typed-in limit: nothing is saved, with a time to wait');
select is((select status from private.screenshot_hashes where id = pg_temp.id('F')), 'pending', 'and the reading can still be confirmed later');
select results_eq($$ select status, saved_as from pg_temp.confirm('S1', pg_temp.id('F'), pg_temp.uk(6, 9), 5000, 1600) $$,
  $$ values ('accepted', 'screenshot') $$, 'confirming it unchanged does not count towards the typed-in limit');

-- The run checks apply to screenshot runs (PRD 6.4, 11.5) ----------------------------------------
-- The injection case: a screenshot that talks the reader into 500 km gives a run that counts for nothing.
insert into ids select 'G', reading_id from pg_temp.save('S2', 666, 500000, 3600, pg_temp.uk_date(1));
select results_eq($$ select status, reasons, saved_as from pg_temp.confirm('S2', pg_temp.id('G'), pg_temp.uk(1, 10), 500000, 3600) $$,
  $$ values ('flagged', array['distance_out_of_range', 'pace_out_of_range', 'daily_total_exceeded'], 'screenshot') $$,
  'a 500 km reading is flagged, so it counts for nothing and goes to the review queue');
insert into ids select 'H', reading_id from pg_temp.save('S2', 777, 5000, 1500, pg_temp.uk_date(8));
select results_eq($$ select status, reasons from pg_temp.confirm('S2', pg_temp.id('H'), pg_temp.uk(8, 10), 5000, 1500) $$,
  $$ values ('flagged', array['too_old']) $$, 'screenshot runs follow the typed-in rule: no more than 7 days old');

-- Duplicates: screenshot runs behave like typed-in runs.
select public.record_run(pg_temp.id('S3'), 'manual', pg_temp.uk(2, 7), 5000, 1500, null, null, null);
insert into ids select 'I', reading_id from pg_temp.save('S3', 888, 5000, 1500, pg_temp.uk_date(2));
select results_eq($$ select status, run_id, saved_as from pg_temp.confirm('S3', pg_temp.id('I'), pg_temp.uk(2, 7, 10), 5000, 1500) $$,
  $$ values ('duplicate', null::uuid, 'screenshot') $$, 'a screenshot run overlapping another run is not saved');
select is((select status from private.screenshot_hashes where id = pg_temp.id('I')), 'used', 'and its reading is used up');
insert into ids select 'J', reading_id from pg_temp.save('S3', 999, 5000, 1500, pg_temp.uk_date(3));
insert into ids select 'RunJ', run_id from pg_temp.confirm('S3', pg_temp.id('J'), pg_temp.uk(3, 7), 5000, 1500);
insert into ids select 'HJ', run_id from public.record_run(pg_temp.id('S3'), 'health', pg_temp.uk(3, 7, 2), 5050, 1500, 'w-1', 'com.apple.health', false);
select results_eq($$ select status, superseded_by from public.runs where id = pg_temp.id('RunJ') $$,
  $$ values ('superseded', pg_temp.id('HJ')) $$, 'a Health run replaces an overlapping screenshot run');

-- Expiry --------------------------------------------------------------------------------------
insert into ids select 'K', reading_id from pg_temp.save('S3', 4242, 7000, 2400, pg_temp.uk_date(1));
update private.screenshot_hashes set expires_at = now() - interval '1 second' where id = pg_temp.id('K');
select throws_ok($$ select * from pg_temp.confirm('S3', pg_temp.id('K'), pg_temp.uk(1, 9), 7000, 2400) $$,
  'P0001', 'reading_unavailable', 'an expired reading cannot be confirmed');
select results_eq($$ select status from pg_temp.save('S2', 4242, 7000, 2400, pg_temp.uk_date(1)) $$,
  $$ values ('new') $$, 'an expired, unconfirmed reading does not block anyone');

-- The cleanup job deletes expired unconfirmed readings and keeps used ones (their fingerprints block reuse).
select is((select count(*)::int from private.screenshot_hashes where id in (pg_temp.id('K'), pg_temp.id('A'))), 2, 'before cleanup');
do $$ begin execute (select command from cron.job where jobname = 'screenshot-readings-cleanup'); end $$;
select is((select count(*)::int from private.screenshot_hashes where id = pg_temp.id('K')), 0, 'cleanup deletes the expired reading');
select is((select count(*)::int from private.screenshot_hashes where id = pg_temp.id('A')), 1, 'cleanup keeps used readings');

-- Deleting an account deletes its readings.
delete from auth.users where id = pg_temp.id('S2');
select is((select count(*)::int from private.screenshot_hashes where user_id = pg_temp.id('S2')), 0,
  'a deleted account leaves no readings behind');

select * from finish();
rollback;
