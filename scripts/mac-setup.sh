#!/usr/bin/env bash
# Fresh-Mac bootstrap for Local Loop dev: installs the toolchain and clones the
# repo. Safe to re-run (each step is skipped if already present). Run in Terminal:
#   curl -fsSL <not-hosted> | bash     # (repo isn't cloned yet, so just paste this)
set -euo pipefail

CLONE_DIR="${1:-$HOME/New/FindlayEvents}"
REPO_URL="https://github.com/BrandonMBW91/LocalLoop.git"

echo "== 1/5  Xcode Command Line Tools (git + compilers) =="
if ! xcode-select -p >/dev/null 2>&1; then
  echo "A dialog will pop up — click Install, then this waits for it to finish."
  xcode-select --install || true
  until xcode-select -p >/dev/null 2>&1; do sleep 15; echo "  ...waiting for Command Line Tools to finish installing"; done
fi
echo "   ok"

echo "== 2/5  Homebrew (package manager) =="
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Put brew on PATH for this shell + future shells (Apple Silicon = /opt/homebrew).
if [ -d /opt/homebrew/bin ]; then BREW=/opt/homebrew/bin/brew; else BREW=/usr/local/bin/brew; fi
eval "$("$BREW" shellenv)"
grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null || echo "eval \"\$($BREW shellenv)\"" >> "$HOME/.zprofile"
echo "   ok"

echo "== 3/5  Tools (node, git, gh, watchman) =="
brew install node git gh watchman
echo "   node $(node -v) / npm $(npm -v)"

echo "== 4/5  EAS CLI (Expo cloud builds) =="
npm install -g eas-cli >/dev/null 2>&1 || sudo npm install -g eas-cli
echo "   eas $(eas --version 2>/dev/null || echo installed)"

echo "== 5/5  Clone the repo =="
if [ -d "$CLONE_DIR/.git" ]; then
  echo "   already cloned at $CLONE_DIR — pulling latest"
  git -C "$CLONE_DIR" pull --ff-only || true
else
  mkdir -p "$(dirname "$CLONE_DIR")"
  git clone "$REPO_URL" "$CLONE_DIR"
fi
echo "   -> $CLONE_DIR"

cat <<EOF

Done. Next:
  1. Get localloop-transfer.enc onto this Mac (Google Drive / USB).
  2. Restore your secrets + data + memory:
       bash "$CLONE_DIR/scripts/transfer-restore.sh"  ~/Downloads/localloop-transfer.enc  "$CLONE_DIR"
  3. Install deps:
       (cd "$CLONE_DIR" && npm install && cd aggregator && npm install)
  4. Re-auth:  npx eas login   &&   gh auth login
  5. Open Claude in $CLONE_DIR and say:
       "recreate my routines and place my memory"
EOF
