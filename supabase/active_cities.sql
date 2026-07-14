-- Towns the aggregator has actually found upcoming events for. The app picker
-- shows only these (plus the user's current selection), so an empty "ghost" town
-- is never shown — and it appears automatically the moment the daily aggregator
-- finds it an event. Cheap: returns just the distinct id array. Anon-callable.
create or replace function public.active_cities()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  -- Mirror what the app actually DISPLAYS (fetchEvents keeps events that started
  -- up to 12h ago or are still running), else a town whose only listing is an
  -- in-progress festival vanishes from the picker mid-festival.
  -- Same shown-events window as active_city_counts(): a real end still ahead,
  -- an end-less event inside its 3h grace, or a noon-ET all-day anchor inside
  -- its Eastern day — so the picker never lists a town whose events all ended.
  select coalesce(array_agg(distinct city_id), array[]::text[])
  from public.events
  where status = 'approved'
    and (
      end_at >= now()
      or (end_at is null and start_at >= now() - interval '3 hours')
      or (end_at is null and start_at >= now() - interval '12 hours'
          and to_char(start_at at time zone 'America/New_York', 'HH24:MI') = '12:00')
    );
$$;

grant execute on function public.active_cities() to anon, authenticated;
