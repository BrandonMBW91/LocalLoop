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
  select coalesce(array_agg(distinct city_id), array[]::text[])
  from public.events
  where status = 'approved' and start_at >= now();
$$;

grant execute on function public.active_cities() to anon, authenticated;
