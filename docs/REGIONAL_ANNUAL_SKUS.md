# Spec: Regional & Annual Ad SKUs

**Goal:** the fastest concrete path to ~$1k MRR without waiting on per-town MAU to grow.

**Thesis:** a single-town $19/mo ad is a hard sell while a town has ~2 MAU. But a
*regional* business (multi-location franchise, HVAC/roofing/pest-control, health
system, car-dealer group, credit union, realtor, staffing agency, regional
festival) values **multi-town reach regardless of any one town's MAU** — so
all-region and metro bundles close faster and at 4x the ACV. Annual prepay then
locks the cash and kills the #1 churn driver.

> Napkin math: **13 all-region sponsors × $79 = $1,027 MRR.** Same dollars need 54
> single-town $19 sponsors. Bundles get you there ~4x faster.

---

## 1. The SKU ladder

| SKU | Scope | Monthly | Annual (2 months free) | Status |
|-----|-------|--------:|----------------------:|--------|
| **Town** | 1 town | $19 | **$190/yr** | monthly exists · add annual |
| **Metro** | a metro cluster (~5–15 towns) | **$39** | **$390/yr** | **new** |
| **All-Region** | all ~122 towns | $79 | **$790/yr** | monthly exists · add annual |

- Annual discount = **2 months free** (10/12 ≈ 17% off): Town saves $38, Metro
  $78, All-Region $158.
- Metro slots cleanly between Town ($19) and All-Region ($79) — the natural buy
  for a business that serves a metro but not the whole state.
- Featured Listing ($25/30d) stays as-is (it's a listing boost, not a bundle).

---

## 2. What already works (don't rebuild)

The `stripe-webhook` `checkout.session.completed` handler already does the hard part:

- **Multi-town fulfillment.** `cityIds = product === 'all_region' ? knownIds : [resolvedCity]`
  then it inserts **one `sponsors` row per city_id**, all sharing the same
  `stripe_subscription_id` + `stripe_session_id` (index.ts ~171–186). A metro
  bundle is just "cityIds = the metro's towns."
- **Bundle cancellation.** `customer.subscription.deleted` sets `active=false`
  for **every** row matching the subscription id — so canceling deactivates the
  whole bundle in one shot.
- **Idempotency.** Upsert on `(stripe_session_id, city_id)` — Stripe retries can't
  double-insert.
- **`product` column** on `sponsors` already exists ('town_sponsor' | 'all_region')
  and is used by the daily backfill to extend all-region subs to newly-added towns.
- **Annual is interval-agnostic.** The webhook never looks at the billing interval,
  so an annual subscription fulfills identically. Stripe handles renewal; on cancel
  it stays live until period end, then fires `subscription.deleted`. **Zero webhook
  change for annual.**

---

## 3. Changes needed

### 3a. Metro bundle definitions — `src/data/bundles.js` (new, shared)
One source of truth imported by the webhook, the advertise generator, and the app.

```js
// Curated metro clusters. Seed from the geo.mjs anchors (they already group towns
// by metro) + the cities.js region field. Keep to metros where we have density.
export const METRO_BUNDLES = {
  toledo:       { name: 'Greater Toledo',        towns: ['toledo','perrysburg','maumee','bowling-green','sylvania','oregon','waterville'] },
  dayton:       { name: 'Greater Dayton',        towns: ['xenia','beavercreek','fairborn','bellbrook','centerville','kettering','miamisburg','vandalia','huber-heights','tipp-city','springboro'] },
  akroncanton:  { name: 'Akron–Canton',          towns: ['akron','canton','massillon','cuyahoga-falls','stow','hudson','north-canton','wadsworth','barberton'] },
  youngstown:   { name: 'Youngstown–Warren',     towns: ['youngstown','warren','boardman','austintown','niles','girard','struthers','canfield','columbiana'] },
  findlay:      { name: 'Findlay / NW Ohio',     towns: ['findlay','fostoria','tiffin','fremont','bowling-green','bluffton','ada','north-baltimore'] },
  // add metros as coverage deepens; validate every id against cities.js
};
```
- Add a `check-cities`-style assertion that **every town id here exists in
  cities.js** (no typos → no silent empty bundle).

### 3b. Stripe (dashboard, no code)
Create these **Payment Links** (LIVE mode), each with `metadata.product` set:

| Link | Price | `metadata.product` | Custom fields (≤3) |
|------|-------|--------------------|--------------------|
| Town Annual (Founding) | $190/yr | `town_sponsor` | businessname, headline, **town** dropdown |
| Metro Monthly | $39/mo | `metro_sponsor` | businessname, headline, **metro** dropdown |
| Metro Annual | $390/yr | `metro_sponsor` | businessname, headline, **metro** dropdown |
| All-Region Annual | $790/yr | `all_region` | businessname, headline |

- The **metro** dropdown values = `METRO_BUNDLES` keys (e.g. `toledo`, `dayton`).
  Only ~6 options → nowhere near the 200-option cap.
- Still no `link` field (3-field cap) — link is collected via the confirmation-email
  reply, same as today.

### 3c. `src/data/checkout.js`
Add the new links so the app + web generator share them:
```js
export const REGION_LINK = '...';            // existing $79/mo
export const REGION_ANNUAL_LINK = '...';     // new $790/yr
export const METRO_LINK = '...';             // new $39/mo
export const METRO_ANNUAL_LINK = '...';      // new $390/yr
// annual town links per tier, mirroring CHECKOUT_BY_TIER:
export const CHECKOUT_ANNUAL_BY_TIER = {
  Founding: { town: '...' /* $190/yr */ },
};
```

### 3d. `stripe-webhook/index.ts` — add the `metro_sponsor` branch
Small, mirrors `all_region`:
```ts
import { METRO_BUNDLES } from '...'; // or inline the map in the function (edge fn can't import app src easily — copy it, or read from a DB table; see note)
// after resolving product:
const metro = field(s, 'metro');
const cityIds =
  product === 'all_region' ? knownIds
  : product === 'metro_sponsor' ? (METRO_BUNDLES[metro?.toLowerCase()]?.towns ?? []).filter(t => knownIds.includes(t))
  : (resolvedCity ? [resolvedCity] : []);
```
- Store `product='metro_sponsor'` (+ optionally the metro code) on each row so the
  daily backfill can extend a metro sub if new towns join that metro.
- **Note:** the edge function can't import `src/data/bundles.js` directly. Either
  (a) copy `METRO_BUNDLES` into the function, or (b) — cleaner long-term — put
  bundles in a small `ad_bundles` DB table the webhook reads. Copy is fine for v1.
- The "unknown town" alert path already covers an unresolvable metro (empty
  cityIds → owner gets an ACTION email instead of a silent charge). Reuse it.

### 3e. `aggregator/generate-advertise.mjs` (+ app `promote.js` / advertise screen)
- Add a **Metro** pricing card between Town and All-Region.
- Add a **Monthly ⇄ Annual** toggle on all three; annual shows "2 months free /
  save $X".
- Keep the existing per-town "coming soon" guard for empty towns; metro/all-region
  are always sellable (they span many towns).

### 3f. `scripts/stripe-refresh-towns.mjs`
Extend it (or add a sibling) to also sync the **metro** dropdown on the metro
links from `METRO_BUNDLES` keys — so adding a metro updates checkout automatically,
same pattern as the town dropdown. (Keep the 200-option assertion.)

---

## 4. Edge cases (mostly already handled)
- **Cancel mid-term:** Stripe keeps the sub live to period end, then
  `subscription.deleted` deactivates all bundle rows. ✓ existing.
- **New town added to a metro/region:** the daily backfill (already extends
  all_region) gains a metro-aware branch. Low urgency (metros rarely change).
- **Proration on upgrade (Town→Metro→All-Region):** out of scope for v1 — treat as
  cancel + new buy, or handle by email.
- **Refunds / disputes:** unchanged; `charge.refunded` isn't handled today (v2).

---

## 5. Go-to-market (this is where the $1k comes from)
- **Target list:** regional/multi-town buyers — franchises, home-services (HVAC,
  roofing, pest, plumbing), health systems/urgent care, car-dealer groups, credit
  unions, realtors/brokerages, staffing agencies, regional festivals & fairs,
  colleges. The outreach engine already exists; add a "regional business" segment
  and a bundle-focused email template ("one ad, every town in {metro/Ohio}").
- **Advertise-page framing:** lead with **All-Region $79 / $790-yr** and **Metro
  $39** as the hero cards (highest ACV first); single-town becomes the entry option.
- **Anchor with annual:** default the toggle to Annual and show the savings — it
  lifts cash-in-hand and cuts churn.

---

## 6. Rollout / sequencing
- **Phase 1 — Annual (days).** Create the 3 annual Stripe links, add to
  checkout.js, add the Monthly/Annual toggle to the advertise page. **Zero webhook
  change.** Start pitching annual to anyone already interested. *This alone is a
  fast cash + retention win.*
- **Phase 2 — Metro bundle (~a few days).** Add `bundles.js`, the `metro_sponsor`
  webhook branch (+ copy the map in), the Metro links + card, and the refresh-script
  metro dropdown. Deploy the edge function.
- **Phase 3 — Sell.** Build the regional-business lead segment + bundle email;
  point outreach at multi-town buyers.

## 7. Effort
- Phase 1: **S** (Stripe links + checkout.js + advertise toggle; no webhook/DB).
- Phase 2: **M** (bundles.js + one webhook branch + advertise card + refresh dropdown + redeploy).
- Phase 3: **M** (leads + template + outreach), ongoing.

Net: a **week of build** unlocks a 4x-ACV product line + annual prepay, on top of a
fulfillment path that already exists.
