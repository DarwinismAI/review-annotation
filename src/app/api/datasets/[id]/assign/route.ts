import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { expertProfiles, profiles } from "@/db/schema";
import { annotationAssignmentRuns, annotationAssignments, annotationMetrics, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { buildMetricKey, planBalancedAssignments } from "@/lib/datasets/assignment";

const ASSIGNMENT_INSERT_CHUNK_SIZE = 1000;

const assignRequestSchema = z.object({
  scope: z.union([
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("selected"), rowIds: z.array(z.string()).min(1) }),
  ]),
  targetOverlap: z.number().int().min(1).max(5),
  maxRowsPerAnnotator: z.number().int().min(1).optional(),
  metricIds: z.array(z.string()).min(1).optional(),
  annotatorIds: z.array(z.string()).min(1),
});

export const POST = requireAdmin(async (req: NextRequest, session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const parsed = assignRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = (await db.select({ id: datasets.id, status: datasets.status }).from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });
  if (dataset.status !== "ready") {
    return NextResponse.json({ error: "DATASET_NOT_READY" }, { status: 409 });
  }

  const metrics = await db
    .select({ id: annotationMetrics.id })
    .from(annotationMetrics)
    .where(eq(annotationMetrics.datasetId, datasetId))
    .orderBy(asc(annotationMetrics.sortOrder), asc(annotationMetrics.id));
  const metricIds = metrics.map((metric: any) => metric.id);
  if (metricIds.length === 0) {
    return NextResponse.json({ error: "NO_METRICS" }, { status: 400 });
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
      ? db.select({ id: datasetRows.id }).from(datasetRows).where(eq(datasetRows.datasetId, datasetId)).orderBy(asc(datasetRows.internalRowId))
      : db
          .select({ id: datasetRows.id })
          .from(datasetRows)
          .where(and(eq(datasetRows.datasetId, datasetId), inArray(datasetRows.id, parsed.data.scope.rowIds)))
          .orderBy(asc(datasetRows.internalRowId));
  const rows = await rowQuery;
  const rowIds = rows.map((row: any) => row.id);

  const metricKey = buildMetricKey(metricIds);
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
    metricIds,
    targetOverlap: parsed.data.targetOverlap,
    maxRowsPerAnnotator: parsed.data.maxRowsPerAnnotator,
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
  const assignmentRows = plan.assignments.map((assignment) => ({
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
  }));

  await db.transaction(async (tx: any) => {
    await tx.insert(annotationAssignmentRuns).values({
      id: assignmentRunId,
      datasetId,
      targetOverlap: parsed.data.targetOverlap,
      metricIds,
      scope: parsed.data.scope.type,
      createdBy: session.user.id,
      createdAt: now,
    });

    for (let offset = 0; offset < assignmentRows.length; offset += ASSIGNMENT_INSERT_CHUNK_SIZE) {
      await tx
        .insert(annotationAssignments)
        .values(assignmentRows.slice(offset, offset + ASSIGNMENT_INSERT_CHUNK_SIZE));
    }
  });

  return NextResponse.json({
    assignmentRunId,
    createdAssignments: plan.assignments.length,
    skippedRows: plan.skippedRowIds.length,
  });
});
