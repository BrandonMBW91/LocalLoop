# Expo HAS CHANGED

This project is on **Expo SDK 54** (`expo` 54.0.35, `react-native` 0.81.5,
`expo-router` 6.0.24, `expo-updates` 29.0.18 — verified against node_modules, not just
package.json). Read the exact versioned docs before writing any code:

**https://docs.expo.dev/versions/v54.0.0/**

Do not read `latest`, and do not trust a version quoted in prose. This line said v56 and
README said "SDK 56 · React Native 0.85" until 2026-07-16, while the installed tree was
54 — so every agent session was being sent to the docs for an SDK the app does not run.
Confirm with `node -e "console.log(require('expo/package.json').version)"` if in doubt.

The New Architecture (Fabric) is ON — it is the default from SDK 54. That is not
cosmetic: it is stricter than the old renderer and it is what made `removeClippedSubviews`
crash every Android launch for five days.

# OTA updates: the runtime rule

`runtimeVersion` is currently the LITERAL `"1.0.4"`, matching the live iOS build and
Android versionCode 9. An update only reaches a binary whose runtimeVersion string
matches **exactly**. There is no fuzzy matching and `eas update` has no
`--runtime-version` flag: it publishes to whatever the app config computes, and
anything else silently reaches nobody — while still exiting 0 and reporting success.

**A literal means YOU are asserting JS/native compatibility by hand, every publish.**
That assertion is what broke the app on 2026-07-10. It is only safe while the change
set is pure JS. Verify that before every publish:

    git diff package.json | grep -E '^[-+]\s*"(expo|react|@react|@expo)'   # must be empty
    git diff app.json | grep -iE 'plugin|permission|scheme'                # must be empty

If either has output, the change needs a NEW BINARY, not an OTA.

**The target is `{"policy": "fingerprint"}`**, which makes that mistake structurally
impossible: adding native code changes the runtime automatically and EAS refuses to
send the JS to a binary that cannot run it. Adopt it on the next release that ships a
binary anyway (see the cut-off cost below) — switching it on its own buys nothing and
strands every live user from hotfixes until new binaries reach them.

Check where an OTA will actually land BEFORE publishing. **Per platform, separately:**

    npx @expo/fingerprint fingerprint:generate --platform ios
    npx @expo/fingerprint fingerprint:generate --platform android
    npx eas-cli build:list --platform android      # the runtime live binaries have

Run it BARE and you get a third, all-platforms hash that matches neither binary and
means nothing. iOS and Android have SEPARATE runtimes that drift independently, so
any script, doc or routine that compares "the" runtimeVersion is wrong by construction.

The fingerprint also covers far more than native code: `eas.json` whole-file, the
`package.json` scripts block, `.gitignore`, and `app.json` version all feed it. Editing
the web deploy script changes the mobile runtime and silently cuts OTAs. Never assume a
change is OTA-safe because it "isn't native" — measure it.

If publish-runtime and binary-runtime differ, the OTA goes into the void. Worse, it
exits 0 and reports success. That is not hypothetical:

- **2026-07-10 20:26** `expo-location` was added and OTA'd as rev 102 to binaries
  with no such native module. The runtime literal was not bumped until 22:33, so
  for two hours incompatible JS could ship to live phones. It did, and every
  Android tester's app crashed on launch.
- Every fix afterwards (rev 103-108) published to runtime `1.0.4`, which those
  `1aa93c…` binaries can never see. They sat on the broken bundle for five days.
  The only ways out were a new binary or `update:roll-back-to-embedded`.

The fingerprint policy exists to make that class of mistake impossible: adding
native code changes the runtime automatically, so EAS refuses to send the JS to a
binary that cannot run it. Do not replace it with a hardcoded string. A literal
means *you* are asserting JS/native compatibility by hand, and that assertion is
what broke the app.

## Changing the runtime cuts off OTAs to existing binaries

Users on the old runtime stop receiving updates until they install a new binary.
So a runtime change must be paired with a build+release on **both** platforms.
Between the change and the release there is no OTA hotfix path for live users;
if you need one in that window, the escape hatch is to temporarily set
`runtimeVersion` back to the literal the live binary was built with, publish, and
restore the policy.
