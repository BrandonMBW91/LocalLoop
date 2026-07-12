# Routine: ll-ad-test (daily 8:18 AM)

Run the Local Loop Facebook ad test/control tracker and report the result.

Context: this routine measures a paired baseline test to decide whether $5/day Facebook ads are worth scaling. Three TEST towns (Canton, Sandusky, Tiffin) each run a $5/day Traffic ad plus a free community post; three matched CONTROL towns (Youngstown, Ashland, Bucyrus) get the free post only. The metric is per-town 30-day MAU (the same number the in-app Metrics screen shows). Net ad lift = test MAU gain minus control MAU gain, which cancels ordinary organic growth. Michael runs the ads manually; this routine only measures.

Steps:
1. From the repo root C:\Users\micha\New\FindlayEvents run:  node ad-test-tracker.mjs --email
   The --email flag is REQUIRED so the branded report is sent to michabw91@gmail.com; without it the script only prints and no email goes out. The script captures the baseline automatically on its very first run (that should be the morning the ads launch, before they can have any effect) and measures every later run against it.
2. Read the script output and reply with ONE compact line: the day (X of 7), the NET AD LIFT number, the cost per net user, and the VERDICT. Numbers first, plain language, no em-dashes.
3. Check the STATUS line in the output:
   - If it says RUNNING, you are done after the one-line summary.
   - If it says COMPLETE (this happens a couple days after the 7-day flight, once late installs have settled), the test is over. Turn this routine off so it stops running: use the scheduled-tasks tool to set the task ll-ad-test to enabled:false. Then say in your summary that the test is complete and the routine has been disabled.

Notes:
- Do NOT launch, boost, or post any ads yourself. This routine only reads numbers.
- If the script errors (for example a network failure), report the error in one line and stop; retry at most once.
- Never use em-dashes in anything you write.
