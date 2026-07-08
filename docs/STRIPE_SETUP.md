# Local Loop — automated advertising with Stripe

End-to-end: a business pays on the web → Stripe bills them automatically (and
re-bills monthly) → the webhook creates and turns on their ad → if they cancel
or a payment fails, the ad turns off automatically (and turns back on when a
retried invoice pays). No manual step.

**Why web, not in-app:** selling ad space is a B2B service, so Stripe-on-web
avoids Apple's 30% cut. The app's "Advertise" button just links to the web page.

---

## How it's wired (LIVE)

Pricing is **per-town and tier-based** (`src/data/pricing.js`): each town's
monthly-active-user count maps to a tier, and each buyable tier has its own
pair of Stripe Payment Links. Five links exist in Live mode:

| Link | Price | metadata.product |
|---|---|---|
| Founding — Town Sponsor | $19/mo | `town_sponsor` |
| Founding — Featured Listing (30 days) | $25 | `featured_30` |
| Local — Town Sponsor | $29/mo | `town_sponsor` |
| Local — Featured Listing (30 days) | $35 | `featured_30` |
| All-Region Sponsor | $79/mo flat | `all_region` |

Established and Premier tiers intentionally have **no** links — they fall back
to an email quote (see the note atop `src/data/pricing.js`).

The pieces, and the single source of truth for each:

- **`src/data/checkout.js`** — the live link URLs (`REGION_LINK`,
  `CHECKOUT_BY_TIER`). Imported by BOTH the app (`app/promote.js`) and the web
  generator, so the two can never drift.
- **`aggregator/generate-advertise.mjs`** — generates `site/advertise.html`
  with live per-town MAU pricing and the matching tier link. **advertise.html
  is a generated file — never edit it by hand.** CI regenerates it daily; run
  `node generate-advertise.mjs` from `aggregator/` to refresh on demand.
- **`supabase/functions/stripe-webhook`** — fulfillment. Creates the sponsor
  row(s) on `checkout.session.completed`, deactivates on cancel/failed payment,
  reactivates on a paid invoice. Its town list is live (`active_cities` RPC),
  so it never goes stale as towns are added.
- **`scripts/stripe-refresh-towns.mjs`** — syncs the "Your town" dropdown on
  the live links with `src/data/cities.js` (see maintenance below).

## The contract every payment link must carry

The webhook routes on these — a link missing them fulfills down the wrong path:

- `metadata.product` = `town_sponsor` | `all_region` | `featured_30`
- Custom fields: `businessname`, `headline`, plus
  - `town` dropdown on town-scoped links (values = city id with hyphens
    removed, e.g. `bowling-green` → `bowlinggreen`; the webhook maps them back
    mechanically), or
  - `link` optional text on the All-Region link (it has no town dropdown).

## Routine maintenance

**Added towns?** The webhook and advertise page pick them up on their own; the
dropdowns baked into the payment links do not. Sync them:

```bash
cd scripts && npm install
STRIPE_SECRET_KEY=sk_live_... node stripe-refresh-towns.mjs           # dry run
STRIPE_SECRET_KEY=sk_live_... node stripe-refresh-towns.mjs --apply   # write
```

The dry run also verifies each link's `metadata.product`, so it doubles as a
catalog health check.

**Adding or re-thresholding a buyable tier?** Create its two Payment Links in
the Stripe dashboard with the contract above, add them to `CHECKOUT_BY_TIER`
in `src/data/checkout.js`, then regenerate `advertise.html`. That alone makes
the tier buyable in both the app and the web page.

## Webhook deployment (already live — for reference)

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

- Stripe → **Developers → Webhooks**: endpoint
  `https://wtaefyspddadcrnovumk.supabase.co/functions/v1/stripe-webhook`,
  events `checkout.session.completed`, `customer.subscription.deleted`,
  `invoice.payment_failed`, `invoice.paid` / `invoice.payment_succeeded`.
- Supabase → Edge Functions → `stripe-webhook` → **Secrets**:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the endpoint's `whsec_…`), and
  `RESEND_API_KEY` for the fulfillment/buyer emails.

## Notes

- **Featured Listing** is fulfilled by hand on purpose: the webhook emails the
  owner (with the amount paid), who features the buyer's listing via the
  in-app moderator Feature button. The buyer gets a confirmation email.
- **All-Region** creates one ad per active town, all tied to the same
  subscription, so a cancel switches them all off together.
- If a buyer's town can't be resolved, no ad is created and the owner gets an
  ACTION email to place it by hand — a paid purchase never vanishes silently.
- Businesses add a **logo / website link** by emailing; set
  `image_url`/`link_url` in the in-app Manage Sponsors screen.
- Test mode has its own separate catalog; test with card `4242 4242 4242 4242`.
