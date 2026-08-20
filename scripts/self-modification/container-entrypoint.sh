#!/usr/bin/env sh
set -eu

PATCH=/proposal/proposal.patch
OUTPUT=/output/validation.json
LEVEL="${SELF_MOD_VALIDATION_LEVEL:-standard}"

fail() {
  echo "[self-modification] ERROR: $*" >&2
  exit 2
}

[ -f "$PATCH" ] || fail "missing $PATCH; create a proposal patch first"
command -v git >/dev/null 2>&1 || fail "git is required inside the validator image"

rm -rf /tmp/candidate
mkdir -p /tmp/candidate
cp -a /workspace/. /tmp/candidate/

cd /tmp/candidate
git apply --check --whitespace=error "$PATCH" || fail "proposal does not apply cleanly to the image source snapshot"
git apply --whitespace=error "$PATCH"

node --import tsx scripts/self-modification/validate-proposal.ts \
  --patch "$PATCH" \
  --policy /tmp/candidate/config/self-modification-policy.json \
  --out "$OUTPUT"

npm run develop:verify
npm run lint

if [ "$LEVEL" = "full" ]; then
  npm test
  npm run build
fi

echo "[self-modification] Candidate validated in disposable container; no host files were changed."
