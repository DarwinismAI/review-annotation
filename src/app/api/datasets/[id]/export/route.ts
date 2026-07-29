import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement } from "@/lib/datasets/aggregation";
import { buildAnnotatedRow } from "@/lib/datasets/row-export";

type AgreementResult = { rowId: string; metricId: string; value: string };
type NullableAgreementResult = { rowId: string; metricId: string; value: string | null };
type ExportDatasetRow = { id: string; internalRowId: number; sourceId: string | null; rawJson: unknown };
type ExportMetric = { id: string; key: string; label: string };
type ExportAssignment = {
  id: string;
  rowId: string;
  annotatorId: string;
  annotatorName: string | null;
  annotatorImage: string | null;
  status: string;
  targetOverlap: number;
};
type ExportResult = {
  assignmentId: string;
  rowId: string;
  annotatorId: string;
  metricId: string;
  value: string | null;
  note: string | null;
};

function hasAgreementValue<T extends NullableAgreementResult>(result: T): result is T & AgreementResult {
  return result.value !== null;
}

export const GET = requireAdmin(async (req: NextRequest, _session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("format") !== "jsonl") {
    return NextResponse.json({ error: "UNSUPPORTED_FORMAT" }, { status: 400 });
  }

  const dataset = (await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const rows: ExportDatasetRow[] = await db
    .select({
      id: datasetRows.id,
      internalRowId: datasetRows.internalRowId,
      sourceId: datasetRows.sourceId,
      rawJson: datasetRows.rawJson,
    })
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, datasetId))
    .orderBy(asc(datasetRows.internalRowId));

  const metrics: ExportMetric[] = await db
    .select({
      id: annotationMetrics.id,
      key: annotationMetrics.key,
      label: annotationMetrics.label,
    })
    .from(annotationMetrics)
    .where(eq(annotationMetrics.datasetId, datasetId))
    .orderBy(asc(annotationMetrics.sortOrder), asc(annotationMetrics.id));

  const assignments: ExportAssignment[] =
    rows.length > 0
      ? await db
          .select({
            id: annotationAssignments.id,
            rowId: annotationAssignments.rowId,
            annotatorId: annotationAssignments.annotatorId,
            annotatorName: profiles.name,
            annotatorImage: profiles.image,
            status: annotationAssignments.status,
            targetOverlap: annotationAssignments.targetOverlap,
          })
          .from(annotationAssignments)
          .innerJoin(profiles, eq(annotationAssignments.annotatorId, profiles.id))
          .where(eq(annotationAssignments.datasetId, datasetId))
          .orderBy(asc(annotationAssignments.rowId), asc(annotationAssignments.assignedAt), asc(annotationAssignments.id))
      : [];

  const results: ExportResult[] =
    rows.length > 0
      ? await db
          .select({
            assignmentId: annotationResults.assignmentId,
            rowId: annotationResults.rowId,
            annotatorId: annotationResults.annotatorId,
            metricId: annotationResults.metricId,
            value: annotationResults.value,
            note: annotationResults.note,
          })
          .from(annotationResults)
          .innerJoin(annotationAssignments, eq(annotationResults.assignmentId, annotationAssignments.id))
          .where(and(eq(annotationAssignments.datasetId, datasetId), eq(annotationAssignments.status, "completed")))
      : [];

  const assignmentsByRow = new Map<string, ExportAssignment[]>();
  for (const assignment of assignments) {
    assignmentsByRow.set(assignment.rowId, [...(assignmentsByRow.get(assignment.rowId) ?? []), assignment]);
  }

  const resultsByRow = new Map<string, ExportResult[]>();
  for (const result of results) {
    resultsByRow.set(result.rowId, [...(resultsByRow.get(result.rowId) ?? []), result]);
  }

  const body = rows
    .map((row) => {
      const rowResults = resultsByRow.get(row.id) ?? [];
      return JSON.stringify(
        buildAnnotatedRow({
          row,
          assignments: assignmentsByRow.get(row.id) ?? [],
          results: rowResults,
          metrics,
          agreement: computeAgreement(rowResults.filter(hasAgreementValue)),
        }),
      );
    })
    .join("\n");

  return new NextResponse(body ? `${body}\n` : "", {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="dataset-${datasetId}-annotated.jsonl"`,
    },
  });
});
