# Local Loop — Google Play launch checklist

The iOS launch and this can run in parallel. Same app, same backend — Android
just needs its own store listing and an upload.

## 0. The build (in progress / done)
An Android **production AAB** is built on EAS (`eas build -p android --profile production`).
When it finishes you'll get a link; download the `.aab` — that's what Play wants.
- First Android build auto-generates a signing keystore, managed by EAS. Don't lose
  access to the Expo account — that keystore signs every future update.
- The duplicate `RECORD_AUDIO` permission is gone, and camera/mic are disabled at the
  image-picker plugin, so the app requests **no sensitive permissions** (just photo
  access when you add a garage-sale picture). This makes the Play data-safety form short.

## 1. Google Play Console ($25 one-time)
- Create the developer account at [play.google.com/console](https://play.google.com/console)
  (I can't create accounts — this one's you). $25 once, not per year.
- **Create app** → name "Local Loop", language English (US), App, Free.

## 2. Store listing
Reuse the copy in `docs/STORE_LISTING.md`:
- **Short description** (80 char): "Events, garage sales & food trucks near you in NW Ohio."
- **Full description**: paste the iOS description.
- **App icon**: `assets/store/icon-512.png` (512×512).
- **Feature graphic**: `assets/store/feature-graphic.png` (1024×500) — required by Play.
- **Phone screenshots**: the four 1290×2796 shots in `assets/store/screenshots/` work
  (Play accepts 16:9–9:16, min 320px). At least 2 required.
- **Category**: Lifestyle. **Tags**: events, local.

## 3. Data safety form (Play's privacy questionnaire)
Mirror the iOS App Privacy answers (and `site/privacy.html`):
- Collects **email** (account management / app functionality), **app activity**
  (product interaction → analytics), and an **app-generated device ID** (analytics /
  app functionality). **Encrypted in transit. No data sold. Not used for tracking.**
- No location, no contacts, no financial info.
- Privacy policy URL = your hosted `…/privacy.html` (same one as iOS).

## 4. Content rating & release
- Fill the **content rating** questionnaire → comes out Everyone.
- **Internal testing** track first: upload the `.aab`, add your email as a tester,
  install from the test link on a real Android phone, click through onboarding →
  town picker → events → save → map. Then promote to **Production**.
- First Play review is typically a few days.

## 5. Ongoing updates
- JS/content changes ride the same `eas update --branch production` OTA as iOS — one
  push updates both platforms.
- Only rebuild + re-upload the AAB for native changes (new permissions, SDK bumps,
  icon/splash). Bump `version` in app.json; `autoIncrement` handles the version code.
