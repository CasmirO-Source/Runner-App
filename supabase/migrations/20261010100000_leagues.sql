-- Migration 5: friend leagues (PRD 5.2, 8.2, milestone 2).
--
-- Who can do what
--   Signed out:      nothing.
--   Signed in:       read seasons; read a league, its current members and its
--                    standings only while they are a current member; read the
--                    league's active invite code only if they own the league.
--                    No writes at all.
--   Server (Edge Functions, service_role): create and update leagues, create
--                    and revoke codes, join, leave and remove, only through the
--                    functions below. It cannot read or write the tables
--                    directly.
--
-- Owner decisions (milestone 2 plan): until subscriptions (milestone 8) every
-- runner may own 1 open league of up to 8 members; only the owner sees and
-- shares the code; the owner can leave only as the last member, which closes
-- the league; leaving keeps a history row (left_at) for past seasons.

-- Shared helpers -------------------------------------------------------------

-- Refuses any caller that is not the server. Every server-only function calls
-- this first, as a second lock behind its execute grant.
create function private.require_server()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end;
$$;

-- League names use the same screen as display names. League names may contain
-- hyphens and apostrophes, so those are now ignored too ("f-u-c-k"). Display
-- names cannot contain them, so nothing changes for display names. Replacing
-- the function keeps its grants and the profiles check constraint.
create or replace function private.display_name_is_clean(p_name text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  with normalised as (
    -- "Scunthorpe" is a real UK town that contains a banned substring.
    select replace(translate(lower(p_name), '013457', 'oieast'), 'scunthorpe', '') as n
  ),
  parts as (
    select
      regexp_split_to_array(n, '[ _''-]+') as tokens,
      regexp_replace(n, '[ _''-]+', '', 'g') as compact
    from normalised
  ),
  lists as (
    select
      array[
        'fuck', 'shit', 'cunt', 'wanker', 'twat', 'bollock', 'nigger', 'nigga',
        'faggot', 'retard', 'whore', 'slut', 'bitch', 'bastard', 'dickhead',
        'cocksuck', 'motherf', 'spastic', 'knobhead', 'bellend', 'arsehole',
        'asshole', 'paedo', 'rapist'
      ] as substrings,
      array[
        'ass', 'arse', 'cock', 'dick', 'prick', 'wank', 'knob', 'minge', 'piss',
        'fag', 'spaz', 'paki', 'chink', 'kike', 'coon', 'gook', 'wog', 'tranny',
        'dyke', 'nonce', 'pedo', 'nazi', 'hitler', 'rape', 'porn', 'sex', 'nude',
        'admin', 'administrator', 'moderator', 'mod', 'official', 'support',
        'staff', 'system'
      ] as tokens
  )
  select
    not exists (select 1 from parts, lists, unnest(lists.substrings) w where position(w in parts.compact) > 0)
    and not exists (select 1 from parts, lists, unnest(parts.tokens) t where t = any (lists.tokens))
    and not exists (select 1 from parts, lists where parts.compact = any (lists.tokens));
$$;

comment on function private.display_name_is_clean(text) is
  'Profanity and impersonation screen for display names and league names. Used by check constraints.';

-- Seasons ----------------------------------------------------------------------
-- One season per calendar month in UK time (PRD 5.2), shared by every league.
-- Standings for a season are worked out from runs between starts_at and
-- ends_at (milestone 3), so the monthly "reset" needs no data to be wiped.
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  month date not null unique
    constraint season_month_is_first_day check (extract(day from month) = 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint season_order check (ends_at > starts_at)
);

comment on table public.seasons is
  'Calendar-month seasons in Europe/London time. Created by the server only.';

-- Creates this month's and next month's season if missing. Midnight UK time is
-- worked out by Postgres from the Europe/London rules, so the months that
-- start in British Summer Time begin at 23:00 UTC the day before.
create function private.ensure_seasons()
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.seasons (month, starts_at, ends_at)
  select
    m,
    m::timestamp at time zone 'Europe/London',
    (m + interval '1 month')::timestamp at time zone 'Europe/London'
  from (
    select (date_trunc('month', now() at time zone 'Europe/London') + make_interval(months => k))::date as m
    from generate_series(0, 1) as k
  ) as months
  on conflict (month) do nothing;
$$;

select private.ensure_seasons();

select cron.schedule('ensure-seasons', '5 0 * * *', $$select private.ensure_seasons()$$);

-- Leagues ----------------------------------------------------------------------
create table public.leagues (
  id uuid primary key default gen_random_uuid(),

  -- 3 to 30 characters: letters, numbers, and single spaces, apostrophes or
  -- hyphens between them ("Sam's Runners", "Leeds-Bradford Club"). ASCII only,
  -- and screened like display names. Names do not need to be unique.
  name text not null
    constraint league_name_length check (char_length(name) between 3 and 30)
    constraint league_name_characters check (
      name ~ '^[A-Za-z0-9]+([ ''-][A-Za-z0-9]+)*$'
      and octet_length(name) = char_length(name)
    )
    constraint league_name_clean check (private.display_name_is_clean(name)),

  -- Account deletion (milestone 9) must decide what happens to an owner's
  -- open league before their profile can be removed.
  owner_id uuid not null references public.profiles (id) on delete restrict,

  -- Owner setting (PRD 5.2). Stored now; applied to runs in milestone 3.
  verified_only boolean not null default false,

  -- Set by the server from the plan (8 until milestone 8).
  member_limit smallint not null default 8
    constraint member_limit_range check (member_limit between 2 and 20),

  created_at timestamptz not null default now(),
  closed_at timestamptz
);

comment on table public.leagues is
  'Friend leagues. Readable by current members only. Written only through server functions.';

-- 1 open league per owner until milestone 8 (Pro). Also stops two "create"
-- requests at the same moment both succeeding.
create unique index leagues_one_open_per_owner on public.leagues (owner_id) where closed_at is null;

-- League membership ---------------------------------------------------------------
create table public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null
    constraint member_role check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  -- Set when the member leaves or is removed. The row is kept so past seasons
  -- can show who took part; access ends the moment this is set.
  left_at timestamptz,
  constraint left_after_joined check (left_at is null or left_at >= joined_at)
);

comment on table public.league_members is
  'League membership history. Current members have left_at null. Written only through server functions.';

create unique index league_members_one_current on public.league_members (league_id, user_id) where left_at is null;
create unique index league_members_one_owner on public.league_members (league_id) where role = 'owner' and left_at is null;
create index league_members_current_by_user on public.league_members (user_id) where left_at is null;

-- Invite codes -------------------------------------------------------------------
-- 10 characters from an alphabet without look-alikes (no 0, O, 1, I or L):
-- 31^10, about 800 trillion codes, guessed at most 10 times an hour per user.
create table public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  code text not null unique
    constraint code_format check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$'),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  constraint code_lifetime check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);

comment on table public.invite_codes is
  'League invite codes. Expire after 7 days, can be revoked. Readable by the league owner only.';

-- One unrevoked code per league: making a new one revokes the old one.
create unique index invite_codes_one_active on public.invite_codes (league_id) where revoked_at is null;

-- Random code with every character equally likely (bytes 248 to 255 are
-- discarded so the 31-character alphabet divides evenly).
create function private.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  b integer;
begin
  while char_length(result) < 10 loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    if b < 248 then
      result := result || substr(alphabet, (b % 31) + 1, 1);
    end if;
  end loop;
  return result;
end;
$$;

-- Audit log (PRD 9.6 rule 20, Appendix A #42) ---------------------------------------
-- Sensitive actions only. Holds IDs, never names or emails. In the private
-- schema: nobody can reach it from the app. No foreign keys, so entries
-- outlive the accounts they mention.
create table private.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null
    constraint audit_action check (action in ('league_member_removed', 'league_closed')),
  league_id uuid,
  target_user_id uuid
);

comment on table private.audit_log is
  'Sensitive actions (PRD 9.6). Server only. IDs only, no personal details.';

-- Membership checks used by the access rules ---------------------------------------
-- Run with the owner's rights because a rule on league_members cannot query
-- league_members itself without looping. Each takes only a league ID and only
-- ever looks at the caller's own membership, from the verified token.
create function private.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members as m
    where m.league_id = p_league_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
  );
$$;

create function private.is_league_owner(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members as m
    where m.league_id = p_league_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.left_at is null
  );
$$;

-- Row-level security -----------------------------------------------------------------
-- Every rule requires a live session (migration 4).
alter table public.seasons enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.invite_codes enable row level security;
alter table private.audit_log enable row level security;

create policy seasons_select_signed_in
  on public.seasons for select to authenticated
  using ((select private.session_is_active()));

create policy leagues_select_members
  on public.leagues for select to authenticated
  using ((select private.session_is_active()) and private.is_league_member(id));

create policy league_members_select_same_league
  on public.league_members for select to authenticated
  using ((select private.session_is_active()) and left_at is null and private.is_league_member(league_id));

create policy invite_codes_select_owner
  on public.invite_codes for select to authenticated
  using ((select private.session_is_active()) and revoked_at is null and private.is_league_owner(league_id));

-- Grants -------------------------------------------------------------------------------
revoke all on table public.seasons, public.leagues, public.league_members, public.invite_codes
  from public, anon, authenticated, service_role;
revoke all on table private.audit_log from public, anon, authenticated, service_role;

grant select (id, month, starts_at, ends_at) on table public.seasons to authenticated;
grant select (id, name, owner_id, verified_only, member_limit, created_at) on table public.leagues to authenticated;
grant select (league_id, user_id, role, joined_at) on table public.league_members to authenticated;
grant select (league_id, code, created_at, expires_at) on table public.invite_codes to authenticated;

revoke all on function private.require_server(), private.ensure_seasons(), private.new_invite_code(),
  private.is_league_member(uuid), private.is_league_owner(uuid)
  from public, anon, authenticated, service_role;
-- The access rules run these as the signed-in user.
grant execute on function private.is_league_member(uuid), private.is_league_owner(uuid) to authenticated;

-- Standings ------------------------------------------------------------------------------
-- Runs as the caller, so the access rules apply: a non-member gets no rows.
-- Distance is 0 until runs exist (milestone 3), so places follow name order.
create function public.league_standings(p_league_id uuid)
returns table (place integer, user_id uuid, display_name text, avatar_id smallint, distance_m integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (row_number() over (order by p.display_name))::integer as place,
    m.user_id,
    p.display_name,
    p.avatar_id,
    0 as distance_m
  from public.league_members as m
  join public.profiles as p on p.id = m.user_id
  where m.league_id = p_league_id
  order by place;
$$;

revoke all on function public.league_standings(uuid) from public, anon, authenticated, service_role;
grant execute on function public.league_standings(uuid) to authenticated;

-- Server functions -------------------------------------------------------------------------
-- Called only by Edge Functions, which pass the caller's user ID from their
-- verified login token. Each runs in one transaction, so a step can never be
-- half done. Refusals are fixed codes (P0001 with a short message), never
-- anything a user typed.

create function public.create_league(p_owner_id uuid, p_name text, p_verified_only boolean)
returns table (id uuid, name text, verified_only boolean, member_limit smallint, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_league public.leagues;
begin
  perform private.require_server();
  if exists (select 1 from public.leagues as l where l.owner_id = p_owner_id and l.closed_at is null) then
    raise exception 'league_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.leagues (name, owner_id, verified_only, member_limit)
  values (p_name, p_owner_id, coalesce(p_verified_only, false), 8)
  returning * into v_league;
  insert into public.league_members (league_id, user_id, role)
  values (v_league.id, p_owner_id, 'owner');
  return query select v_league.id, v_league.name, v_league.verified_only, v_league.member_limit, v_league.created_at;
end;
$$;

create function public.update_league(p_actor_id uuid, p_league_id uuid, p_name text, p_verified_only boolean)
returns table (id uuid, name text, verified_only boolean, member_limit smallint, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_league public.leagues;
begin
  perform private.require_server();
  if p_name is null and p_verified_only is null then
    raise exception 'nothing_to_change' using errcode = 'P0001';
  end if;
  -- "not_found" covers both "no such league" and "not the owner", so a
  -- caller cannot learn whether someone else's league exists.
  select * into v_league from public.leagues as l
  where l.id = p_league_id and l.owner_id = p_actor_id and l.closed_at is null
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.leagues as l
  set name = coalesce(p_name, l.name),
      verified_only = coalesce(p_verified_only, l.verified_only)
  where l.id = p_league_id
  returning * into v_league;
  return query select v_league.id, v_league.name, v_league.verified_only, v_league.member_limit, v_league.created_at;
end;
$$;

create function public.create_invite_code(p_actor_id uuid, p_league_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_code text;
  v_expires timestamptz;
begin
  perform private.require_server();
  perform 1 from public.leagues as l
  where l.id = p_league_id and l.owner_id = p_actor_id and l.closed_at is null
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.invite_codes as c set revoked_at = now()
  where c.league_id = p_league_id and c.revoked_at is null;
  -- A repeat of an existing code is astronomically unlikely; try again if so.
  for attempt in 1..5 loop
    begin
      insert into public.invite_codes (league_id, code, created_by)
      values (p_league_id, private.new_invite_code(), p_actor_id)
      returning invite_codes.code, invite_codes.expires_at into v_code, v_expires;
      return query select v_code, v_expires;
      return;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
end;
$$;

create function public.revoke_invite_code(p_actor_id uuid, p_league_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_server();
  perform 1 from public.leagues as l
  where l.id = p_league_id and l.owner_id = p_actor_id and l.closed_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.invite_codes as c set revoked_at = now()
  where c.league_id = p_league_id and c.revoked_at is null;
  return found;
end;
$$;

-- Joining locks the league row while it counts members, so two people joining
-- at the same moment cannot take a league past its limit. The status tells the
-- Edge Function what happened; it shows one message for every unusable code
-- (unknown, expired, revoked, closed league or full).
create function public.join_league(p_user_id uuid, p_code text)
returns table (status text, league_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_league public.leagues;
  v_league_id uuid;
  v_members integer;
begin
  perform private.require_server();
  if p_code is null or p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' then
    return query select 'invalid_code'::text, null::uuid;
    return;
  end if;
  select c.league_id into v_league_id from public.invite_codes as c
  where c.code = p_code and c.revoked_at is null and c.expires_at > now();
  if not found then
    return query select 'invalid_code'::text, null::uuid;
    return;
  end if;
  select * into v_league from public.leagues as l
  where l.id = v_league_id and l.closed_at is null
  for update;
  if not found then
    return query select 'invalid_code'::text, null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.league_members as m
    where m.league_id = v_league.id and m.user_id = p_user_id and m.left_at is null
  ) then
    return query select 'already_member'::text, v_league.id;
    return;
  end if;
  select count(*) into v_members from public.league_members as m
  where m.league_id = v_league.id and m.left_at is null;
  if v_members >= v_league.member_limit then
    return query select 'full'::text, null::uuid;
    return;
  end if;
  insert into public.league_members (league_id, user_id, role)
  values (v_league.id, p_user_id, 'member');
  return query select 'joined'::text, v_league.id;
end;
$$;

-- A member leaves at any time. The owner may leave only as the last member,
-- which closes the league and revokes its code (recorded in the audit log).
create function public.leave_league(p_user_id uuid, p_league_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform private.require_server();
  perform 1 from public.leagues as l where l.id = p_league_id and l.closed_at is null for update;
  if not found then
    return 'not_found';
  end if;
  select m.role into v_role from public.league_members as m
  where m.league_id = p_league_id and m.user_id = p_user_id and m.left_at is null;
  if not found then
    return 'not_found';
  end if;
  if v_role = 'owner' then
    if exists (
      select 1 from public.league_members as m
      where m.league_id = p_league_id and m.user_id <> p_user_id and m.left_at is null
    ) then
      return 'owner_must_be_last';
    end if;
    update public.leagues as l set closed_at = now() where l.id = p_league_id;
    update public.invite_codes as c set revoked_at = now() where c.league_id = p_league_id and c.revoked_at is null;
    insert into private.audit_log (actor_id, action, league_id) values (p_user_id, 'league_closed', p_league_id);
  end if;
  update public.league_members as m set left_at = now()
  where m.league_id = p_league_id and m.user_id = p_user_id and m.left_at is null;
  return case when v_role = 'owner' then 'closed' else 'left' end;
end;
$$;

-- Only the owner removes, never themselves (they leave instead). Recorded in
-- the audit log (PRD 9.6).
create function public.remove_league_member(p_actor_id uuid, p_league_id uuid, p_user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_server();
  perform 1 from public.leagues as l
  where l.id = p_league_id and l.owner_id = p_actor_id and l.closed_at is null
  for update;
  if not found then
    return 'not_found';
  end if;
  if p_user_id = p_actor_id then
    return 'cannot_remove_owner';
  end if;
  update public.league_members as m set left_at = now()
  where m.league_id = p_league_id and m.user_id = p_user_id and m.role = 'member' and m.left_at is null;
  if not found then
    return 'not_found';
  end if;
  insert into private.audit_log (actor_id, action, league_id, target_user_id)
  values (p_actor_id, 'league_member_removed', p_league_id, p_user_id);
  return 'removed';
end;
$$;

revoke all on function
  public.create_league(uuid, text, boolean),
  public.update_league(uuid, uuid, text, boolean),
  public.create_invite_code(uuid, uuid),
  public.revoke_invite_code(uuid, uuid),
  public.join_league(uuid, text),
  public.leave_league(uuid, uuid),
  public.remove_league_member(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.create_league(uuid, text, boolean),
  public.update_league(uuid, uuid, text, boolean),
  public.create_invite_code(uuid, uuid),
  public.revoke_invite_code(uuid, uuid),
  public.join_league(uuid, text),
  public.leave_league(uuid, uuid),
  public.remove_league_member(uuid, uuid, uuid)
  to service_role;
