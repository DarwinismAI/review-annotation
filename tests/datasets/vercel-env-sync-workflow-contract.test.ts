import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/sync-vercel-environment.yml", "utf8");
const script = readFileSync("scripts/sync-vercel-environment.sh", "utf8");

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

function between(start: string, end: string): string {
  const startIndex = workflow.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = workflow.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return workflow.slice(startIndex, endIndex);
}

function step(name: string): string {
  const marker = `      - name: ${name}\n`;
  const startIndex = workflow.indexOf(marker);
  assert.notEqual(startIndex, -1, `missing step: ${name}`);
  const nextIndex = workflow.indexOf("\n      - ", startIndex + marker.length);
  return workflow.slice(startIndex, nextIndex === -1 ? workflow.length : nextIndex);
}

assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      target:\n/m);
assert.match(workflow, /required: true/);
assert.match(workflow, /type: choice/);
assert.match(workflow, /options:\n          - dev\n          - prod/);

assert.equal((workflow.match(/^  sync-vercel-environment:/gm) ?? []).length, 1);
assert.match(workflow, /^    environment: \$\{\{ inputs\.target \}\}$/m);
assert.match(workflow, /^    name: Sync Vercel production env \(\$\{\{ inputs\.target \}\}\)$/m);

const jobHeader = between("  sync-vercel-environment:\n", "    steps:\n");
assert.doesNotMatch(jobHeader, /\n    env:/);
assert.doesNotMatch(jobHeader, /secrets\./);

const setupSteps = between("    steps:\n", "      - name: Sync Vercel production env (dev)\n");
assert.match(setupSteps, /actions\/checkout@v4/);
assert.match(setupSteps, /pnpm install --frozen-lockfile/);
assert.doesNotMatch(setupSteps, /secrets\.|DATABASE_URL|POSTGRES_URL|SUPABASE_|VERCEL_|SUPERADMIN_EMAILS/);

const devStep = step("Sync Vercel production env (dev)");
assert.match(devStep, /if: inputs\.target == 'dev'/);
assert.match(devStep, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
assert.match(devStep, /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
assert.match(devStep, /VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_DEV_PROJECT_ID \}\}/);
assert.doesNotMatch(devStep, /VERCEL_PROD_PROJECT_ID|secrets\.PROD_/);

const prodStep = step("Sync Vercel production env (prod)");
assert.match(prodStep, /if: inputs\.target == 'prod'/);
assert.match(prodStep, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
assert.match(prodStep, /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}/);
assert.match(prodStep, /VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROD_PROJECT_ID \}\}/);
assert.doesNotMatch(prodStep, /VERCEL_DEV_PROJECT_ID|secrets\.DEV_/);

for (const key of runtimeKeys) {
  assert.match(devStep, new RegExp(`${key}_VALUE: \\$\\{\\{ secrets\\.DEV_${key} \\}\\}`));
  assert.match(prodStep, new RegExp(`${key}_VALUE: \\$\\{\\{ secrets\\.PROD_${key} \\}\\}`));
  assert.doesNotMatch(devStep, new RegExp(`secrets\\.PROD_${key}`));
  assert.doesNotMatch(prodStep, new RegExp(`secrets\\.DEV_${key}`));
  assert.match(script, new RegExp(`sync_env "${key}" "\\$\\{${key}_VALUE\\}"`));
}

assert.match(devStep, /bash scripts\/sync-vercel-environment\.sh/);
assert.match(prodStep, /bash scripts\/sync-vercel-environment\.sh/);

assert.match(script, /required_vars=\(/);
assert.match(script, /VERCEL_TOKEN/);
assert.match(script, /VERCEL_ORG_ID/);
assert.match(script, /VERCEL_PROJECT_ID/);
assert.match(script, /pnpm dlx vercel@58\.4\.4 env add "\$name" production --force --sensitive --yes --token "\$VERCEL_TOKEN"/);
assert.match(script, /printf '%s' "\$value" \|/);
assert.match(script, /mkdir -p \.vercel/);
assert.match(script, /"projectId": "\$VERCEL_PROJECT_ID"/);
assert.match(script, /"orgId": "\$VERCEL_ORG_ID"/);
assert.match(script, /trap 'rm -rf \.vercel' EXIT/);

assert.doesNotMatch(workflow, /echo\s+.*(?:VALUE|TOKEN|URL|KEY|EMAILS|secrets\.)/i);
assert.doesNotMatch(script, /echo\s+.*(?:VALUE|TOKEN|URL|KEY|EMAILS)/i);
assert.doesNotMatch(workflow, /--value/);
assert.doesNotMatch(script, /--value/);
assert.doesNotMatch(workflow, /https?:\/\//);
assert.doesNotMatch(script, /https?:\/\//);
assert.doesNotMatch(workflow, /prj_[A-Za-z0-9]+/);
assert.doesNotMatch(script, /prj_[A-Za-z0-9]+/);
