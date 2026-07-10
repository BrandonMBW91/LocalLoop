-- ============================================================================
-- Hardening from the 2026-07-09 statewide-readiness review.
-- Run ONCE in the Supabase SQL Editor (or via the Management API). Idempotent.
--
-- Defense-in-depth: revoke leftover DEFAULT anon grants so the GRANT layer — not
-- only RLS — denies the public anon key on (a) writes to the core content tables
-- and (b) reads of the private tables. The app's admin + user paths all run under
-- the `authenticated` role (see moderation.sql policies), and the private tables
-- are read only by the SERVICE ROLE (edge functions / aggregator) or by the
-- authenticated admin, so nothing here changes app behavior. Verified live:
-- before, anon PATCH/DELETE on events/food_trucks/garage_sales returned 204 and a
-- bogus-column SELECT on the private tables returned 400 (grant present); after,
-- all should return 401.
-- ============================================================================

-- Finding #1 (HIGH): anon held leftover UPDATE/DELETE grants on the content
-- tables. INSERT was already revoked in launch_audit_fixes.sql; no anon write
-- policy exists on these, so RLS denied it — but the grant should deny it too.
-- (SELECT is intentionally kept: the public browses approved rows as anon.)
revoke insert, update, delete, truncate on public.events        from anon;
revoke insert, update, delete, truncate on public.garage_sales  from anon;
revoke insert, update, delete, truncate on public.food_trucks   from anon;

-- Finding #7 (MEDIUM): anon retained default grants on tables the SQL intends to
-- be private. These are read/written ONLY by the service role (edge functions /
-- aggregator) or by the authenticated admin (reports_admin_read); every app write
-- goes through a SECURITY DEFINER RPC (register_push_token, record_device_activity)
-- or the authenticated role (reports_insert). anon needs NOTHING here, so revoke
-- everything — SELECT was the flagged leak, but the leftover INSERT/UPDATE/DELETE/
-- TRUNCATE grants (RLS-blocked today) should not be the last line of defense either.
revoke all on public.push_tokens     from anon;
revoke all on public.device_activity from anon;
revoke all on public.reports         from anon;
revoke all on public.event_sources   from anon;
revoke all on public.spotlight_log   from anon;
