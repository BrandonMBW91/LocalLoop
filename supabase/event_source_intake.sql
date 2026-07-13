-- Self-serve EVENT calendar intake (Jul 2026). An organizer pastes their Google
-- Calendar / website iCal link in the app; it lands as a PENDING, disabled
-- event_sources row that the aggregator (aggregate.mjs reads enabled=true) will
-- NOT pull until an admin approves it. Mirrors the hardened self-serve truck
-- intake (submit_truck_calendar), so an anonymous caller cannot register an
-- attacker-controlled feed that auto-pulls. event_sources stays service-role
-- locked (revoke all from anon in hardening_2026_07.sql) -- the only client path
-- in is this SECURITY DEFINER RPC, which can only create its own pending row.

-- Provenance / moderation columns. Existing admin-seeded rows become 'approved'
-- (they are already enabled=true), so they keep pulling unchanged.
alter table public.event_sources add column if not exists status text not null default 'approved';
alter table public.event_sources add column if not exists submitted_contact text;

-- Public submit: registers an event calendar as PENDING + DISABLED for admin
-- review. Validated + de-duped on url. Runs as the definer so it bypasses the
-- table's revoke, but it can ONLY insert its own row with controlled columns.
create or replace function public.submit_event_source(
  p_name text, p_city text, p_url text, p_category text, p_contact text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'A calendar name is required'; end if;
  if p_city is null or length(trim(p_city)) = 0 then raise exception 'Town is required'; end if;
  if p_url is null or p_url !~* '^https?://' then raise exception 'Calendar link must start with http'; end if;
  if length(p_url) > 500 then raise exception 'Calendar link is too long'; end if;
  -- Already registered (any status) -> no-op, so a double tap can't create dupes.
  if exists (select 1 from public.event_sources where url = trim(p_url)) then return; end if;
  insert into public.event_sources (city_id, name, url, type, default_category, submitted_contact, enabled, status)
  values (
    trim(p_city),
    left(trim(p_name), 120),
    trim(p_url),
    'ical',
    coalesce(nullif(trim(p_category), ''), 'Community'),
    nullif(left(trim(p_contact), 200), ''),
    false, 'pending'
  );
end;
$$;
revoke all on function public.submit_event_source(text, text, text, text, text) from public;
grant execute on function public.submit_event_source(text, text, text, text, text) to anon, authenticated;

-- Admin-only: list pending submissions (service-role-locked table, so the admin
-- app reads them through this is_admin()-gated definer function).
create or replace function public.admin_pending_event_sources()
returns setof public.event_sources
language sql
security definer
set search_path = public
as $$
  select * from public.event_sources
  where status = 'pending' and public.is_admin()
  order by created_at desc
$$;
revoke all on function public.admin_pending_event_sources() from public;
grant execute on function public.admin_pending_event_sources() to authenticated;

-- Admin-only: approve (enable) or reject (delete) a pending event calendar.
create or replace function public.admin_set_event_source(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_approve then
    update public.event_sources set enabled = true, status = 'approved' where id = p_id;
  else
    delete from public.event_sources where id = p_id and status = 'pending';
  end if;
end;
$$;
revoke all on function public.admin_set_event_source(uuid, boolean) from public;
grant execute on function public.admin_set_event_source(uuid, boolean) to authenticated;
