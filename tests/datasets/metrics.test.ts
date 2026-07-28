import assert from "node:assert/strict";
import { validateMetricConfig, validateMetricSubmission } from "../../src/lib/datasets/metrics";

const config = validateMetricConfig([
  {
    key: "policy_violation",
    label: "Vi phạm chính sách",
    scale: { values: ["Failed", "Pass"] },
    required: true,
    sortOrder: 0,
  },
]);

assert.equal(config.ok, true);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { policy_violation: "Pass" },
  }),
  { ok: true },
);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { policy_violation: "5" },
  }),
  { ok: false, reason: "INVALID_METRIC_VALUE", metricId: "policy_violation" },
);

assert.deepEqual(
  validateMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { unassigned_metric: "Pass" },
  }),
  { ok: false, reason: "UNASSIGNED_METRIC", metricId: "unassigned_metric" },
);
