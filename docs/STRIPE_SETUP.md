# Local Loop — automated advertising with Stripe

End-to-end: a business pays on the web → Stripe bills them automatically (and
re-bills monthly) → the webhook creates and turns on their ad → if they cancel
or a payment fails, the ad turns off automatically. No manual step.

**Why web, not in-app:** selling ad space is a B2B service, so Stripe-on-web
avoids Apple's 30% cut. The app's "Advertise" button just links to your web page.

---

## ✅ Already done (Test mode)
The product catalog and the 3 **Payment Links** are created in your Stripe Test
account (via `scripts/stripe-catalog.mjs`) with the exact metadata + custom-field
keys the webhook needs, and the test links are already in `site/advertise.html`:
- **Town Sponsor** — $19/mo · collects business name, headline, town
- **Featured Listing** — $25 one-time (30-day ad) · business name, headline, town
- **All-Region Sponsor** — $79/mo · business name, headline, link

## What's left to turn it on

### 1. Database
Supabase SQL Editor → run `supabase/stripe.sql` (adds the Stripe link columns).

### 2. Deploy the webhook
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

### 3. Point Stripe at it + set secrets
- Stripe → **Developers → Webhooks → Add endpoint**
  - URL: `https://wtaefyspddadcrnovumk.supabase.co/functions/v1/stripe-webhook`
  - Events: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`
  - Copy the **Signing secret** (`whsec_…`)
- Supabase → Edge Functions → `stripe-webhook` → **Secrets**:
  - `STRIPE_SECRET_KEY` = your Stripe **Secret key** (Developers → API keys)
  - `STRIPE_WEBHOOK_SECRET` = the `whsec_…` from above

### 4. Test it
Open `site/advertise.html`, buy a Town Sponsor with test card
`4242 4242 4242 4242` (any future date, any CVC). Within seconds a row should
appear in your `sponsors` table (`active = true`) and show in the app for that town.

---

## Going live (when you're ready for real money)
1. Switch Stripe to **Live mode**, grab your **live** secret key.
2. Regenerate the live catalog + links:
   ```bash
   cd scripts && npm init -y && npm install stripe
   STRIPE_SECRET_KEY=sk_live_... node stripe-catalog.mjs
   ```
3. Paste the 3 printed live URLs into `site/advertise.html` (replace the `test_` ones), re-deploy the site.
4. Add a **live** webhook endpoint in Stripe (same URL/events) and update the two function secrets with the live values.

## Notes
- One-time **Featured** purchases create a 30-day ad (auto-expires via `expire_promotions`).
- **All-Region** creates one ad per town, all tied to the same subscription, so a cancel switches them all off together.
- Businesses add a **logo / website link** by emailing you; set `image_url`/`link_url` in the in-app Manage Sponsors screen.
- These were **test** keys you shared — fine for now, but roll them in Stripe before launch and never paste live keys.
