#!/usr/bin/env bash
# Restore the encrypted Local Loop transfer bundle on the NEW (Mac) machine.
#   1. git clone the repo first
#   2. bash scripts/transfer-restore.sh  /path/to/localloop-transfer.enc  /path/to/repo
set -euo pipefail

ENC="${1:?usage: transfer-restore.sh <bundle.enc> <repo-dir>}"
REPO="${2:?usage: transfer-restore.sh <bundle.enc> <repo-dir>}"
[ -f "$ENC" ] || { echo "No such bundle: $ENC"; exit 1; }
[ -d "$REPO" ] || { echo "No such repo dir: $REPO"; exit 1; }

if [ -z "${BUNDLE_PASS:-}" ]; then
  read -r -s -p "Bundle password: " BUNDLE_PASS; echo
fi
export BUNDLE_PASS

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BUNDLE_PASS -in "$ENC" | tar -C "$STAGE" -xzf - ; then
  echo "Decrypt/extract failed — wrong password or corrupt file."; exit 1
fi
D="$STAGE/localloop-transfer"

place() { [ -e "$1" ] && { rm -rf "$2"; cp -r "$1" "$2"; echo "  -> $2"; }; }
echo "Restoring into $REPO:"
place "$D/root.env"         "$REPO/.env"
place "$D/aggregator.env"   "$REPO/aggregator/.env"
place "$D/asc"              "$REPO/.asc"
place "$D/gcp"              "$REPO/.gcp"
place "$D/fb-featured.json" "$REPO/.fb-featured.json"
place "$D/outreach"         "$REPO/outreach"

# lock down secrets (Unix perms — simpler than Windows ACLs)
chmod 600 "$REPO/.env" "$REPO/aggregator/.env" 2>/dev/null || true
chmod -R go-rwx "$REPO/.asc" "$REPO/.gcp" 2>/dev/null || true

# Memory: its on-disk location is derived from the project path, which differs on
# this machine, so stage it and let Claude place it in the first session.
if [ -d "$D/memory" ]; then
  mkdir -p "$HOME/localloop-memory-restore"
  cp -r "$D/memory/." "$HOME/localloop-memory-restore/"
  echo "  -> ~/localloop-memory-restore  (Claude will place this in your first session; just say 'restore my memory')"
fi

echo ""
echo "Done. Next steps on the Mac:"
echo "  cd \"$REPO\" && npm install && (cd aggregator && npm install)"
echo "  npx eas login        # re-auth Expo (signing keys are cloud-side)"
echo "  gh auth login         # re-auth GitHub CLI"
echo "  Then open Claude here and say: recreate my Local Loop routines + place my memory"
