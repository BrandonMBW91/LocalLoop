-- Sponsors hardening (Jul 2026 bug sweep). Idempotent.
--
-- 1) `product` — which Stripe product created the row ('town_sponsor' |
--    'all_region'), so the daily backfill can extend All-Region subscriptions
--    to towns added AFTER purchase.
-- 2) `paused_reason` — WHY a row is inactive ('payment_failed' | 'canceled' |
--    null = manually paused). invoice.paid may only reactivate nonpayment
--    pauses; it used to silently un-pause ads the owner deliberately turned off.
-- 3) Column-level SELECT grants — the old table-wide grant exposed
--    stripe_customer_id / stripe_subscription_id / stripe_session_id and
--    impression/click counts to anyone holding the app's public anon key.
--    anon sees only display columns; authenticated (admin screens) adds the
--    metrics; NOBODY client-side sees Stripe identifiers (service role bypasses
--    grants, so the webhook is unaffected).
alter table public.sponsors add column if not exists product text;
alter table public.sponsors add column if not exists paused_reason text;

revoke select on public.sponsors from anon, authenticated;
grant select (id, city_id, title, body, image_url, link_url, weight, active, starts_at, ends_at)
  on public.sponsors to anon;
grant select (id, city_id, title, body, image_url, link_url, weight, active, starts_at, ends_at,
              created_at, impressions, clicks, product, paused_reason)
  on public.sponsors to authenticated;
