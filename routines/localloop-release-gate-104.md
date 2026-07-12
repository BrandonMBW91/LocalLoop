# Routine: localloop-release-gate-104 (every 30 minutes)

Local Loop "release gate" — check whether iOS 1.0.4 is live on the App Store yet and, if so: arm the update prompt, send the update push, AND publish the held OTA. Michael pre-authorized the OTA publish on Jul 12 2026 ("wait for approval, fire the OTA the moment the gate flips").

Run exactly this (git-bash; the script reads its own config via import.meta.url, so no cd is needed):

  node /c/Users/micha/New/FindlayEvents/scripts/release-gate.mjs

What the script does: it queries App Store Connect for version 1.0.4's state.
- If 1.0.4 is NOT live yet (WAITING_FOR_REVIEW, IN_REVIEW, PENDING_DEVELOPER_RELEASE, PROCESSING_FOR_APP_STORE, etc.) it changes nothing and just prints the current state.
- Once 1.0.4 is READY_FOR_SALE (approved AND actually downloadable), it (a) flips the app_config version gate (public.app_config, key='version') so every iOS user below 1.0.4 gets the in-app "Update available" prompt, AND (b) sends a one-time broadcast push notification to all iOS devices telling them to update. It is idempotent — a no-op once already flipped (so the push fires exactly once).

Then act on the script's output:

A. Output says "not live yet" (WAITING_FOR_REVIEW, IN_REVIEW, etc.): report the state in one short sentence and STOP. Do nothing else.

B. Output shows "✔ Flipped" OR "latest already 1.0.4 — prompt already armed" (a previous run flipped it): 1.0.4 IS LIVE. Now publish the held OTA, exactly like this:

   1. Idempotence check — from the repo root run:
        npx eas-cli update:list --branch production --limit 5 --non-interactive
      If any listed update has the message "1.0.4 launch OTA", the OTA already
      shipped. Report "gate flipped and OTA already published" and STOP.
   2. Clean-tree guard — run: git status --porcelain -- app src app.json package.json eas.json
      If it prints ANYTHING, do NOT publish (an OTA ships the working tree, and a
      dirty tree means unreviewed changes would go out). Email Michael instead:
      from aggregator\ run node send-email.mjs --to=michabw91@gmail.com
      --subject="1.0.4 is LIVE but OTA held: dirty working tree" with a body
      listing the dirty files, then STOP.
   3. Publish — from the repo root run:
        npx eas-cli update --channel production --message "1.0.4 launch OTA" --non-interactive
   4. Verify — run update:list again and confirm the new update (both platforms,
      runtimeVersion 1.0.4) is at the top.
   5. Report loudly: 1.0.4 live, prompt armed, push sent to N devices, OTA
      published (include the update group id and git HEAD from git log -1
      --oneline). Also email that summary to michabw91@gmail.com via
      aggregator\send-email.mjs. Then disable this task (update_scheduled_task
      taskId "localloop-release-gate-104" enabled:false) — its job is done.

Do not do anything else. Do not modify code. Never publish with a dirty tree.
