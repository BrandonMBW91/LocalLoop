-- User single-post submissions, 2026-07-23. Server side of the fix; the client
-- change (route insertEvent/insertFoodTruck/insertGarageSale through these RPCs
-- when logged out) ships by OTA.
--
-- In this project the anon (publishable) key cannot INSERT into these tables at
-- all — a permissive RLS policy does not grant it write access, so every anon
-- write goes through a SECURITY DEFINER function like submit_event_source. These
-- mirror that pattern for single posts, forcing source_uid/created_by null.
--
-- The companion change — anon submissions always land 'pending' rather than
-- auto-publishing — is one added line in the authoritative trigger file,
-- supabase/moderate_submission.sql (kept single-source per tests/guards.test.mjs).

create or replace function public.submit_event(
  p_city_id text, p_title text, p_category text, p_emoji text,
  p_start_at timestamptz, p_end_at timestamptz, p_venue text, p_address text,
  p_price text, p_host text, p_description text, p_image_url text
) returns public.events
language plpgsql security definer set search_path to 'public'
as $$
declare r public.events;
begin
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'An event name is required'; end if;
  if p_city_id is null or length(trim(p_city_id)) = 0 then raise exception 'Town is required'; end if;
  if p_start_at is null then raise exception 'A start time is required'; end if;
  if p_image_url is not null and p_image_url !~* '^https?://' then raise exception 'Invalid image link'; end if;
  insert into public.events
    (city_id, title, category, emoji, start_at, end_at, venue, address, price, host,
     featured, description, image_url, source_uid, created_by)
  values
    (trim(p_city_id), left(trim(p_title), 200), coalesce(nullif(trim(p_category), ''), 'Community'),
     p_emoji, p_start_at, p_end_at, left(trim(coalesce(p_venue, '')), 200), nullif(left(trim(p_address), 300), ''),
     nullif(trim(p_price), ''), nullif(left(trim(p_host), 120), ''), false, p_description, p_image_url,
     null, null)
  returning * into r;
  return r;
end;
$$;

create or replace function public.submit_food_truck(
  p_city_id text, p_name text, p_cuisine text, p_date date,
  p_start_time text, p_end_time text, p_location_name text, p_address text,
  p_host text, p_note text, p_image_url text
) returns public.food_trucks
language plpgsql security definer set search_path to 'public'
as $$
declare r public.food_trucks;
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A truck name is required'; end if;
  if p_city_id is null or length(trim(p_city_id)) = 0 then raise exception 'Town is required'; end if;
  if p_date is null then raise exception 'A date is required'; end if;
  if p_image_url is not null and p_image_url !~* '^https?://' then raise exception 'Invalid image link'; end if;
  insert into public.food_trucks
    (city_id, name, cuisine, date, start_time, end_time, location_name, address, host, note,
     image_url, source_uid, created_by)
  values
    (trim(p_city_id), left(trim(p_name), 200), coalesce(nullif(trim(p_cuisine), ''), 'Food truck'),
     p_date, nullif(trim(p_start_time), ''), nullif(trim(p_end_time), ''),
     left(trim(coalesce(p_location_name, '')), 200), nullif(left(trim(p_address), 300), ''),
     nullif(left(trim(p_host), 120), ''), p_note, p_image_url, null, null)
  returning * into r;
  return r;
end;
$$;

create or replace function public.submit_garage_sale(
  p_city_id text, p_title text, p_type text, p_start_date date, p_end_date date,
  p_daily_start text, p_daily_end text, p_address text, p_neighborhood text,
  p_items text[], p_images text[], p_host text, p_note text
) returns public.garage_sales
language plpgsql security definer set search_path to 'public'
as $$
declare r public.garage_sales;
begin
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'A title is required'; end if;
  if p_city_id is null or length(trim(p_city_id)) = 0 then raise exception 'Town is required'; end if;
  if p_start_date is null then raise exception 'A date is required'; end if;
  insert into public.garage_sales
    (city_id, title, type, start_date, end_date, daily_start, daily_end, address, neighborhood,
     items, images, host, note, created_by)
  values
    (trim(p_city_id), left(trim(p_title), 200), coalesce(nullif(trim(p_type), ''), 'Garage Sale'),
     p_start_date, p_end_date, nullif(trim(p_daily_start), ''), nullif(trim(p_daily_end), ''),
     left(trim(coalesce(p_address, '')), 300), nullif(left(trim(p_neighborhood), 120), ''),
     coalesce(p_items, '{}'), coalesce(p_images, '{}'), nullif(left(trim(p_host), 120), ''), p_note, null)
  returning * into r;
  return r;
end;
$$;

grant execute on function public.submit_event(text, text, text, text, timestamptz, timestamptz, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_food_truck(text, text, text, date, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_garage_sale(text, text, text, date, date, text, text, text, text, text[], text[], text, text) to anon, authenticated;

-- Anon may upload the optional listing photo to the public sale-photos bucket. The
-- client only ever uploads image/jpeg under a random name; constrain to .jpg so the
-- bucket cannot be used as general anonymous file hosting.
drop policy if exists sale_photos_upload_anon on storage.objects;
create policy sale_photos_upload_anon on storage.objects
  for insert to anon
  with check (bucket_id = 'sale-photos' and lower(name) like '%.jpg');
