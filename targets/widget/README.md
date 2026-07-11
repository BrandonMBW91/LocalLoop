# iOS home-screen widget (#8) — STAGED, not yet in the build

"This weekend in {town}" widget. Fully written, deliberately **not wired into the
EAS build yet** — an unverified native target can fail the whole build, which would
block the other features riding the next binary. Add it in its **own** build after
the #2/#6 binary is verified.

## What's here
- `LocalLoopWidget.swift` — the WidgetKit extension. Reads events from the App Group
  container `group.com.michaelwilliams.localloop`.
- `../../src/lib/widget.js` — the RN side. Writes the current town's next 3 events into
  that container on app open. Guarded require → no-op until the native pieces ship.

## To ship it (own build, after the #2/#6 binary)
1. `npx expo install @bacons/apple-targets react-native-shared-group-preferences`
2. app.json: add `"@bacons/apple-targets"` to plugins, and add the App Group
   entitlement `group.com.michaelwilliams.localloop` to BOTH the app and the widget
   target (the plugin reads `targets/widget/expo-target.config.js`).
3. Create `targets/widget/expo-target.config.js` declaring a `widget` target pointing
   at `LocalLoopWidget.swift` with the App Group entitlement.
4. Register the App Group on the Apple Developer portal for the app id, and enable it
   on the ASC provisioning profile (EAS can manage this with `eas credentials`).
5. Call `updateWidget(city.name, events)` from AppContext after events load (import is
   already safe/guarded).
6. `eas build -p ios --profile production`, install on a device, add the widget from
   the home-screen gallery, confirm it shows real events.

## Why staged, not shipped blind
Widgets can't be tested from CI or an OTA update — they need a real device build.
Wiring an unverified target into the build that also carries dark mode + near-me would
risk failing that build. Keeping it isolated protects the verifiable features.
