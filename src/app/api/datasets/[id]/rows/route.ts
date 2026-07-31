import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement, computeRowProgress, type RowAssignmentForAggregation } from "@/lib/datasets/aggregation";
import { buildCompletionSql, normalizeDatasetRowFilters, rowsFromResult } from "@/lib/datasets/admin-row-query";
import { projectFields, type JsonRecord } from "@/lib/datasets/import-validation";

type DatasetRowListRecord = { id: string; internalRowId: number; rawJson: unknown };
type DatasetRowQueryRecord = DatasetRowListRecord & {
  filteredTotal: number | string;
  isTotalRow?: number | string | null;
};
type DatasetRowAssignmentRecord = {
  rowId: string;
  annotatorId: string;
  annotatorName: string | null;
  annotatorImage: string | null;
  status: string;
  targetOverlap: number;
};
type DatasetRowResultRecord = { rowId: string; metricId: string; value: string | null };
type DatasetRowAgreementResult = { rowId: string; metricId: string; value: string };

function hasAgreementValue<T extends DatasetRowResultRecord>(result: T): result is T & DatasetRowAgreementResult {
  return result.value !== null;
}

function normalizeJson(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as JsonRecord;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

export const GET = requireAdmin(async (req: NextRequest, _session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50), 1), 100);
  const fieldMode = searchParams.get("fields") === "detail" ? "detail" : "list";
  const filters = normalizeDatasetRowFilters(searchParams);
  const offset = (page - 1) * pageSize;
  const searchPredicate = filters.search
    ? sql`and (cast(dr.internal_row_id as text) = ${filters.search} or lower(cast(dr.raw_json as text)) like ${`%${filters.search}%`})`
    : sql``;
  const completionPredicate = buildCompletionSql(filters.completion);

  const [datasetResult, pageRowResult] = await Promise.all([
    db.select({ id: datasets.id, displayConfig: datasets.displayConfig }).from(datasets).where(eq(datasets.id, datasetId)),
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
          dr.internal_row_id as "internalRowId",
          dr.raw_json as "rawJson",
          coalesce(ap.target_overlap, 0) as target_overlap,
          coalesce(ap.completed_count, 0) as completed_count
        from dataset_rows dr
        left join assignment_progress ap on ap.row_id = dr.id
        where dr.dataset_id = ${datasetId}
        ${searchPredicate}
        ${completionPredicate}
      ),
      filtered_total as (
        select count(*) as total from filtered_rows
      ),
      page_rows as (
        select *, count(*) over() as "filteredTotal"
        from filtered_rows
        order by "internalRowId" asc
        LIMIT ${pageSize} OFFSET ${offset}
      )
      select id, "internalRowId", "rawJson", "filteredTotal", 0 as "isTotalRow"
      from page_rows
      union all
      select null as id, null as "internalRowId", null as "rawJson", total as "filteredTotal", 1 as "isTotalRow"
      from filtered_total
      where not exists (select 1 from page_rows)
    `),
  ]);
  const [dataset] = datasetResult;
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const queryRows = rowsFromResult<DatasetRowQueryRecord>(pageRowResult);
  const total = Number(queryRows[0]?.filteredTotal ?? 0);
  const pageRows = queryRows.filter((record) => !Number(record.isTotalRow)) as DatasetRowListRecord[];
  const rowIds = pageRows.map((row) => row.id);

  const [assignmentRows, resultRows]: [DatasetRowAssignmentRecord[], DatasetRowResultRecord[]] =
    rowIds.length > 0
      ? await Promise.all([
          db
            .select({
              rowId: annotationAssignments.rowId,
              annotatorId: annotationAssignments.annotatorId,
              annotatorName: profiles.name,
              annotatorImage: profiles.image,
              status: annotationAssignments.status,
              targetOverlap: annotationAssignments.targetOverlap,
            })
            .from(annotationAssignments)
            .innerJoin(profiles, eq(annotationAssignments.annotatorId, profiles.id))
            .where(and(eq(annotationAssignments.datasetId, datasetId), inArray(annotationAssignments.rowId, rowIds))),
          db
            .select({
              rowId: annotationResults.rowId,
              metricId: annotationResults.metricId,
              value: annotationResults.value,
            })
            .from(annotationResults)
            .innerJoin(annotationAssignments, eq(annotationResults.assignmentId, annotationAssignments.id))
            .where(and(inArray(annotationResults.rowId, rowIds), eq(annotationAssignments.status, "completed"))),
        ])
      : [[], []];

  const assignmentsByRow = new Map<string, DatasetRowAssignmentRecord[]>();
  for (const assignment of assignmentRows) {
    assignmentsByRow.set(assignment.rowId, [...(assignmentsByRow.get(assignment.rowId) ?? []), assignment]);
  }

  const resultsByRow = new Map<string, DatasetRowResultRecord[]>();
  for (const result of resultRows) {
    resultsByRow.set(result.rowId, [...(resultsByRow.get(result.rowId) ?? []), result]);
  }

  const displayConfig = dataset.displayConfig as { listFields: string[]; detailFields: string[] };
  const projectedFields = fieldMode === "detail" ? displayConfig.detailFields : displayConfig.listFields;

  const rows = pageRows.map((row) => {
      const rowAssignments = assignmentsByRow.get(row.id) ?? [];
      const targetOverlap = rowAssignments.reduce((max, assignment) => Math.max(max, assignment.targetOverlap), 0);
      const normalizedAssignments: RowAssignmentForAggregation[] = rowAssignments.map((assignment) => ({
        ...assignment,
        status: assignment.status === "completed" || assignment.status === "in_review" ? assignment.status : "assigned",
      }));
      const progress = computeRowProgress(normalizedAssignments, targetOverlap);
      return {
        id: row.id,
        internalRowId: row.internalRowId,
        listFields: projectFields(normalizeJson(row.rawJson), projectedFields),
        ...progress,
        agreement: computeAgreement((resultsByRow.get(row.id) ?? []).filter(hasAgreementValue)),
      };
    });

  return NextResponse.json({
    rows,
    total,
    page,
    pageSize,
  });
});
