import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationAssignments } from "@/db/datasets";
import { requireAnnotator } from "@/lib/auth-middleware";
import { markSkippedForQueue } from "@/lib/datasets/task-groups";

export const POST = requireAnnotator(async (_req, session, context) => {
  const assignmentId = context?.params.id;
  if (!assignmentId) return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });

  const assignment = (await db.select().from(annotationAssignments).where(eq(annotationAssignments.id, assignmentId)))[0];
  if (!assignment || assignment.annotatorId !== session.user.id) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }
  if (assignment.status === "completed") {
    return NextResponse.json({ error: "TASK_ALREADY_COMPLETED" }, { status: 409 });
  }

  const now = new Date();
  const update = markSkippedForQueue(
    { skippedAt: assignment.skippedAt ? String(assignment.skippedAt) : null, skipCount: Number(assignment.skipCount ?? 0) },
    now.toISOString(),
  );

  await db
    .update(annotationAssignments)
    .set({ skippedAt: now, skipCount: update.skipCount, updatedAt: now })
    .where(and(eq(annotationAssignments.id, assignmentId), eq(annotationAssignments.annotatorId, session.user.id)));

  return NextResponse.json({ ok: true, status: "skipped", assignmentRunId: assignment.assignmentRunId });
});
