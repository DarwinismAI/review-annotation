import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, datasets } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";
import { buildTaskGroups, type QueueAssignment } from "@/lib/datasets/task-groups";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const GET = requireAnnotator(async (_req, session) => {
  const assignments = await db
    .select({
      id: annotationAssignments.id,
      assignmentRunId: annotationAssignments.assignmentRunId,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      annotatorId: annotationAssignments.annotatorId,
      metricIds: annotationAssignments.metricIds,
      metricKey: annotationAssignments.metricKey,
      status: annotationAssignments.status,
      skippedAt: annotationAssignments.skippedAt,
      assignedAt: annotationAssignments.assignedAt,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .where(eq(annotationAssignments.annotatorId, session.user.id))
    .orderBy(desc(annotationAssignments.assignedAt));

  const allMetricIds: string[] = Array.from(new Set((assignments as Array<{ metricIds: string[] }>).flatMap((assignment) => assignment.metricIds)));
  const metrics =
    allMetricIds.length > 0
      ? await db.select({ id: annotationMetrics.id, label: annotationMetrics.label }).from(annotationMetrics).where(inArray(annotationMetrics.id, allMetricIds))
      : [];
  const metricLabels = new Map(metrics.map((metric: any) => [metric.id, metric.label]));

  const queueAssignments: QueueAssignment[] = assignments.map((assignment: any) => ({
    id: assignment.id,
    assignmentRunId: assignment.assignmentRunId,
    datasetId: assignment.datasetId,
    datasetName: assignment.datasetName,
    annotatorId: assignment.annotatorId,
    metricKey: assignment.metricKey,
    metricLabels: (assignment.metricIds as string[]).map((metricId) => metricLabels.get(metricId)).filter(Boolean) as string[],
    status: assignment.status,
    skippedAt: assignment.skippedAt ? toIso(assignment.skippedAt) : null,
    assignedAt: toIso(assignment.assignedAt),
  }));

  return NextResponse.json({
    taskGroups: buildTaskGroups(queueAssignments).map((group) => ({
      id: group.id,
      assignmentRunId: group.assignmentRunId,
      datasetId: group.datasetId,
      datasetName: group.datasetName,
      metricLabels: group.metricLabels,
      totalCount: group.totalCount,
      submittedCount: group.submittedCount,
      remainingCount: group.remainingCount,
      skippedCount: group.skippedCount,
      status: group.status,
      assignedAt: group.assignedAt,
    })),
  });
});
