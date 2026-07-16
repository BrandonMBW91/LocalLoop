# Local Loop

Ohio's local events, garage sales, and food trucks — one app per town, 135 towns.

**This is live software with paying customers.** iOS 1.0.4 is on the App Store, Android
is in Play closed testing, and [localloop.io](https://localloop.io) serves the same app
on the web. Stripe is in LIVE mode. ~11,000 upcoming events, ~21,600 rows total — almost
all ingested from ~130 public feeds rather than typed in by users.

> **Read [AGENTS.md](AGENTS.md) first.** It holds the rules that are not guessable from
> the code — chiefly how OTA updates reach, or silently fail to reach, real phones.
> Getting that wrong caused a five-day Android outage.

## The one-paragraph architecture

One Expo (SDK 54 / RN 0.81.5) codebase ships **three surfaces**: the iOS app, the Android
app, and the website. `app/` is a thin expo-router tree and **navigation holds no state**
— everything (selected town, hydration, events, sponsors, the analytics kill-switch,
auth) lives in `src/context/AppContext.js`, and `src/lib/db.js` is the only code that
talks to Supabase. The website is **not** `site/`; it is the Expo web export, assembled
by `scripts/build-web.mjs`. The `aggregator/` fills the database from public calendars.

## Where to start reading

| you want to change… | start at |
|---|---|
| anything at all | `AGENTS.md` — the rules |
| app state / data | `src/context/AppContext.js`, then `src/lib/db.js` |
| a screen | `app/` — the file path *is* the route |
| the website | `scripts/build-web.mjs` — read its header first |
| event ingestion | `aggregator/aggregate.mjs` → `makeRow()`, the only quality gate |
| moderation / content safety | `supabase/moderate_submission.sql` — **the** definition |
| colors, spacing, type | `src/theme/theme.js` |

## Things that will bite you

- **OTA updates match on an exact `runtimeVersion` string.** Publish against the wrong
  one and it reaches nobody *and exits 0*. It is an OTA if and only if the change is
  pure JS; native dependency or native config means a new binary, no judgement calls.
  AGENTS.md has the gate that proves which. This is the most expensive mistake available
  in this repo, and it has already been made.
- **Hermes has no reliable `Intl` on Android.** No `toLocaleString`,
  `toLocaleDateString`, or `timeZone` options in app code — use `src/utils/dates.js`.
  This has regressed twice, most recently five days after an audit declared it clean.
- **`site/_redirects` and `site/_headers` are dead files.** `build-web.mjs` skips one and
  overwrites the other; the live routing rules are string literals inside that script.
- **Never `netlify deploy` without `--site`.** A stray link in a parent folder once
  pointed this repo at a *different* live business. `npm run deploy:web` pins the id.
- **`supabase/` is ~50 flat `.sql` files with no migration runner.** File order means
  nothing and mtime is not history. The database is the source of truth — confirm with
  `pg_get_functiondef` before editing any function.
- **The anon key is compiled into the shipped bundle.** Anything `EXPO_PUBLIC_*` is
  public. Private tables are RPC-only, and the authorization check lives *inside* the
  function body — RLS is row-level and cannot restrict columns.
- **Two `.env` files.** Root holds the app/Expo keys; `aggregator/.env` holds
  `SUPABASE_SERVICE_ROLE_KEY`. Scripts that need the service key read both.

## Layout

```
app/          expo-router screens (routes = file paths)
src/          components, context, lib, data, theme — the app's brain
aggregator/   ingestion from ~130 feeds (9 connector types), plus outreach tooling
scripts/      build-web.mjs (the website), build-seo.mjs (SEO pages)
site/         static pages MERGED INTO the web build — not the site itself
supabase/     schema, RLS, SECURITY DEFINER RPCs
routines/     specs for the scheduled agents
docs/         deploy, store listing, adding a city, native features
tests/        node --test
```

## Commands

```bash
npx expo start                        # dev
npm test                              # tests
npm run deploy:web                    # build + deploy localloop.io (site id pinned)
cd aggregator && node aggregate.mjs   # pull feeds into Supabase
```
