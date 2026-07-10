-- Idempotency for featured_30 purchases — the only product that writes no ad row,
-- so a duplicate Stripe delivery would otherwise email the owner twice (risking a
-- double manual feature). The webhook upserts stripe_session_id here and only emails
-- when the row is new. Service-role only (the webhook); no client access.
create table if not exists public.processed_featured (
  stripe_session_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.processed_featured enable row level security;
revoke all on public.processed_featured from anon, authenticated;
