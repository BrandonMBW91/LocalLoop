#!/usr/bin/env bash
# Sync Claude's memory across machines (desktop <-> laptop) through a private git
# repo, so both share the same context. The desktop is the usual source of truth.
#   bash scripts/sync-memory.sh push   # save THIS machine's memory to the cloud
#   bash scripts/sync-memory.sh pull   # load the latest memory onto THIS machine
# (Claude runs these for you when you say "save my memory" / "get my memory".)
set -euo pipefail

ACTION="${1:-}"
[ "$ACTION" = push ] || [ "$ACTION" = pull ] || { echo "usage: sync-memory.sh push|pull"; exit 1; }

SYNC_REMOTE="https://github.com/BrandonMBW91/localloop-memory.git"
SYNC_DIR="$HOME/.claude/memory-sync"

# Locate THIS machine's LOCAL LOOP memory folder. Other projects have their own
# separate memory, and per-machine project slugs differ, so we match by a known
# signature FILE (findlay-events-app.md), not by path or by MEMORY.md alone.
MEM=""
for d in "$HOME"/.claude/projects/*/memory; do
  [ -f "$d/findlay-events-app.md" ] && MEM="$d" && break
done
if [ -z "$MEM" ]; then
  # No Local Loop memory here yet (fresh machine): fall back to the memory dir
  # with the most files, else create one under the first project slug so a pull
  # can seed it. A subsequent push will land in the right place once seeded.
  MEM="$(for d in "$HOME"/.claude/projects/*/memory; do [ -d "$d" ] && echo "$(ls "$d"/*.md 2>/dev/null | wc -l) $d"; done | sort -rn | head -1 | awk '{print $2}')"
  if [ -z "$MEM" ]; then MEM="$(ls -d "$HOME"/.claude/projects/*/ 2>/dev/null | head -1)memory"; mkdir -p "$MEM"; fi
fi
echo "memory dir: $MEM"

# Ensure the sync clone exists and is current.
if [ ! -d "$SYNC_DIR/.git" ]; then
  git clone "$SYNC_REMOTE" "$SYNC_DIR"
fi

if [ "$ACTION" = pull ]; then
  git -C "$SYNC_DIR" pull --ff-only origin main
  cp -f "$SYNC_DIR"/*.md "$MEM"/ 2>/dev/null || true
  echo "Pulled latest memory into $MEM ($(ls "$MEM"/*.md 2>/dev/null | wc -l | tr -d ' ') files)."
else
  # Sync the clone first so a push from either machine lands on top of the
  # other's commits instead of being rejected as non-fast-forward. Files only
  # the other machine has (or edited there more recently than our local copy)
  # ride along untouched unless this machine also has a same-named file.
  git -C "$SYNC_DIR" pull --ff-only origin main || true
  cp -f "$MEM"/*.md "$SYNC_DIR"/ 2>/dev/null || true
  git -C "$SYNC_DIR" add -A
  if git -C "$SYNC_DIR" diff --cached --quiet; then echo "Memory already up to date, nothing to push."; exit 0; fi
  git -C "$SYNC_DIR" -c user.email="localloop@localloop.io" -c user.name="Local Loop Memory" commit -q -m "memory sync from $(hostname)"
  git -C "$SYNC_DIR" push -q origin HEAD:main
  echo "Pushed memory to the cloud ($(ls "$MEM"/*.md 2>/dev/null | wc -l | tr -d ' ') files)."
fi
