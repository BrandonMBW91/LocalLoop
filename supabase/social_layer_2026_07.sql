-- Social / engagement layer (Jul 2026): truck follows (#1), event RSVPs (#4),
-- and business claims (#7). All additive; anon-safe. Idempotent.
--
-- Convention (matches record_device_activity / register_push_token): tables are
-- service-role-only; ALL client writes go through SECURITY DEFINER RPCs that take
-- the anon per-install `p_device` id as an argument (the app already has it in
-- AppContext.deviceId). No header-based RLS — the client uses the anon key with
-- no custom headers, so header matching would never resolve.

-- ============ #1  FOLLOW A TRUCK ============
-- Trucks aren't stable rows (each stop is its own food_trucks row), so a user
-- follows the NAME within a town — how they think of "my truck". When any new
-- stop for that name posts, followers with a push token get pinged.
create table if not exists public.truck_follows (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  truck_name  text not null,
  city_id     text,
  push_token  text,
  created_at  timestamptz not null default now()
);
alter table public.truck_follows enable row level security;
revoke all on public.truck_follows from anon, authenticated;   -- RPC-only
-- One follow per device per truck name (case-insensitive) — expression uniqueness
-- must be an index, not a table constraint.
create unique index if not exists truck_follows_device_name_uniq
  on public.truck_follows (device_id, lower(truck_name));
create index if not exists truck_follows_name_idx on public.truck_follows (lower(truck_name), city_id);
create index if not exists truck_follows_device_idx on public.truck_follows (device_id);

-- Toggle follow on/off; returns the new state (true = now following).
create or replace function public.toggle_truck_follow(
  p_device text, p_name text, p_city text, p_token text default null
) returns boolean language plpgsql security definer
set search_path = public as $$
declare existing uuid;
begin
  if p_device is null or p_name is null or length(trim(p_name)) = 0 then
    raise exception 'device and truck name required';
  end if;
  select id into existing from public.truck_follows
    where device_id = p_device and lower(truck_name) = lower(p_name);
  if existing is not null then
    delete from public.truck_follows where id = existing;
    return false;
  end if;
  insert into public.truck_follows (device_id, truck_name, city_id, push_token)
    values (p_device, left(trim(p_name),120), p_city, p_token);
  return true;
end $$;
grant execute on function public.toggle_truck_follow(text,text,text,text) to anon, authenticated;

-- The names a device follows (so the app can show the Following state + filter).
create or replace function public.my_truck_follows(p_device text)
returns table(truck_name text, city_id text) language sql security definer stable
set search_path = public as $$
  select truck_name, city_id from public.truck_follows where device_id = p_device;
$$;
grant execute on function public.my_truck_follows(text) to anon, authenticated;

-- Public follower count for a truck name (card can show "42 following").
create or replace function public.truck_follower_count(p_name text, p_city text default null)
returns integer language sql security definer stable
set search_path = public as $$
  select count(*)::int from public.truck_follows
   where lower(truck_name) = lower(p_name) and (p_city is null or city_id = p_city);
$$;
grant execute on function public.truck_follower_count(text, text) to anon, authenticated;

-- ============ #4  "I'M GOING" RSVP ============
create table if not exists public.event_rsvps (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'event',   -- event | garage_sale | food_truck
  listing_id  uuid not null,
  device_id   text not null,
  created_at  timestamptz not null default now(),
  unique (kind, listing_id, device_id)
);
alter table public.event_rsvps enable row level security;
revoke all on public.event_rsvps from anon, authenticated;   -- RPC-only

create index if not exists rsvp_listing_idx on public.event_rsvps (kind, listing_id);
create index if not exists rsvp_device_idx on public.event_rsvps (device_id);

-- Toggle going/not-going; returns new count so the UI updates in one round-trip.
create or replace function public.toggle_rsvp(p_kind text, p_id uuid, p_device text)
returns integer language plpgsql security definer
set search_path = public as $$
declare existing uuid; total int;
begin
  if p_device is null or p_id is null then raise exception 'id and device required'; end if;
  select id into existing from public.event_rsvps
    where kind = p_kind and listing_id = p_id and device_id = p_device;
  if existing is not null then delete from public.event_rsvps where id = existing;
  else insert into public.event_rsvps (kind, listing_id, device_id) values (p_kind, p_id, p_device);
  end if;
  select count(*)::int into total from public.event_rsvps where kind = p_kind and listing_id = p_id;
  return total;
end $$;
grant execute on function public.toggle_rsvp(text, uuid, text) to anon, authenticated;

-- Batch counts + which of these the device is going to (one call per feed load).
create or replace function public.rsvp_counts(p_kind text, p_ids uuid[], p_device text default null)
returns table(listing_id uuid, n integer, mine boolean) language sql security definer stable
set search_path = public as $$
  select r.listing_id, count(*)::int,
         bool_or(p_device is not null and r.device_id = p_device)
    from public.event_rsvps r
   where r.kind = p_kind and r.listing_id = any(p_ids)
   group by r.listing_id;
$$;
grant execute on function public.rsvp_counts(text, uuid[], text) to anon, authenticated;

-- ============ #7  CLAIM A BUSINESS / LISTING ============
create table if not exists public.business_claims (
  id            uuid primary key default gen_random_uuid(),
  business_name text not null,
  city_id       text,
  kind          text,              -- venue | food_truck | organizer
  contact_name  text,
  contact_email text not null,
  contact_phone text,
  note          text,
  device_id     text,
  status        text not null default 'pending',
  created_at    timestamptz not null default now()
);
alter table public.business_claims enable row level security;
revoke all on public.business_claims from anon, authenticated;   -- RPC-only

create or replace function public.submit_business_claim(
  p_name text, p_city text, p_kind text, p_contact_name text,
  p_email text, p_phone text, p_note text, p_device text
) returns uuid language plpgsql security definer
set search_path = public as $$
declare new_id uuid;
begin
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'business name required'; end if;
  if p_email is null or p_email !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
    then raise exception 'valid email required'; end if;
  insert into public.business_claims
    (business_name, city_id, kind, contact_name, contact_email, contact_phone, note, device_id)
  values (left(trim(p_name),120), p_city, p_kind, left(coalesce(p_contact_name,''),80),
          lower(trim(p_email)), left(coalesce(p_phone,''),30), left(coalesce(p_note,''),500), p_device)
  returning id into new_id;
  return new_id;
end $$;
grant execute on function public.submit_business_claim(text,text,text,text,text,text,text,text) to anon, authenticated;
