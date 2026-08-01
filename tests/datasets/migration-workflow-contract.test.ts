import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/apply-annotation-queue-migration.yml", "utf8");

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
assert.match(workflow, /description: "Target environment"/);
assert.match(workflow, /required: true/);
assert.match(workflow, /type: choice/);
assert.match(workflow, /options:\n          - dev\n          - prod/);

assert.equal((workflow.match(/^  apply-annotation-queue-migration:/gm) ?? []).length, 1);
assert.match(workflow, /^    environment: \$\{\{ inputs\.target \}\}$/m);
assert.match(workflow, /^    name: Apply annotation queue migration \(\$\{\{ inputs\.target \}\}\)$/m);

const jobHeader = between("  apply-annotation-queue-migration:\n", "    steps:\n");
assert.doesNotMatch(jobHeader, /\n    env:/);
assert.doesNotMatch(jobHeader, /secrets\./);

const setupSteps = between("    steps:\n", "      - name: Apply annotation queue migration (dev)\n");
assert.match(setupSteps, /actions\/checkout@v4/);
assert.match(setupSteps, /pnpm install --frozen-lockfile/);
assert.doesNotMatch(setupSteps, /secrets\.|DATABASE_URL|POSTGRES_URL|VERCEL_/);

const devStep = step("Apply annotation queue migration (dev)");
assert.match(devStep, /if: inputs\.target == 'dev'/);
assert.match(devStep, /DATABASE_URL_SECRET: \$\{\{ secrets\.DEV_DATABASE_URL \}\}/);
assert.match(devStep, /POSTGRES_URL_SECRET: \$\{\{ secrets\.DEV_POSTGRES_URL \}\}/);
assert.match(devStep, /database_url="\$\{DATABASE_URL_SECRET:-\$\{POSTGRES_URL_SECRET:-\}\}"/);
assert.match(devStep, /\[ -z "\$database_url" \]/);
assert.match(devStep, /DATABASE_URL="\$database_url" pnpm exec tsx scripts\/apply-annotation-queue-migration\.ts/);
assert.doesNotMatch(devStep, /PROD_|secrets\.PROD_|secrets\.DATABASE_URL|secrets\.POSTGRES_URL|GITHUB_ENV|DATABASE_URL_EOF/);

const prodStep = step("Apply annotation queue migration (prod)");
assert.match(prodStep, /if: inputs\.target == 'prod'/);
assert.match(prodStep, /DATABASE_URL_SECRET: \$\{\{ secrets\.PROD_DATABASE_URL \}\}/);
assert.match(prodStep, /POSTGRES_URL_SECRET: \$\{\{ secrets\.PROD_POSTGRES_URL \}\}/);
assert.match(prodStep, /database_url="\$\{DATABASE_URL_SECRET:-\$\{POSTGRES_URL_SECRET:-\}\}"/);
assert.match(prodStep, /\[ -z "\$database_url" \]/);
assert.match(prodStep, /DATABASE_URL="\$database_url" pnpm exec tsx scripts\/apply-annotation-queue-migration\.ts/);
assert.doesNotMatch(prodStep, /DEV_|secrets\.DEV_|secrets\.DATABASE_URL|secrets\.POSTGRES_URL|GITHUB_ENV|DATABASE_URL_EOF/);

assert.doesNotMatch(workflow, /secrets\.DATABASE_URL/);
assert.doesNotMatch(workflow, /secrets\.POSTGRES_URL/);
assert.doesNotMatch(workflow, /GITHUB_ENV/);
assert.doesNotMatch(workflow, /DATABASE_URL_EOF/);

assert.doesNotMatch(workflow, /echo\s+.*secrets\./i);
assert.doesNotMatch(workflow, /DATABASE_URL=.*\$\{\{ secrets\./);
assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^$]/i);
