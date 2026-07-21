-- Remember which addresses Mapbox cannot resolve, so we stop asking forever.
--
-- THE PROBLEM. geocode.mjs selects every event with no coordinates and looks it up
-- again, with no memory of what already failed. As of 2026-07-21 that is 923 distinct
-- address+town combos covering 5,759 events which have NEVER resolved and, being
-- mostly vague venue names with no street address, never will. They were re-queried on
-- every run, twice a day (the 2am cloud pass and the 7am desktop pass) — roughly 1,800
-- requests a day spent asking the same unanswerable questions. That was the bulk of
-- the ~28,500 geocoding requests on the account this billing period, and the reason
-- usage jumped 1,439% while real coverage did not.
--
-- THE UNIT IS THE COMBO, NOT THE EVENT. Many events share one address+town, and that
-- is exactly what geocode.mjs already groups by, so the key here is the same query
-- string it builds. Keying on events would re-fail the same address once per event.
--
-- CRITICAL: only "no match" failures land here. An API refusal (401 / 429 / 5xx) must
-- NEVER be recorded, or a single quota blip would permanently blacklist ~900 perfectly
-- good addresses and quietly stop geocoding them for a month. geocode.mjs tracks the
-- two separately for precisely this reason.
--
-- Entries expire: after RETRY_AFTER_DAYS the address is tried once more, because feed
-- data gets cleaned up and Mapbox's coverage improves. A permanent blacklist would be
-- wrong; this is a back-off, not a tombstone.

create table if not exists public.geocode_failures (
  query           text primary key,
  attempts        int not null default 1,
  first_failed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  last_reason     text
);

-- Service-role only. This is an internal cost-control table; nothing user-facing reads
-- it, and the anon key ships inside the public web bundle.
alter table public.geocode_failures enable row level security;
revoke all on public.geocode_failures from public, anon, authenticated;
grant all on public.geocode_failures to service_role;

create index if not exists geocode_failures_last_attempt_idx
  on public.geocode_failures (last_attempt_at);

notify pgrst, 'reload schema';
