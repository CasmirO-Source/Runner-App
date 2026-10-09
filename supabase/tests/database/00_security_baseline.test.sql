-- Security baseline: checks the permission records themselves, so a future
-- migration that weakens access fails the build (PRD 9.1 rule 1, Appendix A
-- #7 and #41). When a later milestone adds a table or function, the expected
-- lists below must be updated on purpose, in the same change.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. Row-level security on every table we create, in any schema. Our tables
-- are owned by postgres (migrations run as postgres). The only exception is
-- the Supabase CLI's migration history, which the API never serves.
select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where c.relkind in ('r', 'p')
      and r.rolname = 'postgres'
      and not c.relrowsecurity
      and c.relpersistence <> 't'  -- temporary tables (pgTAP's own scratch table)
      and n.nspname <> 'supabase_migrations'
  $$,
  'every table has row-level security enabled'
);

select set_eq(
  $$
    select n.nspname || '.' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_roles r on r.oid = c.relowner
    where c.relkind in ('r', 'p') and r.rolname = 'postgres' and c.relpersistence <> 't'
      and n.nspname <> 'supabase_migrations'
  $$,
  array['public.profiles', 'private.rate_limits'],
  'only the milestone 1 tables exist'
);

-- 2. Signed-out users (anon) have no table or column access at all.
select is_empty(
  $$
    select table_schema || '.' || table_name || ':' || privilege_type
    from information_schema.column_privileges
    where grantee in ('anon', 'PUBLIC') and table_schema in ('public', 'private')
  $$,
  'anon and PUBLIC have no access to any column'
);

-- 3. Exact table-level grants to API roles.
select set_eq(
  $$
    select grantee || ' ' || privilege_type || ' ' || table_schema || '.' || table_name
    from information_schema.role_table_grants
    where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  $$,
  array['service_role SELECT public.profiles'],
  'table-level grants are exactly as intended'
);

-- 4. Exact column-level access for API roles.
select set_eq(
  $$
    select grantee || ' ' || privilege_type || ' ' || table_schema || '.' || table_name || '.' || column_name
    from information_schema.column_privileges
    where table_schema in ('public', 'private') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  $$,
  array[
    'authenticated SELECT public.profiles.id',
    'authenticated SELECT public.profiles.display_name',
    'authenticated SELECT public.profiles.avatar_id',
    'service_role SELECT public.profiles.id',
    'service_role SELECT public.profiles.display_name',
    'service_role SELECT public.profiles.avatar_id',
    'service_role SELECT public.profiles.home_city',
    'service_role SELECT public.profiles.over_18',
    'service_role SELECT public.profiles.created_at',
    'service_role SELECT public.profiles.updated_at',
    'service_role INSERT public.profiles.id',
    'service_role INSERT public.profiles.display_name',
    'service_role INSERT public.profiles.avatar_id',
    'service_role INSERT public.profiles.home_city',
    'service_role INSERT public.profiles.over_18',
    'service_role UPDATE public.profiles.display_name',
    'service_role UPDATE public.profiles.avatar_id',
    'service_role UPDATE public.profiles.home_city'
  ],
  'column-level grants are exactly as intended (signed-in users see public fields only)'
);

-- 5. Nobody can delete or truncate anything through the API.
select is_empty(
  $$
    select grantee || ' ' || privilege_type || ' ' || table_schema || '.' || table_name
    from information_schema.role_table_grants
    where table_schema in ('public', 'private')
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  $$,
  'no API role can delete, truncate, reference or add triggers'
);

-- 6. Exact list of who may run each of our functions. PUBLIC (everyone) may
-- run none of them.
select set_eq(
  $$
    select n.nspname || '.' || p.proname || ' ' || r.role
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
    where n.nspname in ('public', 'private')
      and has_function_privilege(r.role, p.oid, 'execute')
  $$,
  array[
    'public.get_my_profile authenticated',
    'public.consume_rate_limit service_role',
    'private.display_name_is_clean service_role'
  ],
  'functions are runnable only by the roles that need them'
);

select is_empty(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
    lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname in ('public', 'private') and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  $$,
  'PUBLIC cannot run any of our functions'
);

-- 7. Every function has a fixed, empty search_path, so it cannot be tricked
-- into using objects a caller created.
select is_empty(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not coalesce(p.proconfig @> array['search_path=""'], false)
  $$,
  'every function sets an empty search_path'
);

select set_eq(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
  $$,
  array['public.get_my_profile', 'public.consume_rate_limit'],
  'only the two reviewed functions run with raised privileges'
);

-- 8. The private schema is closed to app users.
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot enter the private schema');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated cannot enter the private schema');

-- 9. Future objects get no automatic grants (proves the lockdown migration
-- works for tables and functions added later).
create table public.zz_probe (id int);
create function public.zz_probe_fn() returns int language sql as 'select 1';
create table private.zz_probe (id int);

select ok(not has_table_privilege('anon', 'public.zz_probe', 'select'), 'new table: anon gets nothing');
select ok(not has_table_privilege('authenticated', 'public.zz_probe', 'select'), 'new table: authenticated gets nothing');
select ok(not has_table_privilege('authenticated', 'public.zz_probe', 'insert'), 'new table: authenticated cannot insert');
select ok(not has_table_privilege('service_role', 'public.zz_probe', 'select'), 'new table: service_role gets nothing automatically');
select ok(not has_table_privilege('service_role', 'private.zz_probe', 'select'), 'new private table: service_role gets nothing automatically');
select ok(not has_function_privilege('anon', 'public.zz_probe_fn()', 'execute'), 'new function: anon cannot run it');
select ok(not has_function_privilege('authenticated', 'public.zz_probe_fn()', 'execute'), 'new function: authenticated cannot run it');

-- The RLS check above would catch a table created without RLS.
select isnt_empty(
  $$
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'zz_probe' and not c.relrowsecurity
  $$,
  'the RLS check really does detect a table without RLS'
);

-- 10. Other routes are closed.
select ok(not exists (select 1 from pg_extension where extname = 'pg_graphql'), 'GraphQL extension is removed');
select is_empty(
  $$ select schemaname || '.' || tablename from pg_publication_tables where pubname = 'supabase_realtime' $$,
  'no table is broadcast over Realtime'
);
select is_empty($$ select id from storage.buckets $$, 'no storage buckets exist');

-- 11. The rate-limit cleanup job is scheduled.
select results_eq(
  $$ select schedule, command from cron.job where jobname = 'rate-limits-cleanup' $$,
  $$ values ('17 3 * * *'::text, 'delete from private.rate_limits where window_start < now() - interval ''2 days'''::text) $$,
  'daily rate-limit cleanup job is scheduled'
);

select * from finish();
rollback;
