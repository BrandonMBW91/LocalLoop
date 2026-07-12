# Routine: localloop-release-gate-104 (every 4 hours)

Local Loop "release gate" — check whether iOS 1.0.4 is live on the App Store yet and, if so, arm the update prompt AND send the update push to users.

NOTE (Jul 12 2026): the held OTA is NOT published by this routine. Michael will publish it manually when build 4 is released. Never run eas update from this routine.

Run exactly this (git-bash; the script reads its own config via import.meta.url, so no cd is needed):

  node /c/Users/micha/New/FindlayEvents/scripts/release-gate.mjs

What the script does: it queries App Store Connect for version 1.0.4's state.
- If 1.0.4 is NOT live yet (WAITING_FOR_REVIEW, IN_REVIEW, PENDING_DEVELOPER_RELEASE, PROCESSING_FOR_APP_STORE, etc.) it changes nothing and just prints the current state.
- Once 1.0.4 is READY_FOR_SALE (approved AND actually downloadable), it (a) flips the app_config version gate (public.app_config, key='version') so every iOS user below 1.0.4 gets the in-app "Update available" prompt, AND (b) sends a one-time broadcast push notification to all iOS devices telling them to update. It is idempotent — a no-op once already flipped (so the push fires exactly once).

Report the script's output (it prints one line if not live yet; on the flip it prints a "✔ Flipped…" line plus an "update push sent to N/… device(s)" line).
- If you see "✔ Flipped" then 1.0.4 IS LIVE — the in-app prompt is armed and the push was sent. Say so clearly (include how many devices got the push), ALSO email that news to michabw91@gmail.com via aggregator\send-email.mjs (subject "iOS 1.0.4 is LIVE — OTA awaiting your go"), and note that this scheduled task has done its job and can be turned off (list_scheduled_tasks then delete_scheduled_task for taskId "localloop-release-gate-104"). Do NOT publish any OTA — Michael publishes it manually when build 4 is released.
- Otherwise report the current App Store state in one short sentence (e.g. "1.0.4 still WAITING_FOR_REVIEW — no change yet").

Do not do anything else. Do not modify code or run other commands.
