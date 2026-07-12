# Local Loop routines

Each routine's full logic lives here as `<task-id>.md`, version-controlled and
edited in this repo. The matching scheduled task (in the Claude Code scheduler)
is a thin trigger: its only job is the cron schedule, and its `SKILL.md` just
says "read and follow `routines/<task-id>.md`."

**To change what a routine does:** edit its file here. You never touch the
scheduled task itself except to approve or change its cron.

**To confirm they all still run cleanly** (dry, no sends/pushes):
`node validate-routines.mjs`

## Active routines

| File | Task cron | What it does |
|---|---|---|
| `ll-morning-brief.md` | Daily 8:28 AM | Ops brief: daily metrics + overnight pipeline health |
| `ll-ad-test.md` | Daily 8:18 AM | Facebook ad test/control MAU tracker |
| `ll-evening-spotlight.md` | Daily 3:46 PM | Judge tonight's events; spotlight push only for a genuine big hitter |
| `ll-outreach-send.md` | Weekdays 8:09 AM | Paced sponsor/food-truck outreach sender |
| `ll-memory-sync.md` | Daily 9:40 PM | Push this machine's Claude memory to the cloud sync repo |
| `localloop-release-gate-104.md` | Every 4 hours | Arm the in-app update prompt + broadcast push when iOS 1.0.4 goes live |

`pollyball-fb-reminder` is a one-time task (fires Aug 14), left as-is.
Removed Jul 2026: `ll-fb-draft`, `ll-group-posts`, `ll-roster-watch`.
