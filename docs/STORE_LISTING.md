# Local Loop — App Store / Play Store listing kit

Everything you paste into App Store Connect and Google Play Console. Copy is
ready to use; replace the two URLs once you've hosted them.

---

## Names & short text

- **App name** (Apple ≤30 chars): `Local Loop`
- **Subtitle** (Apple ≤30): `Events near you in NW Ohio`
- **Promotional text** (Apple ≤170, editable anytime without review):
  `Discover everything happening in your town — events, garage sales, and food trucks across Northwest Ohio. Free, local, and easy to use.`
- **Short description** (Google Play ≤80):
  `Local events, garage sales & food trucks across Northwest Ohio.`

## Keywords (Apple, ≤100 chars, comma-separated, no spaces)
```
local events,ohio,findlay,garage sale,food truck,things to do,community,calendar,festival,nearby
```

## Description (Apple + Google full description)
```
Local Loop is the easiest way to see what's happening around you in Northwest Ohio.

Browse local events, garage and yard sales, and food-truck stops across Findlay,
Lima, Perrysburg, Bowling Green, Tiffin, Sandusky, and a dozen more towns — all in
one place, grouped by Today, This Week, and beyond.

• See everything happening near you, sorted soonest-first
• Tap any event for directions or add it straight to your calendar
• Find garage sales and food trucks in your town
• Save the events you care about
• Post your own event, sale, or food-truck stop in seconds
• Switch between 18 Northwest Ohio towns

Built for everyone — big, readable text and simple navigation, so it's easy
whether you're 18 or 80. Free to use, and proudly local.

Have a town you'd like added? Just let us know.
```

## Other fields
- **Primary category:** Lifestyle  ·  **Secondary:** Travel
- **Age rating:** 4+ (no objectionable content)
- **Support URL:** _host a simple page or reuse your site_ (required by Apple)
- **Marketing URL:** optional
- **Privacy Policy URL:** host `docs/privacy.html` and paste the link (required by both)
- **Copyright:** `© 2026 Local Loop`
- **What's New (v1.0):**
  `Welcome to Local Loop! Discover local events, garage sales, and food trucks across Northwest Ohio.`

---

## Screenshots

> ✅ `app.json` already has `supportsTablet: false` (iPhone-only), so you only need the
> iPhone screenshots below — no iPad set required.

**iPhone (required) — portrait**
- 6.7" display: **1290 × 2796** (iPhone 15/16 Pro Max). This set satisfies the requirement.
- 6.5" display: 1242 × 2688 (optional, older devices)

**iPad (only if you keep tablet support)**
- 13": 2064 × 2752

**Google Play**
- Phone screenshots: min 2, at least 1080 px on the short side (your iPhone shots work)
- **Feature graphic (required): 1024 × 500** — a branded banner. I can generate this.
- App icon: 512 × 512 (I can export this from the logo)

### Shot list (grab these from TestFlight on your phone)
1. **Events list** — the Today section with a couple of cards → caption: "Everything happening near you"
2. **Event detail** — directions + add-to-calendar buttons → "Get directions or add to your calendar"
3. **Garage sales or food trucks tab** → "Garage sales & food trucks, too"
4. **City picker** — the searchable town list → "18 towns across Northwest Ohio"
5. **Post screen** — submitting an event → "Post your own in seconds"

Tip: turn the text size up one notch in Settings before screenshotting — it shows
off the readable, all-ages design.
