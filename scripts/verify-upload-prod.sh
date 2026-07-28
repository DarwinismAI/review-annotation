#!/usr/bin/env bash
# Probe the production upload flow end-to-end:
#   1) login -> grab session cookie
#   2) POST /api/batches/upload-url -> get signed URL
#   3) PUT the 6MB ZIP fixture directly to Supabase Storage
#   4) POST /api/batches to kick off processing
#   5) GET /api/batches/{id} to confirm rows were persisted
#
# Exits non-zero on any step failing.

set -euo pipefail

BASE_URL="${BASE_URL:-https://expert-review-app.vercel.app}"
EMAIL="${ADMIN_EMAIL:-admin@expert-review.local}"
PASSWORD="${ADMIN_PASSWORD:-admin123}"
FIXTURE="${FIXTURE:-$(dirname "$0")/../e2e/fixtures/sample-batch.zip}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "→ Using $BASE_URL"
echo "→ Fixture: $FIXTURE ($(wc -c <"$FIXTURE") bytes)"

echo "[1/5] login"
curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/api/auth/sign-in/email" >/dev/null

echo "[2/5] request signed upload URL"
SIGN_JSON=$(curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d '{"filename":"probe.zip"}' \
  "$BASE_URL/api/batches/upload-url")
SIGNED_URL=$(echo "$SIGN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["signedUrl"])')
STORAGE_KEY=$(echo "$SIGN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["storageKey"])')
echo "  storageKey=$STORAGE_KEY"

echo "[3/5] PUT ZIP directly to Supabase Storage"
curl -fsS -X PUT -H "Content-Type: application/zip" \
  --data-binary "@$FIXTURE" "$SIGNED_URL" >/dev/null

BATCH_NAME="Prod-probe-$(date +%s)"
echo "[4/5] create batch ($BATCH_NAME)"
CREATE_JSON=$(curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"name\":\"$BATCH_NAME\",\"domain\":\"law\",\"articleType\":\"full\",\"payRatePerArticle\":0,\"storageKey\":\"$STORAGE_KEY\",\"filename\":\"probe.zip\"}" \
  "$BASE_URL/api/batches")
BATCH_ID=$(echo "$CREATE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
TOTAL=$(echo "$CREATE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["totalArticles"])')
echo "  batchId=$BATCH_ID  totalArticles=$TOTAL"
test "$TOTAL" -eq 3 || { echo "FAIL: expected 3 articles, got $TOTAL"; exit 1; }

echo "[5/5] fetch batch detail"
curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/batches/$BATCH_ID" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print("  status="+d["status"]+" totalArticles="+str(d["totalArticles"])+" name="+d["name"])'

echo "✅ Prod upload flow OK"
