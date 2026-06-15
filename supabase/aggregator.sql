-- ============================================================================
-- Auto-aggregation support
-- Run in the Supabase SQL Editor AFTER schema.sql and moderation.sql.
-- Adds: a dedup key on events, a table of calendar feeds you control, and
-- auto-approval for events pulled from trusted feeds. Safe to re-run.
-- ============================================================================

-- Dedup key: each aggregated event carries the source calendar's UID so we
-- never insert the same event twice. User-submitted events leave this null.
alter table public.events add column if not exists source_uid text;
-- Plain unique index: Postgres treats NULLs as distinct, so many user-submitted
-- events (null source_uid) are fine, while feed events stay unique + upsertable.
create unique index if not exists events_source_uid_uniq
  on public.events (source_uid);

-- The calendar feeds the aggregator pulls from. Add rows here to add sources.
create table if not exists public.event_sources (
  id               uuid primary key default gen_random_uuid(),
  city_id          text not null,
  name             text not null,
  url              text not null,
  type             text not null default 'ical',
  default_category text not null default 'Community',
  enabled          boolean not null default true,
  created_at       timestamptz not null default now()
);
alter table public.event_sources enable row level security;
-- (No public policies — only the aggregator's service-role key reads this.)

-- Re-create the moderator trigger to ALSO auto-approve aggregated events.
create or replace function public.moderate_submission()
returns trigger
language plpgsql
as $$
declare content text;
begin
  -- Trusted moderators publish instantly.
  if public.is_admin() then
    NEW.status := 'approved';
    return NEW;
  end if;

  if TG_TABLE_NAME = 'events' then
    -- The aggregator runs as the SERVICE ROLE (no auth.uid, bypasses RLS).
    -- Only it can reach an events insert with a null uid, so only it is
    -- trusted to set source_uid + auto-publish. Regular signed-in users have
    -- a non-null uid: we strip any source_uid they try to send so they can't
    -- self-approve, and run them through normal moderation.
    if auth.uid() is null then
      NEW.status := 'approved';
      return NEW;
    end if;
    NEW.source_uid := null;
    content := lower(concat_ws(' ', NEW.title, NEW.description, NEW.venue, NEW.address));
  elsif TG_TABLE_NAME = 'garage_sales' then
    content := lower(concat_ws(' ', NEW.title, NEW.note, NEW.address));
  elsif TG_TABLE_NAME = 'food_trucks' then
    content := lower(concat_ws(' ', NEW.name, NEW.note, NEW.location_name, NEW.address));
  else
    content := '';
  end if;

  if content ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|info|biz|xyz|shop|io))'
     or content ~ '(\+?\d[ .\-]?){10,}'
     or content ~* '\m(fuck|shit|bitch|asshole|cunt|nigger|faggot|slut|whore|retard)\M'
     or content ~* '(make money|free money|work from home|crypto|bitcoin|viagra|casino|click here|get rich|buy now|limited offer)'
  then
    NEW.status := 'pending';
  else
    NEW.status := 'approved';
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed feeds — all verified returning live iCal events (June 2026).
-- Add more rows anytime via the Table Editor. Set enabled=false to pause one.
-- ---------------------------------------------------------------------------
create unique index if not exists event_sources_url_uniq on public.event_sources (url);

insert into public.event_sources (city_id, name, url, type, default_category, enabled) values
  ('arlington', 'Arlington Branch Library', 'https://fhcpl-arlington-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('bellefontaine', 'Logan County Libraries', 'https://loganc-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('bowling-green', 'BGSU Events', 'https://events.bgsu.edu/calendar.ics', 'ical', 'Education', true),
  ('carey', 'Dorcas Carey Public Library', 'https://dorcascarey-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('findlay', 'Findlay-Hancock County Public Library', 'https://fhcpl-main-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('findlay', 'University of Findlay', 'https://calendar.findlay.edu/?post_type=tribe_events&ical=1&eventDisplay=list', 'ical', 'Education', true),
  -- Owens CC endpoint is unreachable (DNS/plugin removed) — disabled to stop per-run fetch errors.
  ('findlay', 'Owens Community College', 'https://www.owens.edu/events/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true', 'ical', 'Education', false),
  ('fostoria', 'Kaubisch Memorial Public Library', 'https://kaubisch-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('leipsic', 'Leipsic Public Library', 'https://putnam-leipsic-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('lima', 'Lima Public Library', 'https://lima-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('north-baltimore', 'North Baltimore Public Library', 'https://nbpl-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('pandora', 'Pandora-Riley Branch Library', 'https://putnam-pandora-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('perrysburg', 'City of Perrysburg', 'https://www.perrysburgoh.gov/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar', 'ical', 'Community', true),
  ('perrysburg', 'Way Public Library', 'https://waylibrary.libcal.com/ical_subscribe.php?cid=12045', 'ical', 'Community', true),
  ('sandusky', 'Sandusky Library', 'https://events.sanduskylib.org/ical_subscribe.php?src=p&cid=10855', 'ical', 'Community', true),
  ('tiffin', 'Tiffin University', 'https://go.tiffin.edu/events/?ical=1', 'ical', 'Education', true),
  ('tiffin', 'Tiffin-Seneca Public Library', 'https://tiffin-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('toledo', 'Visit Toledo', 'https://visittoledo.org/events-calendar/list/?ical=1', 'ical', 'Community', true),
  ('van-wert', 'Brumback Library', 'https://brumback-oh.whofi.com/calendar/ical', 'ical', 'Community', true),
  ('waterville', 'City of Waterville', 'https://waterville.org/?post_type=tribe_events&ical=1&eventDisplay=list', 'ical', 'Community', true)
on conflict (url) do nothing;
