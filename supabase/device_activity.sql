-- !! SUPERSEDED IN PART BY supabase/metrics_exclusions.sql (2026-07-21) !!
-- The active-user function(s) defined below now read the human_activity VIEW, not the
-- device_activity table, so that bot-minted and owner devices stay out of every MAU
-- number (MAU sets ad pricing and is the ad experiment metric). The definition kept
-- here is the PRE-fix one. Re-applying this file as-is would silently revert the
-- exclusion and quietly re-inflate pricing. Apply metrics_exclusions.sql after it.
-- ============================================================================
-- Active-user tracking per town — powers reach-based ad pricing by ACTUAL USERS.
-- Run in the Supabase SQL Editor. Safe to re-run. No personal data: just an
-- anonymous device id, the town it's browsing, and when it was last seen.
-- ============================================================================

create table if not exists public.device_activity (
  device_id text primary key,
  city_id   text,
  last_seen timestamptz not null default now()
);

create index if not exists device_activity_city_seen_idx
  on public.device_activity (city_id, last_seen);

alter table public.device_activity enable row level security;

-- Writes go through record_device_activity() below (SECURITY DEFINER), NOT a
-- direct client upsert: an INSERT ... ON CONFLICT DO UPDATE needs read access to
-- detect the conflict, and we never want the client able to read this table (it
-- would expose the user list / per-town counts). So the table has NO client
-- read/write policies — the definer function is the only client-reachable path.
drop policy if exists "device_insert" on public.device_activity;
drop policy if exists "device_update" on public.device_activity;
revoke insert, update on public.device_activity from anon, authenticated;

-- A device records/refreshes its own activity (upsert by device_id) via this
-- definer function, which bypasses RLS so the table can stay fully private.
create or replace function public.record_device_activity(p_device text, p_city text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.device_activity (device_id, city_id, last_seen)
  values (p_device, p_city, now())
  on conflict (device_id) do update set city_id = excluded.city_id, last_seen = now();
$$;

grant execute on function public.record_device_activity(text, text) to anon, authenticated;

-- Monthly active users in a town = distinct devices seen there in the last 30 days.
create or replace function public.city_active_users(p_city text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.device_activity
  where city_id = p_city and last_seen > now() - interval '30 days';
$$;

grant execute on function public.city_active_users(text) to anon, authenticated;
