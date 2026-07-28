#!/usr/bin/env bash
# Probe the production upload flow end-to-end:
#   1) create an admin session from explicit Supabase credentials
#   2) POST /api/batches/upload-url -> get signed URL
#   3) PUT the 6MB ZIP fixture directly to Supabase Storage
#   4) POST /api/batches to kick off processing
#   5) GET /api/batches/{id} to confirm rows were persisted
#
# Exits non-zero on any step failing.

set -euo pipefail

BASE_URL="${BASE_URL:-}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
FIXTURE="${FIXTURE:-}"

[[ -n "$BASE_URL" ]] || { echo "FAIL: BASE_URL is required" >&2; exit 1; }
[[ -n "$SUPABASE_URL" ]] || { echo "FAIL: SUPABASE_URL is required" >&2; exit 1; }
[[ -n "$SUPABASE_ANON_KEY" ]] || { echo "FAIL: SUPABASE_ANON_KEY is required" >&2; exit 1; }
[[ -n "$ADMIN_EMAIL" ]] || { echo "FAIL: ADMIN_EMAIL is required" >&2; exit 1; }
[[ -n "$ADMIN_PASSWORD" ]] || { echo "FAIL: ADMIN_PASSWORD is required" >&2; exit 1; }
[[ -n "$FIXTURE" ]] || { echo "FAIL: FIXTURE is required" >&2; exit 1; }
[[ "${ALLOW_PROD_MUTATION:-}" == "1" ]] || {
  echo "FAIL: set ALLOW_PROD_MUTATION=1 to run this production-mutating probe" >&2
  exit 1
}
[[ -f "$FIXTURE" ]] || { echo "FAIL: fixture not found: $FIXTURE" >&2; exit 1; }

export SUPABASE_URL SUPABASE_ANON_KEY ADMIN_EMAIL ADMIN_PASSWORD
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Using $BASE_URL"
echo "→ Fixture: $FIXTURE ($(wc -c <"$FIXTURE") bytes)"

echo "[1/5] login and check admin session"
COOKIE_HEADER="$(
  cd "$PROJECT_ROOT"
  node <<'NODE'
const { createServerClient } = require("@supabase/ssr");

const cookies = new Map();
const supabase = createServerClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll() {
        return [];
      },
      setAll(items) {
        for (const item of items) cookies.set(item.name, item.value);
      },
    },
  },
);

(async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (error) throw error;
  if (cookies.size === 0) throw new Error("Supabase login returned no session cookies");
  process.stdout.write(
    Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; "),
  );
})().catch((error) => {
  console.error(`FAIL: admin login failed: ${error.message}`);
  process.exit(1);
});
NODE
)"
ROLE=$(curl -fsS -H "Cookie: $COOKIE_HEADER" "$BASE_URL/api/auth/me" | python3 -c 'import sys,json; print((json.load(sys.stdin) or {}).get("role",""))')
test "$ROLE" = "admin" || { echo "FAIL: configured credentials are not an admin account"; exit 1; }

echo "[2/5] request signed upload URL"
SIGN_JSON=$(curl -fsS -H "Cookie: $COOKIE_HEADER" -H "Content-Type: application/json" \
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
CREATE_JSON=$(curl -fsS -H "Cookie: $COOKIE_HEADER" -H "Content-Type: application/json" \
  -d "{\"name\":\"$BATCH_NAME\",\"domain\":\"law\",\"articleType\":\"full\",\"payRatePerArticle\":0,\"storageKey\":\"$STORAGE_KEY\",\"filename\":\"probe.zip\"}" \
  "$BASE_URL/api/batches")
BATCH_ID=$(echo "$CREATE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
TOTAL=$(echo "$CREATE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["totalArticles"])')
echo "  batchId=$BATCH_ID  totalArticles=$TOTAL"
test "$TOTAL" -eq 3 || { echo "FAIL: expected 3 articles, got $TOTAL"; exit 1; }

echo "[5/5] fetch batch detail"
curl -fsS -H "Cookie: $COOKIE_HEADER" "$BASE_URL/api/batches/$BATCH_ID" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print("  status="+d["status"]+" totalArticles="+str(d["totalArticles"])+" name="+d["name"])'

echo "✅ Prod upload flow OK"
