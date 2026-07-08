-- Expo push tickets awaiting receipt check (uninstall detection). The weekend
-- digest stores one row per sent push; a follow-up pass (~30 min later) fetches
-- Expo receipts and deletes push_tokens whose receipt says DeviceNotRegistered —
-- the app was uninstalled. Service-role only; no client access. Idempotent.
create table if not exists public.push_tickets (
  ticket_id  text primary key,
  token      text not null,
  created_at timestamptz not null default now()
);
alter table public.push_tickets enable row level security;
revoke all on public.push_tickets from anon, authenticated;
