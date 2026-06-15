# Local Loop — App Store launch checklist

Your binary is already built and uploaded to App Store Connect (App ID **6780306721**).
What's left is the listing + submitting for review. Here's the exact order.

## 1. Host the website (5 min) — gets your required Privacy URL
- Go to [netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**
- Drag the **`site/`** folder (`C:\Users\micha\New\FindlayEvents\site`) onto the page
- Netlify gives you a URL like `https://local-loop.netlify.app`
- Your privacy policy is then at `…/privacy.html` — copy that link, you'll need it next
- (Bonus: this whole site is your shareable link for Findlay Facebook groups, and your Advertise page.)

## 2. App Store Connect → your app → fill in the listing
At [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Apps → Local Loop. Copy from `docs/STORE_LISTING.md`:
- **App Information:** Subtitle `Events near you in NW Ohio`; Category **Lifestyle** (secondary Travel); **Privacy Policy URL** = your Netlify `…/privacy.html`
- **Pricing and Availability:** Free; available in United States
- **Version 1.0 (Prepare for Submission):**
  - **Description, Keywords, Promotional text** — paste from STORE_LISTING.md
  - **Support URL** — your Netlify home URL is fine
  - **Screenshots** — see step 3
  - **Build** — select the build you uploaded (it should be listed)
  - **Age Rating** — answer the questions → comes out **4+**
  - **Copyright** — `2026 Local Loop`

## 3. App Privacy questionnaire (Apple asks what data you collect)
App Store Connect → App Privacy → answer honestly (matches your privacy.html):
- **Contact Info → Email address:** collected, linked to identity, for App Functionality (sign-in). Not used for tracking.
- **Identifiers → Device ID:** collected (for ads), may be used for Third-Party Advertising if you enable ads.
- **Usage Data → Product Interaction:** collected, for Analytics/App Functionality.
- You do **not** collect location, contacts, or browsing history. Not used to track users across other companies' apps (unless you turn on ad personalization later).

## 4. Screenshots — DONE ✅ (already generated for you)
Four ready-to-upload App Store screenshots at the exact size Apple needs (**1290 × 2796**) are in
**`assets/store/screenshots/`** (`1-events`, `2-detail`, `3-food`, `4-city`). Just drag them into the
screenshot slots in App Store Connect.
- Prefer your own real screenshots? Take them on your iPhone with text size set to Large — but the
  generated ones submit fine as-is.

## 5. Submit for Review
Hit **Add for Review → Submit**. Apple review is typically **1–3 days**. You'll get an email when it's approved (or if they need anything).

---

## Notes
- **Don't rebuild** unless you change something native (icons, permissions, new native module). All the JS improvements I made overnight are delivered over-the-air via `eas update` — the build you submit already pulls them.
- **Before a Google Play submission** (later): remove the duplicate `RECORD_AUDIO` permission in `app.json` and rebuild. Doesn't affect this iOS launch.
- Optional anytime: run `supabase/security_hardening.sql` (raises report-takedown threshold, caps spam).
