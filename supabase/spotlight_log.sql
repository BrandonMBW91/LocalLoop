-- Log of spotlight push notifications, used by supabase/functions/spotlight to
-- enforce the "no spotlight to the same audience within COOLDOWN_DAYS" guard.
-- Without this table the cooldown SELECT errors and the guard is a no-op, so two
-- spotlights could fire back-to-back to the same town.
create table if not exists public.spotlight_log (
  id uuid primary key default gen_random_uuid(),
  city_id text not null,
  title text,
  body text,
  sent_at timestamptz not null default now()
);

-- Fully private: only the service role (the edge function) reads/writes it.
alter table public.spotlight_log enable row level security;
grant select, insert on public.spotlight_log to service_role;

create index if not exists spotlight_log_city_sent_idx
  on public.spotlight_log (city_id, sent_at desc);
