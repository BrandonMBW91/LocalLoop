-- Security fixes from the 2026-07-11 adversarial hardening audit. All confirmed
-- exploitable on the live DB before this migration.

-- =====================================================================
-- 1) MODERATION-FILTER BYPASS (critical). An authenticated user could POST an
-- event/food_truck with a client-set source_uid; the moderate_submission trigger
-- auto-approved any source_uid row with no caller check, so attacker content went
-- live app-wide and onto the indexed SEO pages, skipping the content filter.
-- Fix: block anon/authenticated from setting source_uid at all (only the
-- service-role aggregator does), AND gate the trigger's auto-approve on the
-- service role as defense in depth.
-- =====================================================================
alter policy events_insert on public.events
  with check (created_by = auth.uid() and source_uid is null);
alter policy trucks_insert on public.food_trucks
  with check (created_by = auth.uid() and source_uid is null);

create or replace function public.moderate_submission()
 returns trigger
 language plpgsql
as $function$
declare content text;
begin
  if public.is_admin() then
    NEW.status := 'approved';
    return NEW;
  end if;

  -- Auto-approve trusted-source rows ONLY when the insert comes from the
  -- service-role aggregator. An authenticated user who sets source_uid themselves
  -- must NOT skip the content filter below (security fix 2026-07-11).
  if TG_TABLE_NAME in ('events', 'food_trucks') then
    if NEW.source_uid is not null and auth.role() = 'service_role' then
      NEW.status := 'approved';
      return NEW;
    end if;
  end if;

  if TG_TABLE_NAME = 'events' then
    NEW.title := left(NEW.title, 200);
    NEW.description := left(NEW.description, 5000);
    NEW.venue := left(NEW.venue, 200);
    NEW.address := left(NEW.address, 300);
    NEW.host := left(NEW.host, 120);
    content := lower(concat_ws(' ', NEW.title, NEW.description, NEW.venue, NEW.address));
  elsif TG_TABLE_NAME = 'garage_sales' then
    NEW.title := left(NEW.title, 200);
    NEW.note := left(NEW.note, 5000);
    NEW.address := left(NEW.address, 300);
    NEW.neighborhood := left(NEW.neighborhood, 120);
    content := lower(concat_ws(' ', NEW.title, NEW.note, NEW.address));
  elsif TG_TABLE_NAME = 'food_trucks' then
    NEW.name := left(NEW.name, 200);
    NEW.note := left(NEW.note, 5000);
    NEW.location_name := left(NEW.location_name, 200);
    NEW.address := left(NEW.address, 300);
    NEW.cuisine := left(NEW.cuisine, 80);
    content := lower(concat_ws(' ', NEW.name, NEW.note, NEW.location_name, NEW.address));
  else
    content := '';
  end if;

  if content ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|info|biz|xyz|shop|io))'
     or content ~ '(\+?\d[ .\-]?){10,}'
     or content ~* '\m(fuck|shit|bitch|asshole|cunt|nigger|faggot|slut|whore|retard)\M'
     or content ~* '(make money|free money|work from home|crypto|bitcoin|viagra|casino|click here|get rich|buy now|limited offer)'
  then
    NEW.status := 'pending';
  else
    NEW.status := 'approved';
  end if;

  return NEW;
end;
$function$;

-- =====================================================================
-- 2) REPORT-BOMB STATEWIDE TAKEDOWN (high). reports_insert was WITH CHECK true for
-- anon+authenticated with a nullable created_by, and hide_if_reported tripped on
-- count(*) >= 5 -- so one account could forge 5 reports (created_by null / random)
-- and flip ANY approved listing (incl. paid ads) to pending, across all towns.
-- Fix: a reporter can only report AS themselves (authenticated), created_by is
-- required, and auto-hide needs 5 DISTINCT reporters.
-- =====================================================================
alter policy reports_insert on public.reports
  to authenticated
  with check (created_by = auth.uid());
alter table public.reports alter column created_by set not null;

create or replace function public.hide_if_reported()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cnt int;
begin
  select count(distinct created_by) into cnt
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
$function$;

-- =====================================================================
-- 3) ANON AUTO-APPROVED TRUCK-CALENDAR INJECTION (high). submit_truck_calendar
-- (SECURITY DEFINER, EXECUTE to anon) inserted enabled=true, status='approved',
-- contradicting its own docs -- an anonymous caller could register an
-- attacker-controlled iCal for any town and the aggregator would auto-pull it.
-- Fix: land submissions pending+disabled for admin review (matches the docs); the
-- aggregator only reads enabled rows, so nothing auto-pulls without approval.
-- =====================================================================
create or replace function public.submit_truck_calendar(p_name text, p_city text, p_cuisine text, p_ical_url text, p_contact text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Truck name is required'; end if;
  if p_city is null or length(trim(p_city)) = 0 then raise exception 'Town is required'; end if;
  if p_ical_url is null or p_ical_url !~* '^https?://' then raise exception 'Calendar link must start with http'; end if;
  if length(p_ical_url) > 500 then raise exception 'Calendar link is too long'; end if;
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
$function$;
