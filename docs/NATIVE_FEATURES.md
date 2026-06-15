# Native features: AdMob, Map, and Push notifications

These three features use **native code** that is **not available in Expo Go or
the web preview**. To run them you first need a **development build** of the app.
Everything else in the app keeps working without this.

## Why a development build?
Expo Go is a generic sandbox app — it can't load custom native modules like the
ad SDK, the maps SDK, or background push. A *development build* is your own app
binary that includes them. Make one with:

```
npx expo install expo-dev-client
npx eas build --profile development --platform android   # (or ios)
```

Install that build on your phone, then `npx expo start --dev-client`. From then
on it behaves like Expo Go but with native modules. (EAS builds in the cloud —
no Mac needed for iOS.)

---

## 1. Google AdMob (real ads)

The app ships with a placeholder `AdBanner`. Swap in real ads like this.

**Install + configure**
```
npx expo install react-native-google-mobile-ads
```
In `app.json` under `expo.plugins`, add (use your own AdMob app IDs):
```json
["react-native-google-mobile-ads", {
  "androidAppId": "ca-app-pub-XXXX~XXXX",
  "iosAppId": "ca-app-pub-XXXX~XXXX"
}]
```
Add your ad unit IDs to `.env`:
```
EXPO_PUBLIC_ADMOB_BANNER_ANDROID=ca-app-pub-XXXX/XXXX
EXPO_PUBLIC_ADMOB_BANNER_IOS=ca-app-pub-XXXX/XXXX
```

**Replace `src/components/AdBanner.js` with this** (keeps the placeholder on web
and in Expo Go, shows a real ad in a dev/production build):
```jsx
import React from 'react';
import { View, Platform } from 'react-native';
import Constants from 'expo-constants';
import { spacing } from '../theme/theme';
import PlaceholderAd from './AdBannerPlaceholder'; // rename the current file to this

const inExpoGo = Constants.appOwnership === 'expo';
const adUnit = Platform.select({
  android: process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID,
  ios: process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS,
});

export default function AdBanner(props) {
  // Fall back to the placeholder anywhere real ads can't run.
  if (Platform.OS === 'web' || inExpoGo || !adUnit) return <PlaceholderAd {...props} />;
  const { BannerAd, BannerAdSize } = require('react-native-google-mobile-ads');
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
      <BannerAd unitId={adUnit} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />
    </View>
  );
}
```
Use Google's **test** ad unit IDs while developing so you don't risk your account.

---

## 2. In-app Map view

Show events, garage sales, and food trucks as pins.

**Install**
```
npx expo install react-native-maps
```

**Add `src/components/MapPanel.native.js`** (native only):
```jsx
import React from 'react';
import MapView, { Marker } from 'react-native-maps';
import { StyleSheet } from 'react-native';

// Findlay, OH center. Geocode addresses to lat/lng in your backend, or store
// lat/lng columns on each listing for accurate pins.
const FINDLAY = { latitude: 41.0442, longitude: -83.6499, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export default function MapPanel({ pins = [], onPressPin }) {
  return (
    <MapView style={StyleSheet.absoluteFill} initialRegion={FINDLAY}>
      {pins.filter(p => p.lat && p.lng).map((p) => (
        <Marker key={p.id} coordinate={{ latitude: p.lat, longitude: p.lng }}
          title={p.title} description={p.subtitle} onCalloutPress={() => onPressPin?.(p)} />
      ))}
    </MapView>
  );
}
```

**Add `src/components/MapPanel.web.js`** (web fallback so the bundle still builds):
```jsx
import React from 'react';
import { View } from 'react-native';
import ThemedText from './ThemedText';
export default function MapPanel() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ThemedText size="body">The map is available in the phone app.</ThemedText>
    </View>
  );
}
```
Metro automatically picks `.native.js` on phones and `.web.js` on web. Add a
"Map" button on the Events/Sales/Food lists that opens a screen rendering
`<MapPanel pins={...} />`. **You'll need latitude/longitude per listing** — the
simplest path is to geocode the address when a post is approved and store
`lat`/`lng` columns (add them to the tables like the other fields).

---

## 3. Push notifications + "this weekend" alerts

**Install**
```
npx expo install expo-notifications expo-device
```

**Register a device for push** (`src/lib/push.js`):
```js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from './supabase';

export async function registerForPush(userId) {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  // Save the token so your server can message this phone later.
  await supabase.from('push_tokens').upsert({ user_id: userId, token });
  return token;
}
```
Add a `push_tokens` table (user_id, token, city_id) to `supabase/schema.sql`.

**Send "5 events this weekend" from a Supabase Edge Function** (runs on a
schedule): query approved events for the coming weekend per city, then POST to
Expo's push API:
```js
await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(tokens.map(t => ({
    to: t.token,
    title: 'This weekend in Findlay',
    body: `${count} events happening near you`,
  }))),
});
```

**Per-event reminders** can be scheduled locally with
`Notifications.scheduleNotificationAsync` when a user saves an event — or use the
**Add to Calendar** button (already built, works everywhere) so their calendar
app reminds them. For most users, Add to Calendar is the simpler win.

---

## Suggested order
1. **Add to Calendar** — already live, no build needed.
2. **AdMob** — once you have a dev build and an AdMob account.
3. **Push** — needs the Edge Function + a token table; highest retention payoff.
4. **Map** — needs lat/lng per listing (geocoding step) to be useful.
