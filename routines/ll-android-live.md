# Routine: ll-android-live (daily 9:10 AM, from 2026-07-22)

Check whether Local Loop's Android app has gone public on Google Play, and if it has, tell Michael it is time to flip the app over to it.

Context: Android has been in Play CLOSED TESTING since early July. Google will not let it publish until 12 testers have been opted in for 14 CONTINUOUS days. As of 2026-07-16 that counter read "12 testers have currently been opted in for 8 days continuously", which puts the earliest possible publish date at 2026-07-22. It is exactly 12, the bare minimum, with no margin: if a single tester taps "Leave the program" the count drops to 11 and the streak breaks, so the date can slip. That is why this routine re-checks every day instead of firing once on the 22nd.

Why it matters: while Android is not public, `ANDROID_LIVE` is false, and `src/components/WebInstallBanner.js` therefore shows Android visitors NOTHING. Roughly half of mobile web traffic is Android, so every Android visitor to localloop.io currently has no way to install. The paid Facebook ads (through 2026-07-23) send cold mobile traffic to localloop.io/?city=<town>, so a meaningful share of that spend is buying clicks with no destination. Flipping the moment the listing is live closes that hole and costs nothing.

Steps:
1. From the repo root C:\Users\micha\New\FindlayEvents run:  node scripts/android-live.mjs
   This only reads. It fetches the public Play listing and reports whether it is live, plus the current state of the two things that must change.
2. Read the output:
   - If it says "NOT READY" (the listing still 404s), reply with ONE line: not public yet, and that you will check again tomorrow. You are done. Do not change any files.
   - If it says "READY", reply with ONE line saying Android is public and the flip is ready to run, and STOP there. Do not apply it yourself.
3. If it says "Already flipped. Nothing to do.", the work is finished. Turn this routine off so it stops running: use the scheduled-tasks tool to set the task ll-android-live to enabled:false. Say in your summary that Android is live and the routine has been disabled.

Do NOT run `--apply` yourself. Flipping ships to real users and needs both an OTA and a web deploy, so Michael decides when. Your job is to notice the day it becomes possible, which is the part that is easy to miss.

When Michael gives the go, the full sequence is:
1. node scripts/android-live.mjs --apply     (edits src/lib/links.js + site/open.html)
2. bump BUILD in src/version.js
3. npm test
4. commit the release
5. node scripts/build-changelog.mjs   (AFTER the commit, it reads committed history)
6. commit src/data/changelog.js
7. npx eas-cli update --branch production    (the app + install banner)
8. npm run deploy:web                        (open.html, which is a static page)
Steps 7 AND 8 are both required. The banner rides the JS bundle; open.html does not. Doing only the OTA leaves Android visitors on the web still being asked to email Michael to join a test that no longer exists.

Notes:
- The script refuses to apply while the listing 404s, so an early run cannot do damage.
- Do not touch the tester list or the Play Console.
- Never use em-dashes in anything you write.
