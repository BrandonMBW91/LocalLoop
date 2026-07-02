# Local Loop — Apple Search Ads (install-optimized campaign)

## ✅ LAUNCHED (Jul 1, 2026)
- **Campaign:** "Local Loop – Search Results Test" — but placement is **Search Tab**
  (the ASA UI kept defaulting to it; Search Results was the intent).
- **Targeting:** Findlay, OH **+25 mi** (geo-locked via audience Locations — this is
  what keeps it local, since Search Tab has no keywords).
- **Budget:** $5/day. **Max CPT:** $1.00. **Ad:** Default Product Page.
- **Status:** On hold, pending Apple's first-time app-for-ads review (clears on its own).
- Note: the keyword list below was NOT used (Search Tab has no keywords). If we ever
  redo this as a proper **Search Results** campaign, the keywords apply then.

---


A ready-to-launch install campaign, drafted as the alternative to the Facebook
engagement boost. Unlike the boost, this optimizes for and directly measures
**downloads**.

## Why Apple Search Ads (vs a Meta app-install campaign)
- **Separate from your Facebook account** — none of the boosting restrictions apply.
- **No SDK needed.** Apple attributes installs natively through the App Store.
  (A Meta iOS install campaign requires the Facebook SDK + SKAdNetwork wired into
  the app — a real dev setup we'd have to do first.)
- **Runs off your live App Store Connect** — the app, listing, and screenshots
  you already have are the ad creative automatically.
- **High intent + cheap.** People searching "findlay events" want exactly this,
  and those niche keywords have almost no competition.

## Setup (one time)
1. Go to **searchads.apple.com** → sign in with your Apple ID (same as App Store Connect).
2. Choose **Advanced** (gives keyword control; Basic just auto-spends — we want control).
3. Create a **Campaign** → app: **Local Loop** → storefront: **United States**.
4. Set the budget + an ad group with the keywords below.

## Campaign settings
- **Daily budget:** start at **$10/day** (matches your boost spend, easy to compare).
- **Default max cost-per-tap (CPT) bid:** **$1.00** (adjust after a few days of data).
- **Geo:** Apple Search Ads targets by **country, not city** — so localization comes
  from the **keywords** (only locals search the town names). Do NOT bid on generic
  national terms like "events app" — they'd show nationwide and waste spend.
- **Search Match:** ON (lets Apple auto-match relevant searches to your listing; cheap discovery).

## Keywords (exact match, hyperlocal — naturally local because they name the town)
```
findlay events
findlay ohio events
things to do in findlay
findlay ohio
garage sales findlay
findlay garage sales
food trucks findlay
flag city events
hancock county events
tiffin ohio events
fostoria ohio events
bowling green ohio events
lima ohio events
northwest ohio events
nw ohio events
```

## Negative keywords (block irrelevant searches so you don't pay for them)
```
jobs
weather
map
directions
hotels
restaurants
news
obituaries
university
college
football
rentals
homes for sale
```

## Creative
Nothing to make — Apple Search Ads **auto-builds the ad from your App Store listing**
(icon, "Local Loop — Findlay & NWO", the "NW Ohio events, sales & food" subtitle, and
your screenshots). The metadata refresh we shipped already does the work.
(Optional later: a Custom Product Page tuned to the ad, but not needed to start.)

## What to measure (Apple shows this directly — accurate, unlike the boost)
- **Installs** and **Cost per install (CPI)** — the numbers that matter.
- **Tap-through rate** and **conversion rate** (taps that become installs).
- **Target:** for a free local app, aim **CPI under $2-3**. Apple Search Ads for niche
  local keywords often lands **$0.50-$2 per install**.

## Success check (after ~3-4 days)
- If CPI is under ~$3 and installs are steady, scale the daily budget up.
- Compare installs-per-dollar here vs the Facebook boost. This should win on
  installs; the boost wins on reach/awareness. Running both is fine if budget allows.

## QUEUED — Channel #3: Snapchat Ads (do NOT launch until the first two tests conclude)

**Trigger:** launch only after (a) the Facebook boost finishes its 4 days AND (b) Apple
Search Ads has ~a week of data. If ASA lands installs under ~$2-3, scale ASA first and
keep Snap queued. If both underwhelm, Snap is the next test.

**Why Snap:** reaches the demographic the FB boost missed entirely (boost audience was
86% women 45-65+; Snap skews 13-30 — UF students, young families). Radius geo-targeting
works, CPMs are cheap ($3-8), and $5/day is the floor.

**Campaign spec (ready to paste):**
- Where: ads.snapchat.com (Snapchat Ads Manager, self-serve, separate from Meta)
- Objective: App Installs (swipe up -> App Store), app: Local Loop (ID 6780306721)
- Budget: $5/day, 7-day test, hard end date
- Geo: circle around Findlay, OH, 25 mi radius
- Age: 16-34 (the crowd the other channels don't reach)
- Creative: 9:16 vertical, 1080x1920. Simplest viable: animated screenshot walk-through
  of the events feed with July-4th-style content + "Everything happening in Findlay.
  Free." end card. (Claude can generate this from existing screenshots.)
- Measurement: Snap dashboard installs are unreliable without their SDK — judge it by
  the daily report device bump during the flight, same as the FB boost.

**Skip:** Snap Pixel / SDK integration for now (not worth the dev lift for a $35 test).

## Meta app-install alternative (bigger lift, note for later)
A Meta App Promotion campaign would give precise Findlay-radius geo + a younger skew,
but requires: registering the app in Meta's developer dashboard, SKAdNetwork config,
and integrating the Facebook SDK into the Expo app. That's a dev task (a few hours) —
worth doing later if you want Meta's install machine, but Apple Search Ads gets you
an install campaign live today with zero code.
