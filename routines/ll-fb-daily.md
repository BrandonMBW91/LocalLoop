# Routine: ll-fb-daily (daily ~9:00 AM)

Email Michael the day's Facebook-group posting plan, drawn from his own tracker. Repo: C:\Users\micha\New\FindlayEvents. Numbers first, plain language, no em-dashes.

1. RUN IT LIVE: from the repo root run `node fb-daily-plan.mjs --email` (the `--email` flag is REQUIRED; without it the script only prints and no email goes out, and no log is written). This reads `fb-groups.json` (the tracker's data file), picks up to 3 groups still marked "new", writes a post draft tailored to each group's type and town, emails the plan to michabw91@gmail.com, and appends what it suggested to `.fb-plan-log.json`.

2. WHAT IT DOES, so you can sanity-check the run output:
   - Suggests only groups with status `new`, one per area first (sibling-town spacing), skipping any group already suggested in the last 10 days (cooldown, read from `.fb-plan-log.json`).
   - Draft type is chosen from each group's name + rules: community roundup (real event bullets for towns with data), garage-sale utility, food-truck angle, nostalgia, advertiser pitch (B2B, carries the localloop.io/advertise URL), or events-only for no-promotion groups. A no-promotion group with no upcoming events is skipped (nothing safe to post).
   - Every draft is family-safe filtered (same adult/profanity/garbage filter as the weekend routine) and dash-free, ends with a native engagement question, and uses the plain-text "search Local Loop" CTA (no App Store URL in the body). It never writes "comment and I'll add it" style CTAs.
   - Per-group cautions (admin pre-approval, no links, rate limits, business-thread-only, personal-profile-required) are surfaced from the rules.

3. REPORT one compact line to Michael: how many groups it suggested today, how many are still "to post", how many are pending admin approval, and how many have been removed. If the run suggested 0 (everything on cooldown or none left), say so plainly.

3b. CHECK-BACK REMINDER: every email also carries a "Check back on these" list, the groups suggested in the last 14 days that are now `pending` or `posted`, so Michael can confirm whether each was approved, declined, or removed and update the tracker. It clears itself as statuses move off pending/posted.

4. THE LOOP: after Michael posts a draft, he marks that group in the tracker (Posted / Removed / Pending) with a reason. The tracker auto-saves to `fb-groups.json`, so the next run stops suggesting done groups and keeps the removed ones visible to rework. If the removed count is climbing (already 29 as of Jul 13, mostly "no reason given"), flag it: a Page posting into community groups is getting auto-removed, and the approach may need rethinking (post from the personal profile, space further, lead with pure event value).

Notes: dry check is `node fb-daily-plan.mjs` (prints only). Tune the batch size with `--count=N` (default 3). Do not let the batch exceed ~8/day: a Page posting the same pitch across many groups fast is a spam-ban signal.
