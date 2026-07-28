import assert from "node:assert/strict";
import { planBalancedAssignments } from "../../src/lib/datasets/assignment";

const plan = planBalancedAssignments({
  rowIds: ["r1", "r2", "r3"],
  annotatorIds: ["a1", "a2", "a3"],
  metricIds: ["m1", "m2"],
  targetOverlap: 2,
  existingAssignments: [{ rowId: "r1", annotatorId: "a1", metricKey: "m1,m2", status: "completed" }],
});

assert.equal(plan.ok, true);
if (plan.ok) {
  assert.deepEqual(plan.assignments, [
    { rowId: "r1", annotatorId: "a2", metricIds: ["m1", "m2"] },
    { rowId: "r2", annotatorId: "a3", metricIds: ["m1", "m2"] },
    { rowId: "r2", annotatorId: "a1", metricIds: ["m1", "m2"] },
    { rowId: "r3", annotatorId: "a2", metricIds: ["m1", "m2"] },
    { rowId: "r3", annotatorId: "a3", metricIds: ["m1", "m2"] },
  ]);
  assert.deepEqual(plan.skippedRowIds, []);
}

assert.deepEqual(
  planBalancedAssignments({
    rowIds: ["r1"],
    annotatorIds: ["a1"],
    metricIds: ["m1"],
    targetOverlap: 2,
    existingAssignments: [],
  }),
  { ok: false, reason: "NOT_ENOUGH_ANNOTATORS" },
);

const alreadyComplete = planBalancedAssignments({
  rowIds: ["r1"],
  annotatorIds: ["a1", "a2"],
  metricIds: ["m1"],
  targetOverlap: 2,
  existingAssignments: [
    { rowId: "r1", annotatorId: "a1", metricKey: "m1", status: "completed" },
    { rowId: "r1", annotatorId: "a2", metricKey: "m1", status: "assigned" },
  ],
});

assert.equal(alreadyComplete.ok, true);
if (alreadyComplete.ok) {
  assert.deepEqual(alreadyComplete.assignments, []);
  assert.deepEqual(alreadyComplete.skippedRowIds, ["r1"]);
}

const quotaPlan = planBalancedAssignments({
  rowIds: ["r1", "r2", "r3"],
  annotatorIds: ["a1", "a2", "a3"],
  metricIds: ["m1"],
  targetOverlap: 2,
  maxRowsPerAnnotator: 1,
  existingAssignments: [],
});

assert.equal(quotaPlan.ok, true);
if (quotaPlan.ok) {
  assert.deepEqual(quotaPlan.assignments, [
    { rowId: "r1", annotatorId: "a1", metricIds: ["m1"] },
    { rowId: "r1", annotatorId: "a2", metricIds: ["m1"] },
  ]);
  assert.deepEqual(quotaPlan.skippedRowIds, ["r2", "r3"]);
}

const quotaWithExistingLoad = planBalancedAssignments({
  rowIds: ["r1", "r2"],
  annotatorIds: ["a1", "a2", "a3"],
  metricIds: ["m1"],
  targetOverlap: 2,
  maxRowsPerAnnotator: 1,
  existingAssignments: [{ rowId: "r1", annotatorId: "a1", metricKey: "m1", status: "assigned" }],
});

assert.equal(quotaWithExistingLoad.ok, true);
if (quotaWithExistingLoad.ok) {
  assert.deepEqual(quotaWithExistingLoad.assignments, [
    { rowId: "r1", annotatorId: "a2", metricIds: ["m1"] },
  ]);
  assert.deepEqual(quotaWithExistingLoad.skippedRowIds, ["r2"]);
}
