-- ============================================================================
-- Coordinates for the map view. Run in the Supabase SQL Editor. Safe to re-run.
-- The aggregator / geocode script fills these from each event's address.
-- ============================================================================

alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;
