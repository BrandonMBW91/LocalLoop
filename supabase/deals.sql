-- ============================================================================
-- Local Deals — business-posted coupons/specials shown in the app.
-- Run in the Supabase SQL Editor after sponsors.sql. Safe to re-run.
-- A paid/partner feature: a local business posts a deal, it shows in its town.
-- ============================================================================

create table if not exists public.deals (
  id            uuid primary key default gen_random_uuid(),
  city_id       text not null,
  business_name text not null,
  title         text not null,           -- the deal, e.g. "2-for-1 Tuesdays"
  description   text,
  address       text,
  link_url      text,                    -- website or tel: link
  image_url     text,
  active        boolean not null default true,
  featured      boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  view_count    int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists deals_city_active_idx on public.deals (city_id, active);

alter table public.deals enable row level security;

-- Public sees only live deals; admin sees all.
drop policy if exists "deals_public_read" on public.deals;
create policy "deals_public_read" on public.deals
  for select using (
    (active = true
      and (starts_at is null or starts_at <= now())
      and (ends_at   is null or ends_at   >= now()))
    or public.is_admin()
  );

drop policy if exists "deals_admin_insert" on public.deals;
create policy "deals_admin_insert" on public.deals
  for insert to authenticated with check (public.is_admin());

drop policy if exists "deals_admin_update" on public.deals;
create policy "deals_admin_update" on public.deals
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "deals_admin_delete" on public.deals;
create policy "deals_admin_delete" on public.deals
  for delete to authenticated using (public.is_admin());

grant select on public.deals to anon, authenticated;
grant insert, update, delete on public.deals to authenticated;

-- Count a deal view (e.g. when someone taps through). Can only touch view_count.
create or replace function public.bump_deal_view(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deals set view_count = view_count + 1 where id = p_id;
end;
$$;

grant execute on function public.bump_deal_view(uuid) to anon, authenticated;

-- Extend the housekeeping job to also switch off expired deals.
create or replace function public.expire_promotions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.events       set featured = false
    where featured = true and featured_until is not null and featured_until < now();
  update public.garage_sales set featured = false
    where featured = true and featured_until is not null and featured_until < now();
  update public.food_trucks  set featured = false
    where featured = true and featured_until is not null and featured_until < now();
  update public.sponsors     set active = false
    where active = true and ends_at is not null and ends_at < now();
  update public.deals        set active = false
    where active = true and ends_at is not null and ends_at < now();
end;
$$;

grant execute on function public.expire_promotions() to anon, authenticated, service_role;
