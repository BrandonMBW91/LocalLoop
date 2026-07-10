#!/usr/bin/env bash
# Build an ENCRYPTED transfer bundle of all local-only Local Loop state that is
# NOT in git: both .env files, the ASC + GCP keys, the entire outreach/ folder
# (leads + suppress/bounce/sent compliance state), the FB routine state, and
# Claude's memory. AES-256 / PBKDF2 — safe to upload to Google Drive or copy to
# USB; useless without the password.
#
# Run from the repo root:
#   bash scripts/transfer-bundle.sh
# (optional first arg = output path; default ~/Desktop/localloop-transfer.enc)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MEMORY="$HOME/.claude/projects/-Users-brandonw-localloop-memory-restore/memory"
OUT="${1:-$HOME/Desktop/localloop-transfer.enc}"

if [ -z "${BUNDLE_PASS:-}" ]; then
  read -r -s -p "Choose a strong password for the bundle: " BUNDLE_PASS; echo
  read -r -s -p "Confirm password: " P2; echo
  [ "$BUNDLE_PASS" = "$P2" ] || { echo "Passwords do not match."; exit 1; }
  [ -n "$BUNDLE_PASS" ] || { echo "Empty password not allowed."; exit 1; }
fi
export BUNDLE_PASS

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
D="$STAGE/localloop-transfer"
mkdir -p "$D"

copy() { [ -e "$1" ] && cp -r "$1" "$2" && echo "  + $3" || echo "  - skipped (missing): $3"; }
echo "Staging local-only files:"
copy "$REPO/.env"               "$D/root.env"          ".env"
copy "$REPO/aggregator/.env"    "$D/aggregator.env"    "aggregator/.env"
copy "$REPO/.asc"               "$D/asc"               ".asc/ (App Store keys)"
copy "$REPO/.gcp"               "$D/gcp"               ".gcp/ (Play key)"
copy "$REPO/.fb-featured.json"  "$D/fb-featured.json"  ".fb-featured.json"
copy "$REPO/outreach"           "$D/outreach"          "outreach/ (leads + compliance state)"
copy "$MEMORY"                  "$D/memory"            "Claude memory"

# never ship dependency/junk dirs even if present
find "$D" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
find "$D" -name '.DS_Store' -delete 2>/dev/null || true

cat > "$D/README.txt" <<'EOF'
Local Loop transfer bundle (encrypted). Restore on the new machine:
  1. git clone the repo
  2. bash <repo>/scripts/transfer-restore.sh  /path/to/localloop-transfer.enc  /path/to/repo
Contents: root.env, aggregator.env, asc/, gcp/, fb-featured.json, outreach/, memory/
EOF

tar -C "$STAGE" -czf - localloop-transfer \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BUNDLE_PASS -out "$OUT"

echo ""
echo "Wrote encrypted bundle: $OUT  ($(du -h "$OUT" | cut -f1))"
echo "Safe to upload to Google Drive or copy to USB. Send yourself the PASSWORD separately (not in the same place as the file)."
