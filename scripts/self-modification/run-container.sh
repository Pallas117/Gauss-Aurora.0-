#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.self-modification.yml"
PROPOSAL_DIR="${ROOT_DIR}/reports/self-modification"

die() {
  echo "[self-modification] ERROR: $*" >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || die "Docker CLI is not installed; validation is blocked, not bypassed."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable."
mkdir -p "$PROPOSAL_DIR"

case "${1:-check}" in
  check)
    docker compose -f "$COMPOSE_FILE" config --quiet
    echo "[self-modification] Compose policy is valid; source and secrets are not host-mounted."
    ;;
  build)
    docker compose -f "$COMPOSE_FILE" build --pull=false validator
    ;;
  validate)
    [ -f "$PROPOSAL_DIR/proposal.patch" ] || die "missing reports/self-modification/proposal.patch"
    docker compose -f "$COMPOSE_FILE" run --rm validator
    ;;
  full)
    [ -f "$PROPOSAL_DIR/proposal.patch" ] || die "missing reports/self-modification/proposal.patch"
    SELF_MOD_VALIDATION_LEVEL=full docker compose -f "$COMPOSE_FILE" run --rm -e SELF_MOD_VALIDATION_LEVEL=full validator
    ;;
  *)
    die "Usage: $0 {check|build|validate|full}"
    ;;
esac
