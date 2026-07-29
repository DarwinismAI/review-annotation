import assert from "node:assert/strict";
import { buildAnnotatedRow, buildRowDetail } from "../../src/lib/datasets/row-export";

const row = {
  id: "row-1",
  internalRowId: 1,
  sourceId: "source-1",
  rawJson: {
    input: "Prompt",
    intent: "intent-a",
    sub_intent: "sub-a",
    group: "group-a",
    severity: "high",
  },
};

const metrics = [
  { id: "metric-1", key: "policy_violation", label: "Vi phạm chính sách" },
  { id: "metric-2", key: "implicit_risk", label: "Mức độ ẩn ý" },
];

const assignments = [
  {
    id: "assignment-1",
    rowId: "row-1",
    annotatorId: "ann-1",
    annotatorName: "Annotator One",
    annotatorImage: null,
    status: "completed",
    targetOverlap: 2,
  },
  {
    id: "assignment-2",
    rowId: "row-1",
    annotatorId: "ann-2",
    annotatorName: "Annotator Two",
    annotatorImage: null,
    status: "assigned",
    targetOverlap: 2,
  },
];

const results = [
  {
    assignmentId: "assignment-1",
    rowId: "row-1",
    annotatorId: "ann-1",
    metricId: "metric-1",
    value: "Pass",
    note: "ok",
  },
];

const detail = buildRowDetail({
  row,
  detailFields: ["input", "intent", "sub_intent", "group", "severity"],
  assignments,
  results,
  metrics,
  agreement: 100,
});

assert.deepEqual(Object.keys(detail.detailFields), ["input", "intent", "sub_intent", "group", "severity"]);
assert.equal(detail.completedCount, 1);
assert.equal(detail.targetOverlap, 2);
assert.equal(detail.overlapLabel, "1/2");
assert.equal(detail.missingCount, 1);
assert.equal(detail.agreement, 100);
assert.deepEqual(detail.assignments[0].annotator, { id: "ann-1", name: "Annotator One", image: null });
assert.equal(detail.assignments[0].metrics.policy_violation.value, "Pass");
assert.equal(detail.assignments[0].metrics.policy_violation.note, "ok");
assert.equal(detail.assignments[0].metrics.implicit_risk.value, null);
assert.equal(detail.assignments[1].metrics.policy_violation.value, null);

const exported = buildAnnotatedRow({
  row,
  assignments,
  results,
  metrics,
  agreement: 100,
});

assert.equal(exported.row_id, 1);
assert.equal(exported.source_id, "source-1");
assert.deepEqual(exported.data, row.rawJson);
assert.equal(exported.annotation.completed_count, 1);
assert.equal(exported.annotation.target_overlap, 2);
assert.equal(exported.annotation.agreement, 100);
assert.deepEqual(exported.annotation.annotated_by, [{ id: "ann-1", name: "Annotator One" }]);
assert.equal(exported.annotation.results[0].metrics.policy_violation.label, "Vi phạm chính sách");
assert.equal(exported.annotation.results[0].metrics.policy_violation.value, "Pass");
assert.equal(exported.annotation.results[0].metrics.implicit_risk.value, null);
assert.equal(exported.annotation.results[1].status, "assigned");
