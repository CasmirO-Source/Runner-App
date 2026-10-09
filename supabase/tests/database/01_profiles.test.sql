-- profiles: constraints, name screening, uniqueness, the update trigger and
-- get_my_profile(). Runs as postgres; who may do what over the API is covered
-- by 00_security_baseline and the integration tests.
begin;
create extension if not exists pgtap with schema extensions;
-- Run as postgres (the hosted CLI logs in with a separate role that cannot
-- use the extensions schema), and look for pgTAP in the extensions schema.
set local role postgres;
set local search_path = extensions, public;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.com', 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'c@example.com', 'authenticated', 'authenticated');

-- Live sessions for A and B (as Supabase Auth creates on sign-in).
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', now(), now());

insert into public.profiles (id, display_name, avatar_id, home_city, over_18) values
  ('11111111-1111-4111-8111-111111111111', 'Sam Smith', 1, 'Leeds', true),
  ('22222222-2222-4222-8222-222222222222', 'Jordan_99', 12, null, true);

-- Helper: try inserting user C with one bad value.
create function pg_temp.try_insert(p_name text, p_avatar int, p_city text, p_over18 boolean) returns void
language sql as $$
  insert into public.profiles (id, display_name, avatar_id, home_city, over_18)
  values ('33333333-3333-4333-8333-333333333333', p_name, p_avatar, p_city, p_over18);
$$;

-- Display name format
select throws_ok($$ select pg_temp.try_insert('Al', 1, null, true) $$, '23514', null, 'name shorter than 3 refused');
select throws_ok($$ select pg_temp.try_insert('abcdefghijklmnopqrstu', 1, null, true) $$, '23514', null, 'name longer than 20 refused');
select throws_ok($$ select pg_temp.try_insert('Zoë', 1, null, true) $$, '23514', null, 'non-ASCII letters refused');
select throws_ok($$ select pg_temp.try_insert('Sam  Jones', 1, null, true) $$, '23514', null, 'double space refused');
select throws_ok($$ select pg_temp.try_insert(' Sam', 1, null, true) $$, '23514', null, 'leading space refused');
select throws_ok($$ select pg_temp.try_insert('<b>Sam</b>', 1, null, true) $$, '23514', null, 'markup characters refused');
select throws_ok($$ select pg_temp.try_insert('Admin', 1, null, true) $$, '23514', null, 'reserved name refused');
select throws_ok($$ select pg_temp.try_insert('f_u_c_k', 1, null, true) $$, '23514', null, 'disguised swear word refused');

-- Uniqueness ignores capitals and treats underscore as space
select throws_ok($$ select pg_temp.try_insert('SAM_SMITH', 1, null, true) $$, '23505', null, 'name differing only by case or underscore refused');
select throws_ok($$ select pg_temp.try_insert('jordan 99', 1, null, true) $$, '23505', null, 'second duplicate refused');

-- Other fields
select throws_ok($$ select pg_temp.try_insert('Casey', 0, null, true) $$, '23514', null, 'avatar 0 refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 13, null, true) $$, '23514', null, 'avatar 13 refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 1, null, false) $$, '23514', null, 'over_18 false refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 1, null, null) $$, '23502', null, 'over_18 missing refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 1, '<script>', true) $$, '23514', null, 'city with markup refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 1, 'Zürich', true) $$, '23514', null, 'city with non-ASCII refused');
select throws_ok($$ select pg_temp.try_insert('Casey', 1, 'X', true) $$, '23514', null, 'one-letter city refused');
select lives_ok($$ select pg_temp.try_insert('Casey', 1, 'King''s Lynn', true) $$, 'valid profile with apostrophe city accepted');
select lives_ok($$ update public.profiles set home_city = 'Stoke-on-Trent' where id = '33333333-3333-4333-8333-333333333333' $$, 'hyphenated city accepted');
select lives_ok($$ update public.profiles set home_city = 'St. Albans' where id = '33333333-3333-4333-8333-333333333333' $$, 'city with full stop accepted');

-- Name screen: no false positives on ordinary names, catches disguises
select results_eq(
  $$ select n from unnest(array['Cassidy', 'Scunthorpe Sam', 'Sam from Essex', 'Swanky', 'Hancock', 'Grape Runner', 'Dickens', 'Classy_Runner']) n
     where not private.display_name_is_clean(n) $$,
  $$ select null::text where false $$,
  'ordinary names that contain short banned words are allowed'
);
select results_eq(
  $$ select count(*)::int from unnest(array['f_u_c_k', '5h1t runner', 'Admin', 'Big Dick', 'A S S', 'Support', 'WANKER', 'sh1tlegs']) n
     where private.display_name_is_clean(n) $$,
  $$ values (0) $$,
  'disguised, spaced and reserved names are blocked'
);

-- Update trigger: protected fields cannot change, updated_at moves
select throws_ok(
  $$ update public.profiles set id = gen_random_uuid() where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'profile id cannot change'
);
select throws_ok(
  $$ update public.profiles set over_18 = true, created_at = now() - interval '1 day' where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'created_at cannot change'
);
update public.profiles set updated_at = '2000-01-01' where id = '11111111-1111-4111-8111-111111111111';
select ok(
  (select updated_at > '2000-01-01' from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'updated_at is set by the database, not the caller'
);

-- get_my_profile returns only the caller's row, chosen by the token
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select results_eq($$ select id::text, home_city from public.get_my_profile() $$,
  $$ values ('11111111-1111-4111-8111-111111111111', 'Leeds') $$, 'user A gets only their own profile, with private fields');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select results_eq($$ select id::text from public.get_my_profile() $$,
  $$ values ('22222222-2222-4222-8222-222222222222') $$, 'user B gets only their own profile');

-- Session checks (migration 4)
select ok(private.session_is_active(), 'a live session counts as active');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select ok(not private.session_is_active(), 'someone else''s session ID does not count');
select is_empty($$ select * from public.get_my_profile() $$, 'a token naming another user''s session gets nothing');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select ok(not private.session_is_active(), 'a token with no session ID does not count');
update auth.sessions set not_after = now() - interval '1 minute' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}', true);
select ok(not private.session_is_active(), 'a session past its end time does not count');
update auth.sessions set not_after = null where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}', true);
select is_empty($$ select * from public.get_my_profile() $$, 'after sign-out (session deleted) get_my_profile returns nothing');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty($$ select * from public.get_my_profile() $$, 'no token subject means no rows');

-- Deleting the auth user deletes the profile (account deletion, milestone 9)
delete from auth.users where id = '22222222-2222-4222-8222-222222222222';
select is_empty($$ select 1 from public.profiles where id = '22222222-2222-4222-8222-222222222222' $$,
  'profile is removed with its auth user');

select * from finish();
rollback;
