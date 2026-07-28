import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { annotationMetrics, datasetImports, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";

export const GET = requireAdmin(async (_req, _session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const metrics = await db.select().from(annotationMetrics).where(eq(annotationMetrics.datasetId, datasetId));
  const imports = await db.select().from(datasetImports).where(eq(datasetImports.datasetId, datasetId)).orderBy(desc(datasetImports.createdAt));

  return NextResponse.json({
    dataset: {
      id: dataset.id,
      name: dataset.name,
      domain: dataset.domain,
      status: dataset.status,
      displayConfig: dataset.displayConfig,
      requiredAppendFields: dataset.requiredAppendFields,
      schemaFingerprint: dataset.schemaFingerprint,
    },
    metrics: metrics
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      .map((metric: any) => ({
        id: metric.id,
        key: metric.key,
        label: metric.label,
        description: metric.description,
        scale: metric.scaleJson,
        required: Boolean(metric.required),
        sortOrder: metric.sortOrder,
      })),
    imports: imports.map((item: any) => ({
      id: item.id,
      sourceFilename: item.sourceFilename,
      status: item.status,
      rowCount: item.rowCount,
      createdAt: item.createdAt,
    })),
  });
});
