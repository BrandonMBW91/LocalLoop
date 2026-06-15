-- ============================================================================
-- Optional security hardening (from the pre-launch audit). Safe to run anytime;
-- nothing here is launch-blocking, but it closes a few low-risk abuse vectors.
-- ============================================================================

-- 1. Raise the report auto-hide threshold 3 -> 5, so a small ring of throwaway
--    accounts can't quietly take down a competitor's legitimate listing.
create or replace function public.hide_if_reported()
returns trigger
language plpgsql
security definer
as $$
declare cnt int;
begin
  select count(*) into cnt
    from public.reports
    where listing_id = new.listing_id and kind = new.kind;
  if cnt >= 5 then
    if new.kind = 'event' then
      update public.events set status = 'pending' where id = new.listing_id;
    elsif new.kind = 'garage_sale' then
      update public.garage_sales set status = 'pending' where id = new.listing_id;
    elsif new.kind = 'food_truck' then
      update public.food_trucks set status = 'pending' where id = new.listing_id;
    end if;
  end if;
  return new;
end;
$$;

-- 2. Cap report reason length (storage-spam guard). Applies to new rows only.
alter table public.reports drop constraint if exists reports_reason_len;
alter table public.reports
  add constraint reports_reason_len check (char_length(coalesce(reason, '')) <= 500) not valid;

-- 3. expire_promotions is only ever called by the admin (authenticated) and the
--    aggregator (service role) — drop the unnecessary anon execute grant.
revoke execute on function public.expire_promotions() from anon;
