import { computeRowProgress, type RowAssignmentForAggregation } from "./aggregation";
import { projectFields, type JsonRecord } from "./import-validation";

type AssignmentStatus = "assigned" | "in_review" | "completed" | string;

export interface RowExportDatasetRow {
  id: string;
  internalRowId: number;
  sourceId: string | null;
  rawJson: unknown;
}

export interface RowExportMetric {
  id: string;
  key: string;
  label: string;
}

export interface RowExportAssignment {
  id: string;
  rowId: string;
  annotatorId: string;
  annotatorName: string | null;
  annotatorImage: string | null;
  status: AssignmentStatus;
  targetOverlap: number;
}

export interface RowExportResult {
  assignmentId: string;
  rowId: string;
  annotatorId: string;
  metricId: string;
  value: string | null;
  note: string | null;
}

export interface MetricValue {
  label: string;
  value: string | null;
  note: string | null;
}

interface RowExportInput {
  row: RowExportDatasetRow;
  assignments: RowExportAssignment[];
  results: RowExportResult[];
  metrics: RowExportMetric[];
  agreement: number | null;
}

interface RowDetailInput extends RowExportInput {
  detailFields: string[];
}

export function buildRowDetail(input: RowDetailInput) {
  const targetOverlap = getTargetOverlap(input.assignments);
  const progress = getRowProgress(input.assignments, targetOverlap);

  return {
    id: input.row.id,
    internalRowId: input.row.internalRowId,
    detailFields: projectFields(normalizeJson(input.row.rawJson), input.detailFields),
    completedCount: progress.completedCount,
    targetOverlap,
    overlapLabel: progress.overlapLabel,
    missingCount: progress.missingCount,
    agreement: input.agreement,
    assignments: input.assignments.map((assignment) => ({
      id: assignment.id,
      status: assignment.status,
      annotator: {
        id: assignment.annotatorId,
        name: assignment.annotatorName,
        image: assignment.annotatorImage,
      },
      metrics: buildMetricValues(assignment.id, input.metrics, input.results),
    })),
  };
}

export function buildAnnotatedRow(input: RowExportInput) {
  const targetOverlap = getTargetOverlap(input.assignments);
  const progress = getRowProgress(input.assignments, targetOverlap);

  return {
    row_id: input.row.internalRowId,
    source_id: input.row.sourceId,
    data: normalizeJson(input.row.rawJson),
    annotation: {
      completed_count: progress.completedCount,
      target_overlap: targetOverlap,
      agreement: input.agreement,
      annotated_by: progress.annotatedBy.map((annotator) => ({
        id: annotator.id,
        name: annotator.name,
      })),
      results: input.assignments.map((assignment) => ({
        assignment_id: assignment.id,
        annotator: {
          id: assignment.annotatorId,
          name: assignment.annotatorName,
        },
        status: assignment.status,
        metrics: buildMetricValues(assignment.id, input.metrics, input.results),
      })),
    },
  };
}

function normalizeJson(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function getTargetOverlap(assignments: RowExportAssignment[]) {
  return assignments.reduce((max, assignment) => Math.max(max, assignment.targetOverlap), 0);
}

function getRowProgress(assignments: RowExportAssignment[], targetOverlap: number) {
  const normalizedAssignments: RowAssignmentForAggregation[] = assignments.map((assignment) => ({
    ...assignment,
    status: assignment.status === "completed" || assignment.status === "in_review" ? assignment.status : "assigned",
  }));

  return computeRowProgress(normalizedAssignments, targetOverlap);
}

function buildMetricValues(assignmentId: string, metrics: RowExportMetric[], results: RowExportResult[]): Record<string, MetricValue> {
  const resultsByMetricId = new Map<string, RowExportResult>();
  for (const result of results) {
    if (result.assignmentId === assignmentId) {
      resultsByMetricId.set(result.metricId, result);
    }
  }

  return Object.fromEntries(
    metrics.map((metric) => {
      const result = resultsByMetricId.get(metric.id);
      return [
        metric.key,
        {
          label: metric.label,
          value: result?.value ?? null,
          note: result?.note ?? null,
        },
      ];
    }),
  );
}
