-- Deals column-level hardening (mirrors sponsors_hardening.sql). deals_selfserve.sql
-- (#6) added stripe_customer_id / stripe_subscription_id / stripe_session_id /
-- paused_reason, but deals.sql grants anon a WHOLE-TABLE select, so those Stripe
-- identifiers are readable by the public anon key (the app's embedded key). Restrict
-- anon + authenticated to display columns only; the webhook uses the service role
-- and is unaffected. deals is currently empty, so nothing is exposed yet, but the
-- first paid self-serve deal would otherwise make its Stripe ids world-readable.
--
-- COUPLED WITH THE OTA: src/lib/db.js fetchDeals/fetchAllDeals must select an
-- explicit column list (not '*'), or they 401 after this revoke. Apply this at
-- deploy, close to the eas update that ships the db.js change (deals is empty, so
-- the skew window is low-risk, but keep it tight). Do NOT apply while the batch is
-- still held — it would 401 the currently-deployed build's deals fetch.

revoke select on public.deals from anon, authenticated;

grant select (id, city_id, business_name, title, description, address, link_url, image_url,
              active, featured, starts_at, ends_at, view_count, created_at)
  on public.deals to anon;

grant select (id, city_id, business_name, title, description, address, link_url, image_url,
              active, featured, starts_at, ends_at, view_count, created_at, paused_reason)
  on public.deals to authenticated;
