import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import { computeAgreement, computeRowProgress } from "@/lib/datasets/aggregation";
import { projectFields, type JsonRecord } from "@/lib/datasets/import-validation";

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

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const [{ total }] = await db.select({ total: count() }).from(datasetRows).where(eq(datasetRows.datasetId, datasetId));
  const pageRows = await db
    .select()
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, datasetId))
    .orderBy(asc(datasetRows.internalRowId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const rowIds = pageRows.map((row: any) => row.id);

  const assignmentRows =
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

  const resultRows =
    rowIds.length > 0
      ? await db
          .select({
            rowId: annotationResults.rowId,
            metricId: annotationResults.metricId,
            value: annotationResults.value,
          })
          .from(annotationResults)
          .where(and(inArray(annotationResults.rowId, rowIds), eq(annotationResults.status, "completed")))
      : [];

  const assignmentsByRow = new Map<string, typeof assignmentRows>();
  for (const assignment of assignmentRows) {
    assignmentsByRow.set(assignment.rowId, [...(assignmentsByRow.get(assignment.rowId) ?? []), assignment]);
  }

  const resultsByRow = new Map<string, typeof resultRows>();
  for (const result of resultRows) {
    resultsByRow.set(result.rowId, [...(resultsByRow.get(result.rowId) ?? []), result]);
  }

  const displayConfig = dataset.displayConfig as { listFields: string[]; detailFields: string[] };

  return NextResponse.json({
    rows: pageRows.map((row: any) => {
      const rowAssignments = assignmentsByRow.get(row.id) ?? [];
      const targetOverlap = rowAssignments.reduce((max: number, assignment: any) => Math.max(max, assignment.targetOverlap), 0);
      const progress = computeRowProgress(rowAssignments as any, targetOverlap);
      return {
        id: row.id,
        internalRowId: row.internalRowId,
        listFields: projectFields(normalizeJson(row.rawJson), displayConfig.listFields),
        ...progress,
        agreement: computeAgreement(resultsByRow.get(row.id) ?? []),
      };
    }),
    total,
  });
});
