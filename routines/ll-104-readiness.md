# Routine: ll-104-readiness (daily 7:40 AM)

Produce Michael's Local Loop 1.0.4 / OTA build-readiness report. Repo: C:\Users\micha\New\FindlayEvents. This is an automated run with the user not present. Run everything read-only, with ONE exception: check 4 creates and then deletes the temporary .expo-export-check export directory. Beyond that, DO NOT modify, commit, or touch any file, and DO NOT run or alter the automation routines (daily-report.mjs, fb-routine.mjs, aggregator/*, outreach/*, ad-test-tracker.mjs) — those have their own separate checks (validate-routines.mjs). The goal is to confirm the app is ready to build and ship 1.0.4 and publish OTAs, with no errors. Report numbers first, plain language, no em-dashes.

Run these checks from the repo root unless noted, and report each result:

1. TEST SUITE: `node tests/logic.test.mjs`. Report passed/failed counts. Any failure is a blocker.

2. EXPO DOCTOR: `npx --yes expo-doctor`. Report the "X/Y checks passed" line. Any failed check is a blocker; name it.

3. TYPECHECK: `npx tsc --noEmit`. IMPORTANT context: the only expected errors are Deno edge-function false positives in supabase/functions/*.ts (the `Deno` global and `https://esm.sh/...` imports are unknown to Node's tsc). Those are NOT real errors — ignore them. Flag ONLY errors in app code (app/**, src/**), which would be real.

4. FULL BUNDLE EXPORT (the decisive check that the OTA/build will compile): `npx --yes expo export --platform ios --platform android --output-dir .expo-export-check`, then delete the output dir with `rm -rf .expo-export-check`. Success = both platforms bundle with no missing-module or import errors. Report the module counts (e.g. "iOS 1444 / Android 1451 modules") and EXPORT_EXIT code. A non-zero exit or any bundling error is a hard blocker.

5. ASSET PRESENCE: confirm every asset referenced in app.json exists on disk: assets/icon.png, assets/android-icon-foreground.png, assets/android-icon-background.png, assets/android-icon-monochrome.png, assets/favicon.png. Flag any missing.

6. ENV VARS: confirm all four EXPO_PUBLIC_ vars are non-empty in .env (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_MAPBOX_TOKEN, EXPO_PUBLIC_ADMIN_EMAIL). Mask values in output. Note that the actual production build uses EAS secrets, not this local .env.

7. SUPABASE PROJECT MATCH: confirm EXPO_PUBLIC_SUPABASE_URL project ref matches the ref used by the edge functions / site redirects (expected: wtaefyspddadcrnovumk). Mismatch is a blocker.

8. VERSION / CHANNEL CONSISTENCY: read the LIVE values at run time (never assume): app.json expo.version, app.json expo.runtimeVersion, src/version.js APP_VERSION and BUILD, and eas.json build.production.channel. REQUIRE that app.json expo.version === app.json expo.runtimeVersion === src/version.js APP_VERSION — any mismatch among those three is a blocker. eas prod channel must be "production". src/version.js BUILD is the OTA/binary revision counter: report it and its WHATS_NEW string, and note that BUILD should be incremented on every OTA or new binary (so if you are validating right before a release and it still reads the last-shipped number, flag it as "remember to bump BUILD"). package.json version is cosmetic only (EAS reads app.json, not package.json) — mention if it differs but it is NOT a blocker.

9. DEEP-LINK ASSOCIATION (live): curl these two endpoints and confirm each returns HTTP 200 with content-type application/json and correct content:
   - https://localloop.io/.well-known/apple-app-site-association  (must list appID 3C95B37486.com.michaelwilliams.localloop and the /event/*, /garage-sale/*, /food-truck/* paths)
   - https://localloop.io/.well-known/assetlinks.json  (must list package_name com.michaelwilliams.localloop with TWO sha256_cert_fingerprints)
   Any non-200, wrong content-type, wrong app ID, or missing fingerprint breaks App Links / Universal Links for the build.

10. GIT WORKING TREE: `git status --short`. Report which files are dirty. Expected/ignorable: aggregator/* changes (routines). Flag anything uncommitted under app/**, src/**, tests/**, app.json, eas.json, or supabase/** as something that should be committed before tagging 1.0.4 — an OTA publishes the working tree, so uncommitted app code would ship unreviewed. Do not characterize the dirty files' contents from memory; just list them.

End with a one-line VERDICT: "BUILD-READY, no blockers" only if checks 1-9 are all clean, otherwise "NOT READY" followed by the specific blocker(s). Then a reminder of the ship sequence: build + submit 1.0.4 to the stores first; only after 1.0.4 is live do OTAs (`eas update --channel production`, runtimeVersion 1.0.4) reach users, since runtimeVersion is pinned to 1.0.4.
