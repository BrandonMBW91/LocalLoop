-- Per-town upcoming-event counts for the town picker, so a user can see which
-- towns are dense vs just getting started (density-aware selection). Mirrors the
-- exact window active_cities() uses, so the count matches what the picker shows
-- (and what fetchEvents displays). Additive + fail-safe: if this RPC errors the
-- app just omits the counts and the picker still works off active_cities().
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
    and (start_at >= now() - interval '12 hours' or end_at >= now())
  group by city_id;
$$;

grant execute on function public.active_city_counts() to anon, authenticated;
