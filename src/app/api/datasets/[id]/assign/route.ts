import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { expertProfiles, profiles } from "@/db/schema";
import { annotationAssignmentRuns, annotationAssignments, annotationMetrics, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { buildMetricKey, planBalancedAssignments } from "@/lib/datasets/assignment";

const assignRequestSchema = z.object({
  scope: z.union([
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("selected"), rowIds: z.array(z.string()).min(1) }),
  ]),
  targetOverlap: z.number().int().min(1).max(5),
  metricIds: z.array(z.string()).min(1),
  annotatorIds: z.array(z.string()).min(1),
});

export const POST = requireAdmin(async (req: NextRequest, session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const parsed = assignRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = (await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const metrics = await db
    .select({ id: annotationMetrics.id })
    .from(annotationMetrics)
    .where(and(eq(annotationMetrics.datasetId, datasetId), inArray(annotationMetrics.id, parsed.data.metricIds)));
  if (metrics.length !== parsed.data.metricIds.length) {
    return NextResponse.json({ error: "INVALID_METRICS" }, { status: 400 });
  }

  const activeAnnotators = await db
    .select({ userId: profiles.id })
    .from(expertProfiles)
    .innerJoin(profiles, eq(expertProfiles.userId, profiles.id))
    .where(and(eq(expertProfiles.status, "active"), inArray(profiles.id, parsed.data.annotatorIds)));

  const annotatorIds = activeAnnotators.map((annotator: any) => annotator.userId);
  if (annotatorIds.length < parsed.data.targetOverlap) {
    return NextResponse.json({ error: "NOT_ENOUGH_ANNOTATORS" }, { status: 400 });
  }

  const rowQuery =
    parsed.data.scope.type === "all"
      ? db.select({ id: datasetRows.id }).from(datasetRows).where(eq(datasetRows.datasetId, datasetId))
      : db
          .select({ id: datasetRows.id })
          .from(datasetRows)
          .where(and(eq(datasetRows.datasetId, datasetId), inArray(datasetRows.id, parsed.data.scope.rowIds)));
  const rows = await rowQuery;
  const rowIds = rows.map((row: any) => row.id);

  const metricKey = buildMetricKey(parsed.data.metricIds);
  const existingAssignments = await db
    .select({
      rowId: annotationAssignments.rowId,
      annotatorId: annotationAssignments.annotatorId,
      metricKey: annotationAssignments.metricKey,
      status: annotationAssignments.status,
    })
    .from(annotationAssignments)
    .where(and(eq(annotationAssignments.datasetId, datasetId), eq(annotationAssignments.metricKey, metricKey)));

  const plan = planBalancedAssignments({
    rowIds,
    annotatorIds,
    metricIds: parsed.data.metricIds,
    targetOverlap: parsed.data.targetOverlap,
    existingAssignments: existingAssignments as any,
  });

  if (!plan.ok) {
    return NextResponse.json({ error: plan.reason }, { status: 400 });
  }

  if (plan.assignments.length === 0) {
    return NextResponse.json({ assignmentRunId: null, createdAssignments: 0, skippedRows: plan.skippedRowIds.length });
  }

  const assignmentRunId = createId();
  const now = new Date();

  await db.transaction(async (tx: any) => {
    await tx.insert(annotationAssignmentRuns).values({
      id: assignmentRunId,
      datasetId,
      targetOverlap: parsed.data.targetOverlap,
      metricIds: parsed.data.metricIds,
      scope: parsed.data.scope.type,
      createdBy: session.user.id,
      createdAt: now,
    });

    await tx.insert(annotationAssignments).values(
      plan.assignments.map((assignment) => ({
        id: createId(),
        assignmentRunId,
        datasetId,
        rowId: assignment.rowId,
        annotatorId: assignment.annotatorId,
        metricIds: assignment.metricIds,
        metricKey,
        targetOverlap: parsed.data.targetOverlap,
        status: "assigned",
        assignedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });

  return NextResponse.json({
    assignmentRunId,
    createdAssignments: plan.assignments.length,
    skippedRows: plan.skippedRowIds.length,
  });
});
