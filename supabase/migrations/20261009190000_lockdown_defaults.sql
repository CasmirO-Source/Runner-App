-- Migration 1: lock down Supabase's defaults before any table exists.
--
-- Why: out of the box, Postgres and Supabase hand out permissions automatically.
--   * Postgres lets every role (PUBLIC) run any newly created function.
--   * Supabase grants select, insert, update and delete on every new table in
--     the public schema to anon (signed out), authenticated (signed in) and
--     service_role.
-- Row-level security would still filter rows, but "granted by default, then
-- filtered" is the wrong way round. After this migration nothing is reachable
-- until a later migration grants it on purpose, table by table and column by
-- column (PRD 8.2, 9.1 rule 4, Appendix A #7 and #41).

-- 1. Functions: nobody can run new functions unless explicitly granted.
-- The PUBLIC execute default is global in Postgres, and a per-schema revoke
-- cannot remove a global default, so both forms are used.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

-- 2. Tables and sequences: no automatic grants to any API role.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated, service_role;

-- 3. Anything already sitting in public (a fresh project has nothing of ours,
-- but this makes the starting point certain).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- 4. Remove the GraphQL API. The app only uses the REST API, and every extra
-- route is another thing that has to be secured and tested. Dropping the
-- extension makes /graphql/v1 return nothing for every caller.
drop extension if exists pg_graphql;

-- 5. A private schema for internal tables and helper functions. It is not in
-- the API's schema list, and anon and authenticated never get usage on it, so
-- nothing in it can be reached from the app even if a grant were added by
-- mistake. Only the server (service_role, used inside Edge Functions) gets
-- access, object by object.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
