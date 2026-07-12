# Routine: ll-evening-spotlight (daily 3:46 PM)

Decide whether tonight deserves a Local Loop spotlight push. Repo: C:\Users\micha\New\FindlayEvents. Most days the correct outcome is SEND NOTHING.

1. From aggregator\ run: node spotlight-candidates.mjs
   It prints tonight's and tomorrow's events per town (with view counts and each town's opted-in device count).
2. Apply a STRICT big-hitter bar. Qualifies: a genuinely regional draw such as a headline concert at a major venue, a big festival day, fireworks, a pro/marquee sports event, something with clearly elevated view counts. NEVER qualifies: library programs, storytimes, club meetings, farmers markets, routine classes, small fundraisers. When in doubt, send nothing.
3. If (and only if) something clearly qualifies AND its town has opted-in devices (or it is a true region-wide moment), fire the push:
   - Read CRON_SECRET and EXPO_PUBLIC_SUPABASE_ANON_KEY from C:\Users\micha\New\FindlayEvents\.env
   - First do a dry run: POST https://wtaefyspddadcrnovumk.supabase.co/functions/v1/spotlight with headers "Authorization: Bearer <anon key>", "x-cron-secret: <secret>", "Content-Type: application/json" and body {"city_id":"<town id or all>","title":"<short title>","body":"<one enticing sentence>","dry":true} — check the audience count is sane.
   - Then send the same body without "dry". The function enforces a 4-day cooldown per audience and will answer 429 "blocked: cooldown" — that is a normal outcome, accept it and stop (never pass force).
   - Push copy rules: short, concrete, no em-dashes, name the event and town, no exclamation spam.
4. Finish with one line: what was sent (title, town, audience) or "no spotlight today" with a half-sentence reason.
