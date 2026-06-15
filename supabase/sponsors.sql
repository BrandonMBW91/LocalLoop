-- ============================================================================
-- Sponsors (ads) + paid "featured" listings, with auto-expiry.
-- Run in the Supabase SQL Editor AFTER schema.sql, moderation.sql, analytics.sql.
-- Safe to re-run.
--   * sponsors: small ads shown between listings, scoped to a city + date window.
--   * featured_until: a paid promotion that floats a listing to the top until a
--     date, then automatically expires.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Paid "featured" promotions expire on a date. featured (boolean) stays as the
-- fast flag the app reads/sorts on; featured_until is when it lapses.
-- ---------------------------------------------------------------------------
alter table public.events       add column if not exists featured_until timestamptz;
alter table public.garage_sales add column if not exists featured_until timestamptz;
alter table public.food_trucks  add column if not exists featured_until timestamptz;

-- ---------------------------------------------------------------------------
-- Sponsors / ads
-- ---------------------------------------------------------------------------
create table if not exists public.sponsors (
  id         uuid primary key default gen_random_uuid(),
  city_id    text not null,
  title      text not null,
  body       text,
  image_url  text,
  link_url   text,
  weight     int  not null default 1,          -- higher = shown more often
  active     boolean not null default true,
  starts_at  timestamptz,                       -- null = no start bound
  ends_at    timestamptz,                       -- null = runs until paused
  created_at timestamptz not null default now()
);

create index if not exists sponsors_city_active_idx
  on public.sponsors (city_id, active);

alter table public.sponsors enable row level security;

-- Public can read only the ads that are live right now; admin sees all.
drop policy if exists "sponsors_public_read" on public.sponsors;
create policy "sponsors_public_read" on public.sponsors
  for select using (
    (active = true
      and (starts_at is null or starts_at <= now())
      and (ends_at   is null or ends_at   >= now()))
    or public.is_admin()
  );

-- Only the admin can create / edit / remove ads (from the in-app manager).
drop policy if exists "sponsors_admin_insert" on public.sponsors;
create policy "sponsors_admin_insert" on public.sponsors
  for insert to authenticated with check (public.is_admin());

drop policy if exists "sponsors_admin_update" on public.sponsors;
create policy "sponsors_admin_update" on public.sponsors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sponsors_admin_delete" on public.sponsors;
create policy "sponsors_admin_delete" on public.sponsors
  for delete to authenticated using (public.is_admin());

grant select on public.sponsors to anon, authenticated;
grant insert, update, delete on public.sponsors to authenticated;

-- ---------------------------------------------------------------------------
-- Admin action: feature a listing until a date (or un-feature with null).
-- SECURITY DEFINER + an is_admin() guard so only you can promote listings,
-- even though the app calls it with your normal logged-in key.
-- ---------------------------------------------------------------------------
create or replace function public.set_featured(p_kind text, p_id uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  if p_kind = 'event' then
    update public.events
      set featured = (p_until is not null), featured_until = p_until where id = p_id;
  elsif p_kind = 'garage_sale' then
    update public.garage_sales
      set featured = (p_until is not null), featured_until = p_until where id = p_id;
  elsif p_kind = 'food_truck' then
    update public.food_trucks
      set featured = (p_until is not null), featured_until = p_until where id = p_id;
  end if;
end;
$$;

grant execute on function public.set_featured(text, uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping: turn off promotions/ads that have passed their end date.
-- Idempotent + harmless, so it's safe to call from the daily aggregator run
-- (no pg_cron needed) or from the admin screen.
-- ---------------------------------------------------------------------------
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
end;
$$;

grant execute on function public.expire_promotions() to anon, authenticated, service_role;
