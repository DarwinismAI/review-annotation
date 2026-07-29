import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments, datasets } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";
import { chooseNextAssignment, type QueueAssignment } from "@/lib/datasets/task-groups";

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const GET = requireAnnotator(async (_req, session, context) => {
  const groupId = context?.params.groupId;
  if (!groupId) return NextResponse.json({ error: "MISSING_GROUP_ID" }, { status: 400 });

  const assignments = await db
    .select({
      id: annotationAssignments.id,
      assignmentRunId: annotationAssignments.assignmentRunId,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      annotatorId: annotationAssignments.annotatorId,
      metricKey: annotationAssignments.metricKey,
      status: annotationAssignments.status,
      skippedAt: annotationAssignments.skippedAt,
      assignedAt: annotationAssignments.assignedAt,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .where(and(eq(annotationAssignments.assignmentRunId, groupId), eq(annotationAssignments.annotatorId, session.user.id)));

  if (assignments.length === 0) {
    return NextResponse.json({ error: "TASK_GROUP_NOT_FOUND" }, { status: 404 });
  }

  const queueAssignments: QueueAssignment[] = assignments.map((assignment: any) => ({
    id: assignment.id,
    assignmentRunId: assignment.assignmentRunId,
    datasetId: assignment.datasetId,
    datasetName: assignment.datasetName,
    annotatorId: assignment.annotatorId,
    metricKey: assignment.metricKey,
    metricLabels: [],
    status: assignment.status,
    skippedAt: assignment.skippedAt ? toIso(assignment.skippedAt) : null,
    assignedAt: toIso(assignment.assignedAt),
  }));
  const nextAssignment = chooseNextAssignment(queueAssignments);

  if (!nextAssignment) {
    return NextResponse.json({ done: true, nextTaskId: null });
  }
  return NextResponse.json({ done: false, nextTaskId: nextAssignment.id });
});
