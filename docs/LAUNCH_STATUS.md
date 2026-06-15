# Local Loop — Launch status & what's next

_Snapshot: 2026-06-15. Pick this up anytime._

## iOS — ✅ SUBMITTED, in review
- **Submitted** to App Store review on 2026-06-15. Build **1.0.0 (3)**.
- **Release mode: MANUAL** — even after Apple approves, it will NOT go live until you click Release.
- App Store Connect App ID **6780306721**, bundle `com.michaelwilliams.localloop`.

### When Apple emails "Approved"
1. App Store Connect → Local Loop → the **1.0.0** version
2. Click **"Release this version"** → it goes live on the App Store (can take a few hours to appear).

### If Apple rejects it (normal on a first try)
1. Open the **Resolution Center** message in App Store Connect — read exactly what they flagged.
2. Paste that message to Claude — most rejections are small (a clarification, a metadata tweak, or a quick fix).
3. Fix → if it's a metadata/answer change, just **resubmit**; if it's a code change, Claude ships it (OTA for JS, or a rebuild for native) and you resubmit.

### Shipping updates after launch
- **Content** (events, towns, deals): server-side in Supabase — appears instantly, no app update.
- **Code/UI fixes:** `eas update --branch production` — silent OTA, no review, users get it on next open. (Bump `BUILD` in `src/version.js` each time → shows as "rev N" in Settings.)
- **Native changes** (new native module, permissions, SDK bump, icon): require a **rebuild + resubmit** to Apple. Runtime is **fingerprint** policy, so OTAs only reach builds with matching native modules.

---

## Android — ⏸️ PAUSED (need an Android device)
Stopped at Google Play Console **device verification** — Google requires a real Android device to verify a new personal account, and there isn't one available right now.

### State when paused
- Play Console account: **michabw91@gmail.com**, type **Personal** ("Yourself"). Developer name + "About you" entered.
- `.aab` was built (versionCode 3) but EAS artifacts expire — **rebuild a fresh one when resuming**.
- Listing copy ✅ (`docs/STORE_LISTING.md`), feature graphic + 512 icon ✅ (`assets/store/`).

### To resume (once you have ANY Android phone/tablet — a cheap $60–100 one is fine)
1. Install the **Google Play Console** app on the Android device → sign in as michabw91@gmail.com → clears device verification.
2. Complete **identity verification** (upload ID; Google reviews, ~1–2 days).
3. Rebuild the bundle: `eas build -p android --profile production` → download the `.aab`.
4. Play Console → **Create app** (Local Loop, English US, App, Free).
5. **Store listing** — paste from `docs/STORE_LISTING.md`; short description, feature graphic (`assets/store/feature-graphic.png`), icon (`assets/store/icon-512.png`), phone screenshots (the 1284×2778 set in `assets/store/screenshots-65/` works).
6. **Data Safety** form — see answers below.
7. **Content Rating** questionnaire — see answers below.
8. **Target audience** — 18+ or 13+ (general audience; no kids-specific design).
9. ⚠️ **Closed test: 20+ testers for 14 days** (required for new personal accounts) — recruit Findlay-area testers (doubles as a soft launch).
10. After 14 days → **apply for production access** → upload `.aab` to Production → submit for review (a few days).

### Data Safety answers (Google Play)
- Does the app collect/share user data? **Yes (collect; share: No).** All data **encrypted in transit (Yes)**.
- **Email address** — collected; purpose: Account management + App functionality; optional (only to post); not shared.
- **Photos** (garage-sale uploads) — collected; App functionality; not shared.
- **App activity → Product interaction** (listing views) — collected; Analytics + App functionality; not shared.
- **Device or other IDs** (app-generated anon id) — collected; Analytics + App functionality; not shared. **NOT the advertising ID.**
- **Data deletion:** users can request deletion by emailing michabw91@gmail.com (state this; link the privacy policy).
- **No** location, financial info, contacts, messages, health. **No** data used for tracking/advertising (no ads SDK).

### Content Rating answers (IARC questionnaire)
- Category: **Social / Utility** (events app).
- Violence, sexual content, profanity, drugs/alcohol, gambling, horror → **No / None** to all.
- **Users can interact / share user-generated content:** **Yes** (post events, sales, food trucks) — and it's **moderated** (report + admin review system).
- **Shares user's physical location with other users:** **No** (shows event venues, not the user's location).
- Expected result: **Everyone / Teen** (low rating).

---

## Key reference
- **Site (live):** https://local-loop-nwohio.netlify.app · privacy `…/privacy.html` · advertise `…/advertise.html`
  - Redeploy: `netlify deploy --prod --dir=site` (logged in as bwsandbox91@gmail.com)
- **EAS:** `@brandonmbw/local-loop`, projectId `4b1bddaa-1419-4967-94d0-5a3c9a966582`
- **Repo:** github.com/BrandonMBW91/LocalLoop (main)
- **Stripe (ads):** test mode, dormant — flip to live only when you land a paying advertiser.
- **Build/update commands:**
  - OTA: `eas update --branch production --message "…"` (bump `src/version.js` BUILD first)
  - iOS build: `eas build -p ios --profile production` → `eas submit -p ios --latest`
  - Android build: `eas build -p android --profile production`
