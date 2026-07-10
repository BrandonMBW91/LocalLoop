-- Personalized push (big-ticket #3). Store each device's chosen interest
-- categories so the weekend digest can prioritize what they care about, and add a
-- 4-arg registrar overload (the 3-arg one stays valid for older app builds, so
-- OTA order never matters). Additive + idempotent.
alter table public.push_tokens add column if not exists interests text[];

create or replace function public.register_push_token(p_token text, p_city text, p_platform text, p_interests text[])
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_tokens (token, city_id, platform, interests, updated_at)
  values (p_token, p_city, p_platform, p_interests, now())
  on conflict (token) do update
    set city_id = excluded.city_id, platform = excluded.platform, interests = excluded.interests, updated_at = now();
$$;
grant execute on function public.register_push_token(text, text, text, text[]) to anon, authenticated;
