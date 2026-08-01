#!/usr/bin/env bash
set -euo pipefail

trap 'rm -rf .vercel' EXIT

required_vars=(
  VERCEL_TOKEN
  VERCEL_ORG_ID
  VERCEL_PROJECT_ID
  DATABASE_URL_VALUE
  POSTGRES_URL_VALUE
  NEXT_PUBLIC_APP_URL_VALUE
  NEXT_PUBLIC_SUPABASE_URL_VALUE
  NEXT_PUBLIC_SUPABASE_ANON_KEY_VALUE
  SUPABASE_URL_VALUE
  SUPABASE_ANON_KEY_VALUE
  SUPABASE_SERVICE_ROLE_KEY_VALUE
  SUPABASE_SECRET_KEY_VALUE
  SUPERADMIN_EMAILS_VALUE
)

for var_name in "${required_vars[@]}"; do
  if [ -z "${!var_name:-}" ]; then
    printf '%s\n' "::error::Required secret is empty: $var_name" >&2
    exit 1
  fi
done

mkdir -p .vercel
cat > .vercel/project.json <<PROJECT_JSON
{
  "projectId": "$VERCEL_PROJECT_ID",
  "orgId": "$VERCEL_ORG_ID"
}
PROJECT_JSON

sync_env() {
  local name="$1"
  local value="$2"

  printf '%s' "$value" |
    pnpm dlx vercel@58.4.4 env add "$name" production --force --sensitive --yes --token "$VERCEL_TOKEN"
}

sync_env "DATABASE_URL" "${DATABASE_URL_VALUE}"
sync_env "POSTGRES_URL" "${POSTGRES_URL_VALUE}"
sync_env "NEXT_PUBLIC_APP_URL" "${NEXT_PUBLIC_APP_URL_VALUE}"
sync_env "NEXT_PUBLIC_SUPABASE_URL" "${NEXT_PUBLIC_SUPABASE_URL_VALUE}"
sync_env "NEXT_PUBLIC_SUPABASE_ANON_KEY" "${NEXT_PUBLIC_SUPABASE_ANON_KEY_VALUE}"
sync_env "SUPABASE_URL" "${SUPABASE_URL_VALUE}"
sync_env "SUPABASE_ANON_KEY" "${SUPABASE_ANON_KEY_VALUE}"
sync_env "SUPABASE_SERVICE_ROLE_KEY" "${SUPABASE_SERVICE_ROLE_KEY_VALUE}"
sync_env "SUPABASE_SECRET_KEY" "${SUPABASE_SECRET_KEY_VALUE}"
sync_env "SUPERADMIN_EMAILS" "${SUPERADMIN_EMAILS_VALUE}"
