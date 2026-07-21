@echo off
rem Daily cold-outreach send. Runs send-queue.mjs, which enforces its own rails:
rem the Mon-Sat 08:00-20:00 ET window, OUTREACH_MAX_DAILY, dedupe vs Zoho Sent +
rem sent-log, MX pre-check, bounce/opt-out sweeps, and the 2.5-5 min inter-send gap.
rem
rem MUST run from the desktop (residential IP). Outreach from the laptop is banned,
rem and send-queue's own OUTREACH_HOST gate (default BrandonPC) enforces that.
rem
rem Scheduled via Windows Task Scheduler as "local-loop-outreach-send"
rem (Mon-Fri 10:04, Start-When-Available so a logged-off morning catches up rather
rem than silently skipping). Created 2026-07-21 after discovering NO such task had
rem ever existed: outreach had only ever gone out when a Claude session triggered it
rem by hand, which is why sends landed on session days (Jul 12/13/17/18/20) instead
rem of every weekday.
rem
rem The stamp line is DATED and SUCCESS-GATED so a failed run can't look like a good
rem one (same lesson as local-refresh.cmd).
cd /d "%~dp0"
echo ======= %date% %time% ======= >> outreach-send.log
node send-queue.mjs >> outreach-send.log 2>&1 && (echo done %date% %time% >> outreach-send.log) || (echo FAILED %date% %time% >> outreach-send.log)
