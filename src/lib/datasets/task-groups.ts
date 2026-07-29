export type AssignmentQueueStatus = "assigned" | "in_progress" | "completed" | string;

export interface QueueAssignment {
  id: string;
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  annotatorId: string;
  metricKey: string;
  metricLabels: string[];
  status: AssignmentQueueStatus;
  skippedAt: string | null;
  assignedAt: string;
}

export interface TaskGroupSummary {
  id: string;
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  metricKey: string;
  metricLabels: string[];
  totalCount: number;
  submittedCount: number;
  remainingCount: number;
  skippedCount: number;
  status: "not_started" | "in_progress" | "completed";
  assignedAt: string;
}

export function buildTaskGroups(assignments: QueueAssignment[]): TaskGroupSummary[] {
  const groups = new Map<string, QueueAssignment[]>();
  for (const assignment of assignments) {
    groups.set(assignment.assignmentRunId, [...(groups.get(assignment.assignmentRunId) ?? []), assignment]);
  }

  return [...groups.entries()]
    .map(([assignmentRunId, groupAssignments]) => {
      const first = groupAssignments[0];
      const submittedCount = groupAssignments.filter((item) => item.status === "completed").length;
      const remainingCount = groupAssignments.length - submittedCount;
      const skippedCount = groupAssignments.filter((item) => item.status !== "completed" && item.skippedAt).length;
      const startedCount = groupAssignments.filter((item) => item.status === "in_progress" || item.status === "completed").length;
      const status: TaskGroupSummary["status"] = remainingCount === 0 ? "completed" : startedCount > 0 ? "in_progress" : "not_started";

      return {
        id: assignmentRunId,
        assignmentRunId,
        datasetId: first.datasetId,
        datasetName: first.datasetName,
        metricKey: first.metricKey,
        metricLabels: first.metricLabels,
        totalCount: groupAssignments.length,
        submittedCount,
        remainingCount,
        skippedCount,
        status,
        assignedAt: groupAssignments.map((item) => item.assignedAt).sort()[0],
      };
    })
    .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
}

export function chooseNextAssignment(assignments: QueueAssignment[], random: () => number = Math.random): QueueAssignment | null {
  const eligible = assignments.filter((item) => item.status !== "completed");
  const unskipped = eligible.filter((item) => !item.skippedAt);
  const pool = unskipped.length > 0 ? unskipped : eligible;
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)];
}

export function markSkippedForQueue(input: { skippedAt: string | null; skipCount: number }, nowIso: string) {
  return { skippedAt: nowIso, skipCount: input.skipCount + 1 };
}

export function projectImportJobStatus(input: { status: string; rowCount: number; targetRowCount: number | null; errorMessage: string | null }) {
  const normalized = input.status === "in_progress" ? "running" : input.status === "completed" ? "completed" : input.status;
  const target = input.targetRowCount ?? input.rowCount;

  return {
    status: normalized,
    rowCount: input.rowCount,
    targetRowCount: input.targetRowCount,
    progress: target > 0 ? Math.min(100, Math.round((input.rowCount / target) * 100)) : 0,
    canCancel: false,
    canRetry: input.status === "failed",
    errorMessage: input.errorMessage,
  };
}
