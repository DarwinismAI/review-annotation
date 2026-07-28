export interface ExistingAssignment {
  rowId: string;
  annotatorId: string;
  metricKey: string;
  status: "assigned" | "in_review" | "completed";
}

export interface PlannedAssignment {
  rowId: string;
  annotatorId: string;
  metricIds: string[];
}

export function buildMetricKey(metricIds: string[]): string {
  return [...metricIds].sort().join(",");
}

export function planBalancedAssignments(input: {
  rowIds: string[];
  annotatorIds: string[];
  metricIds: string[];
  targetOverlap: number;
  existingAssignments: ExistingAssignment[];
}): { ok: true; assignments: PlannedAssignment[]; skippedRowIds: string[] } | { ok: false; reason: "NOT_ENOUGH_ANNOTATORS" } {
  if (input.annotatorIds.length < input.targetOverlap) {
    return { ok: false, reason: "NOT_ENOUGH_ANNOTATORS" };
  }

  const metricKey = buildMetricKey(input.metricIds);
  const currentRunLoad = new Map(input.annotatorIds.map((annotatorId) => [annotatorId, 0]));
  for (const assignment of input.existingAssignments) {
    if (assignment.metricKey === metricKey && currentRunLoad.has(assignment.annotatorId)) {
      currentRunLoad.set(assignment.annotatorId, (currentRunLoad.get(assignment.annotatorId) ?? 0) + 1);
    }
  }
  const assignments: PlannedAssignment[] = [];
  const skippedRowIds: string[] = [];

  for (const rowId of input.rowIds) {
    const existingForRow = input.existingAssignments.filter(
      (assignment) => assignment.rowId === rowId && assignment.metricKey === metricKey,
    );
    const assignedAnnotators = new Set(existingForRow.map((assignment) => assignment.annotatorId));
    const missing = input.targetOverlap - existingForRow.length;

    if (missing <= 0) {
      skippedRowIds.push(rowId);
      continue;
    }

    for (let index = 0; index < missing; index += 1) {
      const nextAnnotator = input.annotatorIds
        .filter((annotatorId) => !assignedAnnotators.has(annotatorId))
        .sort((a, b) => (currentRunLoad.get(a) ?? 0) - (currentRunLoad.get(b) ?? 0) || a.localeCompare(b))[0];

      if (!nextAnnotator) break;

      assignments.push({ rowId, annotatorId: nextAnnotator, metricIds: input.metricIds });
      assignedAnnotators.add(nextAnnotator);
      currentRunLoad.set(nextAnnotator, (currentRunLoad.get(nextAnnotator) ?? 0) + 1);
    }
  }

  return { ok: true, assignments, skippedRowIds };
}
