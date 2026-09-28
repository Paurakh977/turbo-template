#!/bin/sh
# k6/run.sh — POSIX shell twin of k6/run.ps1 for Linux / macOS / CI.
#
# Same contract as run.ps1 (P1-5):
# - suite mapping identical (incl. explicit `edge-cases` + `edge` alias)
# - SUMMARY_PATH always lands in k6/results (absolute path, native mode)
#   or /results/<suite>.summary.json (Docker mode)
# - env passthrough passes values through "$var" quoting, never eval/string
#   concatenation, so secrets with spaces, `!`, `&` survive verbatim
# - Docker fallback uses --add-host host.docker.internal:host-gateway and
#   maps localhost/127.0.0.1 in BASE_URL to host.docker.internal instead of
#   `--network host` (Linux-only, opt-in on Docker Desktop 4.34+)
#
# Usage: ./k6/run.sh [suite] [base-url]   (defaults: smoke, https://localhost)
#        EXTRA_ARGS="..." ./k6/run.sh load
set -eu

SUITE="${1:-smoke}"
BASE_URL="${2:-https://localhost}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RESULTS_DIR="${RESULTS_DIR:-$SCRIPT_DIR/results}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:0.57.0}"

map_suite() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    smoke) printf 'suites/smoke.js' ;;
    load) printf 'suites/load.js' ;;
    stress) printf 'suites/stress.js' ;;
    spike) printf 'suites/spike.js' ;;
    soak) printf 'suites/soak.js' ;;
    edge|edge-cases) printf 'suites/edge-cases.js' ;;
    capacity) printf 'suites/capacity.js' ;;
    *.js) printf '%s' "$1" ;;
    *) printf 'suites/%s.js' "$1" ;;
  esac
}

SUITE_FILE="$(map_suite "$SUITE")"
SUMMARY_NAME="$(printf '%s' "$SUITE_FILE" | sed -e 's|^suites/||' -e 's|\.js$||').summary.json"
mkdir -p "$RESULTS_DIR"

echo "=========================================================="
echo "  Turbo Observability k6 Runner"
echo "  Target Suite : $SUITE_FILE"
echo "  Base URL     : $BASE_URL"
echo "=========================================================="

# Env passthrough: "-e NAME=value" pairs appended with `set --` INLINE (not
# via a helper — `set --` inside a function does not reliably propagate to
# the caller across POSIX shells). Each value stays exactly one argv element
# (spaces, `!`, `&` preserved verbatim; no eval of values — $n comes from the
# fixed list below).
if command -v k6 >/dev/null 2>&1; then
  echo "[Runner] Using native k6 CLI from PATH..."
  set -- run \
    -e "BASE_URL=$BASE_URL" \
    -e "SUMMARY_PATH=$RESULTS_DIR/$SUMMARY_NAME" \
    --insecure-skip-tls-verify
  for n in SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD USER_EMAIL USER_PASSWORD LOAD_QUICK SOAK_DURATION; do
    eval "v=\${$n:-}"
    if [ -n "$v" ]; then
      set -- "$@" -e "$n=$v"
    fi
  done
  set -- "$@" "$SCRIPT_DIR/$SUITE_FILE"
  # EXTRA_ARGS is intentionally word-split (documented extra k6 flags).
  # shellcheck disable=SC2086
  k6 "$@" ${EXTRA_ARGS:-}
else
  echo "[Runner] Native k6 not detected. Using Docker ($K6_IMAGE)..."
  DOCKER_BASE_URL="$(printf '%s' "$BASE_URL" | sed -e 's/localhost/host.docker.internal/g' -e 's/127\.0\.0\.1/host.docker.internal/g')"
  if [ "$DOCKER_BASE_URL" != "$BASE_URL" ]; then
    echo "[Runner] Docker mode: mapped Base URL to $DOCKER_BASE_URL"
  fi
  set -- run --rm -i \
    -v "$SCRIPT_DIR:/scripts" \
    -v "$RESULTS_DIR:/results" \
    --add-host host.docker.internal:host-gateway \
    -e "SUMMARY_PATH=/results/$SUMMARY_NAME" \
    "$K6_IMAGE" run \
    -e "BASE_URL=$DOCKER_BASE_URL" \
    --insecure-skip-tls-verify
  for n in SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD USER_EMAIL USER_PASSWORD LOAD_QUICK SOAK_DURATION; do
    eval "v=\${$n:-}"
    if [ -n "$v" ]; then
      set -- "$@" -e "$n=$v"
    fi
  done
  set -- "$@" "/scripts/$SUITE_FILE"
  # shellcheck disable=SC2086
  docker "$@" ${EXTRA_ARGS:-}
fi
