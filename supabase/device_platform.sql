-- Platform (iOS / Android) breakout for device metrics.
-- Adds device_activity.platform, updates record_device_activity to capture it,
-- and adds platform_split() for the in-app metrics screen. Idempotent; run once.

alter table public.device_activity add column if not exists platform text;

-- Recreate record_device_activity with an optional p_platform (default null so the
-- previous 2-arg app build still resolves to this single function — no ambiguous
-- overload). Keeps the last known platform if a later call omits it.
drop function if exists public.record_device_activity(text, text);
create or replace function public.record_device_activity(p_device text, p_city text, p_platform text default null)
  returns void
  language sql
  security definer
  set search_path to 'public'
as $$
  insert into public.device_activity (device_id, city_id, last_seen, platform)
  values (p_device, p_city, now(), p_platform)
  on conflict (device_id) do update
    set city_id = excluded.city_id,
        last_seen = now(),
        platform = coalesce(excluded.platform, public.device_activity.platform);
$$;
grant execute on function public.record_device_activity(text, text, text) to anon, authenticated;

-- Distinct devices per platform over the last 30 days. p_city null = all towns.
-- SECURITY DEFINER so device_activity stays private (mirrors city_active_users).
create or replace function public.platform_split(p_city text default null)
  returns table(platform text, users integer)
  language sql
  stable security definer
  set search_path to 'public'
as $$
  select coalesce(platform, 'unknown') as platform, count(*)::int as users
  from public.device_activity
  where last_seen > now() - interval '30 days'
    and (p_city is null or city_id = p_city)
  group by 1;
$$;
grant execute on function public.platform_split(text) to anon, authenticated;
