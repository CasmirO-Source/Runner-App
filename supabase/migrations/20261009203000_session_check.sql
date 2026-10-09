-- Migration 4: signed-out tokens stop working everywhere at once
-- (owner decision, Option A; Appendix A #25).
--
-- Why: Supabase's REST API accepts any correctly signed access token until it
-- expires (up to 1 hour). It does not check whether the session behind the
-- token has ended. So after someone signs out, a copied access token could
-- still read data through the REST API for up to an hour. Supabase Auth and
-- our Edge Functions already refuse such tokens; this closes the REST API too.
--
-- How: every login token carries a session ID. private.session_is_active()
-- checks that this session still exists in Supabase Auth's own sessions table
-- (signing out deletes it) and has not passed its end time. Every database
-- rule for signed-in users now requires it.
--
-- Rule for later milestones: every policy and function that serves the
-- authenticated role must include private.session_is_active(). The security
-- baseline test fails if a policy for signed-in users leaves it out.

create function private.session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Runs with the owner's rights because app users cannot read auth.sessions.
  -- It takes no arguments and only ever looks up the caller's own session,
  -- named in their verified token, so it reveals nothing about anyone else.
  select exists (
    select 1
    from auth.sessions as s
    where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
  );
$$;

comment on function private.session_is_active() is
  'True if the session in the caller''s token still exists (not signed out or expired). Required by every rule for signed-in users.';

-- Policies run with the caller's rights, so signed-in users must be allowed to
-- run this one function. They still cannot use the private schema itself, so
-- it cannot be called through the API.
revoke all on function private.session_is_active() from public, anon, authenticated, service_role;
grant execute on function private.session_is_active() to authenticated;

-- Profiles: signed-in users see public fields only while their session is live.
-- "(select ...)" lets Postgres check once per query instead of once per row.
drop policy profiles_select_public_fields on public.profiles;
create policy profiles_select_public_fields
  on public.profiles
  for select
  to authenticated
  using ((select private.session_is_active()));

-- The owner's own profile, also only while the session is live.
create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.profiles as p
  where p.id = (select auth.uid())
    and (select private.session_is_active());
$$;

revoke all on function public.get_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to authenticated;
