#!/bin/bash
# Long-running IME fuzzer. Runs seed batches and appends failures to a log file.
# Usage: ./tests/fuzz/run-ime-fuzz.sh [hours] [workers]
#   hours   — how long to run (default: 6)
#   workers — playwright workers (default: 8)

set -euo pipefail

HOURS="${1:-6}"
WORKERS="${2:-8}"
BATCH_SIZE=200
SEED_OFFSET=0
END_TIME=$(($(date +%s) + HOURS * 3600))

RESULTS_DIR="tests/fuzz/results"
mkdir -p "$RESULTS_DIR"
LOGFILE="$RESULTS_DIR/ime-fuzz-$(date +%Y%m%d-%H%M%S).log"

echo "IME fuzzer: ${HOURS}h, ${WORKERS} workers, batch size ${BATCH_SIZE}" | tee "$LOGFILE"
echo "Started: $(date)" | tee -a "$LOGFILE"
echo "Log: $LOGFILE"
echo "---" >> "$LOGFILE"

# Build once
echo "Building container..."
DOCKER_API_VERSION=1.44 DOCKER_BUILDKIT=0 docker build -t editcontext-test -f Containerfile . > /dev/null 2>&1
echo "Build done."

TOTAL_PASS=0
TOTAL_FAIL=0
BATCH_NUM=0

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  BATCH_NUM=$((BATCH_NUM + 1))
  echo ""
  echo "=== Batch $BATCH_NUM: seeds $SEED_OFFSET-$((SEED_OFFSET + BATCH_SIZE - 1)) ===" | tee -a "$LOGFILE"

  OUTPUT=$(DOCKER_API_VERSION=1.44 docker run --rm \
    -e FUZZ_ITERATIONS="$BATCH_SIZE" \
    -e FUZZ_SEED_OFFSET="$SEED_OFFSET" \
    editcontext-test bash -c \
    'Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &>/dev/null & sleep 1 && DISPLAY=:99 pnpm exec playwright test tests/fuzz/fuzz-ime.spec.ts --project=chromium-native --workers='"$WORKERS" 2>&1 || true)

  # Count pass/fail
  PASSED=$(echo "$OUTPUT" | grep -oP '\d+ passed' | grep -oP '\d+' || echo 0)
  FAILED=$(echo "$OUTPUT" | grep -oP '\d+ failed' | grep -oP '\d+' || echo 0)
  TOTAL_PASS=$((TOTAL_PASS + PASSED))
  TOTAL_FAIL=$((TOTAL_FAIL + FAILED))

  echo "  $PASSED passed, $FAILED failed (cumulative: $TOTAL_PASS passed, $TOTAL_FAIL failed)" | tee -a "$LOGFILE"

  # Append failure details (only the error lines, not the full diff)
  if [ "$FAILED" -gt 0 ]; then
    echo "$OUTPUT" | grep -E '(seed [0-9]+|State mismatch|Event log mismatch|beforeinput log mismatch|composition log mismatch)' >> "$LOGFILE" 2>/dev/null || true
    echo "---" >> "$LOGFILE"
  fi

  SEED_OFFSET=$((SEED_OFFSET + BATCH_SIZE))
done

echo "" | tee -a "$LOGFILE"
echo "=== DONE ===" | tee -a "$LOGFILE"
echo "Finished: $(date)" | tee -a "$LOGFILE"
echo "Total: $TOTAL_PASS passed, $TOTAL_FAIL failed across $((BATCH_NUM * BATCH_SIZE)) seeds" | tee -a "$LOGFILE"
