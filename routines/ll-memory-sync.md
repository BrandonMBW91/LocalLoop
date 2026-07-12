# Routine: ll-memory-sync (daily 9:40 PM)

Push this machine's Local Loop Claude memory to the cloud sync repo so the laptop always has an up-to-date copy to pull. Run from the repo root:

  bash C:/Users/micha/New/FindlayEvents/scripts/sync-memory.sh push

This is a silent backstop. If it prints "Memory already up to date" or "Pushed memory to the cloud (N files)", do NOT message the user — just finish quietly. ONLY surface something if it FAILS (non-zero exit, git error, auth failure) — in that case, say one plain line about what broke so the user knows the laptop sync may be stale. Never pass any arguments other than "push". No em-dashes in anything user-facing.
