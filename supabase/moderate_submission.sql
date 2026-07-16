-- ============================================================================
-- moderate_submission() — THE AUTHORITATIVE DEFINITION. Edit only this file.
-- ============================================================================
--
-- This function is the content-safety gate for ALL user-submitted listings. It is a
-- BEFORE INSERT trigger on events, garage_sales and food_trucks (triggers declared at
-- the bottom of moderation.sql), and it decides three things:
--   1. who publishes instantly vs lands in the moderation queue
--   2. who may hand themselves the paid Featured slot
--   3. the maximum length of every user-writable text field
--
-- WHY THIS FILE EXISTS
-- Until 2026-07-16 this function was defined in SIX files:
--   aggregator.sql · launch_audit_fixes.sql · moderation.sql
--   moderation_trust_aggregator.sql · security_fixes_2026_07_11.sql
--   submission_length_caps.sql
-- None was authoritative, none was dated, and there is no migration runner — the only
-- ordering signal in the repo was file mtime. Each file held a DIFFERENT, older body.
-- Whichever you happened to open looked like the truth.
--
-- That is not theoretical. On 2026-07-16, fixing an unrelated bug, a change was built
-- from moderation.sql's copy. Applying it would have silently REVERTED the 2026-07-11
-- source_uid security fix (reopening the moderation bypass) and all 14 length caps —
-- while appearing to close a lesser hole. It was caught only by dumping the live
-- function and diffing token by token.
--
-- So: the other five files no longer define this function. They point here. If you are
-- reading one of them looking for the moderation logic, this is where it lives.
--
-- BEFORE YOU EDIT, CONFIRM THIS FILE STILL MATCHES PRODUCTION. The database is the
-- real source of truth; this file is only a faithful copy of it:
--
--   select pg_get_functiondef(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'moderate_submission';
--
-- If that output and this file disagree, the database wins. Reconcile before editing,
-- never after.
--
-- HISTORY FOLDED IN HERE (do not remove these without understanding why they exist):
--   2026-07-11  source_uid may only skip the content filter for service_role. An
--               authenticated user setting it themselves was a moderation bypass.
--   2026-07-11  length caps on every user-writable text field.
--   2026-07-16  non-admin, non-service-role callers cannot set featured /
--               featured_until. Both are the paid featured_30 SKU ($25-$49), and a
--               null featured_until is never reaped by expire_promotions(), so a
--               self-granted feature was free AND permanent.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

create or replace function public.moderate_submission()
returns trigger
language plpgsql
as $function$
declare content text;
begin
  -- Trusted moderators (you) publish instantly, no holding.
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
  --
  -- coalesce, not a bare <>: if auth.role() is ever null, `null <> 'service_role'` is
  -- NULL, Postgres skips the branch, and featured sails through unchanged — failing
  -- open for precisely the anonymous caller this exists to stop.
  if coalesce(auth.role(), '') <> 'service_role' then
    NEW.featured := false;
    NEW.featured_until := null;
  end if;

  -- Cap every user-writable text field before it is stored or scanned.
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
$function$;

-- Verify after applying:
--   select 'featured lock'  k, position('coalesce(auth.role()' in pg_get_functiondef(p.oid)) > 0 ok
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='moderate_submission'
--   union all
--   select 'source_uid fix', position('auth.role() = ''service_role''' in pg_get_functiondef(p.oid)) > 0
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='moderate_submission';
