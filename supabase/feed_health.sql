-- Per-source health stamps so a silently dying feed is visible instead of a town
-- slowly emptying out months later. aggregate.mjs stamps every pull; feed-health.mjs
-- reads these to flag dead/stale sources. Idempotent.
alter table public.event_sources add column if not exists last_pulled_at timestamptz;
alter table public.event_sources add column if not exists last_ok_at timestamptz;
alter table public.event_sources add column if not exists last_event_count int;
alter table public.event_sources add column if not exists last_error text;
