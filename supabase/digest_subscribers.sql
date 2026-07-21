-- Weekly email digest subscribers (the web return path).
--
-- WHY THIS EXISTS: push is native-only (getPushToken bails on !Device.isDevice),
-- so the Friday weekend-digest push reaches ~52 of ~870 users and NONE of the ~570
-- on web. Those visitors currently have no way to be reminded the app exists. This
-- table backs an opt-in weekly email so every user, on any platform, has a way back.
--
-- SECURITY POSTURE, and why it differs from push_tokens:
-- push_tokens lets `anon` insert directly because a push token is not PII and is
-- useless to an attacker. An EMAIL ADDRESS is different on both counts:
--   1. anon SELECT would leak the whole subscriber list, so anon gets no read at all.
--   2. a publicly-writable insert is an email-bombing vector: an attacker submits a
--      victim's address repeatedly and WE send the confirmations. So there are no
--      anon policies at all here. Every write goes through the digest-subscribe edge
--      function (service role), which validates the address and throttles resends.
-- Net: service role only, plus an admin read for the dashboard.
create table if not exists public.digest_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  city_id text not null,
  interests text[] not null default '{}',
  -- pending  = signed up, confirmation email sent, NOT yet mailable
  -- confirmed = double opt-in complete, receives the weekly digest
  -- unsubscribed = one-click opt-out; never mail again, keep the row so a re-signup
  --                is a deliberate act and we retain proof of the opt-out (CAN-SPAM)
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'unsubscribed')),
  -- Unguessable secret in the confirm/unsubscribe links. Must be unguessable because
  -- possessing it is the ONLY authorization those endpoints require (an email link
  -- cannot carry a session).
  token text not null default encode(gen_random_bytes(24), 'hex'),
  source text not null default 'web',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  -- Throttles confirmation resends so re-submitting the form cannot be used to
  -- repeatedly mail an address.
  last_confirm_sent_at timestamptz,
  last_sent_at timestamptz
);

-- One row per address. Prevents duplicate sends (which hurt deliverability) and makes
-- the edge function's re-signup path a clean upsert: same person, new town.
create unique index if not exists digest_subscribers_email_key
  on public.digest_subscribers (lower(email));
-- The Friday send groups by town and only mails confirmed rows.
create index if not exists digest_subscribers_send_idx
  on public.digest_subscribers (city_id) where status = 'confirmed';
-- Confirm/unsubscribe look up strictly by token.
create unique index if not exists digest_subscribers_token_key
  on public.digest_subscribers (token);

alter table public.digest_subscribers enable row level security;

-- Revoke BEFORE granting: a stray default privilege on public/anon would otherwise
-- survive and expose the subscriber list.
revoke all on public.digest_subscribers from public, anon;

-- Defensive, and it must come AFTER the revoke: revoking from the PUBLIC pseudo-role
-- can strip privileges other roles inherit through it. service_role bypasses RLS but
-- still needs a table GRANT, and if it ever lost one the digest sender would 401 and
-- mail nobody, silently. Granting explicitly makes that impossible to regress.
grant all on public.digest_subscribers to service_role;

-- No anon policy at all (see the posture note above). Admins may read for support.
drop policy if exists "digest_admin_read" on public.digest_subscribers;
create policy "digest_admin_read" on public.digest_subscribers
  for select to authenticated using (public.is_admin());
grant select on public.digest_subscribers to authenticated;
