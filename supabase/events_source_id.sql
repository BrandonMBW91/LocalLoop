-- Tag aggregator-ingested events with the feed they came from, so the aggregator's
-- reconcile step (aggregate.mjs) can remove ONLY a given feed's own future events
-- when they vanish / cancel / reschedule -- never another feed's rows, a user's
-- posted event, or anything in the past. Nullable + ON DELETE SET NULL so deleting
-- a source never cascades away its events. Existing rows stay null (never touched
-- by reconcile; they age out via retention) until they are re-ingested.
alter table public.events add column if not exists source_id uuid references public.event_sources(id) on delete set null;
create index if not exists events_source_id_idx on public.events (source_id) where source_id is not null;
