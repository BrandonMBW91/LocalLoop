# Findlay Events — Auto-Aggregator

Pulls events from public **iCal calendar feeds** into your Supabase `events`
table on a schedule, so the app fills itself. Aggregated events auto-approve.

Verified working against BGSU's feed (63 live events on first run).

## 1. One-time database setup
In the Supabase SQL Editor, run (in order): `schema.sql`, `moderation.sql`, then
**`../supabase/aggregator.sql`**. That adds the dedup key, the `event_sources`
table, and auto-approval for feed events.

## 2. Get your service-role key 🔒
Supabase → **Project Settings → API → `service_role` secret**. This key bypasses
security rules, so the aggregator can write events.
**Never commit it, never paste it in chat — only set it as a secret/env var.**

## 3. Try it (no writes)
```bash
cd aggregator
npm install
node aggregate.mjs --dry-run --url=https://events.bgsu.edu/calendar.ics --city=bowling-green --name="BGSU Events" --category=Education
```

## 4. Run it for real
```bash
# PowerShell:
$env:SUPABASE_URL="https://wtaefyspddadcrnovumk.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<your service_role key>"
node aggregate.mjs
```
It reads every **enabled** row in `event_sources`, pulls each feed, and inserts
new events (skipping ones it already imported).

## 5. Put it on a schedule (pick one)

### Option A — GitHub Actions (free, recommended)
A workflow is included at `.github/workflows/aggregate.yml`. Push this repo to
GitHub, then add two **repository secrets** (Settings → Secrets and variables →
Actions): `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It then runs daily.

### Option B — Netlify Scheduled Function
You already use Netlify. Wrap `aggregate.mjs` in a scheduled function (cron),
set the two env vars in the site settings.

### Option C — Supabase Edge Function + cron
Port to a Deno edge function and schedule it from the Supabase dashboard
(Database → Cron). Most "native" but the most setup.

### Option D — Manual / your PC's Task Scheduler
Just run `node aggregate.mjs` on a daily schedule on any always-on machine.

## Adding more sources
Insert rows into `event_sources` (via the Supabase Table Editor):
| column | example |
|---|---|
| city_id | `findlay`, `fostoria`, `tiffin`, `bowling-green` |
| name | `University of Findlay` |
| url | the calendar's **.ics** feed URL |
| default_category | `Education`, `Community`, `Music`, … |
| enabled | `true` |

### Where to find `.ics` feed URLs
- **University / Localist calendars** (like BGSU): add `.ics` — e.g.
  `https://events.<school>.edu/calendar.ics`. Also works for a single group, e.g.
  `https://events.bgsu.edu/group/student_engagement/calendar.ics`.
- **Google Calendars**: the public calendar's "Public address in iCal format".
- **Libraries / civic sites**: look for a "Subscribe / iCal / Export" link on the
  calendar; copy the `webcal://` or `.ics` URL.
- If a source has **no feed** (e.g. a Facebook page), it can't be auto-pulled —
  add those by hand with the in-app "Add an event" tool.

## Notes
- Only events in the **next 60 days** (and not already past) are imported.
- Re-running is safe — duplicates are skipped via each event's `source_uid`.
- To stop a noisy source, set its `enabled = false` (no code change).
