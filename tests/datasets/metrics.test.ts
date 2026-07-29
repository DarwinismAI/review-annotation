import assert from "node:assert/strict";
import { validateDraftMetricSubmission, validateMetricConfig, validateMetricSubmission } from "../../src/lib/datasets/metrics";

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
  validateMetricConfig([
    {
      key: "severity",
      label: "Severity",
      scale: { values: ["1", "2", "3", "4", "5"] },
      required: true,
      sortOrder: 0,
    },
  ]),
  { ok: false, reason: "METRIC_SCALE_NOT_PASS_FAIL", key: "severity" },
);

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

assert.deepEqual(
  validateDraftMetricSubmission({
    assignedMetricIds: ["policy_violation", "implicit_risk"],
    metrics: [
      { id: "policy_violation", scale: { values: ["Failed", "Pass"] } },
      { id: "implicit_risk", scale: { values: ["Failed", "Pass"] } },
    ],
    values: { policy_violation: "Pass" },
  }),
  { ok: true },
);

assert.deepEqual(
  validateDraftMetricSubmission({
    assignedMetricIds: ["policy_violation"],
    metrics: [{ id: "policy_violation", scale: { values: ["Failed", "Pass"] } }],
    values: { policy_violation: "5" },
  }),
  { ok: false, reason: "INVALID_METRIC_VALUE", metricId: "policy_violation" },
);
