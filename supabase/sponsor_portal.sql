-- Self-serve advertiser portal (big-ticket #5). An unguessable per-subscription
-- token (set by the webhook, shared across a sub's fanned-out town rows) lets an
-- advertiser set/change their clickable link + headline + business name without the
-- manual "reply to the email" step — which also finally solves the clickable-ad gap
-- (Stripe's 3-field payment-link cap blocked collecting the link at checkout).
--
-- Security: both RPCs are SECURITY DEFINER but gated on an exact token match (UUID,
-- 36 chars — brute-force infeasible). get returns ONLY display fields (never stripe/
-- customer data); update touches ONLY title/body/link_url (never active, city_id,
-- stripe_*, product, or the token itself), validates the link, and caps lengths.
-- Additive + idempotent.

alter table public.sponsors add column if not exists edit_token text;
create index if not exists sponsors_edit_token_idx on public.sponsors (edit_token);

-- Read the editable ad for a token. All of a subscription's town rows share the
-- token and the same display values, so max()/bool_or() collapse them to one ad plus
-- the full town list. Returns no row for an unknown/short token.
create or replace function public.get_sponsor_ad(p_token text)
returns table(business text, headline text, link_url text, active boolean, paused_reason text, towns text[])
language sql
security definer
set search_path = public
as $$
  select
    max(title)            as business,
    max(body)             as headline,
    max(link_url)         as link_url,
    bool_or(active)       as active,
    max(paused_reason)    as paused_reason,
    array_agg(distinct city_id order by city_id) as towns
  from public.sponsors
  where p_token is not null and length(p_token) >= 20 and edit_token = p_token
  having count(*) > 0;
$$;
revoke execute on function public.get_sponsor_ad(text) from public;
grant execute on function public.get_sponsor_ad(text) to anon, authenticated;

-- Update the ad across every town it runs in. Only display fields; link is
-- normalized (adds https://) and validated; blank headline clears it, blank business
-- keeps the current one. Returns the number of town rows updated (0 = bad token).
create or replace function public.update_sponsor_ad(p_token text, p_business text, p_headline text, p_link_url text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  clean_link text;
begin
  if p_token is null or length(p_token) < 20 then return 0; end if;

  clean_link := nullif(btrim(coalesce(p_link_url, '')), '');
  if clean_link is not null then
    if clean_link ~* '^tel:' then
      -- Phone link: the checkout webhook whitelists tel: and the app renders a Call
      -- CTA, so a pre-filled tel: link must round-trip. Allow digits + separators only.
      if clean_link !~* '^tel:\+?[0-9().\- ]{3,20}$' then raise exception 'invalid link'; end if;
    else
      if clean_link !~* '^https?://' then clean_link := 'https://' || clean_link; end if;
      -- http(s) to a real host, and NO whitespace/control chars, quotes, or angle
      -- brackets — so a stored link can never break out of an href/attribute if any
      -- surface ever renders it as HTML (defense in depth for the clickable ad).
      if length(clean_link) > 300 or clean_link !~* '^https?://[^[:space:]"''<>]+\.[^[:space:]"''<>]+$' then
        raise exception 'invalid link';
      end if;
    end if;
  end if;

  update public.sponsors set
    title    = left(coalesce(nullif(btrim(p_business), ''), title), 80),
    body     = left(nullif(btrim(coalesce(p_headline, '')), ''), 120),
    link_url = clean_link
  where edit_token = p_token;

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.update_sponsor_ad(text, text, text, text) from public;
grant execute on function public.update_sponsor_ad(text, text, text, text) to anon, authenticated;
