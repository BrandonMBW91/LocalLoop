-- ============================================================================
-- Push notification device tokens (for the weekly "what's on this weekend"
-- digest). Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique,
  city_id    text,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  platform   text,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

-- A device can register / refresh its own token (upsert by token). We don't read
-- these from the client — only the digest job (service role) does.
drop policy if exists "push_insert" on public.push_tokens;
create policy "push_insert" on public.push_tokens
  for insert to anon, authenticated with check (true);

drop policy if exists "push_update" on public.push_tokens;
create policy "push_update" on public.push_tokens
  for update to anon, authenticated using (true) with check (true);

drop policy if exists "push_admin_read" on public.push_tokens;
create policy "push_admin_read" on public.push_tokens
  for select to authenticated using (public.is_admin());

grant insert, update on public.push_tokens to anon, authenticated;
grant select on public.push_tokens to authenticated;
