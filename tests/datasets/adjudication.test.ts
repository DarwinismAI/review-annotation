import assert from "node:assert/strict";
import { attachAdjudicationToExport, type ReviewerAdjudication } from "../../src/lib/datasets/adjudication";

const adjudications: ReviewerAdjudication[] = [
  {
    rowId: "row-1",
    metricId: "metric-1",
    metricKey: "policy_violation",
    reviewerId: "admin-1",
    reviewerName: "Admin",
    value: "Pass",
    note: "final",
    updatedAt: "2026-07-29T03:00:00.000Z",
  },
];

const exportRow = {
  row_id: 1,
  source_id: null,
  data: { input: "abc" },
  annotation: {
    completed_count: 1,
    target_overlap: 3,
    agreement: null,
    annotated_by: [{ id: "ann-1", name: "Annotator" }],
    results: [
      {
        assignment_id: "as-1",
        annotator: { id: "ann-1", name: "Annotator" },
        status: "completed",
        metrics: { policy_violation: { label: "Vi pham", value: "Failed", note: "vote" } },
      },
    ],
  },
};

const attached = attachAdjudicationToExport(exportRow, adjudications);
assert.equal(attached.annotation.results[0].metrics.policy_violation.value, "Failed");
assert.deepEqual(attached.adjudication.policy_violation, {
  metric_id: "metric-1",
  reviewer: { id: "admin-1", name: "Admin" },
  value: "Pass",
  note: "final",
  updated_at: "2026-07-29T03:00:00.000Z",
});
