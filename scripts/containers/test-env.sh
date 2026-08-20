#!/usr/bin/env bash
# Disposable, secret-free container test/build harness.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${GAUSS_TEST_COMPOSE_FILE:-${ROOT_DIR}/docker-compose.test.yml}"
ACTION="${1:-check}"

die() {
  echo "[gauss-container] ERROR: $*" >&2
  exit 2
}

require_engine() {
  command -v docker >/dev/null 2>&1 || die "Docker CLI is not installed. Install Docker Desktop/Engine, then rerun this command."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable. Enable the Compose plugin and rerun this command."
  [[ -f "${COMPOSE_FILE}" ]] || die "Compose file not found: ${COMPOSE_FILE}"
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

case "${ACTION}" in
  check)
    require_engine
    compose config --quiet
    echo "[gauss-container] Compose manifest is valid; no host secrets are loaded."
    ;;
  build)
    require_engine
    compose build --pull=false
    ;;
  test)
    require_engine
    compose run --rm test
    ;;
  up)
    require_engine
    compose up -d backend
    compose ps
    ;;
  smoke)
    require_engine
    curl --fail --silent --show-error http://127.0.0.1:13001/health >/dev/null
    echo "[gauss-container] Backend health smoke test passed on localhost:13001."
    ;;
  shell)
    require_engine
    compose run --rm test sh
    ;;
  down)
    require_engine
    compose down --remove-orphans
    ;;
  *)
    die "Usage: $0 {check|build|test|up|smoke|shell|down}"
    ;;
esac
