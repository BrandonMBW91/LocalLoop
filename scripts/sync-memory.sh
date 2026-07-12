#!/usr/bin/env bash
# Sync Claude's memory across machines (desktop <-> laptop) through a private git
# repo, so both share the same context. The desktop is the usual source of truth.
#   bash scripts/sync-memory.sh push   # save THIS machine's memory to the cloud
#   bash scripts/sync-memory.sh pull   # load the latest memory onto THIS machine
# (Claude runs these for you when you say "save my memory" / "get my memory".)
#
# Conflict semantics (deliberate, keep in mind): LAST WRITER WINS per FILE, no
# merge — if both machines edit the same file between syncs, the later push
# keeps its whole copy. Deletions do NOT propagate (a file pruned on one machine
# comes back on the next pull). The desktop is the source of truth by convention.
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
  # No signature match on this machine. NEVER guess a directory: pushing another
  # project's memory (or pulling over it with cp -f) would silently corrupt that
  # project. Push requires the signature; pull may seed a fresh machine ONLY when
  # no memory dirs exist at all.
  if [ "$ACTION" = push ]; then
    echo "No Local Loop memory found (no */memory/findlay-events-app.md). Refusing to push a guessed directory."
    exit 1
  fi
  candidates=0
  for d in "$HOME"/.claude/projects/*/memory; do
    if [ -d "$d" ]; then candidates=$((candidates+1)); fi
  done
  if [ "$candidates" -gt 0 ]; then
    echo "No Local Loop memory dir here, but $candidates other memory dir(s) exist. Refusing to guess which to seed."
    echo "Open the Local Loop project in Claude Code once (creates its memory dir), then re-run pull."
    exit 1
  fi
  first="$(ls -d "$HOME"/.claude/projects/*/ 2>/dev/null | head -1 || true)"
  if [ -z "$first" ]; then
    echo "No ~/.claude/projects/* on this machine yet. Open the project in Claude Code once, then re-run pull."
    exit 1
  fi
  MEM="${first}memory"
  mkdir -p "$MEM"
fi
echo "memory dir: $MEM"

# Ensure the sync clone exists and is current. The clone is only a TRANSPORT
# CACHE (the memory dirs are the source of truth), so if it ever diverges from
# the remote (e.g. a committed push that failed to upload), hard-reset it to
# origin/main instead of wedging: the old behavior swallowed the pull failure,
# re-committed on the divergent head, and then every future push AND pull died
# on the non-fast-forward state forever.
if [ ! -d "$SYNC_DIR/.git" ]; then
  git clone "$SYNC_REMOTE" "$SYNC_DIR"
fi
if ! git -C "$SYNC_DIR" pull --ff-only origin main; then
  echo "sync clone diverged from origin; resetting it (clone is just a cache, memory dirs hold the truth)"
  git -C "$SYNC_DIR" fetch origin main
  git -C "$SYNC_DIR" reset --hard origin/main
fi

if [ "$ACTION" = pull ]; then
  cp -f "$SYNC_DIR"/*.md "$MEM"/ 2>/dev/null || true
  echo "Pulled latest memory into $MEM ($(ls "$MEM"/*.md 2>/dev/null | wc -l | tr -d ' ') files)."
else
  # Files only the other machine has ride along untouched unless this machine
  # also has a same-named file (last writer wins; see header).
  cp -f "$MEM"/*.md "$SYNC_DIR"/ 2>/dev/null || true
  git -C "$SYNC_DIR" add -A
  if git -C "$SYNC_DIR" diff --cached --quiet; then echo "Memory already up to date, nothing to push."; exit 0; fi
  git -C "$SYNC_DIR" -c user.email="localloop@localloop.io" -c user.name="Local Loop Memory" commit -q -m "memory sync from $(hostname)"
  git -C "$SYNC_DIR" push -q origin HEAD:main
  echo "Pushed memory to the cloud ($(ls "$MEM"/*.md 2>/dev/null | wc -l | tr -d ' ') files)."
fi
