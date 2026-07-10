-- Self-serve food-truck calendar intake (Jul 2026). A truck owner pastes their
-- Google Calendar / iCal link in the app; it lands as a PENDING row that the
-- aggregator will NOT pull until an admin approves it. truck_calendars stays
-- service-role-locked (revoke all) — the only client path in is this SECURITY
-- DEFINER RPC, which can only create a pending, disabled row. Idempotent.

-- Provenance/moderation columns.
alter table public.truck_calendars add column if not exists status text not null default 'approved';
alter table public.truck_calendars add column if not exists submitted_contact text;

-- Public submit: creates a PENDING (enabled=false) calendar. Validated + de-duped.
-- Runs as the definer so it bypasses the table's revoke, but it can ONLY insert a
-- disabled/pending row — never enable one, never read others.
create or replace function public.submit_truck_calendar(
  p_name text, p_city text, p_cuisine text, p_ical_url text, p_contact text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Truck name is required'; end if;
  if p_city is null or length(trim(p_city)) = 0 then raise exception 'Town is required'; end if;
  if p_ical_url is null or p_ical_url !~* '^https?://' then raise exception 'Calendar link must start with http'; end if;
  if length(p_ical_url) > 500 then raise exception 'Calendar link is too long'; end if;
  -- Already registered (any status) -> no-op, so a double tap can't create dupes.
  if exists (select 1 from public.truck_calendars where ical_url = trim(p_ical_url)) then return; end if;
  insert into public.truck_calendars (name, city_id, cuisine, ical_url, host, submitted_contact, enabled, status)
  values (
    left(trim(p_name), 120), trim(p_city),
    coalesce(nullif(trim(p_cuisine), ''), 'Food truck'),
    trim(p_ical_url),
    left(trim(p_name), 120),
    nullif(left(trim(p_contact), 200), ''),
    false, 'pending'
  );
end;
$$;
revoke all on function public.submit_truck_calendar(text, text, text, text, text) from public;
grant execute on function public.submit_truck_calendar(text, text, text, text, text) to anon, authenticated;

-- Admin-only: list pending submissions (service-role-locked table, so the admin
-- app reads them through this is_admin()-gated definer function).
create or replace function public.admin_pending_truck_calendars()
returns setof public.truck_calendars
language sql
security definer
set search_path = public
as $$
  select * from public.truck_calendars
  where status = 'pending' and public.is_admin()
  order by created_at desc
$$;
revoke all on function public.admin_pending_truck_calendars() from public;
grant execute on function public.admin_pending_truck_calendars() to authenticated;

-- Admin-only: approve (enable) or reject (delete) a pending calendar.
create or replace function public.admin_set_truck_calendar(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_approve then
    update public.truck_calendars set enabled = true, status = 'approved' where id = p_id;
  else
    delete from public.truck_calendars where id = p_id and status = 'pending';
  end if;
end;
$$;
revoke all on function public.admin_set_truck_calendar(uuid, boolean) from public;
grant execute on function public.admin_set_truck_calendar(uuid, boolean) to authenticated;
