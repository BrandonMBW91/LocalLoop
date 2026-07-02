-- Email the owner when a submission lands in the moderation queue.
-- Fires on INSERT or UPDATE of events / garage_sales / food_trucks whenever the
-- row's status becomes 'pending' (fresh user submissions held by the auto-filter,
-- and live posts auto-hidden by report threshold). Calls the moderation-alert
-- edge function via pg_net with a shared secret.
--
-- BEFORE RUNNING: replace __ALERT_SECRET__ with the CRON_SECRET value
-- (Claude keeps a filled copy out of the repo — ask for it).

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row_j jsonb := to_jsonb(new);
  payload jsonb;
begin
  -- Only when the row just became pending.
  if new.status <> 'pending' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'pending' then return new; end if;

  payload := jsonb_build_object(
    'kind', tg_table_name,
    'title', coalesce(row_j->>'title', row_j->>'name', 'Untitled'),
    'town', coalesce(row_j->>'city_id', ''),
    'start', coalesce(row_j->>'start_at', row_j->>'start_date', row_j->>'date', ''),
    'venue', coalesce(row_j->>'venue', row_j->>'location_name', row_j->>'address', '')
  );

  perform net.http_post(
    url := 'https://wtaefyspddadcrnovumk.supabase.co/functions/v1/moderation-alert',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alert-secret', '__ALERT_SECRET__'
    )
  );
  return new;
end;
$$;

drop trigger if exists moderation_alert on public.events;
create trigger moderation_alert
  after insert or update of status on public.events
  for each row execute function public.notify_moderation();

drop trigger if exists moderation_alert on public.garage_sales;
create trigger moderation_alert
  after insert or update of status on public.garage_sales
  for each row execute function public.notify_moderation();

drop trigger if exists moderation_alert on public.food_trucks;
create trigger moderation_alert
  after insert or update of status on public.food_trucks
  for each row execute function public.notify_moderation();
