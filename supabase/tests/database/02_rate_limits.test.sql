-- consume_rate_limit(): counting, refusals, caller check, input checks,
-- hashing and the cleanup job's statement.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Counting within one window. Each call is its own statement, as in real use.
select results_eq($$ select allowed, remaining from public.consume_rate_limit('test_scope', 'user-a', 3, 3600) $$, $$ values (true, 2) $$, 'request 1 allowed');
select results_eq($$ select allowed, remaining from public.consume_rate_limit('test_scope', 'user-a', 3, 3600) $$, $$ values (true, 1) $$, 'request 2 allowed');
select results_eq($$ select allowed, remaining from public.consume_rate_limit('test_scope', 'user-a', 3, 3600) $$, $$ values (true, 0) $$, 'request 3 allowed');
select results_eq($$ select allowed, remaining from public.consume_rate_limit('test_scope', 'user-a', 3, 3600) $$, $$ values (false, 0) $$, 'request 4 refused');
select ok(
  (select retry_after_seconds between 1 and 3600 from public.consume_rate_limit('test_scope', 'user-a', 3, 3600)),
  'refusal says how long to wait'
);

-- Separate counters
select results_eq($$ select allowed from public.consume_rate_limit('test_scope', 'user-b', 3, 3600) $$, $$ values (true) $$, 'another subject has its own count');
select results_eq($$ select allowed from public.consume_rate_limit('other_scope', 'user-a', 3, 3600) $$, $$ values (true) $$, 'another scope has its own count');
select results_eq($$ select allowed from public.consume_rate_limit('test_scope', 'user-a', 3, 86400) $$, $$ values (true) $$, 'another window length has its own count');

-- Stored keys are hashes, never the raw subject
select is_empty($$ select 1 from private.rate_limits where bucket !~ '^[0-9a-f]{64}$' or bucket like '%user-a%' $$, 'only SHA-256 hashes are stored');

-- Caller check: only the server's role may count
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}', true);
select throws_ok($$ select * from public.consume_rate_limit('test_scope', 'x', 3, 60) $$, '42501', null, 'signed-in caller refused even with execute');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.consume_rate_limit('test_scope', 'x', 3, 60) $$, '42501', null, 'caller with no token refused');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Input checks
select throws_ok($$ select * from public.consume_rate_limit('Bad Scope', 'x', 3, 60) $$, '22023', null, 'scope with capitals and spaces refused');
select throws_ok($$ select * from public.consume_rate_limit('x'' or 1=1 --', 'x', 3, 60) $$, '22023', null, 'scope with SQL characters refused');
select throws_ok($$ select * from public.consume_rate_limit(repeat('a', 41), 'x', 3, 60) $$, '22023', null, 'scope longer than 40 refused');
select throws_ok($$ select * from public.consume_rate_limit('ok', '', 3, 60) $$, '22023', null, 'empty subject refused');
select throws_ok($$ select * from public.consume_rate_limit('ok', repeat('a', 201), 3, 60) $$, '22023', null, 'subject longer than 200 refused');
select throws_ok($$ select * from public.consume_rate_limit('ok', 'x', 0, 60) $$, '22023', null, 'limit 0 refused');
select throws_ok($$ select * from public.consume_rate_limit('ok', 'x', 3, 0) $$, '22023', null, 'window 0 refused');
select throws_ok($$ select * from public.consume_rate_limit('ok', 'x', 3, 86401) $$, '22023', null, 'window over a day refused');
select throws_ok($$ select * from public.consume_rate_limit(null, 'x', 3, 60) $$, '22023', null, 'null scope refused');

-- Cleanup job statement removes rows older than two days and keeps the rest
insert into private.rate_limits (bucket, window_start, hits) values
  (repeat('a', 64), now() - interval '3 days', 5),
  (repeat('b', 64), now() - interval '1 day', 5);
delete from private.rate_limits where window_start < now() - interval '2 days';
select is_empty($$ select 1 from private.rate_limits where bucket = repeat('a', 64) $$, 'cleanup removes rows older than two days');
select isnt_empty($$ select 1 from private.rate_limits where bucket = repeat('b', 64) $$, 'cleanup keeps recent rows');

select * from finish();
rollback;
