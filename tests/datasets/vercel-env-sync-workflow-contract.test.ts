import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/sync-vercel-environment.yml", "utf8");

const runtimeKeys = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPERADMIN_EMAILS",
];

assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      target:\n/m);
assert.match(workflow, /required: true/);
assert.match(workflow, /type: choice/);
assert.match(workflow, /options:\n          - dev\n          - prod/);

assert.equal((workflow.match(/^  sync-vercel-environment:/gm) ?? []).length, 1);
assert.match(workflow, /^    environment: \$\{\{ inputs\.target \}\}$/m);
assert.match(workflow, /^    name: Sync Vercel production env \(\$\{\{ inputs\.target \}\}\)$/m);

assert.match(workflow, /TARGET: \$\{\{ inputs\.target \}\}/);
assert.match(workflow, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
assert.match(workflow, /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
assert.match(workflow, /VERCEL_DEV_PROJECT_ID: \$\{\{ secrets\.VERCEL_DEV_PROJECT_ID \}\}/);
assert.match(workflow, /VERCEL_PROD_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROD_PROJECT_ID \}\}/);
assert.doesNotMatch(workflow, /VERCEL_PROJECT_ID: (?!\$\{\{)[A-Za-z0-9_-]+/);
assert.doesNotMatch(workflow, /VERCEL_TOKEN: (?!\$\{\{)[A-Za-z0-9_-]+/);

for (const key of runtimeKeys) {
  assert.match(workflow, new RegExp(`DEV_${key}: \\$\\{\\{ secrets\\.DEV_${key} \\}\\}`));
  assert.match(workflow, new RegExp(`PROD_${key}: \\$\\{\\{ secrets\\.PROD_${key} \\}\\}`));
  assert.match(workflow, new RegExp(`${key}_VALUE="\\$DEV_${key}"`));
  assert.match(workflow, new RegExp(`${key}_VALUE="\\$PROD_${key}"`));
  assert.match(workflow, new RegExp(`sync_env "${key}" "\\$${key}_VALUE"`));
}

assert.match(workflow, /if \[ "\$TARGET" = "dev" \]; then/);
assert.match(workflow, /VERCEL_PROJECT_ID="\$VERCEL_DEV_PROJECT_ID"/);
assert.match(workflow, /VERCEL_PROJECT_ID="\$VERCEL_PROD_PROJECT_ID"/);

assert.match(workflow, /pnpm dlx vercel@58\.4\.4 env add "\$name" production --force --sensitive --yes --token "\$VERCEL_TOKEN"/);
assert.match(workflow, /printf '%s' "\$value" \|/);
assert.match(workflow, /mkdir -p \.vercel/);
assert.match(workflow, /"projectId": "\$VERCEL_PROJECT_ID"/);
assert.match(workflow, /"orgId": "\$VERCEL_ORG_ID"/);
assert.match(workflow, /trap 'rm -rf \.vercel' EXIT/);

assert.doesNotMatch(workflow, /echo\s+.*(?:VALUE|TOKEN|URL|KEY|EMAILS|secrets\.)/i);
assert.doesNotMatch(workflow, /--value/);
assert.doesNotMatch(workflow, /https?:\/\//);
assert.doesNotMatch(workflow, /prj_[A-Za-z0-9]+/);
