-- Outreach measurement: click + conversion events for the sponsor cold-email
-- funnel. Written ONLY by edge functions (service role): the `outreach-click`
-- redirect logs a 'click', and `stripe-webhook` logs a 'conversion' keyed on the
-- Stripe Payment Link's client_reference_id. Internal analytics only — anon and
-- authenticated get NOTHING (RLS on, no policies; the service role bypasses RLS).
-- Read it for the funnel view via the management API or the service role.
create table if not exists public.outreach_events (
  id          bigint generated always as identity primary key,
  event       text not null check (event in ('click','conversion')),
  slug        text,                 -- /for/<slug> token; resolves to a lead via the local slug map
  ref         text,                 -- raw ref / client_reference_id (conversions)
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists outreach_events_slug_idx  on public.outreach_events (slug);
create index if not exists outreach_events_event_idx on public.outreach_events (event, created_at desc);

alter table public.outreach_events enable row level security;
-- No policies => anon & authenticated are fully denied. Service role bypasses RLS.
revoke all on public.outreach_events from anon, authenticated;
