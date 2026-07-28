#!/usr/bin/env bash
# smoke.sh - quick liveness check against running dev server.
# Run: `pnpm smoke:local` (assumes `pnpm dev` running on :3000).
# Exits non-zero on first failure for CI usability.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "→ Smoke testing $BASE_URL"

# 1. Health endpoint
echo -n "  /api/health ... "
HEALTH=$(curl -fsS --max-time 5 "$BASE_URL/api/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "✅"
else
  echo "❌ ($HEALTH)"
  exit 1
fi

# 2. Root page renders
echo -n "  / (root) ... "
if curl -fsS --max-time 5 -o /dev/null "$BASE_URL/"; then
  echo "✅"
else
  echo "❌"
  exit 1
fi

# Add per-epic smoke checks below as auth/CRUD endpoints land:
# echo -n "  /api/auth/session ... "
# curl -fsS --max-time 5 "$BASE_URL/api/auth/session" >/dev/null && echo "✅" || { echo "❌"; exit 1; }

echo "✅ All smoke checks passed."
