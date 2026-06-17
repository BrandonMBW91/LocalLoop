-- ============================================================================
-- Event images. Run in the Supabase SQL Editor. Adds an optional image URL to
-- events so rich sources (Ticketmaster, schema.org pages) can show artwork.
-- Safe to re-run.
-- ============================================================================

alter table public.events add column if not exists image_url text;
