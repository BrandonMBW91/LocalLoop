-- Let a signed-in poster edit their OWN event / garage sale / food truck.
--
-- Why RPCs and not an RLS update policy: RLS is row-level, so a plain
-- "using (created_by = auth.uid())" update policy would also let the owner set
-- status='approved' (self-approving past moderation) or featured=true (free paid
-- promotion). These SECURITY DEFINER functions take ONLY the editable fields, so
-- status / featured / created_by / source_uid can never be touched by a caller.
--
-- Every edit returns the row to 'pending'. Otherwise the obvious abuse is: post
-- something harmless, get approved, then edit it into spam that is already live.
-- Michael sees edits in the same moderation queue as new posts.
--
-- Feed rows (source_uid not null) are never editable by anyone here: the nightly
-- aggregator owns them and would clobber the edit anyway.
--
-- Idempotent; run once.

create or replace function public.update_own_event(
  p_id uuid,
  p_title text,
  p_category text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_venue text,
  p_address text,
  p_price text,
  p_description text,
  p_image_url text default null
) returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.events;
begin
  update public.events set
    title = left(coalesce(nullif(btrim(p_title), ''), title), 200),
    category = coalesce(nullif(btrim(p_category), ''), category),
    start_at = coalesce(p_start_at, start_at),
    end_at = p_end_at,
    venue = left(coalesce(p_venue, ''), 300),
    address = left(coalesce(p_address, ''), 300),
    price = left(coalesce(nullif(btrim(p_price), ''), 'See details'), 60),
    description = left(coalesce(p_description, ''), 4000),
    image_url = coalesce(p_image_url, image_url),
    status = 'pending'          -- re-moderate: an approved post must not be editable into spam
  where id = p_id
    and created_by = auth.uid() -- ownership; null auth.uid() matches nothing
    and source_uid is null      -- never let a user edit an aggregator row
  returning * into r;

  if r.id is null then
    raise exception 'not your listing, or it is not editable';
  end if;
  return r;
end;
$$;

create or replace function public.update_own_garage_sale(
  p_id uuid,
  p_title text,
  p_type text,
  p_start_date date,
  p_end_date date,
  p_daily_start text,
  p_daily_end text,
  p_address text,
  p_neighborhood text,
  p_note text
) returns public.garage_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.garage_sales;
begin
  update public.garage_sales set
    title = left(coalesce(nullif(btrim(p_title), ''), title), 200),
    type = coalesce(nullif(btrim(p_type), ''), type),
    start_date = coalesce(p_start_date, start_date),
    end_date = p_end_date,
    daily_start = left(coalesce(p_daily_start, ''), 20),
    daily_end = left(coalesce(p_daily_end, ''), 20),
    address = left(coalesce(nullif(btrim(p_address), ''), address), 300),
    neighborhood = left(coalesce(p_neighborhood, ''), 120),
    note = left(coalesce(p_note, ''), 2000),
    status = 'pending'
  where id = p_id
    and created_by = auth.uid()
  -- no source_uid guard: garage_sales has no such column (sales are only ever
  -- user-submitted, never aggregated), so ownership alone is the gate.
  returning * into r;

  if r.id is null then
    raise exception 'not your listing, or it is not editable';
  end if;
  return r;
end;
$$;

create or replace function public.update_own_food_truck(
  p_id uuid,
  p_name text,
  p_cuisine text,
  p_date date,
  p_start_time text,
  p_end_time text,
  p_location_name text,
  p_address text,
  p_note text
) returns public.food_trucks
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.food_trucks;
begin
  update public.food_trucks set
    name = left(coalesce(nullif(btrim(p_name), ''), name), 200),
    cuisine = coalesce(nullif(btrim(p_cuisine), ''), cuisine),
    date = coalesce(p_date, date),
    start_time = left(coalesce(p_start_time, ''), 20),
    end_time = left(coalesce(p_end_time, ''), 20),
    location_name = left(coalesce(p_location_name, ''), 300),
    address = left(coalesce(p_address, ''), 300),
    note = left(coalesce(p_note, ''), 2000),
    status = 'pending'
  where id = p_id
    and created_by = auth.uid()
    and source_uid is null
  returning * into r;

  if r.id is null then
    raise exception 'not your listing, or it is not editable';
  end if;
  return r;
end;
$$;

-- Owners must be signed in. Postgres grants EXECUTE to PUBLIC on every new
-- function, so granting to `authenticated` alone changes nothing — anon keeps
-- the inherited grant. Revoke PUBLIC first, THEN grant. (It was already safe in
-- practice: auth.uid() is null for anon, so the ownership check matched no row.
-- This just closes the surface.)
revoke execute on function public.update_own_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_event(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text) to authenticated;
revoke execute on function public.update_own_garage_sale(uuid, text, text, date, date, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_garage_sale(uuid, text, text, date, date, text, text, text, text, text) to authenticated;
revoke execute on function public.update_own_food_truck(uuid, text, text, date, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_food_truck(uuid, text, text, date, text, text, text, text, text) to authenticated;
