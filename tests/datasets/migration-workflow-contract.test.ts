import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/apply-annotation-queue-migration.yml", "utf8");

assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      target:\n/m);
assert.match(workflow, /description: "Target environment"/);
assert.match(workflow, /required: true/);
assert.match(workflow, /type: choice/);
assert.match(workflow, /options:\n          - dev\n          - prod/);

assert.equal((workflow.match(/^  apply-annotation-queue-migration:/gm) ?? []).length, 1);
assert.match(workflow, /^    environment: \$\{\{ inputs\.target \}\}$/m);
assert.match(workflow, /^    name: Apply annotation queue migration \(\$\{\{ inputs\.target \}\}\)$/m);

assert.match(workflow, /TARGET: \$\{\{ inputs\.target \}\}/);
assert.match(workflow, /DEV_DATABASE_URL: \$\{\{ secrets\.DEV_DATABASE_URL \}\}/);
assert.match(workflow, /DEV_POSTGRES_URL: \$\{\{ secrets\.DEV_POSTGRES_URL \}\}/);
assert.match(workflow, /PROD_DATABASE_URL: \$\{\{ secrets\.PROD_DATABASE_URL \}\}/);
assert.match(workflow, /PROD_POSTGRES_URL: \$\{\{ secrets\.PROD_POSTGRES_URL \}\}/);
assert.match(workflow, /if \[ "\$TARGET" = "dev" \]; then/);
assert.match(workflow, /database_url="\$\{DEV_DATABASE_URL:-\$\{DEV_POSTGRES_URL:-\}\}"/);
assert.match(workflow, /database_url="\$\{PROD_DATABASE_URL:-\$\{PROD_POSTGRES_URL:-\}\}"/);
assert.match(workflow, /\[ -z "\$database_url" \]/);
assert.match(workflow, /DATABASE_URL="\$database_url" pnpm exec tsx scripts\/apply-annotation-queue-migration\.ts/);

assert.doesNotMatch(workflow, /DEV_DATABASE_URL[^\n]*PROD_/);
assert.doesNotMatch(workflow, /DEV_POSTGRES_URL[^\n]*PROD_/);
assert.doesNotMatch(workflow, /PROD_DATABASE_URL[^\n]*DEV_/);
assert.doesNotMatch(workflow, /PROD_POSTGRES_URL[^\n]*DEV_/);
assert.doesNotMatch(workflow, /secrets\.DATABASE_URL/);
assert.doesNotMatch(workflow, /secrets\.POSTGRES_URL/);
assert.doesNotMatch(workflow, /GITHUB_ENV/);
assert.doesNotMatch(workflow, /DATABASE_URL_EOF/);

assert.doesNotMatch(workflow, /echo\s+.*secrets\./i);
assert.doesNotMatch(workflow, /DATABASE_URL=.*\$\{\{ secrets\./);
assert.doesNotMatch(workflow, /postgres(?:ql)?:\/\/[^$]/i);
