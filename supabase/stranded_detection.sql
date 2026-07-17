-- Detect STRANDED devices, which by construction cannot report that they are stranded.
--
-- THE BLIND SPOT: device_rev.sql records `runtime` so we can spot devices on the old
-- 1aa93c fingerprint runtime, which can never receive a 1.0.4 OTA. But that reporting
-- code SHIPS IN AN OTA. A stranded device cannot receive it, so it never sends a
-- runtime, and the "STRANDED" row reads 0 forever while the truth sits in the
-- "not yet reported" bucket looking like ordinary lag. The metric was blind to exactly
-- the population it was built to find.
--
-- THE INFERENCE: `last_seen` updates on every open regardless of which JS is running.
-- So a device that keeps OPENING well after an update was published, yet still reports
-- no rev, is not waiting for the update. It cannot get it.
--
-- THE GRACE PERIOD IS NOT OPTIONAL. expo-updates fetches in the background and applies
-- on the NEXT launch, so a device that opened ONCE after publish is legitimately still
-- on old JS and is not stranded. 48h gives any normal device several launches. Anything
-- still silent after that has had every chance.
--
-- This yields a FLOOR, not a count: a stranded device that never opens again is
-- invisible to any method, and always will be. Read it as "at least this many".
--
-- Idempotent. Safe to re-run.

-- !! DROP FIRST. `create or replace function` CANNOT change a return type -- it fails
-- with 42P13 and, because the whole script runs as one statement batch, everything
-- after it (including the '' cleanup below) silently rolls back too. This is the third
-- shape of the same Postgres footgun hit in two days: replace cannot change the arg
-- list, and it cannot change the return type either. When in doubt, drop.
drop function if exists public.rev_split();

-- rev 111 (the first build that reports a rev) published 2026-07-16 ~21:00 ET.
-- Bump this if the reporting code is ever re-shipped from scratch.
--   TRACKING_LIVE = 2026-07-16 21:00 ET, + 48h grace = 2026-07-18 21:00 ET
create or replace function public.rev_split()
  returns table(
    rev integer,
    runtime text,
    embedded boolean,
    app_version text,
    native_build text,
    platform text,
    -- true = opened AFTER the grace window closed but STILL reports no rev, i.e. it
    -- had every chance to take the update and did not. Stranded or update-blocked.
    update_blocked boolean,
    users integer
  )
  language sql
  stable security definer
  set search_path to 'public'
as $$
  select
    da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform,
    (da.rev is null and da.last_seen > timestamptz '2026-07-18 21:00:00-04') as update_blocked,
    count(*)::int as users
  from public.device_activity da
  where da.last_seen > now() - interval '30 days'
  group by da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform,
           (da.rev is null and da.last_seen > timestamptz '2026-07-18 21:00:00-04')
  order by count(*) desc;
$$;

revoke execute on function public.rev_split() from public, anon;
grant execute on function public.rev_split() to authenticated;

-- Clean the '' rows already stored. On web expo-updates reports runtimeVersion as an
-- empty string, and a `typeof === 'string'` guard stored it, so web devices grouped
-- under a meaningless '' runtime instead of "unknown". '' is not a runtime.
update public.device_activity set runtime = null where runtime = '';
update public.device_activity set app_version = null where app_version = '';
update public.device_activity set native_build = null where native_build = '';

notify pgrst, 'reload schema';
