-- ============================================================================
-- Findlay Events — database schema + security rules
-- Paste this into the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- and click Run. Safe to run more than once.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  city_id     text not null,
  title       text not null,
  category    text not null,
  emoji       text,
  start_at    timestamptz not null,
  end_at      timestamptz,
  venue       text not null,
  address     text,
  price       text,
  host        text,
  featured    boolean not null default false,
  description text,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.garage_sales (
  id          uuid primary key default gen_random_uuid(),
  city_id     text not null,
  title       text not null,
  type        text not null default 'Garage Sale',
  start_date  date not null,
  end_date    date,
  daily_start text,
  daily_end   text,
  address     text not null,
  neighborhood text,
  items       text[] not null default '{}',
  images      text[] not null default '{}',
  featured    boolean not null default false,
  host        text,
  note        text,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- In case tables were created before these columns were added:
alter table public.garage_sales add column if not exists images text[] not null default '{}';
alter table public.garage_sales add column if not exists featured boolean not null default false;

create table if not exists public.food_trucks (
  id            uuid primary key default gen_random_uuid(),
  city_id       text not null,
  name          text not null,
  cuisine       text not null default 'Other',
  date          date not null,
  start_time    text,
  end_time      text,
  location_name text not null,
  address       text,
  featured      boolean not null default false,
  host          text,
  note          text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists events_city_status_start_idx
  on public.events (city_id, status, start_at);
create index if not exists sales_city_status_start_idx
  on public.garage_sales (city_id, status, start_date);
create index if not exists trucks_city_status_date_idx
  on public.food_trucks (city_id, status, date);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   * Anyone (even logged out) can READ approved posts.
--   * A signed-in person can also read their OWN pending posts.
--   * A signed-in person can SUBMIT, but only as 'pending' and as themselves.
--   * Nobody can edit/approve via the app. You approve in the Supabase
--     dashboard, which uses the service role and bypasses these rules.
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.garage_sales enable row level security;
alter table public.food_trucks enable row level security;

drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events
  for select using (status = 'approved' or auth.uid() = created_by);

drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events
  for insert to authenticated
  with check (status = 'pending' and created_by = auth.uid());

drop policy if exists "sales_read" on public.garage_sales;
create policy "sales_read" on public.garage_sales
  for select using (status = 'approved' or auth.uid() = created_by);

drop policy if exists "sales_insert" on public.garage_sales;
create policy "sales_insert" on public.garage_sales
  for insert to authenticated
  with check (status = 'pending' and created_by = auth.uid());

drop policy if exists "trucks_read" on public.food_trucks;
create policy "trucks_read" on public.food_trucks
  for select using (status = 'approved' or auth.uid() = created_by);

drop policy if exists "trucks_insert" on public.food_trucks;
create policy "trucks_insert" on public.food_trucks
  for insert to authenticated
  with check (status = 'pending' and created_by = auth.uid());

-- Grants (Supabase usually sets these by default; explicit for safety).
grant select, insert on public.events to anon, authenticated;
grant select, insert on public.garage_sales to anon, authenticated;
grant select, insert on public.food_trucks to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: a public bucket for garage-sale photos.
--   * Anyone can VIEW photos (they appear in the public listings).
--   * Only signed-in users can UPLOAD.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('sale-photos', 'sale-photos', true)
on conflict (id) do nothing;

drop policy if exists "sale_photos_read" on storage.objects;
create policy "sale_photos_read" on storage.objects
  for select using (bucket_id = 'sale-photos');

drop policy if exists "sale_photos_upload" on storage.objects;
create policy "sale_photos_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sale-photos');

-- ---------------------------------------------------------------------------
-- Reports: anyone can flag a listing. After 3 reports a listing is auto-hidden
-- (status back to 'pending') so it disappears from the public until you
-- re-review it in the dashboard.
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('event', 'garage_sale', 'food_truck')),
  listing_id uuid not null,
  reason     text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

-- One report per person per listing (stops a single actor report-bombing a
-- listing offline). created_by defaults to auth.uid().
create unique index if not exists reports_one_per_user
  on public.reports (created_by, kind, listing_id);

-- Signed-in users can file a report as themselves; nobody can read them
-- (you review reported listings via the dashboard).
drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports
  for insert to authenticated with check (created_by = auth.uid());

grant insert on public.reports to authenticated;

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
  if cnt >= 3 then
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

drop trigger if exists reports_autohide on public.reports;
create trigger reports_autohide
  after insert on public.reports
  for each row execute function public.hide_if_reported();
