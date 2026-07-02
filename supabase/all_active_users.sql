-- Monthly active users across EVERY town = distinct devices seen anywhere in the
-- last 30 days. Powers the "All towns" view on the admin Metrics screen.
-- device_activity holds one row per device (latest town), so a plain count is
-- already distinct devices — no double-counting across towns.
create or replace function public.all_active_users()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.device_activity
  where last_seen > now() - interval '30 days';
$$;

grant execute on function public.all_active_users() to anon, authenticated;
