import assert from "node:assert/strict";
import {
  buildTaskGroups,
  chooseNextAssignment,
  markSkippedForQueue,
  type QueueAssignment,
} from "../../src/lib/datasets/task-groups";

const assignments: QueueAssignment[] = [
  {
    id: "a1",
    assignmentRunId: "run-1",
    datasetId: "d1",
    datasetName: "Dataset A",
    annotatorId: "u1",
    metricKey: "m1,m2",
    metricLabels: ["M1", "M2"],
    status: "assigned",
    skippedAt: null,
    assignedAt: "2026-07-29T01:00:00.000Z",
  },
  {
    id: "a2",
    assignmentRunId: "run-1",
    datasetId: "d1",
    datasetName: "Dataset A",
    annotatorId: "u1",
    metricKey: "m1,m2",
    metricLabels: ["M1", "M2"],
    status: "completed",
    skippedAt: null,
    assignedAt: "2026-07-29T01:01:00.000Z",
  },
  {
    id: "a3",
    assignmentRunId: "run-1",
    datasetId: "d1",
    datasetName: "Dataset A",
    annotatorId: "u1",
    metricKey: "m1,m2",
    metricLabels: ["M1", "M2"],
    status: "in_progress",
    skippedAt: "2026-07-29T01:02:00.000Z",
    assignedAt: "2026-07-29T01:02:00.000Z",
  },
  {
    id: "a4",
    assignmentRunId: "run-2",
    datasetId: "d1",
    datasetName: "Dataset A",
    annotatorId: "u1",
    metricKey: "m1",
    metricLabels: ["M1"],
    status: "assigned",
    skippedAt: null,
    assignedAt: "2026-07-29T01:03:00.000Z",
  },
];

const groups = buildTaskGroups(assignments);
assert.equal(groups.length, 2);
assert.deepEqual(groups[0], {
  id: "run-1",
  assignmentRunId: "run-1",
  datasetId: "d1",
  datasetName: "Dataset A",
  metricKey: "m1,m2",
  metricLabels: ["M1", "M2"],
  totalCount: 3,
  submittedCount: 1,
  remainingCount: 2,
  skippedCount: 1,
  status: "in_progress",
  assignedAt: "2026-07-29T01:00:00.000Z",
});

assert.equal(chooseNextAssignment(assignments.filter((item) => item.assignmentRunId === "run-1"), () => 0)?.id, "a1");
assert.equal(chooseNextAssignment(assignments.filter((item) => item.id !== "a1" && item.assignmentRunId === "run-1"), () => 0)?.id, "a3");
assert.equal(markSkippedForQueue({ skippedAt: null, skipCount: 0 }, "2026-07-29T02:00:00.000Z").skipCount, 1);
