import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationAssignments, annotationMetrics, annotationResults } from "@/db/datasets";
import { requireExpert } from "@/lib/auth-middleware";
import { validateMetricSubmission } from "@/lib/datasets/metrics";

const submitSchema = z.object({
  values: z.record(z.string()),
  notes: z.record(z.string()).optional(),
});

export const POST = requireExpert(async (req: NextRequest, session, context) => {
  const assignmentId = context?.params.id;
  if (!assignmentId) return NextResponse.json({ error: "MISSING_TASK_ID" }, { status: 400 });

  const parsed = submitSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = (await db.select().from(annotationAssignments).where(eq(annotationAssignments.id, assignmentId)))[0];
  if (!assignment || assignment.annotatorId !== session.user.id) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const assignedMetricIds = assignment.metricIds as string[];
  const metrics = await db.select().from(annotationMetrics).where(eq(annotationMetrics.datasetId, assignment.datasetId));
  const validation = validateMetricSubmission({
    assignedMetricIds,
    metrics: metrics.map((metric: any) => ({ id: metric.id, scale: metric.scaleJson as { values: string[] } })),
    values: parsed.data.values,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason, metricId: validation.metricId }, { status: 400 });
  }

  const now = new Date();

  await db.transaction(async (tx: any) => {
    for (const metricId of assignedMetricIds) {
      const existing = (
        await tx
          .select({ id: annotationResults.id })
          .from(annotationResults)
          .where(and(eq(annotationResults.assignmentId, assignmentId), eq(annotationResults.metricId, metricId)))
      )[0];

      if (existing) {
        await tx
          .update(annotationResults)
          .set({
            value: parsed.data.values[metricId],
            note: parsed.data.notes?.[metricId] ?? null,
            updatedAt: now,
          })
          .where(eq(annotationResults.id, existing.id));
      } else {
        await tx.insert(annotationResults).values({
          id: createId(),
          assignmentId,
          rowId: assignment.rowId,
          annotatorId: assignment.annotatorId,
          metricId,
          value: parsed.data.values[metricId],
          note: parsed.data.notes?.[metricId] ?? null,
          submittedAt: now,
          updatedAt: now,
        });
      }
    }

    await tx
      .update(annotationAssignments)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(annotationAssignments.id, assignmentId));
  });

  return NextResponse.json({ ok: true, status: "completed" });
});
