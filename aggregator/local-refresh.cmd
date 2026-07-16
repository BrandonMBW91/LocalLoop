@echo off
rem Daily local top-up for sources that block GitHub Actions' datacenter IPs
rem (Eventbrite answers CI with HTTP 405 but a residential IP with 200 — caught
rem by feed-health on its first night; StreetFoodFinder sits behind Cloudflare,
rem which serves CI a challenge page with no vtok while this machine gets a
rem clean 200 — so the food-truck chain lives here too, NOT in the workflow).
rem Runs the feeds pass + geocode from this
rem machine at 7:00 AM, after the 5 AM cloud run, so only the blocked sources
rem have anything new. Scheduled via Windows Task Scheduler:
rem   "LocalLoop Eventbrite refresh" (daily 07:00, runs when logged on)
rem
rem The stamp line is DATED and SUCCESS-GATED: the old bare "done %time%" was
rem written even when node failed, so the morning brief's "done line from TODAY"
rem health check could pass on a completely failed (or yesterday's) run.
cd /d "%~dp0"
echo ======= %date% %time% ======= >> local-refresh.log
node aggregate.mjs >> local-refresh.log 2>&1 && node geocode.mjs >> local-refresh.log 2>&1 && (echo done %date% %time% >> local-refresh.log) || (echo FAILED %date% %time% >> local-refresh.log)

rem Food trucks: Cloudflare blocks the cloud runner, so the pull + the follower
rem push both run from this residential IP. Deliberately NOT chained into the
rem stamp above: an SFF hiccup must not mark the Eventbrite refresh FAILED (the
rem morning brief health-checks that done line). Trucks get their own stamp.
rem Pushing at 7 AM is also far kinder to followers than the 4:36 AM cloud run.
node truck-calendars.mjs >> local-refresh.log 2>&1 && node notify-truck-followers.mjs --send >> local-refresh.log 2>&1 && (echo trucks done %date% %time% >> local-refresh.log) || (echo trucks FAILED %date% %time% >> local-refresh.log)
