#!/usr/bin/env bash
# Upload a single .json or .zip to a running expert-review backend as admin.
# Args: <fixture-path> <batch-name> [domain] [articleType]
# Env:  BASE_URL (default http://localhost:3000), ADMIN_EMAIL, ADMIN_PASSWORD
set -euo pipefail

FIXTURE="${1:?fixture path required}"
BATCH_NAME="${2:?batch name required}"
DOMAIN="${3:-law}"
ARTICLE_TYPE="${4:-full}"

BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="${ADMIN_EMAIL:-admin@expert-review.local}"
PASSWORD="${ADMIN_PASSWORD:-admin123}"

[[ -f "$FIXTURE" ]] || { echo "FAIL: fixture not found: $FIXTURE" >&2; exit 1; }
FILENAME="$(basename "$FIXTURE")"
LOWER_EXT="${FILENAME##*.}"
LOWER_EXT="$(echo "$LOWER_EXT" | tr '[:upper:]' '[:lower:]')"
case "$LOWER_EXT" in
  json) CONTENT_TYPE="application/json" ;;
  zip)  CONTENT_TYPE="application/zip" ;;
  *)    echo "FAIL: unsupported extension .$LOWER_EXT" >&2; exit 1 ;;
esac

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "→ $BASE_URL  fixture=$FILENAME ($(wc -c <"$FIXTURE") bytes)  ct=$CONTENT_TYPE"

echo "[1/4] login"
curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/api/auth/sign-in/email" >/dev/null

echo "[2/4] sign upload URL"
SIGN_JSON=$(curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"filename\":\"$FILENAME\"}" \
  "$BASE_URL/api/batches/upload-url")
SIGNED_URL=$(echo "$SIGN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.signedUrl))')
STORAGE_KEY=$(echo "$SIGN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.storageKey))')
echo "  storageKey=$STORAGE_KEY"

echo "[3/4] PUT to Supabase Storage"
curl -fsS -X PUT -H "Content-Type: $CONTENT_TYPE" \
  --data-binary "@$FIXTURE" "$SIGNED_URL" >/dev/null

echo "[4/4] create batch '$BATCH_NAME' (domain=$DOMAIN, type=$ARTICLE_TYPE)"
CREATE_JSON=$(curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"name\":\"$BATCH_NAME\",\"domain\":\"$DOMAIN\",\"articleType\":\"$ARTICLE_TYPE\",\"payRatePerArticle\":0,\"storageKey\":\"$STORAGE_KEY\",\"filename\":\"$FILENAME\"}" \
  "$BASE_URL/api/batches")
echo "$CREATE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;console.log(`  batchId=${d.id} totalArticles=${d.totalArticles} errors=${(d.errorFiles||[]).length}`)})'
echo "✅ Done: $FILENAME"
