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
  maxRowsPerAnnotator?: number;
  existingAssignments: ExistingAssignment[];
}): { ok: true; assignments: PlannedAssignment[]; skippedRowIds: string[] } | { ok: false; reason: "NOT_ENOUGH_ANNOTATORS" } {
  if (input.annotatorIds.length < input.targetOverlap) {
    return { ok: false, reason: "NOT_ENOUGH_ANNOTATORS" };
  }

  const metricKey = buildMetricKey(input.metricIds);
  const currentRunLoad = new Map(input.annotatorIds.map((annotatorId) => [annotatorId, 0]));
  const assignedRowsByAnnotator = new Map(input.annotatorIds.map((annotatorId) => [annotatorId, new Set<string>()]));
  for (const assignment of input.existingAssignments) {
    if (assignment.metricKey === metricKey && currentRunLoad.has(assignment.annotatorId)) {
      assignedRowsByAnnotator.get(assignment.annotatorId)?.add(assignment.rowId);
    }
  }
  for (const [annotatorId, rowIds] of assignedRowsByAnnotator) {
    currentRunLoad.set(annotatorId, rowIds.size);
  }
  const assignments: PlannedAssignment[] = [];
  const skippedRowIds: string[] = [];
  const existingByRow = new Map<string, ExistingAssignment[]>();
  for (const assignment of input.existingAssignments) {
    if (assignment.metricKey !== metricKey) continue;
    existingByRow.set(assignment.rowId, [...(existingByRow.get(assignment.rowId) ?? []), assignment]);
  }

  for (const rowId of input.rowIds) {
    const existingForRow = existingByRow.get(rowId) ?? [];
    const assignedAnnotators = new Set(existingForRow.map((assignment) => assignment.annotatorId));
    const missing = input.targetOverlap - existingForRow.length;

    if (missing <= 0) {
      skippedRowIds.push(rowId);
      continue;
    }

    const candidates = input.annotatorIds
      .filter((annotatorId) => !assignedAnnotators.has(annotatorId))
      .filter((annotatorId) => !input.maxRowsPerAnnotator || (currentRunLoad.get(annotatorId) ?? 0) < input.maxRowsPerAnnotator)
      .sort((a, b) => (currentRunLoad.get(a) ?? 0) - (currentRunLoad.get(b) ?? 0) || a.localeCompare(b));
    if (candidates.length < missing) {
      skippedRowIds.push(rowId);
      continue;
    }

    for (let index = 0; index < missing; index += 1) {
      const nextAnnotator = candidates[index];

      assignments.push({ rowId, annotatorId: nextAnnotator, metricIds: input.metricIds });
      assignedAnnotators.add(nextAnnotator);
      currentRunLoad.set(nextAnnotator, (currentRunLoad.get(nextAnnotator) ?? 0) + 1);
    }
  }

  return { ok: true, assignments, skippedRowIds };
}
