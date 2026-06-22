-- ============================================================================
-- Launch audit fixes (from the 2026-06-19 multi-agent security/correctness audit).
-- Run ONCE in the Supabase SQL Editor. Idempotent and safe to re-run.
-- Nothing here is launch-blocking, but it closes the confirmed real findings.
-- ============================================================================

-- 1) push_tokens: stop OPEN anon writes. The old policy `push_update ... using(true)`
--    let anyone holding the public anon key UPDATE any device's token row (corrupt
--    digest targeting). Mirror device_activity: revoke client DML and route
--    registration through a SECURITY DEFINER function. The app already calls
--    supabase.rpc('register_push_token', ...).
drop policy if exists "push_insert" on public.push_tokens;
drop policy if exists "push_update" on public.push_tokens;
revoke insert, update on public.push_tokens from anon, authenticated;

create or replace function public.register_push_token(p_token text, p_city text, p_platform text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_tokens (token, city_id, platform, updated_at)
  values (p_token, p_city, p_platform, now())
  on conflict (token) do update
    set city_id = excluded.city_id, platform = excluded.platform, updated_at = now();
$$;
grant execute on function public.register_push_token(text, text, text) to anon, authenticated;

-- 2) hide_if_reported: pin search_path on this SECURITY DEFINER trigger
--    (un-pinned search_path on a definer function is a privilege-escalation vector).
--    Body is unchanged from security_hardening.sql.
create or replace function public.hide_if_reported()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare cnt int;
begin
  select count(*) into cnt
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
$$;

-- 3) moderate_submission: pin search_path. LOGIC UNCHANGED from aggregator.sql
--    (admins publish instantly; the aggregator/service role auto-publishes feed
--    events; signed-in users are screened and cannot self-approve or set source_uid).
create or replace function public.moderate_submission()
returns trigger
language plpgsql
set search_path = public
as $$
declare content text;
begin
  if public.is_admin() then
    NEW.status := 'approved';
    return NEW;
  end if;

  if TG_TABLE_NAME = 'events' then
    if auth.uid() is null then
      NEW.status := 'approved';
      return NEW;
    end if;
    NEW.source_uid := null;
    content := lower(concat_ws(' ', NEW.title, NEW.description, NEW.venue, NEW.address));
  elsif TG_TABLE_NAME = 'garage_sales' then
    content := lower(concat_ws(' ', NEW.title, NEW.note, NEW.address));
  elsif TG_TABLE_NAME = 'food_trucks' then
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
$$;

-- 4) sponsors: make the Stripe webhook insert idempotent against Stripe's retries
--    and replays (the webhook now upserts on stripe_session_id + city_id). NULLs
--    on existing rows are treated as distinct, so this does not affect current data.
alter table public.sponsors add column if not exists stripe_session_id text;
create unique index if not exists sponsors_stripe_session_city_uniq
  on public.sponsors (stripe_session_id, city_id);

-- 5) Least-privilege: events/garage_sales/food_trucks GRANT insert to anon but
--    have NO anon insert policy (RLS already denies it). Drop the unused grant so
--    the only path to an events insert with a null uid is the service role. No
--    functional change for the app (authenticated users keep their grant+policy).
revoke insert on public.events, public.garage_sales, public.food_trucks from anon;
