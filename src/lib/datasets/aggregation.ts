export interface RowAssignmentForAggregation {
  rowId: string;
  annotatorId: string;
  annotatorName: string | null;
  annotatorImage: string | null;
  status: "assigned" | "in_review" | "completed";
}

export interface MetricResultForAggregation {
  rowId: string;
  metricId: string;
  value: string;
}

export function computeRowProgress(assignments: RowAssignmentForAggregation[], targetOverlap: number) {
  const completedAssignments = assignments.filter((assignment) => assignment.status === "completed");
  const completedCount = completedAssignments.length;

  return {
    completedCount,
    annotatedBy: completedAssignments.map((assignment) => ({
      id: assignment.annotatorId,
      name: assignment.annotatorName,
      image: assignment.annotatorImage,
    })),
    overlapLabel: `${completedCount}/${targetOverlap}`,
    missingCount: Math.max(targetOverlap - completedCount, 0),
  };
}

export function computeAgreement(results: MetricResultForAggregation[]): number | null {
  const byMetric = new Map<string, string[]>();

  for (const result of results) {
    byMetric.set(result.metricId, [...(byMetric.get(result.metricId) ?? []), result.value]);
  }

  const metricAgreements = [...byMetric.values()]
    .filter((values) => values.length >= 2)
    .map((values) => {
      const counts = new Map<string, number>();
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return Math.max(...counts.values()) / values.length;
    });

  if (metricAgreements.length === 0) return null;

  return Math.round((metricAgreements.reduce((sum, value) => sum + value, 0) / metricAgreements.length) * 100);
}
