-- RLS audit tidy-ups, 2026-07-23. Hygiene only — the audit found no exploitable
-- hole. Each change is a no-op for real behaviour; it makes the GRANTS and the
-- view definitions state the intent that RLS was already enforcing.
--
-- Context: Local Loop has no anonymous sign-in. Regular users are the `anon`
-- role; only the admin (email OTP) and the App Store reviewer account are ever
-- `authenticated`. So the anon role is the untrusted-attacker surface, and these
-- three tables/views carried privileges wider than anon can actually use.

-- (1) app_config: the client only READS it (the version/update row). Nothing
-- writes it as anon. Strip the stray write grants; keep SELECT.
revoke insert, update, delete, truncate, references, trigger
  on public.app_config from anon;

-- (2) app_events: anon INSERT is already rejected by the row-level policy
-- (verified live: 42501), and the SELECT policy is is_admin()-only, so anon can
-- neither read nor write real rows. Strip every write grant; SELECT is retained
-- only so the two security_invoker views over this table never error if read.
revoke insert, update, delete, truncate, references, trigger
  on public.app_events from anon;

-- (3) human_activity view: make it enforce RLS as the CALLER, matching
-- app_events_daily and app_top_searches (both already security_invoker=on). It
-- reads device_activity, which has RLS; today the view bypasses that as its
-- postgres owner. Its only real callers are SECURITY DEFINER analytics functions
-- that run AS postgres (table owner, so they still bypass RLS and keep working);
-- flipping this on means that if a grant ever leaked, device_activity's RLS would
-- still apply. Defense in depth, no behaviour change.
alter view public.human_activity set (security_invoker = on);
