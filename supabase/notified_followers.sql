-- Idempotency ledger for notify-truck-followers.mjs: one row per truck stop
-- (source_uid for calendar stops, id for user posts) that we've already pushed
-- followers about, so re-runs and calendar re-upserts never double-notify. The
-- script's dedupe SELECT + record INSERT depend on this table existing; without
-- it every run would re-notify the whole 2-day window. Internal only.
create table if not exists public.notified_followers (
  stop_key    text primary key,
  notified_at timestamptz not null default now()
);
alter table public.notified_followers enable row level security;
-- No policies => anon & authenticated denied. Service role (the script) bypasses RLS.
revoke all on public.notified_followers from anon, authenticated;
