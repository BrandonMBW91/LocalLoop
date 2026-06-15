# Deploying Findlay Events

Deploying a phone app = **build a binary in the cloud → install it / submit it
to the stores**. The project is already configured (`eas.json`, app identifiers,
permissions). Below is the path from "on my phone today" to "in the app stores."

> Your app id is `com.findlayevents.app` (iOS + Android). Pick this carefully —
> it can't be changed after you publish.

## Accounts you'll need
| For | Cost | When |
|-----|------|------|
| **Expo** account | Free | Now — required for any build |
| **Google Play** Developer | $25 once | To publish on Android |
| **Apple** Developer | $99 / year | To test on iPhone or publish on iOS |

I (Claude) can't create these or log in as you — those steps are yours.

---

## Stage 1 — Get it on your phone (fastest, free)

This makes a real installable app with only a **free Expo account**. Best on
**Android** (you can sideload the APK directly; iPhone testing needs an Apple
Developer account even for testing).

```bash
npm install -g eas-cli      # one time
cd FindlayEvents
eas login                   # create/sign in to your free Expo account
eas build:configure         # links the project (creates a project id)
eas build -p android --profile preview
```
When it finishes (~10–15 min in Expo's cloud), you get a link to an **APK**.
Open that link on your Android phone and install it. That's your app, running
natively, sharable with anyone.

For **iPhone** testing instead:
```bash
eas build -p ios --profile preview   # requires an Apple Developer account
```

## Stage 2 — Connect the backend (do before a public release)
Follow [`../supabase/SETUP.md`](../supabase/SETUP.md): create the Supabase
project, run the SQL, set Twilio for phone sign-in, and put the keys in `.env`.
Rebuild after adding keys so the app ships with the live database. Without this,
the published app shows only sample data and submissions don't sync.

## Stage 3 — Publish to the stores

**Before you submit, prepare:**
- [ ] **App icon / branding** — the app currently uses Expo's default icon.
      Replace `assets/icon.png` (1024×1024) and the Android adaptive icons with
      your own before a public launch.
- [ ] **Privacy policy URL** — host [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) at a
      public link (e.g. on your Netlify site). Both stores require it.
- [ ] **Store listing** — name, short + full description, screenshots (take them
      from a real build), category (Events / Lifestyle), and an age rating
      questionnaire.

**Build the production binaries:**
```bash
eas build -p android --profile production
eas build -p ios --profile production
```

**Submit them:**
```bash
eas submit -p android --profile production   # needs Google Play account + app created
eas submit -p ios --profile production       # needs Apple account + app created
```
- **Google Play:** create the app in the Play Console, start with the **Internal
  testing** track (live in minutes) before a public release.
- **Apple:** create the app in App Store Connect; builds go to **TestFlight**
  first, then submit for review (usually a day or two).

## Stage 4 — Pushing updates later
For JS/content changes (most updates), push over-the-air — no store review:
```bash
eas update --branch production -m "what changed"
```
Only changes to native code or app config need a new store build.

---

### TL;DR fastest first step
Free Expo account → `eas build -p android --profile preview` → install the APK
on an Android phone. Everything else builds on top of that.
