import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationMetrics, datasetImports, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import {
  computeRequiredAppendFields,
  inspectDatasetRows,
  validateDisplayFields,
  type JsonRecord,
} from "@/lib/datasets/import-validation";
import { validateMetricConfig } from "@/lib/datasets/metrics";

const metricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  scale: z.object({ values: z.array(z.string().min(1)).min(2) }),
  required: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const createDatasetSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  sourceFilename: z.string().min(1),
  rows: z.array(z.record(z.unknown())).min(1),
  totalRows: z.number().int().min(1).optional(),
  schemaFingerprint: z.array(z.object({ path: z.string(), type: z.string(), sample: z.unknown() })).optional(),
  listFields: z.array(z.string()).min(1),
  detailFields: z.array(z.string()).min(1),
  metrics: z.array(metricSchema).min(1),
});

const ROW_INSERT_CHUNK_SIZE = 500;

function getSourceId(row: JsonRecord): string | null {
  const candidate = row.id ?? row._id ?? row.uuid;
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : null;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export const GET = requireAdmin(async () => {
  const allDatasets = await db.select().from(datasets).orderBy(desc(datasets.createdAt));
  const datasetIds = allDatasets.map((dataset: any) => dataset.id);
  const rowCounts =
    datasetIds.length > 0
      ? await db
          .select({ datasetId: datasetRows.datasetId, total: count() })
          .from(datasetRows)
          .where(inArray(datasetRows.datasetId, datasetIds))
          .groupBy(datasetRows.datasetId)
      : [];
  const metricCounts =
    datasetIds.length > 0
      ? await db
          .select({ datasetId: annotationMetrics.datasetId, total: count() })
          .from(annotationMetrics)
          .where(inArray(annotationMetrics.datasetId, datasetIds))
          .groupBy(annotationMetrics.datasetId)
      : [];
  const latestImportTimes = db
    .select({
      datasetId: datasetImports.datasetId,
      latestCreatedAt: max(datasetImports.createdAt).as("latest_created_at"),
    })
    .from(datasetImports)
    .where(inArray(datasetImports.datasetId, datasetIds))
    .groupBy(datasetImports.datasetId)
    .as("latest_import_times");
  const allImports =
    datasetIds.length > 0
      ? await db
          .select({ datasetId: datasetImports.datasetId, sourceFilename: datasetImports.sourceFilename })
          .from(datasetImports)
          .innerJoin(
            latestImportTimes,
            and(eq(datasetImports.datasetId, latestImportTimes.datasetId), eq(datasetImports.createdAt, latestImportTimes.latestCreatedAt)),
          )
          .orderBy(desc(datasetImports.createdAt))
      : [];

  const rowCount = new Map<string, number>();
  for (const row of rowCounts) rowCount.set(row.datasetId, row.total);

  const metricCount = new Map<string, number>();
  for (const metric of metricCounts) metricCount.set(metric.datasetId, metric.total);

  const latestImport = new Map<string, string>();
  for (const item of allImports) {
    if (!latestImport.has(item.datasetId)) latestImport.set(item.datasetId, item.sourceFilename);
  }

  return NextResponse.json({
    datasets: allDatasets.map((dataset: any) => ({
      id: dataset.id,
      name: dataset.name,
      domain: dataset.domain,
      status: dataset.status,
      rowCount: rowCount.get(dataset.id) ?? 0,
      metricCount: metricCount.get(dataset.id) ?? 0,
      latestImport: latestImport.get(dataset.id) ?? null,
      createdAt: dataset.createdAt,
    })),
  });
});

export const POST = requireAdmin(async (req: NextRequest, session) => {
  const parsed = createDatasetSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const displayValidation = validateDisplayFields(parsed.data.rows, parsed.data.listFields, parsed.data.detailFields);
  if (!displayValidation.ok) {
    return NextResponse.json({ error: "MISSING_DISPLAY_FIELDS", missingFields: displayValidation.missingFields }, { status: 400 });
  }

  const metricValidation = validateMetricConfig(parsed.data.metrics);
  if (!metricValidation.ok) {
    return NextResponse.json({ error: "INVALID_METRICS", details: metricValidation }, { status: 400 });
  }

  const datasetId = createId();
  const importId = createId();
  const now = new Date();
  const requiredAppendFields = computeRequiredAppendFields(parsed.data.listFields, parsed.data.detailFields);
  const schemaFingerprint = parsed.data.schemaFingerprint ?? inspectDatasetRows(parsed.data.rows).fields;
  const totalRows = parsed.data.totalRows ?? parsed.data.rows.length;
  const isComplete = parsed.data.rows.length >= totalRows;

  await db.transaction(async (tx: any) => {
    await tx.insert(datasets).values({
      id: datasetId,
      name: parsed.data.name,
      domain: parsed.data.domain,
      status: isComplete ? "ready" : "importing",
      schemaFingerprint,
      displayConfig: { listFields: parsed.data.listFields, detailFields: parsed.data.detailFields },
      requiredAppendFields,
      createdBy: session.user.id,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(datasetImports).values({
      id: importId,
      datasetId,
      sourceFilename: parsed.data.sourceFilename,
      status: isComplete ? "completed" : "in_progress",
      rowCount: parsed.data.rows.length,
      missingFieldsReport: null,
      createdBy: session.user.id,
      createdAt: now,
    });

    const rowValues = parsed.data.rows.map((row, index) => ({
      id: createId(),
      datasetId,
      importId,
      internalRowId: index + 1,
      rawJson: row,
      sourceId: getSourceId(row),
      createdAt: now,
    }));
    for (const chunk of chunkRows(rowValues, ROW_INSERT_CHUNK_SIZE)) {
      await tx.insert(datasetRows).values(chunk);
    }

    await tx.insert(annotationMetrics).values(
      parsed.data.metrics.map((metric) => ({
        id: createId(),
        datasetId,
        key: metric.key,
        label: metric.label,
        description: metric.description ?? null,
        scaleJson: metric.scale,
        required: metric.required ? 1 : 0,
        sortOrder: metric.sortOrder,
        createdAt: now,
        updatedAt: now,
      })),
    );
  });

  return NextResponse.json({ datasetId, importId, insertedRows: parsed.data.rows.length, status: isComplete ? "ready" : "importing" });
});
