-- Metrics hygiene: keep non-genuine devices out of every "active users" number.
--
-- WHY THIS EXISTS
-- Per-town MAU is not a vanity stat here: it sets ad PRICING tiers
-- (aggregator/generate-advertise.mjs) and it is the outcome metric of the paid
-- Facebook ad experiment (ad-test-tracker.mjs). A single inflated town can move a
-- price or fake a result, so the number has to mean "distinct humans".
--
-- WHAT WAS WRONG
-- The old model was "delete bot rows at 7 AM, and let every consumer read the raw
-- table and hope the cron ran". Two problems:
--   1. Every reader saw unfiltered rows between cron runs.
--   2. A delete is unrecoverable. If the heuristic ever misfired on a REAL user,
--      that user was gone with no way to notice or undo it.
-- Now: classify once, MARK the row, and point every reader at one filtered view.
-- A false positive is now visible (select excluded_reason, count(*) ... group by 1)
-- and reversible with a single UPDATE.
--
-- WHAT IS *NOT* A PROBLEM (measured 2026-07-21, do not build anything for it)
-- Plain HTTP requests -- curl, wget, link previews, uptime checks -- create NO rows.
-- The only writer is the record_device_activity RPC, called from one useEffect in
-- src/context/AppContext.js, so it needs a real JS engine, hydrated storage, and a
-- user gesture. Verified empirically: 12 GETs against a zero-activity town produced
-- zero rows. What DOES get counted is a real browser driven by automation, and the
-- owner's own devices.
--
-- Deliberately NOT touching record_device_activity. It must keep exactly one
-- signature; a bad drop/recreate of it killed recording for every live user on
-- 2026-07-16 (see supabase/device_native_version.sql). Adding columns needs no
-- function change, so this file never mentions it.

begin;

-- 1. Mark columns. The upsert in record_device_activity sets only city_id, last_seen,
--    platform, rev, runtime, embedded, app_version and native_build -- it never
--    touches these -- so once a device is marked it STAYS marked through every future
--    visit, with no client change and no recurring job to remember.
alter table public.device_activity add column if not exists excluded_at timestamptz;
alter table public.device_activity add column if not exists excluded_reason text;

-- Partial index matching the view's predicate, so the filtered reads stay cheap.
create index if not exists device_activity_live_idx
  on public.device_activity (city_id, last_seen) where excluded_at is null;

-- 2. The single filtered source every consumer reads.
--    service_role only: this is an internal metrics surface, and the anon key ships
--    inside the public web bundle.
create or replace view public.human_activity as
  select * from public.device_activity where excluded_at is null;
revoke all on public.human_activity from anon, authenticated;
grant select on public.human_activity to service_role;

-- 3. Repoint every reader. These are all SECURITY DEFINER, so they read the view as
--    owner and the revoke above does not affect them. Definitions are otherwise
--    copied verbatim from the LIVE database (pg_get_functiondef), not from the repo
--    files, which had drifted -- only the table name changes.

create or replace function public.all_active_users()
 returns integer language sql stable security definer set search_path to 'public'
as $function$
  select count(*)::int
  from public.human_activity
  where last_seen > now() - interval '30 days';
$function$;

create or replace function public.city_active_users(p_city text)
 returns integer language sql stable security definer set search_path to 'public'
as $function$
  select count(*)::int from public.human_activity
  where city_id = p_city and last_seen > now() - interval '30 days';
$function$;

create or replace function public.users_by_city()
 returns table(city_id text, users integer)
 language sql stable security definer set search_path to 'public'
as $function$
  select da.city_id, count(*)::int as users
  from public.human_activity da
  where da.last_seen > now() - interval '30 days'
    and da.city_id is not null
  group by da.city_id
  order by count(*) desc, da.city_id;
$function$;

create or replace function public.platform_split(p_city text default null::text)
 returns table(platform text, users integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select coalesce(da.platform, 'unknown'), count(*)::int
    from public.human_activity da
    where da.last_seen > now() - interval '30 days'
      and (p_city is null or da.city_id = p_city)
    group by 1;
end;
$function$;

create or replace function public.rev_split()
 returns table(rev integer, runtime text, embedded boolean, app_version text,
               native_build text, platform text, update_blocked boolean, users integer)
 language sql stable security definer set search_path to 'public'
as $function$
  select
    da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform,
    (da.rev is null and da.last_seen > timestamptz '2026-07-18 21:00:00-04') as update_blocked,
    count(*)::int as users
  from public.human_activity da
  where da.last_seen > now() - interval '30 days'
  group by da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform,
           (da.rev is null and da.last_seen > timestamptz '2026-07-18 21:00:00-04')
  order by count(*) desc;
$function$;

-- 4. Let the owner permanently exclude one of his own installs.
--    is_admin() guard: only the owner can suppress a device, so this can never be
--    used to erase someone else's activity. coalesce keeps the FIRST reason, so
--    re-running never rewrites history.
create or replace function public.mark_device_excluded(p_device text, p_reason text default 'owner')
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.device_activity
     set excluded_at = coalesce(excluded_at, now()),
         excluded_reason = coalesce(excluded_reason, p_reason)
   where device_id = p_device;
end;
$function$;
revoke execute on function public.mark_device_excluded(text, text) from public, anon;
grant execute on function public.mark_device_excluded(text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
