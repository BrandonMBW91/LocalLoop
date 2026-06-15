# Backend setup — connecting the app to Supabase

The app code is already written. These are the steps that need *your* login.
Until you finish them, the app keeps running on the bundled sample data, so
nothing is broken in the meantime.

Estimated time: ~20 minutes.

## 1. Create the Supabase project
1. Go to https://supabase.com and sign up (free).
2. Click **New project**. Give it a name (e.g. `findlay-events`), set a database
   password (save it somewhere), pick the region closest to Ohio
   (**East US / Ohio** if offered).
3. Wait ~2 minutes for it to finish provisioning.

## 2. Create the tables + security rules
In the project, open **SQL Editor** → **New query**, then run these files **in
order** (open each from `supabase/`, copy all, paste, **Run** — expect "Success").
Each is safe to re-run, so if you add a new one later just run that one.

1. `schema.sql` — tables, security rules, reports, photo storage.
2. `moderation.sql` — auto-approve/hold filter, admin powers, reported-post review.
3. `aggregator.sql` — calendar feed table + auto-approval for imported events.
4. `analytics.sql` — view counters (the "👁 N views" you see as admin).
5. `sponsors.sql` — ads + paid "featured" listings, with auto-expiry.

Then (optional, recommended) run `seed.sql` to load sample Findlay events and
garage sales so the app isn't empty while you test.

## 3. Get your two keys into the app
1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In this project, copy `.env.example` to a new file named `.env` and paste
   them in:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
4. Restart the app: stop `expo start` and run `npx expo start -c` (the `-c`
   clears the cache so it picks up the new keys). The app now reads live data.

## 4. Email sign-in (to let people post) — free, no SMS provider
Posting requires signing in. The app is set up for **email one-time codes**,
which need no paid provider:
1. In Supabase, go to **Authentication → Providers → Email** and make sure it's
   enabled (it is by default).
2. Go to **Authentication → Email Templates → Magic Link** and make sure the
   template includes the code token, e.g. add a line:
   `Your code is: {{ .Token }}`
   (This is what shows the 6-digit code the app's sign-in screen asks for.)
3. That's it — the in-app email sign-in screen is already built and will work.

> Want phone-number sign-in for launch instead? That needs an SMS provider
> (Twilio, ~pennies per text). Switch `requestOtp`/`verifyOtp` in
> `src/context/AppContext.js` back to the phone version and enable
> Authentication → Providers → Phone. Ask me and I'll flip it.

## 5. Moderate posts (your daily routine) — from your phone
Clean submissions auto-publish; anything risky (a link, phone number, or flagged
wording) is held. As the admin (signed in as the email in `moderation.sql`):
1. **Settings → Review submissions** shows everything waiting, plus a **🚩 Reported**
   section for posts neighbors have flagged. Approve / Reject / Keep / Remove
   right there — no dashboard needed.
2. The badge on that row tells you how many are waiting.

## 6. Make money — sponsors & featured listings
- **Settings → Manage sponsors & ads**: create a local ad (business name, blurb,
  link, optional image, run length). It appears between listings for that city
  and pauses itself when it ends.
- On any event / sale / food-truck page you'll see a **moderator promotion** box:
  feature it for 7 or 30 days to float it to the top with a ★ badge. Promotions
  expire automatically (the daily aggregator clears lapsed ones).
- Payments aren't wired up — you collect off-app for now (Venmo/invoice) and flip
  the switch. A real in-app purchase flow can come later.

## Costs recap
- Supabase: **free** to launch; ~$25/mo only once you grow.
- Twilio SMS: **pennies** per sign-in code.
- Apple Developer **$99/yr** + Google Play **$25 once** when you publish.
