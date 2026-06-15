-- ============================================================================
-- Auto-moderation + admin review
-- Run this in the Supabase SQL Editor AFTER schema.sql.
--   * Clean submissions are AUTO-APPROVED (go live instantly).
--   * Suspicious ones are HELD as 'pending' for you to review in the app.
--   * You (the admin) can see pending posts and approve/reject them.
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who is an admin? (You. Change/add emails here.)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = lower('michabw91@gmail.com'), false);
$$;

-- ---------------------------------------------------------------------------
-- Auto-moderator: decides approved vs pending from the submission's text.
-- Runs server-side so the client can never force 'approved'.
-- ---------------------------------------------------------------------------
create or replace function public.moderate_submission()
returns trigger
language plpgsql
as $$
declare content text;
begin
  -- Trusted moderators (you) publish instantly, no holding.
  if public.is_admin() then
    NEW.status := 'approved';
    return NEW;
  end if;

  if TG_TABLE_NAME = 'events' then
    content := lower(concat_ws(' ', NEW.title, NEW.description, NEW.venue, NEW.address));
  elsif TG_TABLE_NAME = 'garage_sales' then
    content := lower(concat_ws(' ', NEW.title, NEW.note, NEW.address));
  elsif TG_TABLE_NAME = 'food_trucks' then
    content := lower(concat_ws(' ', NEW.name, NEW.note, NEW.location_name, NEW.address));
  else
    content := '';
  end if;

  -- Hold for human review if anything looks risky; otherwise auto-approve.
  if content ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|info|biz|xyz|shop|io))'   -- web links
     or content ~ '(\+?\d[ .\-]?){10,}'                                              -- phone numbers
     or content ~* '\m(fuck|shit|bitch|asshole|cunt|nigger|faggot|slut|whore|retard)\M'  -- profanity
     or content ~* '(make money|free money|work from home|crypto|bitcoin|viagra|casino|click here|get rich|buy now|limited offer)' -- spam
  then
    NEW.status := 'pending';
  else
    NEW.status := 'approved';
  end if;

  return NEW;
end;
$$;

drop trigger if exists events_moderate on public.events;
create trigger events_moderate before insert on public.events
  for each row execute function public.moderate_submission();

drop trigger if exists sales_moderate on public.garage_sales;
create trigger sales_moderate before insert on public.garage_sales
  for each row execute function public.moderate_submission();

drop trigger if exists trucks_moderate on public.food_trucks;
create trigger trucks_moderate before insert on public.food_trucks
  for each row execute function public.moderate_submission();

-- ---------------------------------------------------------------------------
-- Policies: drop the old "insert must be pending" rule (the trigger now owns
-- status), let admins read everything, and let admins update (approve/reject).
-- ---------------------------------------------------------------------------

-- EVENTS
drop policy if exists "events_insert" on public.events;
create policy "events_insert" on public.events
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "events_read" on public.events;
create policy "events_read" on public.events
  for select using (status = 'approved' or auth.uid() = created_by or public.is_admin());

drop policy if exists "events_update" on public.events;
create policy "events_update" on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- GARAGE SALES
drop policy if exists "sales_insert" on public.garage_sales;
create policy "sales_insert" on public.garage_sales
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "sales_read" on public.garage_sales;
create policy "sales_read" on public.garage_sales
  for select using (status = 'approved' or auth.uid() = created_by or public.is_admin());

drop policy if exists "sales_update" on public.garage_sales;
create policy "sales_update" on public.garage_sales
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- FOOD TRUCKS
drop policy if exists "trucks_insert" on public.food_trucks;
create policy "trucks_insert" on public.food_trucks
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists "trucks_read" on public.food_trucks;
create policy "trucks_read" on public.food_trucks
  for select using (status = 'approved' or auth.uid() = created_by or public.is_admin());

drop policy if exists "trucks_update" on public.food_trucks;
create policy "trucks_update" on public.food_trucks
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant update on public.events, public.garage_sales, public.food_trucks to authenticated;

-- ---------------------------------------------------------------------------
-- REPORTS: let the admin read all reports (to surface flagged posts in the
-- moderation screen) and delete them (to clear a report once handled).
-- Regular users keep their insert-only access from schema.sql.
-- ---------------------------------------------------------------------------
drop policy if exists "reports_admin_read" on public.reports;
create policy "reports_admin_read" on public.reports
  for select to authenticated using (public.is_admin());

drop policy if exists "reports_admin_delete" on public.reports;
create policy "reports_admin_delete" on public.reports
  for delete to authenticated using (public.is_admin());

grant select, delete on public.reports to authenticated;
