-- !! SUPERSEDED IN PART BY supabase/metrics_exclusions.sql (2026-07-21) !!
-- The active-user function(s) defined below now read the human_activity VIEW, not the
-- device_activity table, so that bot-minted and owner devices stay out of every MAU
-- number (MAU sets ad pricing and is the ad experiment metric). The definition kept
-- here is the PRE-fix one. Re-applying this file as-is would silently revert the
-- exclusion and quietly re-inflate pricing. Apply metrics_exclusions.sql after it.
-- Active users per town, in ONE call, for the admin metrics screen.
--
-- city_active_users(p_city) already exists but answers for a single town, so a
-- per-town breakdown meant 135 round trips. This returns the whole table at once.
--
-- Returns AGGREGATE COUNTS ONLY, never device rows: device_activity must stay private
-- (it is the user list). SECURITY DEFINER for that reason, mirroring city_active_users
-- and platform_split.
--
-- Grants are tighter than platform_split's, which grants to anon without revoking from
-- PUBLIC first. Postgres grants EXECUTE to PUBLIC by default, so the revoke has to come
-- FIRST or the grant is decoration. This one is only ever called by the admin metrics
-- screen, so authenticated is enough and anon has no business here.
--
-- Idempotent. Safe to re-run.

create or replace function public.users_by_city()
  returns table(city_id text, users integer)
  language sql
  stable security definer
  set search_path to 'public'
as $$
  select da.city_id, count(*)::int as users
  from public.device_activity da
  where da.last_seen > now() - interval '30 days'
    and da.city_id is not null
  group by da.city_id
  order by count(*) desc, da.city_id;
$$;

revoke execute on function public.users_by_city() from public, anon;
grant execute on function public.users_by_city() to authenticated;

-- Verify:
--   select * from public.users_by_city() limit 5;
--   -- and that anon cannot:
--   set local role anon; select * from public.users_by_city();  -- must raise
