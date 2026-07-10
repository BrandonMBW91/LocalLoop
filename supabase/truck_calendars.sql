-- Food-truck calendar auto-ingest (Jul 2026). A truck sends their Google Calendar
-- (or any iCal) link ONCE; the aggregator pulls their stops into food_trucks
-- daily, so they never post manually. Answers the #1 truck objection ("won't
-- post on another platform") — same model as StreetFoodFinder. Idempotent.

-- 1) Dedup + provenance on food_trucks: aggregator-ingested stops carry a
--    source_uid = sha1(truck|date|location); user submissions stay NULL (so
--    retention/dedup never touch hand-posted stops).
alter table public.food_trucks add column if not exists source_uid text;
-- FULL (not partial) unique index: Postgres treats NULLs as distinct, so many
-- user submissions (source_uid NULL) coexist while non-null aggregator ids stay
-- unique. Must be non-partial so PostgREST upsert onConflict='source_uid' can
-- infer it.
drop index if exists public.food_trucks_source_uid_uniq;
create unique index if not exists food_trucks_source_uid_uniq
  on public.food_trucks (source_uid);

-- 2) One row per registered truck calendar. Service-role only (admin registers
--    a calendar when a truck replies with their link); never client-writable.
create table if not exists public.truck_calendars (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  city_id       text not null,
  cuisine       text not null default 'Food truck',
  ical_url      text not null,
  host          text,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  last_pulled_at timestamptz,
  last_ok_at     timestamptz,
  last_stop_count int,
  last_error     text
);
alter table public.truck_calendars enable row level security;
revoke all on public.truck_calendars from anon, authenticated;
