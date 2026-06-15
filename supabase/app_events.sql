-- ============================================================================
-- Lightweight product analytics (no third-party SDK).
-- Run in the Supabase SQL Editor. Records anonymous interaction events so you
-- can see what towns/searches/actions matter. Safe to re-run.
-- ============================================================================

create table if not exists public.app_events (
  id          bigint generated always as identity primary key,
  device_id   text,                 -- anonymous per-install id (not personal)
  event       text not null,        -- e.g. 'change_city', 'search', 'save_event'
  city_id     text,
  props       jsonb,                -- small event-specific details
  created_at  timestamptz not null default now()
);

create index if not exists app_events_event_idx on public.app_events (event, created_at);
create index if not exists app_events_city_idx on public.app_events (city_id, created_at);

alter table public.app_events enable row level security;

-- Anonymous clients may INSERT their own events; nobody but admins can read.
drop policy if exists "app_events_insert" on public.app_events;
create policy "app_events_insert" on public.app_events
  for insert to anon, authenticated with check (true);

drop policy if exists "app_events_admin_read" on public.app_events;
create policy "app_events_admin_read" on public.app_events
  for select to authenticated using (public.is_admin());

grant insert on public.app_events to anon, authenticated;
grant select on public.app_events to authenticated;

-- Handy admin summaries -------------------------------------------------------

-- Daily counts per event type (last 60 days).
create or replace view public.app_events_daily
with (security_invoker = true) as
  select date_trunc('day', created_at)::date as day, event, count(*) as n
  from public.app_events
  where created_at > now() - interval '60 days'
  group by 1, 2
  order by 1 desc, 3 desc;

-- What people search for (top terms, last 30 days) — drives content strategy.
create or replace view public.app_top_searches
with (security_invoker = true) as
  select lower(props->>'term') as term, count(*) as n
  from public.app_events
  where event = 'search'
    and coalesce(props->>'term','') <> ''
    and created_at > now() - interval '30 days'
  group by 1
  order by 2 desc
  limit 100;
