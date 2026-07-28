import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, datasetRows, datasets } from "@/db/datasets";
import { requireExpert } from "@/lib/auth-middleware";
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

export const GET = requireExpert(async (_req, session) => {
  const assignments = await db
    .select({
      id: annotationAssignments.id,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      internalRowId: datasetRows.internalRowId,
      rawJson: datasetRows.rawJson,
      displayConfig: datasets.displayConfig,
      metricIds: annotationAssignments.metricIds,
      status: annotationAssignments.status,
      assignedAt: annotationAssignments.assignedAt,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .innerJoin(datasetRows, eq(annotationAssignments.rowId, datasetRows.id))
    .where(eq(annotationAssignments.annotatorId, session.user.id));

  const allMetricIds = Array.from(new Set(assignments.flatMap((assignment: any) => assignment.metricIds as string[])));
  const metrics =
    allMetricIds.length > 0
      ? await db.select({ id: annotationMetrics.id, label: annotationMetrics.label }).from(annotationMetrics)
      : [];
  const metricLabels = new Map(metrics.map((metric: any) => [metric.id, metric.label]));

  return NextResponse.json({
    tasks: assignments
      .sort((a: any, b: any) => String(b.assignedAt).localeCompare(String(a.assignedAt)))
      .map((assignment: any) => {
        const displayConfig = assignment.displayConfig as { listFields: string[]; detailFields: string[] };
        const metricIds = assignment.metricIds as string[];
        return {
          id: assignment.id,
          datasetId: assignment.datasetId,
          datasetName: assignment.datasetName,
          internalRowId: assignment.internalRowId,
          status: assignment.status,
          assignedAt: assignment.assignedAt,
          listFields: projectFields(normalizeJson(assignment.rawJson), displayConfig.listFields),
          metricLabels: metricIds.map((metricId) => metricLabels.get(metricId)).filter(Boolean),
        };
      }),
  });
});
