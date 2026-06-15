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

-- A device can record/refresh its own activity (upsert by device_id). We never
-- read these from the client — only the pricing function (service-level) does.
drop policy if exists "device_insert" on public.device_activity;
create policy "device_insert" on public.device_activity
  for insert to anon, authenticated with check (true);

drop policy if exists "device_update" on public.device_activity;
create policy "device_update" on public.device_activity
  for update to anon, authenticated using (true) with check (true);

grant insert, update on public.device_activity to anon, authenticated;

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
