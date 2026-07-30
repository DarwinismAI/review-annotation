import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, datasetRows, datasets } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";

export const GET = requireAnnotator(async (req: NextRequest, session) => {
  const { searchParams } = new URL(req.url);
  const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 100), 1), 200);
  const [{ total }] = await db
    .select({ total: count() })
    .from(annotationAssignments)
    .where(eq(annotationAssignments.annotatorId, session.user.id));

  const assignments = await db
    .select({
      id: annotationAssignments.id,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      internalRowId: datasetRows.internalRowId,
      metricIds: annotationAssignments.metricIds,
      status: annotationAssignments.status,
      assignedAt: annotationAssignments.assignedAt,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .innerJoin(datasetRows, eq(annotationAssignments.rowId, datasetRows.id))
    .where(eq(annotationAssignments.annotatorId, session.user.id))
    .orderBy(desc(annotationAssignments.assignedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const allMetricIds: string[] = Array.from(new Set(assignments.flatMap((assignment: any) => assignment.metricIds as string[])));
  const metrics =
    allMetricIds.length > 0
      ? await db.select({ id: annotationMetrics.id, label: annotationMetrics.label }).from(annotationMetrics).where(inArray(annotationMetrics.id, allMetricIds))
      : [];
  const metricLabels = new Map(metrics.map((metric: any) => [metric.id, metric.label]));

  return NextResponse.json({
    tasks: assignments
      .map((assignment: any) => {
        const metricIds = assignment.metricIds as string[];
        return {
          id: assignment.id,
          datasetId: assignment.datasetId,
          datasetName: assignment.datasetName,
          internalRowId: assignment.internalRowId,
          status: assignment.status,
          assignedAt: assignment.assignedAt,
          // The detail route owns full row JSON; keep this legacy list key light.
          listFields: {},
          metricLabels: metricIds.map((metricId) => metricLabels.get(metricId)).filter(Boolean),
        };
      }),
    total,
    page,
    pageSize,
  });
});
