#!/usr/bin/env bash
# Snapshot Claude's live memory to the on-laptop backup folder.
# Run whenever the user says "save memory":
#   bash scripts/save-memory.sh
# (optional first arg = destination; default ~/localloop-memory-restore)
set -euo pipefail

LIVE="$HOME/.claude/projects/-Users-brandonw-localloop-memory-restore/memory"
DEST="${1:-$HOME/localloop-memory-restore}"

[ -d "$LIVE" ] || { echo "No live memory at $LIVE"; exit 1; }
mkdir -p "$DEST"
rsync -a --delete "$LIVE/" "$DEST/"
echo "Saved $(ls "$DEST" | wc -l | tr -d ' ') memory files -> $DEST  ($(date '+%Y-%m-%d %H:%M'))"
