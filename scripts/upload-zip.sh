#!/usr/bin/env bash
# Upload a single .json or .zip to a running expert-review backend as admin.
# Args: <fixture-path> <batch-name> [domain] [articleType]
# Env: BASE_URL (default http://localhost:3000), ADMIN_SESSION_COOKIE
# Non-local targets additionally require ALLOW_PROD_MUTATION=1.
set -euo pipefail

FIXTURE="${1:?fixture path required}"
BATCH_NAME="${2:?batch name required}"
DOMAIN="${3:-law}"
ARTICLE_TYPE="${4:-full}"

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-}"

if [[ ! "$BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$) ]] &&
   [[ "${ALLOW_PROD_MUTATION:-}" != "1" ]]; then
  echo "FAIL: set ALLOW_PROD_MUTATION=1 for a non-local upload target" >&2
  exit 1
fi
[[ -n "$ADMIN_SESSION_COOKIE" ]] || {
  echo "FAIL: ADMIN_SESSION_COOKIE is required" >&2
  exit 1
}

[[ -f "$FIXTURE" ]] || { echo "FAIL: fixture not found: $FIXTURE" >&2; exit 1; }
FILENAME="$(basename "$FIXTURE")"
LOWER_EXT="${FILENAME##*.}"
LOWER_EXT="$(echo "$LOWER_EXT" | tr '[:upper:]' '[:lower:]')"
case "$LOWER_EXT" in
  json) CONTENT_TYPE="application/json" ;;
  zip)  CONTENT_TYPE="application/zip" ;;
  *)    echo "FAIL: unsupported extension .$LOWER_EXT" >&2; exit 1 ;;
esac

echo "→ $BASE_URL  fixture=$FILENAME ($(wc -c <"$FIXTURE") bytes)  ct=$CONTENT_TYPE"

echo "[1/4] verify admin session"
ROLE="$(curl -fsS -H "Cookie: $ADMIN_SESSION_COOKIE" "$BASE_URL/api/auth/me" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log((JSON.parse(s)||{}).role||""))')"
[[ "$ROLE" == "admin" ]] || { echo "FAIL: ADMIN_SESSION_COOKIE is not an admin session" >&2; exit 1; }

echo "[2/4] sign upload URL"
SIGN_JSON=$(curl -fsS -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d "{\"filename\":\"$FILENAME\"}" \
  "$BASE_URL/api/batches/upload-url")
SIGNED_URL=$(echo "$SIGN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.signedUrl))')
STORAGE_KEY=$(echo "$SIGN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.storageKey))')
echo "  storageKey=$STORAGE_KEY"

echo "[3/4] PUT to Supabase Storage"
curl -fsS -X PUT -H "Content-Type: $CONTENT_TYPE" \
  --data-binary "@$FIXTURE" "$SIGNED_URL" >/dev/null

echo "[4/4] create batch '$BATCH_NAME' (domain=$DOMAIN, type=$ARTICLE_TYPE)"
CREATE_JSON=$(curl -fsS -H "Cookie: $ADMIN_SESSION_COOKIE" -H "Content-Type: application/json" \
  -d "{\"name\":\"$BATCH_NAME\",\"domain\":\"$DOMAIN\",\"articleType\":\"$ARTICLE_TYPE\",\"payRatePerArticle\":0,\"storageKey\":\"$STORAGE_KEY\",\"filename\":\"$FILENAME\"}" \
  "$BASE_URL/api/batches")
echo "$CREATE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).data;console.log(`  batchId=${d.id} totalArticles=${d.totalArticles} errors=${(d.errorFiles||[]).length}`)})'
echo "✅ Done: $FILENAME"
