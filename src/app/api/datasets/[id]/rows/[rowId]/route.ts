import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAdjudications, annotationAssignments, annotationMetrics, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement } from "@/lib/datasets/aggregation";
import { buildRowDetail } from "@/lib/datasets/row-export";

type AgreementResult = { rowId: string; metricId: string; value: string };
type NullableAgreementResult = { rowId: string; metricId: string; value: string | null };

function hasAgreementValue(result: NullableAgreementResult): result is AgreementResult {
  return result.value !== null;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const GET = requireAdmin(async (_req, _session, context) => {
  const datasetId = context?.params.id;
  const rowId = context?.params.rowId;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });
  if (!rowId) return NextResponse.json({ error: "MISSING_ROW_ID" }, { status: 400 });

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const row = (
    await db
      .select({
        id: datasetRows.id,
        internalRowId: datasetRows.internalRowId,
        sourceId: datasetRows.sourceId,
        rawJson: datasetRows.rawJson,
      })
      .from(datasetRows)
      .where(and(eq(datasetRows.datasetId, datasetId), eq(datasetRows.id, rowId)))
  )[0];
  if (!row) return NextResponse.json({ error: "ROW_NOT_FOUND" }, { status: 404 });

  const metrics = await db
    .select({
      id: annotationMetrics.id,
      key: annotationMetrics.key,
      label: annotationMetrics.label,
      description: annotationMetrics.description,
      scaleJson: annotationMetrics.scaleJson,
      required: annotationMetrics.required,
      sortOrder: annotationMetrics.sortOrder,
    })
    .from(annotationMetrics)
    .where(eq(annotationMetrics.datasetId, datasetId))
    .orderBy(asc(annotationMetrics.sortOrder), asc(annotationMetrics.id));

  const assignments = await db
    .select({
      id: annotationAssignments.id,
      rowId: annotationAssignments.rowId,
      annotatorId: annotationAssignments.annotatorId,
      annotatorName: profiles.name,
      annotatorImage: profiles.image,
      status: annotationAssignments.status,
      targetOverlap: annotationAssignments.targetOverlap,
      assignmentRunId: annotationAssignments.assignmentRunId,
      skippedAt: annotationAssignments.skippedAt,
      skipCount: annotationAssignments.skipCount,
      assignedAt: annotationAssignments.assignedAt,
      completedAt: annotationAssignments.completedAt,
    })
    .from(annotationAssignments)
    .innerJoin(profiles, eq(annotationAssignments.annotatorId, profiles.id))
    .where(and(eq(annotationAssignments.datasetId, datasetId), eq(annotationAssignments.rowId, row.id)))
    .orderBy(asc(annotationAssignments.assignedAt), asc(annotationAssignments.id));

  const results = await db
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
    .where(eq(annotationResults.rowId, row.id));

  const adjudications = await db
    .select({
      rowId: annotationAdjudications.rowId,
      metricId: annotationAdjudications.metricId,
      metricKey: annotationAdjudications.metricKey,
      reviewerId: annotationAdjudications.reviewerId,
      reviewerName: profiles.name,
      value: annotationAdjudications.value,
      note: annotationAdjudications.note,
      updatedAt: annotationAdjudications.updatedAt,
    })
    .from(annotationAdjudications)
    .leftJoin(profiles, eq(annotationAdjudications.reviewerId, profiles.id))
    .where(and(eq(annotationAdjudications.datasetId, datasetId), eq(annotationAdjudications.rowId, row.id)))
    .orderBy(asc(annotationAdjudications.metricKey));

  const displayConfig = dataset.displayConfig as { listFields: string[]; detailFields: string[] };

  return NextResponse.json({
    row: buildRowDetail({
      row,
      detailFields: displayConfig.detailFields,
      assignments,
      results,
      metrics,
      agreement: computeAgreement(
        results
          .filter((result: any) => assignments.some((assignment: any) => assignment.id === result.assignmentId && assignment.status === "completed"))
          .filter(hasAgreementValue),
      ),
      adjudications: adjudications.map((item: any) => ({
        ...item,
        updatedAt: toIso(item.updatedAt),
      })),
    }),
  });
});
