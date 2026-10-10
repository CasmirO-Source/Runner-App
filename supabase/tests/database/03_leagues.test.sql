-- Leagues (milestone 2): seasons, creating, updating, invite codes, joining,
-- leaving, removing and the audit log. Runs as postgres with the server's
-- role in the token claims. What signed-in users can see through the API is
-- covered by 00_security_baseline and the integration tests.
begin;
create extension if not exists pgtap with schema extensions;
-- Run as postgres (the hosted CLI logs in with a separate role that cannot
-- use the extensions schema), and look for pgTAP in the extensions schema.
set local role postgres;
set local search_path = extensions, public;
select no_plan();

-- Five runners with profiles: A, B, C, D, E.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'la@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'lb@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'lc@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000004', 'ld@example.com', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000005', 'le@example.com', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, avatar_id, over_18) values
  ('a0000000-0000-4000-8000-000000000001', 'League A', 1, true),
  ('a0000000-0000-4000-8000-000000000002', 'League B', 2, true),
  ('a0000000-0000-4000-8000-000000000003', 'League C', 3, true),
  ('a0000000-0000-4000-8000-000000000004', 'League D', 4, true),
  ('a0000000-0000-4000-8000-000000000005', 'League E', 5, true);

create temp table ids (name text primary key, id uuid);
create function pg_temp.id(p text) returns uuid language sql as $$ select id from ids where name = p $$;
create function pg_temp.as_server() returns void language sql as
  $$ select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
create function pg_temp.as_user(p uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', p)::text, true) $$;
insert into ids values
  ('A', 'a0000000-0000-4000-8000-000000000001'), ('B', 'a0000000-0000-4000-8000-000000000002'),
  ('C', 'a0000000-0000-4000-8000-000000000003'), ('D', 'a0000000-0000-4000-8000-000000000004'),
  ('E', 'a0000000-0000-4000-8000-000000000005');

-- Seasons ----------------------------------------------------------------------
select isnt_empty(
  $$ select 1 from public.seasons where now() >= starts_at and now() < ends_at $$,
  'a season covers right now'
);
select isnt_empty(
  $$ select 1 from public.seasons s1 join public.seasons s2 on s2.month = (s1.month + interval '1 month')::date
     where now() >= s1.starts_at and now() < s1.ends_at $$,
  'next month''s season already exists'
);
select is_empty(
  $$ select month from public.seasons
     where starts_at at time zone 'Europe/London' <> month::timestamp
        or ends_at at time zone 'Europe/London' <> (month + interval '1 month')::timestamp $$,
  'every season runs from midnight UK time on the 1st to midnight UK time on the next 1st'
);
select lives_ok($$ select private.ensure_seasons() $$, 'the season job can run again');
select is((select count(*)::int from public.seasons where month >= date_trunc('month', now() at time zone 'Europe/London')::date), 2,
  'running the season job twice creates no duplicates');

-- Server functions refuse anyone but the server ----------------------------------------
select pg_temp.as_user(pg_temp.id('A'));
select throws_ok($$ select * from public.create_league(pg_temp.id('A'), 'Sneaky League', false) $$, '42501', null,
  'a signed-in user cannot call create_league even if granted');
select throws_ok($$ select * from public.join_league(pg_temp.id('A'), 'ABCDEFGHJK') $$, '42501', null,
  'a signed-in user cannot call join_league even if granted');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.leave_league(pg_temp.id('A'), gen_random_uuid()) $$, '42501', null,
  'no token: refused');
select pg_temp.as_server();

-- Creating ----------------------------------------------------------------------
insert into ids select 'LA', id from public.create_league(pg_temp.id('A'), 'Leeds Lunch Club', null);
select ok(pg_temp.id('LA') is not null, 'A creates a league');
select results_eq(
  $$ select verified_only, member_limit, owner_id from public.leagues where id = pg_temp.id('LA') $$,
  $$ values (false, 8::smallint, pg_temp.id('A')) $$,
  'new league: verified-only off, limit 8, A owns it'
);
select results_eq(
  $$ select user_id, role from public.league_members where league_id = pg_temp.id('LA') $$,
  $$ values (pg_temp.id('A'), 'owner') $$,
  'the creator is the only member, as owner'
);
select throws_ok($$ select * from public.create_league(pg_temp.id('A'), 'Second League', false) $$, 'P0001', 'league_limit_reached',
  'one open league per owner');

select throws_ok($$ select * from public.create_league(pg_temp.id('B'), 'ab', false) $$, '23514', null, 'name too short');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), repeat('a', 31), false) $$, '23514', null, 'name too long');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), '<b>Club</b>', false) $$, '23514', null, 'markup refused');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), 'Leeds  Club', false) $$, '23514', null, 'double space refused');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), 'Zürich Club', false) $$, '23514', null, 'non-ASCII refused');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), 'Admin Crew', false) $$, '23514', null, 'reserved word refused');
select throws_ok($$ select * from public.create_league(pg_temp.id('B'), 'f-u-c-k club', false) $$, '23514', null, 'hyphen-disguised swear word refused');
insert into ids select 'LB', id from public.create_league(pg_temp.id('B'), 'Sam''s Run-Club 2', true);
select ok(pg_temp.id('LB') is not null, 'apostrophes, hyphens and numbers are allowed');

-- Updating ----------------------------------------------------------------------
select throws_ok($$ select * from public.update_league(pg_temp.id('B'), pg_temp.id('LA'), 'Taken Over', null) $$, 'P0001', 'not_found',
  'only the owner can change a league (others get not_found)');
select throws_ok($$ select * from public.update_league(pg_temp.id('A'), pg_temp.id('LA'), null, null) $$, 'P0001', 'nothing_to_change',
  'an empty update is refused');
select throws_ok($$ select * from public.update_league(pg_temp.id('A'), pg_temp.id('LA'), 'Bad <name>', null) $$, '23514', null,
  'an update must pass the same name rules');
select results_eq($$ select name, verified_only from public.update_league(pg_temp.id('A'), pg_temp.id('LA'), 'Leeds Lunch Runners', true) $$,
  $$ values ('Leeds Lunch Runners', true) $$, 'the owner renames and switches on verified-only');

-- Invite codes ----------------------------------------------------------------------
select throws_ok($$ select * from public.create_invite_code(pg_temp.id('C'), pg_temp.id('LA')) $$, 'P0001', 'not_found',
  'only the owner can make a code');
create temp table codes as select * from public.create_invite_code(pg_temp.id('A'), pg_temp.id('LA'));
select matches((select code from codes), '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$', 'code is 10 characters with no look-alikes');
select ok((select expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' from codes),
  'code expires in 7 days');
insert into codes select * from public.create_invite_code(pg_temp.id('A'), pg_temp.id('LA'));
select is((select count(*)::int from public.invite_codes where league_id = pg_temp.id('LA') and revoked_at is null), 1,
  'a new code replaces the old one');
select results_eq(
  $$ select status from public.join_league(pg_temp.id('E'), (select code from codes order by expires_at limit 1)) $$,
  $$ values ('invalid_code') $$, 'the replaced code no longer works'
);
select ok((select count(distinct code) = 2 from codes), 'codes are random');

-- Joining ----------------------------------------------------------------------
create temp table live as select code from public.invite_codes where league_id = pg_temp.id('LA') and revoked_at is null;
select results_eq($$ select status, league_id from public.join_league(pg_temp.id('C'), (select code from live)) $$,
  $$ values ('joined', pg_temp.id('LA')) $$, 'C joins with the code');
select results_eq($$ select status from public.join_league(pg_temp.id('C'), (select code from live)) $$,
  $$ values ('already_member') $$, 'joining twice is reported, not duplicated');
select results_eq($$ select status from public.join_league(pg_temp.id('A'), (select code from live)) $$,
  $$ values ('already_member') $$, 'the owner is already a member');
select results_eq($$ select status from public.join_league(pg_temp.id('D'), lower((select code from live))) $$,
  $$ values ('invalid_code') $$, 'codes are exact (the Edge Function tidies case first)');
select results_eq($$ select status from public.join_league(pg_temp.id('D'), 'ABCDEFGHJK') $$,
  $$ values ('invalid_code') $$, 'an unknown code is refused');
select results_eq($$ select status from public.join_league(pg_temp.id('D'), 'x'' or 1=1 --') $$,
  $$ values ('invalid_code') $$, 'junk is refused');

-- Full league: limit 3, with A and C already in.
update public.leagues set member_limit = 3 where id = pg_temp.id('LA');
select results_eq($$ select status from public.join_league(pg_temp.id('D'), (select code from live)) $$,
  $$ values ('joined') $$, 'D takes the last place');
select results_eq($$ select status, league_id from public.join_league(pg_temp.id('E'), (select code from live)) $$,
  $$ values ('full', null::uuid) $$, 'a full league refuses E and does not reveal which league it is');
update public.leagues set member_limit = 8 where id = pg_temp.id('LA');

-- Expired and revoked codes.
update public.invite_codes set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
  where code = (select code from live);
select results_eq($$ select status from public.join_league(pg_temp.id('E'), (select code from live)) $$,
  $$ values ('invalid_code') $$, 'an expired code is refused');
delete from live;
insert into live select code from public.create_invite_code(pg_temp.id('A'), pg_temp.id('LA'));
select ok(public.revoke_invite_code(pg_temp.id('A'), pg_temp.id('LA')), 'the owner revokes the code');
select results_eq($$ select status from public.join_league(pg_temp.id('E'), (select code from live)) $$,
  $$ values ('invalid_code') $$, 'a revoked code is refused');
select throws_ok($$ select public.revoke_invite_code(pg_temp.id('C'), pg_temp.id('LA')) $$, 'P0001', 'not_found',
  'only the owner can revoke');

-- Membership checks used by the access rules ----------------------------------------------
select pg_temp.as_user(pg_temp.id('C'));
select ok(private.is_league_member(pg_temp.id('LA')), 'C counts as a member of league A');
select ok(not private.is_league_owner(pg_temp.id('LA')), 'C is not its owner');
select ok(not private.is_league_member(pg_temp.id('LB')), 'C is not a member of league B');
select pg_temp.as_user(pg_temp.id('A'));
select ok(private.is_league_owner(pg_temp.id('LA')), 'A owns league A');
select pg_temp.as_server();

-- Removing ----------------------------------------------------------------------
select is(public.remove_league_member(pg_temp.id('C'), pg_temp.id('LA'), pg_temp.id('D')), 'not_found', 'a member cannot remove anyone');
select is(public.remove_league_member(pg_temp.id('A'), pg_temp.id('LA'), pg_temp.id('A')), 'cannot_remove_owner', 'the owner cannot remove themselves');
select is(public.remove_league_member(pg_temp.id('A'), pg_temp.id('LA'), pg_temp.id('D')), 'removed', 'the owner removes D');
select is(public.remove_league_member(pg_temp.id('A'), pg_temp.id('LA'), pg_temp.id('D')), 'not_found', 'D cannot be removed twice');
select results_eq(
  $$ select action, actor_id, league_id, target_user_id from private.audit_log
     where action = 'league_member_removed' and league_id = pg_temp.id('LA') $$,
  $$ values ('league_member_removed', pg_temp.id('A'), pg_temp.id('LA'), pg_temp.id('D')) $$,
  'the removal is in the audit log, by ID only'
);
select pg_temp.as_user(pg_temp.id('D'));
select ok(not private.is_league_member(pg_temp.id('LA')), 'a removed member loses access at once');
select pg_temp.as_server();
select isnt_empty($$ select 1 from public.league_members where league_id = pg_temp.id('LA') and user_id = pg_temp.id('D') and left_at is not null $$,
  'the removed member''s history row is kept for past seasons');

-- Leaving ----------------------------------------------------------------------
select is(public.leave_league(pg_temp.id('A'), pg_temp.id('LA')), 'owner_must_be_last', 'the owner cannot leave while others remain');
select is(public.leave_league(pg_temp.id('C'), pg_temp.id('LA')), 'left', 'C leaves');
select is(public.leave_league(pg_temp.id('C'), pg_temp.id('LA')), 'not_found', 'C cannot leave twice');
select results_eq($$ select status from public.join_league(pg_temp.id('C'), (select code from public.create_invite_code(pg_temp.id('A'), pg_temp.id('LA')))) $$,
  $$ values ('joined') $$, 'C can rejoin with a new code');
select is(public.leave_league(pg_temp.id('C'), pg_temp.id('LA')), 'left', 'C leaves again');
select is((select count(*)::int from public.league_members where league_id = pg_temp.id('LA') and user_id = pg_temp.id('C')), 2,
  'both stints are kept in the history');
select is(public.leave_league(pg_temp.id('A'), pg_temp.id('LA')), 'closed', 'the last member (the owner) leaving closes the league');
select ok((select closed_at is not null from public.leagues where id = pg_temp.id('LA')), 'league is closed');
select is((select count(*)::int from public.invite_codes where league_id = pg_temp.id('LA') and revoked_at is null), 0,
  'closing revokes the code');
select isnt_empty($$ select 1 from private.audit_log where action = 'league_closed' and league_id = pg_temp.id('LA') $$,
  'closing is in the audit log');
select throws_ok($$ select * from public.update_league(pg_temp.id('A'), pg_temp.id('LA'), 'Back Again', null) $$, 'P0001', 'not_found',
  'a closed league cannot be changed');
insert into ids select 'LA2', id from public.create_league(pg_temp.id('A'), 'Leeds Evening Club', false);
select ok(pg_temp.id('LA2') is not null, 'after closing, the owner can start a new league');

-- Standings shape (access rules are tested through the API) ---------------------------------
select results_eq(
  $$ select place, display_name, distance_m from public.league_standings(pg_temp.id('LB')) $$,
  $$ values (1, 'League B', 0) $$,
  'standings list members with places and distance 0 until runs exist'
);

select * from finish();
rollback;
