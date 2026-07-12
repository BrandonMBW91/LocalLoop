# Routine: ll-morning-brief (daily 8:28 AM)

Produce Michael's Local Loop morning ops brief. Repo: C:\Users\micha\New\FindlayEvents. Four checks, then one compact summary (numbers first, plain language, no em-dashes):

1. DAILY REPORT: from the repo root run `node daily-report.mjs --email` (the --email flag is REQUIRED to send the full report to michabw91@gmail.com; without it the script only prints and no email goes out). Pull the headline numbers from its output for the brief: total upcoming events, 30-day active devices, and the iOS vs Android split (Android count matters most, he is tracking closed-test adoption).

2. OVERNIGHT CLOUD RUN: `gh run list --workflow=aggregate.yml --limit 1` from the repo root, and CHECK THE DATE: the run must be from today (or late last night ET). A green run from YESTERDAY means the overnight cron did not fire, which is itself a failure to report. If status is in_progress, say so. If the latest run failed, `gh run view <id> --log` and summarize which step broke in one line. Only if it is green AND from today, say the pipeline is healthy.

3. LOCAL 7AM REFRESH: check the tail of aggregator\local-refresh.log. The stamp format is "done <date> <time>" on success and "FAILED <date> <time>" on failure (both dated). Healthy = a "done" line with TODAY'S date. A FAILED line from today means the refresh ran and broke (read the log lines above it). No line from today means the task did not fire (machine off at 7am is the usual cause).

4. FEED HEALTH: from aggregator\ run `node feed-health.mjs`. Report the DEAD count and name any dead sources that are NOT Eventbrite jsonld rows (Eventbrite 405s are a known CI artifact that the 7am local refresh clears; only worth flagging if they persist AFTER a successful local refresh). Flag STALE sources by name, they mean a feed has quietly died.

End with one line: ghost/thin towns only if changed from the usual (LaRue, Prospect, Green Camp empty is normal), and while the Android closed test is running, remind him only on Mondays to glance at the Play Console tester opt-in count (needs 12).
