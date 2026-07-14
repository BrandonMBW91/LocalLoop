-- Per-town upcoming-event counts for the town picker, so a user can see which
-- towns are dense vs just getting started (density-aware selection). The window
-- approximates what the app's list actually SHOWS after its client-side
-- ended-event filter (src/lib/db.js effectiveEndMs/isOver): a real end still
-- ahead, or an end-less event started within 3h grace, or a noon-ET-anchored
-- all-day event still inside its Eastern day. The old start-only 12h window
-- counted events that ended hours earlier, so the picker number visibly
-- exceeded the list ("2,517 events" -> 2,449 rows).
-- Additive + fail-safe: if this RPC errors the app just omits the counts.
create or replace function public.active_city_counts()
returns table(city_id text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select city_id, count(*)::int as n
  from public.events
  where status = 'approved'
    and (
      end_at >= now()
      or (end_at is null and start_at >= now() - interval '3 hours')
      or (end_at is null and start_at >= now() - interval '12 hours'
          and to_char(start_at at time zone 'America/New_York', 'HH24:MI') = '12:00')
    )
  group by city_id;
$$;

grant execute on function public.active_city_counts() to anon, authenticated;
