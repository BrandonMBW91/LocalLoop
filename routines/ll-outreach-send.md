# Routine: ll-outreach-send (weekdays 8:09 AM)

Run the Local Loop outreach sender and report the result. Repo: C:\Users\micha\New\FindlayEvents.

1. From C:\Users\micha\New\FindlayEvents\aggregator run: node send-queue.mjs
   (The script is fully self-managing: warm-up ramp quota, bounce sweeps with top-up, MX pre-checks, opt-out suppression, town interleave, Mon-Sat 8am-8pm ET send window, follow-ups once warmed, circuit breaker. Do NOT pass --force.)
2. Read its output and outreach/last-run.json, then give Michael a SHORT summary: how many sent today (and toward which towns), bounces handled, and MOST IMPORTANTLY any lines marked "REPLY — review": list each replier's name/email prominently, because a reply from a business or food truck is a warm lead he should answer personally the same day.
3. If there are ANY replies to review OR a circuit-breaker ALERT, ALSO email the summary to michabw91@gmail.com via: node send-email.mjs --to=michabw91@gmail.com --subject="Outreach: replies to review" --file={temp file} — because these signals otherwise live only in the Zoho inbox he does not routinely read. If nothing needs his attention, the in-app summary is enough.
4. If the output contains a circuit-breaker ALERT (high bounce rate) or the run fails entirely, lead with that in plain language and stop.

Style: plain language, numbers first, no em-dashes anywhere. The queue includes both venue/sponsor leads and food-truck awareness leads (drafts 420-488 are trucks); no distinction needed in the summary beyond flagging replies.
