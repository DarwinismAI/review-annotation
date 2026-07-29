import assert from "node:assert/strict";
import { projectImportJobStatus } from "../../src/lib/datasets/task-groups";

assert.deepEqual(projectImportJobStatus({ status: "in_progress", rowCount: 500, targetRowCount: 1000, errorMessage: null }), {
  status: "running",
  rowCount: 500,
  targetRowCount: 1000,
  progress: 50,
  canCancel: false,
  canRetry: false,
  errorMessage: null,
});

assert.deepEqual(projectImportJobStatus({ status: "failed", rowCount: 250, targetRowCount: 1000, errorMessage: "bad row" }).canRetry, true);
