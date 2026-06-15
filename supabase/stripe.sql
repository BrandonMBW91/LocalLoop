-- ============================================================================
-- Stripe linkage for self-serve ads. Run in the Supabase SQL Editor.
-- Lets the webhook tie a sponsor row to its Stripe subscription so it can be
-- auto-deactivated when the business cancels or a payment fails. Safe to re-run.
-- ============================================================================

alter table public.sponsors add column if not exists stripe_customer_id     text;
alter table public.sponsors add column if not exists stripe_subscription_id text;

create index if not exists sponsors_stripe_sub_idx
  on public.sponsors (stripe_subscription_id);
