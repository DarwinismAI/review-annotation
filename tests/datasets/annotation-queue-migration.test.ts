import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/apply-annotation-queue-migration.yml", "utf8");
const script = readFileSync("scripts/apply-annotation-queue-migration.ts", "utf8");
const migration = readFileSync("migrations/0022_annotation_queue_adjudication.sql", "utf8");
const pgDatasets = readFileSync("src/db/datasets.ts", "utf8");
const sqliteDatasets = readFileSync("src/db/datasets.sqlite.ts", "utf8");
const runner = readFileSync("tests/datasets/run.ts", "utf8");

assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
assert.doesNotMatch(workflow, /push:|pull_request:/);
assert.match(workflow, /TARGET: \$\{\{ inputs\.target \}\}/);
assert.match(workflow, /DEV_DATABASE_URL: \$\{\{ secrets\.DEV_DATABASE_URL \}\}/);
assert.match(workflow, /DEV_POSTGRES_URL: \$\{\{ secrets\.DEV_POSTGRES_URL \}\}/);
assert.match(workflow, /PROD_DATABASE_URL: \$\{\{ secrets\.PROD_DATABASE_URL \}\}/);
assert.match(workflow, /PROD_POSTGRES_URL: \$\{\{ secrets\.PROD_POSTGRES_URL \}\}/);
assert.match(workflow, /database_url="\$\{DEV_DATABASE_URL:-\$\{DEV_POSTGRES_URL:-\}\}"/);
assert.match(workflow, /database_url="\$\{PROD_DATABASE_URL:-\$\{PROD_POSTGRES_URL:-\}\}"/);
assert.match(workflow, /\[ -z "\$database_url" \]/);
assert.doesNotMatch(workflow, /secrets\.DATABASE_URL/);
assert.doesNotMatch(workflow, /secrets\.POSTGRES_URL/);
assert.match(workflow, /pnpm exec tsx scripts\/apply-annotation-queue-migration\.ts/);

assert.match(script, /PROD_DATABASE_URL/);
assert.match(script, /DATABASE_URL/);
assert.match(script, /PROD_POSTGRES_URL/);
assert.match(script, /POSTGRES_URL/);
assert.match(script, /migrations\/0022_annotation_queue_adjudication\.sql/);
assert.doesNotMatch(script, /0021_safety_compliance_domain_constraints/);
assert.match(script, /client\.begin\(async \(tx\) =>/);
assert.doesNotMatch(script, /client`\s*BEGIN\s*`/);
assert.doesNotMatch(script, /client`\s*COMMIT\s*`/);
assert.doesNotMatch(script, /client`\s*ROLLBACK\s*`/);
assert.match(script, /tx\.unsafe\(migrationSql\)/);
assert.doesNotMatch(script, /client\.unsafe\(migrationSql\)/);
assert.match(script, /finally[\s\S]*client\.end\(\)/);
assert.match(migration, /reviewer_id UUID REFERENCES profiles\(id\) ON DELETE SET NULL/);
assert.doesNotMatch(migration, /reviewer_id TEXT REFERENCES profiles\(id\)/);
assert.match(pgDatasets, /import \{ index, integer, jsonb, pgTable, text, timestamp, unique, uuid \} from "drizzle-orm\/pg-core";/);
assert.equal((pgDatasets.match(/createdBy: uuid\("created_by"\)\.references\(\(\) => profiles\.id, \{ onDelete: "set null" \}\)/g) ?? []).length, 3);
assert.equal((pgDatasets.match(/annotatorId: uuid\("annotator_id"\)\.notNull\(\)\.references\(\(\) => profiles\.id, \{ onDelete: "cascade" \}\)/g) ?? []).length, 2);
assert.match(pgDatasets, /reviewerId: uuid\("reviewer_id"\)\.references\(\(\) => profiles\.id, \{ onDelete: "set null" \}\)/);
assert.doesNotMatch(pgDatasets, /(?:createdBy|annotatorId|reviewerId): text\("(?:created_by|annotator_id|reviewer_id)"\)\.references\(\(\) => profiles\.id/);
assert.match(sqliteDatasets, /reviewerId: text\("reviewer_id"\)\.references\(\(\) => profiles\.id, \{ onDelete: "set null" \}\)/);

for (const table of [
  "datasets",
  "dataset_rows",
  "annotation_assignments",
  "annotation_results",
  "annotation_metrics",
  "annotation_assignment_runs",
  "dataset_imports",
]) {
  assert.match(script, new RegExp(`"${table}"`));
}

assert.match(script, /counts\.set\(table, await readTableCount\(client, table\)\)/);
assert.match(script, /readOptionalTableCount\(tx, "annotation_adjudications"\)/);
assert.match(script, /afterAdjudications\.total !== beforeAdjudications\.total/);
assert.match(script, /!beforeAdjudications\.exists && afterAdjudications\.total !== BigInt\(0\)/);

for (const required of [
  "table: \"annotation_assignments\", column: \"skipped_at\", dataType: \"timestamp with time zone\", isNullable: \"YES\", columnDefault: null",
  "table: \"annotation_assignments\", column: \"skip_count\", dataType: \"integer\", isNullable: \"NO\", columnDefault: \"0\"",
  "table: \"dataset_imports\", column: \"target_row_count\", dataType: \"integer\", isNullable: \"YES\", columnDefault: null",
  "table: \"dataset_imports\", column: \"error_message\", dataType: \"text\", isNullable: \"YES\", columnDefault: null",
  "table: \"dataset_imports\", column: \"started_at\", dataType: \"timestamp with time zone\", isNullable: \"YES\", columnDefault: null",
  "table: \"dataset_imports\", column: \"completed_at\", dataType: \"timestamp with time zone\", isNullable: \"YES\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"id\", dataType: \"text\", isNullable: \"NO\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"dataset_id\", dataType: \"text\", isNullable: \"NO\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"row_id\", dataType: \"text\", isNullable: \"NO\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"metric_id\", dataType: \"text\", isNullable: \"NO\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"metric_key\", dataType: \"text\", isNullable: \"NO\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"reviewer_id\", dataType: \"uuid\", isNullable: \"YES\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"value\", dataType: \"text\", isNullable: \"YES\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"note\", dataType: \"text\", isNullable: \"YES\", columnDefault: null",
  "table: \"annotation_adjudications\", column: \"created_at\", dataType: \"timestamp with time zone\", isNullable: \"NO\", columnDefault: \"now()\"",
  "table: \"annotation_adjudications\", column: \"updated_at\", dataType: \"timestamp with time zone\", isNullable: \"NO\", columnDefault: \"now()\"",
  "table: \"annotation_adjudications\", column: \"submitted_at\", dataType: \"timestamp with time zone\", isNullable: \"NO\", columnDefault: \"now()\"",
]) {
  assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const required of [
  "name: \"annotation_assignments_group_queue_idx\", table: \"annotation_assignments\", columns: [\"annotator_id\", \"assignment_run_id\", \"status\", \"skipped_at\", \"assigned_at\"]",
  "name: \"dataset_imports_dataset_status_idx\", table: \"dataset_imports\", columns: [\"dataset_id\", \"status\", \"created_at DESC\"]",
  "name: \"annotation_adjudications_dataset_row_idx\", table: \"annotation_adjudications\", columns: [\"dataset_id\", \"row_id\"]",
  "name: \"annotation_adjudications_row_metric_unique\", table: \"annotation_adjudications\", columns: [\"row_id\", \"metric_id\"], unique: true",
]) {
  assert.match(script, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(script, /primary key/);
assert.match(script, /annotation_adjudications_pkey/);
assert.match(script, /foreign key/);
assert.match(script, /constraintCandidates\.find\(\(/);
assert.doesNotMatch(script, /const \[constraint\] = await client/);
assert.match(script, /foreignTable: "datasets", foreignColumns: \["id"\], deleteAction: "CASCADE"/);
assert.match(script, /foreignTable: "dataset_rows", foreignColumns: \["id"\], deleteAction: "CASCADE"/);
assert.match(script, /foreignTable: "annotation_metrics", foreignColumns: \["id"\], deleteAction: "CASCADE"/);
assert.match(script, /foreignTable: "profiles", foreignColumns: \["id"\], deleteAction: "SET NULL"/);

assert.match(script, /Aggregate row-count invariants verified/);
assert.doesNotMatch(script, /console\.log\([^)]*databaseUrl/);
assert.doesNotMatch(script, /console\.error\([^)]*databaseUrl/);
assert.match(runner, /import "\.\/annotation-queue-migration\.test";/);
