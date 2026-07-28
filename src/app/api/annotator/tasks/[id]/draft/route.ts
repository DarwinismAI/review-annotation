import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics } from "@/db/datasets";
import { saveAnnotationResults } from "@/lib/datasets/annotation-results";
import { requireAnnotator } from "@/lib/auth-middleware";
import { validateDraftMetricSubmission } from "@/lib/datasets/metrics";

const draftSchema = z.object({
  values: z.record(z.string()).default({}),
  notes: z.record(z.string()).optional(),
});

export const POST = requireAnnotator(async (req: NextRequest, session, context) => {
  const assignmentId = context?.params.id;
  if (!assignmentId) return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });

  const parsed = draftSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = (await db.select().from(annotationAssignments).where(eq(annotationAssignments.id, assignmentId)))[0];
  if (!assignment || assignment.annotatorId !== session.user.id) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }
  if (assignment.status === "completed") {
    return NextResponse.json({ ok: true, status: "completed", savedAt: null });
  }

  const assignedMetricIds = assignment.metricIds as string[];
  const metrics = await db.select().from(annotationMetrics).where(eq(annotationMetrics.datasetId, assignment.datasetId));
  const validation = validateDraftMetricSubmission({
    assignedMetricIds,
    metrics: metrics.map((metric: any) => ({ id: metric.id, scale: metric.scaleJson as { values: string[] } })),
    values: parsed.data.values,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason, metricId: validation.metricId }, { status: 400 });
  }

  const now = new Date();
  await db.transaction(async (tx: any) => {
    await saveAnnotationResults({
      tx,
      assignmentId,
      rowId: assignment.rowId,
      annotatorId: assignment.annotatorId,
      metricIds: assignedMetricIds,
      values: parsed.data.values,
      notes: parsed.data.notes,
      mode: "draft",
      now,
    });

    await tx
      .update(annotationAssignments)
      .set({ status: "in_progress", updatedAt: now })
      .where(and(eq(annotationAssignments.id, assignmentId), eq(annotationAssignments.status, "assigned")));
  });

  return NextResponse.json({ ok: true, status: "draft", savedAt: now.toISOString() });
});
