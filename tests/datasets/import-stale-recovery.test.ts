import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canFailStaleImportJob,
  IMPORT_STALE_RECOVERY_MIN_AGE_MS,
  type ImportJobRecoveryState,
} from "../../src/lib/datasets/import-stale-recovery";

const now = new Date("2026-08-01T00:00:00.000Z");
const staleCreatedAt = new Date(now.getTime() - IMPORT_STALE_RECOVERY_MIN_AGE_MS - 1);
const freshCreatedAt = new Date(now.getTime() - IMPORT_STALE_RECOVERY_MIN_AGE_MS + 1);

function job(overrides: Partial<ImportJobRecoveryState> = {}): ImportJobRecoveryState {
  return {
    id: "import-1",
    datasetId: "dataset-1",
    datasetStatus: "importing",
    status: "in_progress",
    rowCount: 5,
    createdAt: staleCreatedAt,
    activeImportId: "import-1",
    ...overrides,
  };
}

const freshDecision = canFailStaleImportJob(job({ createdAt: freshCreatedAt }), now);
assert.equal(freshDecision.ok, false);
if (!freshDecision.ok) {
  assert.equal(freshDecision.code, "IMPORT_JOB_NOT_STALE");
}

assert.equal(canFailStaleImportJob(job({ status: "completed" }), now).ok, false);
assert.equal(canFailStaleImportJob(job({ status: "canceled" }), now).ok, false);

const stalePartial = canFailStaleImportJob(job(), now);
assert.equal(stalePartial.ok, true);
if (stalePartial.ok) {
  assert.equal(stalePartial.datasetStatus, "failed");
  assert.match(stalePartial.errorMessage, /stale/i);
}

assert.equal(canFailStaleImportJob(job({ activeImportId: "another-import" }), now).ok, false);
assert.equal(canFailStaleImportJob(job({ activeImportId: null }), now).ok, false);

const recoveryRoute = readFileSync("src/app/api/import-jobs/[jobId]/recover/route.ts", "utf8");
assert.match(recoveryRoute, /requireAdmin/);
assert.match(recoveryRoute, /fail_stale/);
assert.match(recoveryRoute, /db\.transaction/);
assert.match(recoveryRoute, /lockDatasetImportRun/);
assert.match(recoveryRoute, /lockDatasetImportDomain/);
assert.doesNotMatch(recoveryRoute, /\.delete\(\s*datasetRows\s*\)/);
assert.doesNotMatch(recoveryRoute, /\.update\(\s*datasetRows\s*\)/);
assert.doesNotMatch(recoveryRoute, /status:\s*"ready"/);
assert.doesNotMatch(recoveryRoute, /set\(\{[\s\S]*status:\s*"ready"/);

const cancelRoute = readFileSync("src/app/api/import-jobs/[jobId]/cancel/route.ts", "utf8");
assert.match(cancelRoute, /job\.status !== "in_progress" \|\| job\.rowCount !== 0/);
assert.match(cancelRoute, /status:\s*"canceled"/);
assert.match(cancelRoute, /status:\s*"ready"/);
