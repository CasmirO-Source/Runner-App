-- Migration 2: profiles (PRD 5.1 and 8.2).
--
-- Who can do what
--   Signed out (anon):        nothing.
--   Signed in (authenticated): read id, display_name and avatar_id of any
--                              profile. Nothing else. No writes at all.
--   The owner:                 reads their own private fields through
--                              public.get_my_profile() only.
--   Server (service_role):     creates and edits profiles from the profile Edge
--                              Function, which checks the login token, validates
--                              input with zod and applies rate limits first.
--
-- Profile writes go only through the Edge Function (owner decision, stricter
-- than PRD 8.2), so that the server, not the app, is the only writer.

-- Display name screening ----------------------------------------------------
-- Runs inside the database as a check constraint, so a bad name is refused
-- however it arrives. It is a starting list for the owner to review, not a
-- complete filter: names can also be reported (milestone 9).
--
-- Two kinds of match:
--   substrings: strong words that are never innocent inside another word.
--   tokens:     words blocked only when they are a whole word, because they
--               appear inside ordinary names ("Cassidy" contains "ass").
-- Common digit swaps are undone first (0 to o, 1 to i, 3 to e, 4 to a, 5 to s,
-- 7 to t), and spaces and underscores are ignored for the substring check, so
-- "f_u_c_k" and "5h1t" are caught.
-- Reserved words stop anyone posing as staff.
create function private.display_name_is_clean(p_name text)
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
      regexp_split_to_array(n, '[ _]+') as tokens,
      regexp_replace(n, '[ _]+', '', 'g') as compact
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
  'Profanity and impersonation screen for display names. Used by a check constraint on public.profiles.';

-- Table ---------------------------------------------------------------------
create table public.profiles (
  -- Same random UUID as the Supabase Auth user. Never a counting number
  -- (Appendix A #33). Deleting the auth user deletes the profile.
  id uuid primary key references auth.users (id) on delete cascade,

  -- Public. 3 to 20 characters: letters, numbers, underscores and single
  -- spaces between words (PRD 5.1). ASCII only: this also blocks look-alike
  -- characters from other alphabets being used to impersonate someone.
  display_name text not null
    constraint display_name_length check (char_length(display_name) between 3 and 20)
    constraint display_name_characters check (
      display_name ~ '^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$'
      and octet_length(display_name) = char_length(display_name)
    )
    constraint display_name_clean check (private.display_name_is_clean(display_name)),

  -- Public. One of the 12 preset avatars in src/lib/avatars.ts.
  avatar_id smallint not null
    constraint avatar_id_preset check (avatar_id between 1 and 12),

  -- Private (owner decision). Optional. Letters, spaces, full stops,
  -- apostrophes and hyphens, for names like "St. Albans", "King's Lynn" and
  -- "Stoke-on-Trent". Nothing else can be stored in it.
  home_city text
    constraint home_city_format check (
      home_city is null
      or (
        char_length(home_city) between 2 and 40
        and home_city ~ '^[A-Za-z][A-Za-z .''-]*[A-Za-z]$'
        and octet_length(home_city) = char_length(home_city)
      )
    ),

  -- Private. Stores "over 18: yes" and never the date of birth (PRD 5.1,
  -- Appendix A #48). A profile cannot exist without it.
  over_18 boolean not null
    constraint over_18_required check (over_18),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per user. Public fields: id, display_name, avatar_id. Private fields: home_city, over_18, timestamps. See PRD 8.2.';

-- Display names are unique (owner decision), so nobody can copy a friend's
-- name to impersonate them on a leaderboard. Capital letters are ignored, and
-- an underscore counts the same as a space, so "Sam_Smith" and "sam smith"
-- cannot both exist. Enforced by the database, so two people choosing the same
-- name at the same moment cannot both succeed.
create unique index profiles_display_name_unique
  on public.profiles (lower(replace(display_name, '_', ' ')));

-- Keep updated_at accurate, and refuse any change to the id or creation time
-- (second layer behind the column-level grants below).
create function private.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.over_18 is distinct from old.over_18 then
    raise exception 'This profile field cannot be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function private.profiles_before_update();

-- Row-level security ----------------------------------------------------------
-- On from the moment the table exists. With RLS on and no policy, a role sees
-- and changes nothing, so every policy below is a deliberate opening.
alter table public.profiles enable row level security;

-- Any signed-in user may see every row, but the column grants below limit them
-- to the three public columns. There are deliberately no insert, update or
-- delete policies: even if a write grant were added by mistake, RLS would
-- still refuse the write for anon and authenticated.
create policy profiles_select_public_fields
  on public.profiles
  for select
  to authenticated
  using (true);

-- Grants ----------------------------------------------------------------------
-- Start from nothing, then grant exactly what is needed.
revoke all on table public.profiles from public, anon, authenticated, service_role;

-- Signed-in users: read the public columns only. Asking for home_city or
-- over_18, or for "*", fails with "permission denied".
grant select (id, display_name, avatar_id) on table public.profiles to authenticated;

-- Server only (the profile Edge Function). Column-level insert and update
-- grants mean even the server cannot change id, over_18 or the timestamps
-- after creation. No delete: profiles are removed only when the auth user is
-- deleted (account deletion, milestone 9).
grant select on table public.profiles to service_role;
grant insert (id, display_name, avatar_id, home_city, over_18) on table public.profiles to service_role;
grant update (display_name, avatar_id, home_city) on table public.profiles to service_role;

-- The name check runs as whoever writes the row, so the server needs to be
-- able to run it. Nobody else can.
revoke all on function private.display_name_is_clean(text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.display_name_is_clean(text) to service_role;
revoke all on function private.profiles_before_update() from public, anon, authenticated, service_role;

-- Owner's own profile, including private fields --------------------------------
-- Runs with the table owner's rights (security definer), because signed-in
-- users have no column grant on the private fields. It is safe because:
--   * it takes no arguments, so a caller cannot ask for anyone else's row;
--   * the row is chosen by auth.uid(), which Supabase reads from the verified
--     login token, never from anything the app sends;
--   * search_path is empty and every name is schema-qualified, so a caller
--     cannot trick it into using an object they created;
--   * signed-out callers get no rows (auth.uid() is null), and only the
--     authenticated role may run it at all.
create function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.profiles as p
  where p.id = (select auth.uid());
$$;

comment on function public.get_my_profile() is
  'Returns the signed-in user''s own profile, including private fields. Row chosen by the verified login token only.';

revoke all on function public.get_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.get_my_profile() to authenticated;
