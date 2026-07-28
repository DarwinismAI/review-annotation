import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, annotationResults, datasetRows, datasets } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";
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

export const GET = requireAnnotator(async (_req, session, context) => {
  const assignmentId = context?.params.id;
  if (!assignmentId) return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });

  const assignment = (
    await db
      .select({
        id: annotationAssignments.id,
        status: annotationAssignments.status,
        annotatorId: annotationAssignments.annotatorId,
        rowId: annotationAssignments.rowId,
        datasetId: annotationAssignments.datasetId,
        metricIds: annotationAssignments.metricIds,
        datasetName: datasets.name,
        displayConfig: datasets.displayConfig,
        internalRowId: datasetRows.internalRowId,
        rawJson: datasetRows.rawJson,
      })
      .from(annotationAssignments)
      .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
      .innerJoin(datasetRows, eq(annotationAssignments.rowId, datasetRows.id))
      .where(eq(annotationAssignments.id, assignmentId))
  )[0];

  if (!assignment || assignment.annotatorId !== session.user.id) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const metricIds = assignment.metricIds as string[];
  const metrics =
    metricIds.length > 0
      ? await db
          .select()
          .from(annotationMetrics)
          .where(inArray(annotationMetrics.id, metricIds))
      : [];
  const metricSet = new Set(metricIds);
  const resultRows = await db
    .select({
      metricId: annotationResults.metricId,
      value: annotationResults.value,
      note: annotationResults.note,
    })
    .from(annotationResults)
    .where(eq(annotationResults.assignmentId, assignmentId));
  const existingValues = Object.fromEntries(resultRows.map((result: any) => [result.metricId, { value: result.value ?? "", note: result.note }]));
  const displayConfig = assignment.displayConfig as { listFields: string[]; detailFields: string[] };

  return NextResponse.json({
    task: {
      id: assignment.id,
      status: assignment.status,
      datasetName: assignment.datasetName,
      internalRowId: assignment.internalRowId,
      detailFields: projectFields(normalizeJson(assignment.rawJson), displayConfig.detailFields),
      metrics: metrics
        .filter((metric: any) => metricSet.has(metric.id))
        .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
        .map((metric: any) => ({
          id: metric.id,
          key: metric.key,
          label: metric.label,
          description: metric.description,
          scale: metric.scaleJson,
          required: Boolean(metric.required),
        })),
      existingValues,
    },
  });
});
