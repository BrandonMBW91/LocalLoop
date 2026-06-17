-- ============================================================================
-- Event ticket / info links. Run in the Supabase SQL Editor. Adds an optional
-- outbound URL (Ticketmaster, Eventbrite, or a venue's event page) so the app
-- can show a "Get Tickets" / "More Info" button. Safe to re-run.
-- ============================================================================

alter table public.events add column if not exists ticket_url text;
