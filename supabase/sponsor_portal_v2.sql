-- Advertiser self-serve, round 2: let them CUSTOMISE the ad (logo + button label)
-- and SEE what it did (views, taps, running since).
--
-- WHY. Two things were promised in writing and never delivered:
--   1. "Want to add a logo too? Just reply to this email." — every buyer confirmation
--      says it (stripe-webhook/index.ts). There was no logo field anywhere self-serve,
--      so every ad rendered the grey storefront placeholder and looked unsold.
--   2. "Ask us any time for your views and taps" — site/advertise.html. The counters
--      exist and work, but only the OWNER's admin screen could read them, so a paying
--      advertiser had no way to learn their ad did anything. That is the renewal
--      conversation, and it was a support ticket.
--
-- OVERLOAD SAFETY, read before editing. `create or replace function` does NOT replace
-- a function with a different argument list — it creates a SECOND overload, and the
-- shorter call then matches both and Postgres refuses it as ambiguous (42725). That
-- killed activity recording for every live user on 2026-07-16. So the 4-arg
-- update_sponsor_ad is DROPPED explicitly below before the 6-arg one is created.
--
-- The new params take DEFAULT NULL and NULL means "leave unchanged", so the
-- CURRENTLY DEPLOYED manage-ad.html — which still posts only 4 params — keeps working
-- unchanged through this migration. Empty string clears a value; that distinction is
-- what lets a 4-arg caller avoid wiping a logo it does not know about.

alter table public.sponsors add column if not exists cta text;

-- ---------------------------------------------------------------------------
-- Stats for the advertiser's own ad. Same shape and same guard as get_sponsor_ad:
-- SECURITY DEFINER, gated on an exact token match, returns ONLY display numbers and
-- never stripe/customer fields.
--
-- A purchase fans out to one row PER TOWN sharing one edit_token, and each row counts
-- separately — so an all-region buyer gets a real per-town breakdown for free, with no
-- new tracking of any kind.
--
-- NOTE ON "views": impressions are deduped once per app session (AdBanner.js), so this
-- is "app sessions where a neighbour saw your ad", not ad-tech impressions. That is a
-- better and more honest number for a local business. Label it accordingly.
create or replace function public.get_sponsor_stats(p_token text)
returns table(views bigint, taps bigint, since timestamptz, towns_detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(impressions), 0)::bigint as views,
    coalesce(sum(clicks), 0)::bigint      as taps,
    min(created_at)                        as since,
    jsonb_agg(jsonb_build_object('city_id', city_id, 'views', impressions, 'taps', clicks)
              order by impressions desc, city_id) as towns_detail
  from public.sponsors
  where p_token is not null and length(p_token) >= 20 and edit_token = p_token
  having count(*) > 0;
$$;
revoke execute on function public.get_sponsor_stats(text) from public;
grant execute on function public.get_sponsor_stats(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_sponsor_ad gains image_url + cta so the portal can round-trip what it edits.
-- Return type changes, so this one must be dropped too (Postgres cannot change a
-- function's return type in place).
drop function if exists public.get_sponsor_ad(text);
create or replace function public.get_sponsor_ad(p_token text)
returns table(business text, headline text, link_url text, image_url text, cta text,
              active boolean, paused_reason text, towns text[])
language sql
security definer
set search_path = public
as $$
  select
    max(title)            as business,
    max(body)             as headline,
    max(link_url)         as link_url,
    max(image_url)        as image_url,
    max(cta)              as cta,
    bool_or(active)       as active,
    max(paused_reason)    as paused_reason,
    array_agg(distinct city_id order by city_id) as towns
  from public.sponsors
  where p_token is not null and length(p_token) >= 20 and edit_token = p_token
  having count(*) > 0;
$$;
revoke execute on function public.get_sponsor_ad(text) from public;
grant execute on function public.get_sponsor_ad(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
drop function if exists public.update_sponsor_ad(text, text, text, text);
create or replace function public.update_sponsor_ad(
  p_token text,
  p_business text,
  p_headline text,
  p_link_url text,
  p_image_url text default null,
  p_cta text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  clean_link text;
  clean_img text;
  clean_cta text;
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

  -- Logo. Same anti-breakout rules as the link, plus https-only: an http image on an
  -- https page is blocked as mixed content anyway, and it would render as the grey
  -- placeholder — i.e. exactly the "looks unsold" problem this is meant to fix, but
  -- now with the advertiser believing they fixed it.
  if p_image_url is not null then
    clean_img := nullif(btrim(p_image_url), '');
    if clean_img is not null then
      if clean_img !~* '^https://' then clean_img := 'https://' || regexp_replace(clean_img, '^https?://', '', 'i'); end if;
      if length(clean_img) > 500 or clean_img !~* '^https://[^[:space:]"''<>]+\.[^[:space:]"''<>]+$' then
        raise exception 'invalid image url';
      end if;
    end if;
  end if;

  -- Button label. Short on purpose: it sits on one line next to the town's events and
  -- must not wrap. Letters, digits, spaces and basic punctuation only, so it can never
  -- carry markup into the banner.
  if p_cta is not null then
    clean_cta := nullif(btrim(p_cta), '');
    if clean_cta is not null then
      clean_cta := left(clean_cta, 22);
      if clean_cta !~ '^[A-Za-z0-9 ''&.!-]+$' then raise exception 'invalid button label'; end if;
    end if;
  end if;

  update public.sponsors set
    title    = left(coalesce(nullif(btrim(p_business), ''), title), 80),
    -- 200, not 120: checkout accepts a 200-char headline, so the old cap silently
    -- truncated a buyer's own words the first time they pressed Save on the page that
    -- exists to make them feel in control.
    body     = left(nullif(btrim(coalesce(p_headline, '')), ''), 200),
    link_url = clean_link,
    -- NULL param = leave alone (so an older 4-arg caller cannot wipe these);
    -- empty string = the advertiser deliberately cleared it.
    image_url = case when p_image_url is null then image_url else clean_img end,
    cta       = case when p_cta is null then cta else clean_cta end
  where edit_token = p_token;

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.update_sponsor_ad(text, text, text, text, text, text) from public;
grant execute on function public.update_sponsor_ad(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- COLUMN GRANTS FOR cta — added 2026-07-21 after this migration broke ad rendering.
--
-- sponsors uses COLUMN-LEVEL grants (supabase/sponsors_hardening.sql) so the anon key
-- shipped in the public web bundle cannot read stripe ids or the per-ad counters.
-- Adding the cta column above did not extend those grants, and PostgREST denies the
-- WHOLE query — 401, "permission denied for table sponsors" — the moment a request
-- names one ungranted column. src/lib/db.js then added cta to SPONSOR_PUBLIC_COLS, so
-- fetchSponsors started 401ing for every user in every town: no ad rendered anywhere.
--
-- RLS was never the issue and the rows were fine; the query never got that far.
--
-- THE RULE: adding a column that any client reads means granting it here too. A new
-- column is invisible-by-default on this table, and the failure is total rather than
-- partial, which makes it look like "ads are broken" rather than "one field is missing".
grant select (cta) on public.sponsors to anon, authenticated;

notify pgrst, 'reload schema';
