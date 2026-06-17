-- ============================================================================
-- Editor's Pick — a hand-curated "This Week's Pick" per town, set by the admin
-- and shown at the top of that town's events list. The local human voice.
-- Run in the Supabase SQL Editor. Needs is_admin() from moderation.sql. Re-runnable.
-- ============================================================================

create table if not exists public.editor_picks (
  city_id     text primary key,
  title       text not null,
  note        text,                 -- the personal blurb ("Get there early…")
  detail      text,                 -- when/where line
  link_url    text,                 -- optional outbound link
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.editor_picks enable row level security;

-- Anyone can read the active pick for a town; only the admin can set it.
drop policy if exists "editor_picks_read" on public.editor_picks;
create policy "editor_picks_read" on public.editor_picks
  for select to anon, authenticated using (active);

drop policy if exists "editor_picks_admin" on public.editor_picks;
create policy "editor_picks_admin" on public.editor_picks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.editor_picks to anon, authenticated;
grant insert, update, delete on public.editor_picks to authenticated;
