-- Cross-platform app config the app reads at runtime. Currently holds the update-
-- prompt version gate (iOS + Android), so a NEW store build can be announced to users
-- on either platform by editing ONE row — no code change, no OTA. Public read; only
-- service role / admin writes.
--
-- To announce a new build: bump the platform's "latest" (soft, dismissible prompt) or
-- "min" (forced prompt) to the just-published store version, e.g.
--   update public.app_config set value = jsonb_set(value, '{android,latest}', '"1.0.4"'), updated_at = now() where key = 'version';
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);
grant select on public.app_config to anon, authenticated;

-- Seed the version gate at the CURRENT store version (1.0.3), so nothing prompts until
-- you raise "latest"/"min" after publishing a newer build. do nothing on conflict so a
-- re-run never clobbers values you've since edited.
insert into public.app_config (key, value) values (
  'version',
  jsonb_build_object(
    'ios', jsonb_build_object('latest', '1.0.3', 'min', '1.0.0', 'url', 'https://apps.apple.com/app/id6780306721'),
    'android', jsonb_build_object('latest', '1.0.3', 'min', '1.0.0', 'url', 'https://play.google.com/store/apps/details?id=com.michaelwilliams.localloop')
  )
) on conflict (key) do nothing;
