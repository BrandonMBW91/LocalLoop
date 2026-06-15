-- ============================================================================
-- Analytics — view tracking
-- Run in the Supabase SQL Editor after schema.sql. Safe to re-run.
-- Adds a view counter to each listing + a safe function anyone can call to
-- increment it (so you can show advertisers real reach).
-- ============================================================================

alter table public.events       add column if not exists view_count int not null default 0;
alter table public.garage_sales add column if not exists view_count int not null default 0;
alter table public.food_trucks  add column if not exists view_count int not null default 0;

-- Bump a listing's view count. SECURITY DEFINER so a logged-out viewer can
-- increment it without any update permission — but it can ONLY touch
-- view_count, nothing else.
create or replace function public.bump_view(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind = 'event' then
    update public.events set view_count = view_count + 1 where id = p_id;
  elsif p_kind = 'garage_sale' then
    update public.garage_sales set view_count = view_count + 1 where id = p_id;
  elsif p_kind = 'food_truck' then
    update public.food_trucks set view_count = view_count + 1 where id = p_id;
  end if;
end;
$$;

grant execute on function public.bump_view(text, uuid) to anon, authenticated;
