import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement, computeRowProgress, type RowAssignmentForAggregation } from "@/lib/datasets/aggregation";
import { projectFields, type JsonRecord } from "@/lib/datasets/import-validation";

type DatasetRowListRecord = { id: string; internalRowId: number; rawJson: unknown };
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
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50), 1), 200);
  const fieldMode = searchParams.get("fields") === "detail" ? "detail" : "list";

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const [{ total }] = await db.select({ total: count() }).from(datasetRows).where(eq(datasetRows.datasetId, datasetId));
  const pageRows: DatasetRowListRecord[] = await db
    .select({
      id: datasetRows.id,
      internalRowId: datasetRows.internalRowId,
      rawJson: datasetRows.rawJson,
    })
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, datasetId))
    .orderBy(asc(datasetRows.internalRowId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const rowIds = pageRows.map((row) => row.id);

  const assignmentRows: DatasetRowAssignmentRecord[] =
    rowIds.length > 0
      ? await db
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
          .where(and(eq(annotationAssignments.datasetId, datasetId), inArray(annotationAssignments.rowId, rowIds)))
      : [];

  const resultRows: DatasetRowResultRecord[] =
    rowIds.length > 0
      ? await db
          .select({
            rowId: annotationResults.rowId,
            metricId: annotationResults.metricId,
            value: annotationResults.value,
          })
          .from(annotationResults)
          .innerJoin(annotationAssignments, eq(annotationResults.assignmentId, annotationAssignments.id))
          .where(and(inArray(annotationResults.rowId, rowIds), eq(annotationAssignments.status, "completed")))
      : [];

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

  return NextResponse.json({
    rows: pageRows.map((row) => {
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
    }),
    total,
  });
});
