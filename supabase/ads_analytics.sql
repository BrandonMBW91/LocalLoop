-- ============================================================================
-- Ad performance tracking — impressions + taps per sponsor.
-- Run in the Supabase SQL Editor after sponsors.sql. Safe to re-run.
-- This is what lets you tell an advertiser "your ad got N views and M taps" —
-- the number that justifies the price and the renewal.
-- ============================================================================

alter table public.sponsors add column if not exists impressions int not null default 0;
alter table public.sponsors add column if not exists clicks      int not null default 0;

-- Anyone (even logged out) can record that an ad was shown or tapped, but this
-- function can ONLY touch those two counters — nothing else.
create or replace function public.track_sponsor(p_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event = 'impression' then
    update public.sponsors set impressions = impressions + 1 where id = p_id;
  elsif p_event = 'click' then
    update public.sponsors set clicks = clicks + 1 where id = p_id;
  end if;
end;
$$;

grant execute on function public.track_sponsor(uuid, text) to anon, authenticated;

-- A town's total reach = all listing views there. Drives reach-based ad pricing
-- (prices step up as a town's audience grows). Read-only; safe for anyone.
create or replace function public.city_reach(p_city text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(view_count) from public.events       where city_id = p_city and status = 'approved'), 0)
       + coalesce((select sum(view_count) from public.garage_sales where city_id = p_city and status = 'approved'), 0)
       + coalesce((select sum(view_count) from public.food_trucks  where city_id = p_city and status = 'approved'), 0);
$$;

grant execute on function public.city_reach(text) to anon, authenticated;
