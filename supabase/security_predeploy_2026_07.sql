-- !! SUPERSEDED IN PART BY supabase/metrics_exclusions.sql (2026-07-21) !!
-- The active-user function(s) defined below now read the human_activity VIEW, not the
-- device_activity table, so that bot-minted and owner devices stay out of every MAU
-- number (MAU sets ad pricing and is the ad experiment metric). The definition kept
-- here is the PRE-fix one. Re-applying this file as-is would silently revert the
-- exclusion and quietly re-inflate pricing. Apply metrics_exclusions.sql after it.
-- Pre-deploy security hardening from the whole-app review (2026-07). Additive /
-- tightening only, independent of the held feature batch. Applied to prod.

-- (1) reports: deploy the admin read/delete policies that moderation.sql defines but
-- that never reached prod, so the admin "Reported" panel actually works (fetchReported
-- was returning [] and dismissReports deleting 0 rows for everyone, admin included).
drop policy if exists "reports_admin_read" on public.reports;
create policy "reports_admin_read" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "reports_admin_delete" on public.reports;
create policy "reports_admin_delete" on public.reports for delete to authenticated using (public.is_admin());
grant select, delete on public.reports to authenticated;

-- (2) reports: one report per (kind, listing_id) per user, so the >=5-report auto-hide
-- trigger counts DISTINCT reporters (one signed-in user could otherwise trip it alone).
create unique index if not exists reports_one_per_user on public.reports (kind, listing_id, created_by);

-- (3) platform_split: admin-only. It is SECURITY DEFINER over the private
-- device_activity table but had no is_admin() guard, so any signed-in user could read
-- aggregate platform counts. Convert to plpgsql to raise like the other admin RPCs.
create or replace function public.platform_split(p_city text default null)
returns table(platform text, users integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select coalesce(da.platform, 'unknown'), count(*)::int
    from public.device_activity da
    where da.last_seen > now() - interval '30 days'
      and (p_city is null or da.city_id = p_city)
    group by 1;
end;
$$;

-- (4) Least privilege: anon needs only SELECT on deals + editor_picks; the anon
-- INSERT/UPDATE/DELETE grants were unnecessary surface with RLS as the sole backstop.
revoke insert, update, delete, truncate on public.deals from anon;
revoke insert, update, delete, truncate on public.editor_picks from anon;

-- (5) Reconcile prod with the repo: these admin definer RPCs are authenticated-only in
-- the .sql files but were execute-granted to anon in prod. Harmless (each raises
-- 'not authorized' internally) but tighten anyway.
revoke execute on function public.set_featured(text, uuid, timestamptz) from anon;
revoke execute on function public.admin_set_truck_calendar(uuid, boolean) from anon;
revoke execute on function public.admin_pending_truck_calendars() from anon;
