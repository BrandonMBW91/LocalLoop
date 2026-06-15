# Findlay Events 📍

A hyperlocal mobile app showing community events in Findlay, OH (and nearby
cities), built for iPhone and Android from a single codebase with **Expo /
React Native**. Designed to be simple enough for any age — large text, high
contrast, big buttons, and a built-in text-size control.

## What's working right now (prototype)

- **Events list** — browse local events with search + category filters
- **Event details** — date/time, tap-for-directions map link, cost, share
- **Garage Sales** — dedicated tab: browse garage/yard/estate/moving sales with
  "This Week" filter + filter by what's for sale; **photo uploads** (up to 4 per
  sale, shown as thumbnails + a gallery on the detail); detail leads with a big
  **Get Directions** button; multi-day sales with daily hours and item tags
- **Food Trucks** — dedicated tab: trucks post where & when they'll be parked;
  "Today" filter + filter by cuisine; "TODAY / TOMORROW" badges; detail leads
  with **Get Directions** so people can find the truck
- **Post** — one simple chooser: Post an Event / Garage Sale / Food Truck, each
  with a friendly form (saved on-device in the prototype, pending review)
- **Settings** — switch cities, adjust text size (Normal / Large / Extra Large), saved events
- **Featured listings** — promoted events/sales/trucks sort to the top with a
  ★ badge (the paid-boost revenue mechanic); "Advertise" screen in Settings
- **Trust & safety** — every submission is screened for profanity/spam/links
  before the pending queue; a **Report** button on every listing; the backend
  auto-hides anything reported 3+ times for re-review
- **Add to Calendar** — one tap from an event into the phone's calendar
- **Ad slots** — placeholder banners showing where revenue ads go (real AdMob,
  in-app maps, and push notifications are documented in
  [`docs/NATIVE_FEATURES.md`](docs/NATIVE_FEATURES.md) — they need a device build)
- **Multi-city** — Findlay is live; Fostoria, Tiffin, Bowling Green are scaffolded

Sample Findlay events use real local venues (Marathon Center, Riverside Park,
the public library, Dietsch Brothers, Hancock County Fairgrounds, etc.).

## See it on your phone (easiest)

1. Install the free **Expo Go** app from the App Store / Google Play.
2. On this computer, in this folder, run:
   ```
   npx expo start
   ```
3. Scan the QR code with your phone's camera (iPhone) or the Expo Go app
   (Android). The app opens instantly. Edits show up live.

To preview in a desktop browser instead: `npm run web`.

## Project layout

```
app/                 # Screens (file-based routing via expo-router)
  (tabs)/index.js          Events list (home)
  (tabs)/garage-sales.js   Garage sales list
  (tabs)/food-trucks.js    Food trucks list
  (tabs)/post.js           Post chooser (event / sale / food truck)
  (tabs)/settings.js       City + text size + account + about
  event/[id].js · event/new.js
  garage-sale/[id].js · garage-sale/new.js
  food-truck/[id].js · food-truck/new.js
  sign-in.js               Phone sign-in (when backend is on)
src/
  components/         EventCard, GarageSaleCard, FoodTruckCard, PhotoPicker,
                      AdBanner, CategoryChip, ThemedText
  context/           AppContext (city, text size, data loading, auth)
  data/              cities.js, events.js, garageSales.js, foodTrucks.js
  lib/               supabase.js (client), db.js (queries + photo upload)
  theme/             theme.js (colors, spacing, fonts — all tokens here)
  utils/             dates.js
supabase/            schema.sql, seed.sql, SETUP.md
```

## Roadmap (to ship for real)

### 1. Backend so events are shared by everyone — ✅ code built, needs your keys
The **Supabase** integration is already written. To turn it on, follow
[`supabase/SETUP.md`](supabase/SETUP.md): create a free project, run
[`supabase/schema.sql`](supabase/schema.sql) (+ optional
[`seed.sql`](supabase/seed.sql)), and paste two keys into `.env`.
- Until you add keys, the app runs on the bundled sample data (nothing breaks).
- Submissions insert as `status = 'pending'`; security rules keep pending posts
  hidden from the public until you approve them in the Supabase dashboard.
- Posting requires a **phone sign-in** (built); browsing stays open to all.
- Moderate by setting a row's `status` to `approved` in the dashboard.

### 2. The three content sources you chose
- **You curate** — add events yourself via the admin dashboard.
- **User submissions** — already built; wire the form to Supabase + moderation.
- **Auto-aggregate** — a scheduled job pulling public feeds (city/county
  calendars, library RSS, Eventbrite) into the `pending` queue for review.

### 3. Ads for revenue
Use **Google AdMob** via `react-native-google-mobile-ads`. The `AdBanner`
component is already isolated, so it's a drop-in replacement. Start with banner
ads; sell direct "featured business" placements to local shops later.

### 4. Push updates instantly
Set up **EAS Update** (`eas update`). After the apps are in the stores, most
changes (text, layout, new screens, data sources) push over-the-air without
waiting on app-store review.

### 5. Publish to the stores
- **Google Play**: $25 one-time. Build with `eas build -p android`.
- **Apple App Store**: $99/year. Build with `eas build -p ios` (no Mac needed —
  EAS builds in the cloud).

## Tech
Expo SDK 56 · React Native 0.85 · Expo Router · AsyncStorage
