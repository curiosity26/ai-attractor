#!/usr/bin/env bash
# Run all test pipelines and report results
# Usage: ./test-pipelines/run-all.sh [--validate-only]

set -euo pipefail
cd "$(dirname "$0")/.."

VALIDATE_ONLY="${1:-}"
PASS=0
FAIL=0
EXPECTED_FAIL=0
RESULTS=()

run_test() {
  local file="$1"
  local expect="${2:-success}"  # success | fail
  local name
  name=$(basename "$file" .dot)

  if [ "$VALIDATE_ONLY" = "--validate-only" ]; then
    if attractor validate "$file" >/dev/null 2>&1; then
      echo "  ✓ $name — validates"
      PASS=$((PASS + 1))
    else
      echo "  ✗ $name — validation failed"
      FAIL=$((FAIL + 1))
    fi
    return
  fi

  local logs_dir="/tmp/attractor-test-runs/$name"
  rm -rf "$logs_dir"

  local start_time
  start_time=$(date +%s)

  local exit_code=0
  local output
  output=$(attractor run "$file" --logs-dir "$logs_dir" 2>&1) || exit_code=$?

  local end_time
  end_time=$(date +%s)
  local elapsed=$((end_time - start_time))

  if [ "$expect" = "fail" ]; then
    if [ $exit_code -ne 0 ]; then
      echo "  ✓ $name — failed as expected (${elapsed}s)"
      EXPECTED_FAIL=$((EXPECTED_FAIL + 1))
      RESULTS+=("PASS (expected fail): $name")
    else
      echo "  ✗ $name — expected failure but succeeded (${elapsed}s)"
      FAIL=$((FAIL + 1))
      RESULTS+=("FAIL: $name — expected failure but got success")
    fi
  else
    if [ $exit_code -eq 0 ]; then
      echo "  ✓ $name — passed (${elapsed}s)"
      PASS=$((PASS + 1))
      RESULTS+=("PASS: $name")
    else
      echo "  ✗ $name — failed (${elapsed}s)"
      echo "    Output: $(echo "$output" | tail -3)"
      FAIL=$((FAIL + 1))
      RESULTS+=("FAIL: $name")
    fi
  fi
}

echo ""
echo "═══════════════════════════════════════════════"
echo "  Attractor Test Pipeline Suite"
echo "═══════════════════════════════════════════════"
echo ""

# Sequential
echo "── Sequential Execution ──"
run_test test-pipelines/01-sequential.dot

# Parallel
echo ""
echo "── Parallel Execution ──"
run_test test-pipelines/02-parallel-timing.dot
run_test test-pipelines/06-parallel-join-policies.dot
run_test test-pipelines/07-parallel-all-fail.dot          fail
run_test test-pipelines/12-parallel-bounded-concurrency.dot
run_test test-pipelines/14-parallel-no-fanin.dot

# Conditionals
echo ""
echo "── Conditional Branching ──"
run_test test-pipelines/03-conditional-branching.dot
run_test test-pipelines/04-conditional-success.dot

# Retry
echo ""
echo "── Retry & Goal Gates ──"
run_test test-pipelines/05-retry-policy.dot
run_test test-pipelines/08-goal-gate.dot                  fail
run_test test-pipelines/15-goal-gate-retry.dot

# Other Features
echo ""
echo "── Other Features ──"
run_test test-pipelines/09-edge-weights.dot
run_test test-pipelines/10-stylesheet.dot
run_test test-pipelines/11-context-passing.dot

# Integration
echo ""
echo "── Integration ──"
run_test test-pipelines/13-mixed-pipeline.dot

echo ""
echo "═══════════════════════════════════════════════"
TOTAL=$((PASS + EXPECTED_FAIL + FAIL))
echo "  Results: $PASS passed, $EXPECTED_FAIL expected-fail, $FAIL unexpected"
echo "  Total:   $TOTAL tests"
echo "═══════════════════════════════════════════════"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
