-- Stop a signed-in user from self-granting the paid Featured slot.
--
-- THE HOLE: `featured` / `featured_until` are ordinary columns on events,
-- garage_sales and food_trucks, and anon/authenticated hold table-wide INSERT. The
-- anon key ships compiled into the client bundle (EXPO_PUBLIC_), so anyone with a
-- free account can bypass the app and POST straight to PostgREST:
--
--   POST /rest/v1/events
--   {"city_id":"findlay","title":"Joe's Pizza Grand Opening","category":"Food",
--    "start_at":"2026-08-01T18:00:00Z","venue":"Main St","featured":true}
--
-- The text is clean, so it auto-approves and goes live pinned above every other
-- listing in town with a Featured badge. That is the featured_30 SKU ($25/$35/$49 by
-- tier) taken for free. And PERMANENTLY: omitting featured_until leaves it null, so
-- isFeatured() stays true forever AND expire_promotions() never reaps it, because
-- that job only touches rows `where featured_until is not null`. Repeatable per town,
-- on all three tables.
--
-- Nobody has done it (verified 2026-07-16: zero user-created rows with featured=true
-- and featured_until null). Prevention, not cleanup.
--
-- THE FIX: moderate_submission already runs BEFORE INSERT on all three tables, so
-- clearing the columns there covers every table and every client insert path at once,
-- leaving set_featured() (is_admin()-guarded in its own body) as the only route to a
-- real feature.
--
-- !! READ THIS BEFORE EDITING !!
-- moderate_submission is defined in SIX files in this repo: aggregator.sql,
-- launch_audit_fixes.sql, moderation.sql, moderation_trust_aggregator.sql,
-- security_fixes_2026_07_11.sql and submission_length_caps.sql. NONE of them is
-- authoritative and the file dates do not tell you which was applied last. This body
-- was taken from the LIVE database via pg_get_functiondef, not from any file:
--
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'moderate_submission';
--
-- Do the same before you touch it again. Rebuilding it from moderation.sql would have
-- silently reverted the 2026-07-11 source_uid security fix and every length cap below,
-- reopening the moderation bypass while appearing to fix something else.
--
-- Idempotent. Safe to re-run.

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

  -- Past the branches above the caller is neither an admin nor the aggregator, so it
  -- is a client holding the public anon key. It does not get to hand itself the paid
  -- Featured slot by putting featured=true in the request body. Clearing
  -- featured_until matters just as much: a null there is what made a self-granted
  -- feature permanent and invisible to expire_promotions(). service_role is exempted
  -- so backend/admin scripts keep working.
  -- coalesce, not a bare <>: if auth.role() is ever null, `null <> 'service_role'`
  -- is NULL, Postgres skips the branch, and featured would sail through unchanged --
  -- failing open for precisely the anonymous caller this exists to stop.
  if coalesce(auth.role(), '') <> 'service_role' then
    NEW.featured := false;
    NEW.featured_until := null;
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
