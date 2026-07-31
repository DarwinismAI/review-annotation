import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const transactionalSql = readFileSync("migrations/0022_annotation_queue_adjudication.sql", "utf8");
const securityMigrationPath = "migrations/0023_annotation_adjudication_security.sql";
assert.ok(existsSync(securityMigrationPath), "adjudication security migration must exist");

const securitySql = readFileSync(securityMigrationPath, "utf8");
const runnerSource = readFileSync("scripts/apply-annotation-queue-migration.ts", "utf8");
const beginBody = runnerSource.match(/client\.begin\(async \(tx\) => \{([\s\S]*?)\n    \}\);/)?.[1] ?? "";

assert.match(securitySql, /ALTER TABLE public\.annotation_adjudications ENABLE ROW LEVEL SECURITY/i);
assert.match(securitySql, /REVOKE ALL ON TABLE public\.annotation_adjudications FROM anon, authenticated/i);
assert.doesNotMatch(transactionalSql, /CREATE\s+(UNIQUE\s+)?INDEX(?!\s+CONCURRENTLY)/i);
assert.match(runnerSource, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
assert.match(runnerSource, /verifyAdjudicationSecurity/);
assert.doesNotMatch(beginBody, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/i);
assert.doesNotMatch(beginBody, /CONCURRENT_INDEX_SQL/);
assert.doesNotMatch(runnerSource, /CREATE UNIQUE INDEX CONCURRENTLY/i);
