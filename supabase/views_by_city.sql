-- Per-town view counts for the Metrics screen's "Total views" tile.
--
-- MUST stay consistent with total_views() (supabase/total_views.sql). That function
-- sums events + garage_sales + food_trucks, so this one does too. If they diverged,
-- the tile would show one number and its own breakdown would add up to a different
-- one — which reads as the metrics being wrong, and it is the sort of thing you only
-- notice after quoting the headline figure to an advertiser.
--
-- Modelled on users_by_city(): same shape, same security mode, same ordering, so the
-- two expandable tiles on that screen behave identically.
--
-- No is_admin() guard, matching total_views(): this aggregates view counts of
-- already-public approved listings and leaks nothing that is not readable anyway.

create or replace function public.views_by_city()
returns table(city_id text, views bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select t.city_id, sum(t.v)::bigint as views
  from (
    select e.city_id, coalesce(e.view_count, 0) as v
      from public.events e where e.status = 'approved'
    union all
    select g.city_id, coalesce(g.view_count, 0)
      from public.garage_sales g where g.status = 'approved'
    union all
    select f.city_id, coalesce(f.view_count, 0)
      from public.food_trucks f where f.status = 'approved'
  ) t
  where t.city_id is not null
  group by t.city_id
  -- Drop the zero-view towns. With 135 towns and views concentrated in a handful,
  -- an unfiltered list is ~120 rows of "0" that bury the towns that matter.
  having sum(t.v) > 0
  order by sum(t.v) desc, t.city_id;
$function$;

grant execute on function public.views_by_city() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
