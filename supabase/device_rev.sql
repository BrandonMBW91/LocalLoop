-- Record WHICH BUILD each device is actually running, so OTA adoption is observable.
--
-- THE QUESTION THIS ANSWERS: "are the auto-updates landing?" Today nothing records a
-- version anywhere, so an OTA is published into silence — we can see that EAS accepted
-- it, never that a single phone ran it.
--
-- THREE COLUMNS, because "rev 102" alone cannot distinguish the two cases that matter:
--   rev       int   src/version.js BUILD — the JS actually executing.
--   runtime   text  expo-updates runtimeVersion. THE IMPORTANT ONE. A device on the old
--                   fingerprint runtime (1aa93c…) can NEVER receive a 1.0.4 OTA. Every
--                   fix is permanently unreachable for it and no amount of waiting helps.
--                   Without this, "stuck forever" and "just has not reopened yet" look
--                   identical, and only one of them is a problem.
--   embedded  bool  expo-updates isEmbeddedLaunch — true means it is running the bundle
--                   baked into the binary, i.e. NO OTA has ever landed on it. A healthy
--                   population trends false within a day or two of a publish; a stuck one
--                   does not. This is the adoption signal in a single boolean.
--
-- BACKWARD COMPATIBILITY: p_rev/p_runtime/p_embedded all default to null so builds that
-- predate this keep resolving the SAME function with 3 args. record_device_activity has
-- exactly one overload (verified 2026-07-16: record_device_activity(text,text,text)), so
-- there is no ambiguity to create. This mirrors how p_platform was retrofitted in rev 75.
--
-- EXPECT NULLS AT FIRST. Existing devices report nothing until they reopen on a build
-- carrying this, exactly as platform sat at "unknown" after rev 75. The data starts
-- answering from the NEXT rev onward, not retroactively.
--
-- Idempotent. Safe to re-run.

alter table public.device_activity add column if not exists rev integer;
alter table public.device_activity add column if not exists runtime text;
alter table public.device_activity add column if not exists embedded boolean;

-- !! DROP THE OLD SIGNATURE FIRST. THIS LINE IS NOT OPTIONAL. !!
-- `create or replace function` only replaces a function with the SAME argument list.
-- Adding parameters creates a SECOND function, and then a 3-arg call (which is what
-- every live build sends) matches BOTH — the old one exactly, the new one via defaults.
-- Postgres refuses that as ambiguous with 42725 and activity recording dies for every
-- live user. This exact mistake was made and caught on 2026-07-16, live, for the ~2
-- minutes between applying and testing. Verify after ANY change here:
--   select p.oid::regprocedure::text from pg_proc p join pg_namespace n
--     on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='record_device_activity';
-- Exactly ONE row. If there are two, 3-arg callers are already broken.
drop function if exists public.record_device_activity(text, text, text);
drop function if exists public.record_device_activity(text, text);

create or replace function public.record_device_activity(
  p_device text,
  p_city text,
  p_platform text default null,
  p_rev integer default null,
  p_runtime text default null,
  p_embedded boolean default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.device_activity (device_id, city_id, last_seen, platform, rev, runtime, embedded)
  values (p_device, p_city, now(), p_platform, p_rev, p_runtime, p_embedded)
  on conflict (device_id) do update
    set city_id   = excluded.city_id,
        last_seen = now(),
        -- coalesce so an older client (which sends nulls) cannot BLANK OUT what a newer
        -- one already told us. Only ever overwrite with a real value.
        platform  = coalesce(excluded.platform, public.device_activity.platform),
        rev       = coalesce(excluded.rev, public.device_activity.rev),
        runtime   = coalesce(excluded.runtime, public.device_activity.runtime),
        embedded  = coalesce(excluded.embedded, public.device_activity.embedded);
$$;

grant execute on function public.record_device_activity(text, text, text, integer, text, boolean) to anon, authenticated;

-- Active devices grouped by what they are running. Aggregates only; device_activity
-- itself stays private. Admin screen only, so unlike platform_split this revokes from
-- public/anon BEFORE granting — Postgres grants EXECUTE to PUBLIC by default, so the
-- revoke has to come first or the grant is decoration.
create or replace function public.rev_split()
  returns table(rev integer, runtime text, embedded boolean, users integer)
  language sql
  stable security definer
  set search_path to 'public'
as $$
  select da.rev, da.runtime, da.embedded, count(*)::int as users
  from public.device_activity da
  where da.last_seen > now() - interval '30 days'
  group by da.rev, da.runtime, da.embedded
  order by count(*) desc;
$$;

revoke execute on function public.rev_split() from public, anon;
grant execute on function public.rev_split() to authenticated;

-- Verify:
--   select * from public.rev_split();
--   -- old 3-arg call must still work (this is what live builds send):
--   select public.record_device_activity('d_test','findlay','ios');
--   delete from public.device_activity where device_id = 'd_test';
