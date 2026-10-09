-- Migration 3: rate-limit framework (PRD 9.3, Appendix A #28).
--
-- Who can do what
--   Signed out and signed in: nothing. The table lives in the private schema,
--   which the API does not serve and which those roles cannot even look into.
--   Server (service_role):    calls public.consume_rate_limit() from Edge
--                             Functions. It cannot read or edit the table
--                             directly.
--
-- How it works: a fixed-window counter. Each check names a scope (for example
-- "any_function_ip"), a subject (a user ID or IP address), a limit and a window
-- length. The function adds one to the counter for the current window and says
-- whether the request is allowed and, if not, how many seconds until the window
-- resets. Edge Functions turn "not allowed" into HTTP 429 with a Retry-After
-- header.
--
-- Known limit of fixed windows: a burst straddling the boundary between two
-- windows can briefly reach up to twice the limit. That is acceptable for
-- abuse prevention and keeps each check to a single database write.

create table private.rate_limits (
  -- SHA-256 of scope, window length and subject. Raw IP addresses and user IDs
  -- are never stored. Hashing is not anonymisation (an IPv4 address can be
  -- recovered by trying them all), so the real protection is that rows are
  -- deleted within two days (see the cleanup job below).
  bucket text not null
    constraint bucket_is_sha256_hex check (bucket ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0
    constraint hits_not_negative check (hits >= 0),
  primary key (bucket, window_start)
);

comment on table private.rate_limits is
  'Request counters for rate limiting. Server only. Rows older than two days are deleted daily.';

-- Supports the cleanup job.
create index rate_limits_window_start_idx on private.rate_limits (window_start);

-- RLS is on with no policies: deny everyone except roles that bypass RLS.
alter table private.rate_limits enable row level security;

revoke all on table private.rate_limits from public, anon, authenticated, service_role;

-- The check-and-count function ------------------------------------------------
-- Security definer so the server needs only permission to run this one
-- function, not read and write access to the table. Kept safe by:
--   * only service_role may run it (granted below), and it also checks the
--     caller's role from the request's verified token, refusing anyone else;
--   * every input is checked against strict limits before use;
--   * no SQL is built from the inputs: they are used only as values;
--   * search_path is empty and every name is schema-qualified.
create function public.consume_rate_limit(
  p_scope text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer, remaining integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_bucket text;
  v_hits integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_scope is null or p_scope !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'Invalid rate limit scope' using errcode = '22023';
  end if;
  if p_subject is null or char_length(p_subject) not between 1 and 200 then
    raise exception 'Invalid rate limit subject' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit window' using errcode = '22023';
  end if;

  -- Start of the current window, aligned to the window length.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  -- The window length is part of the key, so a per-minute limit and a per-day
  -- limit on the same action keep separate counts.
  v_bucket := encode(
    sha256(convert_to(p_scope || '|' || p_window_seconds::text || '|' || p_subject, 'UTF8')),
    'hex'
  );

  -- One atomic statement: two requests arriving at the same moment cannot both
  -- read the old count and slip through.
  insert into private.rate_limits as rl (bucket, window_start, hits)
  values (v_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
  do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  allowed := v_hits <= p_limit;
  remaining := greatest(p_limit - v_hits, 0);
  retry_after_seconds := case
    when v_hits <= p_limit then 0
    else greatest(
      ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer,
      1
    )
  end;
  return next;
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Counts one request against a rate limit and reports whether it is allowed. Server (service_role) only.';

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

-- Daily cleanup ---------------------------------------------------------------
-- pg_cron runs scheduled jobs inside the database. Every limit window is at
-- most one day long, so anything older than two days is never needed again.
-- Deleting it keeps the table small and limits how long hashed IP addresses
-- are kept (UK GDPR storage limitation).
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'rate-limits-cleanup',
  '17 3 * * *',
  $$delete from private.rate_limits where window_start < now() - interval '2 days'$$
);
