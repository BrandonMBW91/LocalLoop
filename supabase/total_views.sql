-- Global "total views" for the Metrics screen.
--
-- The Metrics screen has a scope toggle (this town / all towns) and EVERY stat on it
-- follows that toggle, including "Total views". So standing in Findlay the card read
-- 436 while the product had actually served 1,101 — the number looked like a product
-- total but was a town total, which is the kind of stat you quote to an advertiser.
-- Views are now always global; the other cards stay scoped, and the label says which.
--
-- Server-side on purpose. The client alternative is fetchMetrics(null), which pages
-- every approved row in three tables (~17k events) just to add up one column. This
-- returns a single integer, so the card no longer costs a full catalog download.
--
-- No is_admin() guard: this aggregates view counts of already-public approved
-- listings, so it leaks nothing that isn't readable anyway.

create or replace function public.total_views()
returns bigint language sql stable security definer set search_path to 'public'
as $function$
  select
    (select coalesce(sum(view_count), 0) from public.events        where status = 'approved')
  + (select coalesce(sum(view_count), 0) from public.garage_sales  where status = 'approved')
  + (select coalesce(sum(view_count), 0) from public.food_trucks   where status = 'approved');
$function$;

grant execute on function public.total_views() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
