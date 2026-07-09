-- Jul 2026 audit hardening. Idempotent. Defense-in-depth on the anon key.
--
-- 1) expire_promotions() is a SECURITY DEFINER that does table-wide UPDATEs;
--    anon could call it (HTTP 204). Only the daily job (service_role) and admin
--    screens (authenticated) should. set_featured/delete_account already do this.
revoke execute on function public.expire_promotions() from public, anon;

-- 2) platform_split() returns an admin-only per-town iOS/Android split; the app
--    calls it only from the admin metrics screen. Close it to anon.
revoke execute on function public.platform_split(text) from public, anon;

-- 3) sponsors is the live payments table; every write goes through the webhook's
--    service_role (which bypasses grants). anon holds table-level DML only
--    because of a default grant — RLS blocks it today, but strip the grant so a
--    future policy slip can't expose the revenue table. Keep the column-level
--    SELECT grants from sponsors_hardening.sql intact.
revoke insert, update, delete, truncate, references, trigger on public.sponsors from anon;
