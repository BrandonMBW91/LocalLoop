-- Self-serve Local Deals ($9/mo micro-SKU, big-ticket #6). A business buys a deal
-- slot via a Stripe Payment Link; the webhook creates the deal row. This adds the
-- subscription plumbing the deals table lacked so the lifecycle matches sponsors:
--   * stripe_* columns to tie a deal to its subscription (cancel -> deactivate)
--   * a unique index on stripe_session_id for idempotency against Stripe retries
-- Additive + idempotent; nothing reads these until the webhook deploys.
alter table public.deals add column if not exists stripe_subscription_id text;
alter table public.deals add column if not exists stripe_customer_id text;
alter table public.deals add column if not exists stripe_session_id text;
-- Mirrors sponsors so the webhook can distinguish a payment-failure pause from an
-- admin-disabled deal, and only reactivate the former on a later paid invoice.
alter table public.deals add column if not exists paused_reason text;

-- NULLs are distinct in a Postgres unique index, so the many admin-created deals
-- (session_id NULL) coexist while paid deals stay idempotent on their session id.
create unique index if not exists deals_stripe_session_uniq on public.deals (stripe_session_id);
