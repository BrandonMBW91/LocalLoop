-- Record the BINARY's version and build number alongside the OTA rev.
--
-- rev/runtime/embedded (device_rev.sql) answer "did the JS update land". They cannot
-- answer "who is still on the old 1.0.3 binary", because everything they report is
-- OTA-delivered. These two come from the NATIVE side and are untouched by updates:
--   app_version   text  expo-application nativeApplicationVersion -> "1.0.3" | "1.0.4"
--   native_build  text  expo-application nativeBuildVersion -> iOS "12", Android "9"
--                       (text, not int: iOS build numbers are dotted strings like
--                       "1.2.3" and would not fit an integer.)
--
-- Together with rev they separate the three states that actually matter:
--   current binary + current rev  -> healthy, the OTA landed
--   current binary + stale rev    -> just has not reopened; self-heals, ignore
--   OLD binary                    -> only a store update can ever move them. On the
--                                    1aa93c runtime they can never receive a 1.0.4
--                                    OTA at all, so every fix is unreachable.
--
-- OTA-SAFE. expo-application is not a direct dependency; it arrives via
-- expo-notifications, so its native module is already autolinked into every binary.
-- Reading it adds no native code and does not move the fingerprint (verified).
--
-- Not Constants.expoConfig.version: that reads the OTA manifest, so it reports what the
-- JS bundle claims, not what the binary is. It would just echo APP_VERSION.
--
-- Idempotent. Safe to re-run.

alter table public.device_activity add column if not exists app_version text;
alter table public.device_activity add column if not exists native_build text;

-- !! DROP EVERY OLDER SIGNATURE FIRST. NOT OPTIONAL. !!
-- `create or replace function` only replaces a function with the SAME argument list.
-- Adding parameters creates ANOTHER function, and then the shorter call every live
-- build sends matches both -- the old one exactly, the new one via defaults -- and
-- Postgres refuses it as ambiguous (42725). Activity recording dies for every live
-- user. This exact mistake was made on 2026-07-16, in production, while adding the
-- previous three columns. Verify after ANY change here:
--   select p.oid::regprocedure::text from pg_proc p join pg_namespace n
--     on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='record_device_activity';
-- Exactly ONE row, always.
drop function if exists public.record_device_activity(text, text, text);
drop function if exists public.record_device_activity(text, text);
drop function if exists public.record_device_activity(text, text, text, integer, text, boolean);

create or replace function public.record_device_activity(
  p_device text,
  p_city text,
  p_platform text default null,
  p_rev integer default null,
  p_runtime text default null,
  p_embedded boolean default null,
  p_app_version text default null,
  p_native_build text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.device_activity (
    device_id, city_id, last_seen, platform, rev, runtime, embedded, app_version, native_build
  )
  values (p_device, p_city, now(), p_platform, p_rev, p_runtime, p_embedded, p_app_version, p_native_build)
  on conflict (device_id) do update
    set city_id      = excluded.city_id,
        last_seen    = now(),
        -- coalesce so an older client (which sends nulls) cannot BLANK OUT what a
        -- newer one already reported. Only ever overwrite with a real value.
        platform     = coalesce(excluded.platform, public.device_activity.platform),
        rev          = coalesce(excluded.rev, public.device_activity.rev),
        runtime      = coalesce(excluded.runtime, public.device_activity.runtime),
        embedded     = coalesce(excluded.embedded, public.device_activity.embedded),
        app_version  = coalesce(excluded.app_version, public.device_activity.app_version),
        native_build = coalesce(excluded.native_build, public.device_activity.native_build);
$$;

grant execute on function public.record_device_activity(text, text, text, integer, text, boolean, text, text) to anon, authenticated;

-- Now reports the binary too. Admin screen only, so revoke from public/anon BEFORE
-- granting: Postgres grants EXECUTE to PUBLIC by default and the revoke must come
-- first or the grant is decoration.
drop function if exists public.rev_split();
create or replace function public.rev_split()
  returns table(rev integer, runtime text, embedded boolean, app_version text, native_build text, platform text, users integer)
  language sql
  stable security definer
  set search_path to 'public'
as $$
  select da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform, count(*)::int as users
  from public.device_activity da
  where da.last_seen > now() - interval '30 days'
  group by da.rev, da.runtime, da.embedded, da.app_version, da.native_build, da.platform
  order by count(*) desc;
$$;

revoke execute on function public.rev_split() from public, anon;
grant execute on function public.rev_split() to authenticated;

-- REQUIRED, not housekeeping. PostgREST caches the schema, so until it reloads it does
-- not know the new parameters exist and every call passing them gets a 404 -- while the
-- OLD call shapes keep returning 204, so the app looks perfectly healthy and only the
-- NEW build silently stops recording. Observed exactly that on 2026-07-16: 3-arg and
-- 6-arg were 204 while the 8-arg was 404. Supabase usually reloads on its own, but not
-- fast enough to trust between applying this and publishing an OTA that depends on it.
notify pgrst, 'reload schema';
