# Local Loop — App Store / Play Store listing kit

Everything you paste into App Store Connect and Google Play Console.

> NUMBERS: this kit uses live figures from `outreach/stats.json` (79 supported
> towns across Northwest, Central, and Northeast Ohio; 7,500+ upcoming events).
> Re-check that file at paste time so counts are current. The OLD kit said "18
> Northwest Ohio towns" — never paste a hardcoded count again.

---

## Names & short text

- **App name** (Apple ≤30 chars): `Local Loop`
- **Subtitle** (Apple ≤30): `Ohio events near you`
- **Promotional text** (Apple ≤170, editable anytime without review):
  `Now covering 79 Ohio towns across Northwest, Central, and Northeast Ohio. Find local events, garage sales, and food trucks near you, updated every morning. Free.`
- **Short description** (Google Play ≤80):
  `Local events, garage sales & food trucks across 79 Ohio towns.`

## Keywords (Apple, ≤100 chars, comma-separated, no spaces)
```
local events,ohio,findlay,akron,garage sale,food truck,things to do,community,festival,nearby
```

## Description (Apple + Google full description)
```
Local Loop is the easiest way to see what's happening around you in Ohio.

Browse local events, garage and yard sales, and food-truck stops across 79 towns
in Northwest, Central, and Northeast Ohio, from Toledo and Findlay to Akron,
Canton, and Youngstown, all in one place, grouped by Today, This Week, and beyond.

• See everything happening near you, sorted soonest-first
• Tap any event for directions or add it straight to your calendar
• Find garage sales and food trucks in your town
• See it all on a map, then zoom out to catch the towns nearby
• Save the events you care about
• Post your own event, sale, or food-truck stop in seconds
• Pick your town from 79 across the region

Built for everyone, with big readable text and simple navigation, so it's easy
whether you're 18 or 80. Free to use, and proudly local.

Have a town you'd like added? Just let us know.
```

## Other fields
- **Primary category:** Lifestyle  ·  **Secondary:** Travel
- **Age rating:** 4+ (no objectionable content)
- **Support URL:** https://localloop.io (required by Apple)
- **Marketing URL:** https://localloop.io (optional)
- **Privacy Policy URL:** host `docs/privacy.html` and paste the link (required by both)
- **Copyright:** `© 2026 Local Loop`
- **What's New:**
  `Now covering 79 Ohio towns across Northwest, Central, and Northeast Ohio, plus a new map view. Find local events, garage sales, and food trucks near you.`

---

## Screenshots

> ✅ `app.json` has `supportsTablet: false` (iPhone-only), so you only need the
> iPhone screenshots below, no iPad set required.

**iPhone (required) — portrait**
- 6.7" display: **1290 × 2796** (iPhone 15/16 Pro Max). This set satisfies the requirement.
- 6.5" display: 1242 × 2688 (optional, older devices)

**Google Play**
- Phone screenshots: min 2, at least 1080 px on the short side (your iPhone shots work)
- **Feature graphic (required): 1024 × 500** — `assets/social/play-feature-graphic.png` is ready.
- App icon: 512 × 512 — `assets/social/play-icon-512.png` is ready.

### Shot list (grab these from the phone)
1. **Events list** — the Today section with a couple of cards → "Everything happening near you"
2. **Event detail** — directions + add-to-calendar buttons → "Get directions or add to your calendar"
3. **Map view** — pins across the region → "See what's on across 79 towns"
4. **City picker** — the searchable town list → "79 towns across Northwest, Central, and Northeast Ohio"
5. **Post screen** — submitting an event → "Post your own in seconds"

Tip: turn the text size up one notch in Settings before screenshotting, it shows
off the readable, all-ages design.
