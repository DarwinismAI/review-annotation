import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationAdjudications, annotationMetrics, datasetRows } from "@/db/datasets";
import { profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";

const adjudicationSchema = z.object({
  values: z.record(z.string().nullable()),
  notes: z.record(z.string()).optional(),
});

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

async function loadRow(datasetId: string, rowId: string) {
  return (
    await db
      .select({ id: datasetRows.id })
      .from(datasetRows)
      .where(and(eq(datasetRows.datasetId, datasetId), eq(datasetRows.id, rowId)))
  )[0];
}

export const GET = requireAdmin(async (_req, _session, context) => {
  const datasetId = context?.params.id;
  const rowId = context?.params.rowId;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });
  if (!rowId) return NextResponse.json({ error: "MISSING_ROW_ID" }, { status: 400 });

  const row = await loadRow(datasetId, rowId);
  if (!row) return NextResponse.json({ error: "ROW_NOT_FOUND" }, { status: 404 });

  const adjudications = await db
    .select({
      rowId: annotationAdjudications.rowId,
      metricId: annotationAdjudications.metricId,
      metricKey: annotationAdjudications.metricKey,
      reviewerId: annotationAdjudications.reviewerId,
      reviewerName: profiles.name,
      value: annotationAdjudications.value,
      note: annotationAdjudications.note,
      updatedAt: annotationAdjudications.updatedAt,
    })
    .from(annotationAdjudications)
    .leftJoin(profiles, eq(annotationAdjudications.reviewerId, profiles.id))
    .where(and(eq(annotationAdjudications.datasetId, datasetId), eq(annotationAdjudications.rowId, rowId)))
    .orderBy(asc(annotationAdjudications.metricKey));

  return NextResponse.json({
    adjudications: adjudications.map((item: any) => ({
      ...item,
      updatedAt: toIso(item.updatedAt),
    })),
  });
});

export const POST = requireAdmin(async (req: NextRequest, session, context) => {
  const datasetId = context?.params.id;
  const rowId = context?.params.rowId;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });
  if (!rowId) return NextResponse.json({ error: "MISSING_ROW_ID" }, { status: 400 });

  const parsed = adjudicationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await loadRow(datasetId, rowId);
  if (!row) return NextResponse.json({ error: "ROW_NOT_FOUND" }, { status: 404 });

  const metricIds = Object.keys(parsed.data.values);
  if (metricIds.length === 0) {
    return NextResponse.json({ ok: true, adjudications: [] });
  }

  const metrics = await db
    .select({ id: annotationMetrics.id, key: annotationMetrics.key })
    .from(annotationMetrics)
    .where(and(eq(annotationMetrics.datasetId, datasetId), inArray(annotationMetrics.id, metricIds)));
  if (metrics.length !== metricIds.length) {
    return NextResponse.json({ error: "INVALID_METRIC_ID" }, { status: 400 });
  }

  const now = new Date();
  await db.transaction(async (tx: any) => {
    for (const metric of metrics) {
      const existing = (
        await tx
          .select({ id: annotationAdjudications.id })
          .from(annotationAdjudications)
          .where(and(eq(annotationAdjudications.rowId, rowId), eq(annotationAdjudications.metricId, metric.id)))
      )[0];
      const payload = {
        metricKey: metric.key,
        reviewerId: session.user.id,
        value: parsed.data.values[metric.id],
        note: parsed.data.notes?.[metric.id] ?? null,
        updatedAt: now,
        submittedAt: now,
      };

      if (existing) {
        await tx.update(annotationAdjudications).set(payload).where(eq(annotationAdjudications.id, existing.id));
      } else {
        await tx.insert(annotationAdjudications).values({
          id: createId(),
          datasetId,
          rowId,
          metricId: metric.id,
          createdAt: now,
          ...payload,
        });
      }
    }
  });

  const adjudications = await db
    .select({
      rowId: annotationAdjudications.rowId,
      metricId: annotationAdjudications.metricId,
      metricKey: annotationAdjudications.metricKey,
      reviewerId: annotationAdjudications.reviewerId,
      reviewerName: profiles.name,
      value: annotationAdjudications.value,
      note: annotationAdjudications.note,
      updatedAt: annotationAdjudications.updatedAt,
    })
    .from(annotationAdjudications)
    .leftJoin(profiles, eq(annotationAdjudications.reviewerId, profiles.id))
    .where(and(eq(annotationAdjudications.datasetId, datasetId), eq(annotationAdjudications.rowId, rowId)))
    .orderBy(asc(annotationAdjudications.metricKey));

  return NextResponse.json({
    ok: true,
    adjudications: adjudications.map((item: any) => ({
      ...item,
      updatedAt: toIso(item.updatedAt),
    })),
  });
});
