import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAdjudications, annotationAssignments, annotationMetrics, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement } from "@/lib/datasets/aggregation";
import { buildCompletionSql, normalizeDatasetRowFilters, rowsFromResult } from "@/lib/datasets/admin-row-query";
import { buildRowDetail } from "@/lib/datasets/row-export";

type AgreementResult = { rowId: string; metricId: string; value: string };
type NullableAgreementResult = { rowId: string; metricId: string; value: string | null };
type NavigationQueryRow = {
  previousRowId: string | null;
  nextRowId: string | null;
  position: number | string;
  filteredTotal: number | string;
};

function hasAgreementValue(result: NullableAgreementResult): result is AgreementResult {
  return result.value !== null;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const GET = requireAdmin(async (req, _session, context) => {
  const datasetId = context.params.id;
  const rowId = context.params.rowId;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });
  if (!rowId) return NextResponse.json({ error: "MISSING_ROW_ID" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const filters = normalizeDatasetRowFilters(searchParams);
  const searchPredicate = filters.search
    ? sql`and (cast(dr.internal_row_id as text) = ${filters.search} or lower(cast(dr.raw_json as text)) like ${`%${filters.search}%`})`
    : sql``;
  const completionPredicate = buildCompletionSql(filters.completion);

  const datasetRow = (
    await context.timing.measure("sql", async () =>
      await db
        .select({
          datasetId: datasets.id,
          displayConfig: datasets.displayConfig,
          rowId: datasetRows.id,
          rowInternalRowId: datasetRows.internalRowId,
          rowSourceId: datasetRows.sourceId,
          rowRawJson: datasetRows.rawJson,
        })
        .from(datasetRows)
        .innerJoin(datasets, eq(datasetRows.datasetId, datasets.id))
        .where(and(eq(datasets.id, datasetId), eq(datasetRows.id, rowId)))
    )
  )[0];
  if (!datasetRow) {
    const dataset = (await context.timing.measure("sql", async () => await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.id, datasetId))))[0];
    return NextResponse.json({ error: dataset ? "ROW_NOT_FOUND" : "DATASET_NOT_FOUND" }, { status: 404 });
  }

  const row = {
    id: datasetRow.rowId,
    internalRowId: datasetRow.rowInternalRowId,
    sourceId: datasetRow.rowSourceId,
    rawJson: datasetRow.rowRawJson,
  };

  const [metrics, assignments, results, adjudications, navigationResult] = await context.timing.measure("sql", async () =>
    await Promise.all([
      db
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
        .orderBy(asc(annotationMetrics.sortOrder), asc(annotationMetrics.id)),
      db
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
        .orderBy(asc(annotationAssignments.assignedAt), asc(annotationAssignments.id)),
      db
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
        .where(eq(annotationResults.rowId, row.id)),
      db
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
        .orderBy(asc(annotationAdjudications.metricKey)),
      db.execute(sql`
        with assignment_progress as (
          select
            row_id,
            max(target_overlap) as target_overlap,
            sum(case when status = 'completed' then 1 else 0 end) as completed_count
          from annotation_assignments
          where dataset_id = ${datasetId}
          group by row_id
        ),
        filtered_rows as (
          select
            dr.id,
            dr.internal_row_id,
            row_number() over (order by dr.internal_row_id asc) as position,
            count(*) over() as filtered_total
          from dataset_rows dr
          left join assignment_progress ap on ap.row_id = dr.id
          where dr.dataset_id = ${datasetId}
          ${searchPredicate}
          ${completionPredicate}
        ),
        current_row as (
          select * from filtered_rows where id = ${row.id}
        )
        select
          previous_row.id as "previousRowId",
          next_row.id as "nextRowId",
          current_row.position,
          current_row.filtered_total as "filteredTotal"
        from current_row
        left join filtered_rows previous_row on previous_row.position = current_row.position - 1
        left join filtered_rows next_row on next_row.position = current_row.position + 1
      `),
    ])
  );
  const [navigationRow] = rowsFromResult<NavigationQueryRow>(navigationResult);
  if (!navigationRow) return NextResponse.json({ error: "ROW_NOT_FOUND" }, { status: 404 });

  const displayConfig = datasetRow.displayConfig as { listFields: string[]; detailFields: string[] };

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
    adjudications: adjudications.map((item: any) => ({
      ...item,
      updatedAt: toIso(item.updatedAt),
    })),
    navigation: {
      previousRowId: navigationRow.previousRowId ?? null,
      nextRowId: navigationRow.nextRowId ?? null,
      position: Number(navigationRow.position),
      filteredTotal: Number(navigationRow.filteredTotal),
    },
  });
});
