-- ============================================================================
-- Account deletion — App Store Guideline 5.1.1(v). Run in the Supabase SQL Editor.
-- A signed-in user permanently deletes their OWN account plus the content they
-- submitted. SECURITY DEFINER so it can remove the auth.users row; every delete
-- is scoped to auth.uid(), so a user can only ever delete themselves. Idempotent.
-- ============================================================================
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.reports      where created_by = uid;
  delete from public.events       where created_by = uid;
  delete from public.garage_sales where created_by = uid;
  delete from public.food_trucks  where created_by = uid;
  delete from public.push_tokens  where user_id = uid;
  delete from auth.users          where id = uid;  -- cascades sessions/identities
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
