# Local Loop — automated advertising with Stripe

End-to-end: a business pays on the web → Stripe bills them automatically (and
re-bills monthly) → the webhook creates and turns on their ad → if they cancel
or a payment fails, the ad turns off automatically. No manual step.

**Why web, not in-app:** selling ad space is a B2B service, so Stripe-on-web
avoids Apple's 30% cut. The app's "Advertise" button just links to your web page.

---

## 1. Create a Stripe account
[stripe.com](https://stripe.com) → sign up. Start in **Test mode** (toggle, top right) until everything works, then switch to Live.

## 2. Create products + prices
Stripe → **Products** → add:
| Product | Price | Type |
|---|---|---|
| Town Sponsor | $19/mo | Recurring (monthly) |
| All-Region Sponsor | $79/mo | Recurring (monthly) |
| Featured Listing | $25 | One-time |
| Featured Listing (7-day) | $9 | One-time (optional) |

## 3. Create a Payment Link for each
Stripe → **Payment Links** → New. For each product:
- **Metadata** (Advanced options → Metadata): add `product` = one of
  `town_sponsor`, `all_region`, or `featured_30` (use `featured_30` for both featured options).
- **Custom fields** (collect from the buyer): add text fields
  `business_name`, `headline`, `link` — and for the town/all-region split, add a
  **dropdown** field with key `town` listing your town names (Findlay, Lima, …).
  (Skip the `town` field on the All-Region link.)

The field **keys must match exactly**: `business_name`, `headline`, `link`, `town`.

## 4. Put the links on your site
Open `site/advertise.html` and replace the three `https://buy.stripe.com/REPLACE_…`
URLs with your real Payment Link URLs. Re-deploy the site.

## 5. Database
In the Supabase SQL Editor, run `supabase/stripe.sql` (adds the Stripe link columns).

## 6. Deploy the webhook
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```
Then set its secrets (Supabase → Edge Functions → `stripe-webhook` → Secrets):
- `STRIPE_SECRET_KEY` — Stripe → Developers → API keys → Secret key
- `STRIPE_WEBHOOK_SECRET` — from the next step

## 7. Point Stripe at the webhook
Stripe → **Developers → Webhooks → Add endpoint**:
- URL: `https://wtaefyspddadcrnovumk.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`
- After creating it, copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` (step 6).

## 8. Test it
In **Test mode**, open your advertise page, buy a Town Sponsor with Stripe's test
card `4242 4242 4242 4242` (any future date / any CVC). Within seconds a row should
appear in your `sponsors` table (active = true) and show in the app for that town.
When you're confident, flip Stripe to **Live mode** and repeat steps 3–7 with live keys.

## Notes
- One-time **Featured** purchases create a 30-day ad (auto-expires via `expire_promotions`).
- **All-Region** creates one ad per town, all tied to the same subscription, so a
  cancel switches them all off together.
- Businesses add a **logo** by emailing it to you; set `image_url` in the Manage
  Sponsors screen. (A logo-upload step can be added later.)
