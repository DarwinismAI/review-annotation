import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationMetrics, datasetImports, datasetRows, datasets } from "@/db/datasets";
import { rubricCriteria, rubrics } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-middleware";
import {
  computeRequiredAppendFields,
  inspectDatasetRows,
  validateDisplayFields,
  type JsonRecord,
} from "@/lib/datasets/import-validation";
import { MAX_DATASET_IMPORT_ROWS } from "@/lib/datasets/import-limits";
import { lockDatasetImportDomain } from "@/lib/datasets/import-locks";
import { validateMetricConfig, type MetricConfigInput } from "@/lib/datasets/metrics";

const createDatasetSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  sourceFilename: z.string().min(1),
  rows: z.array(z.record(z.unknown())).min(1),
  totalRows: z.number().int().min(1).optional(),
  schemaFingerprint: z.array(z.object({ path: z.string(), type: z.string(), sample: z.unknown() })).optional(),
  listFields: z.array(z.string()).min(1),
  detailFields: z.array(z.string()).min(1),
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

function importRowCount(rows: JsonRecord[], totalRows?: number) {
  return totalRows ?? rows.length;
}

async function findActiveImport(domain: string) {
  const [activeImport] = await db
    .select({
      datasetId: datasets.id,
      datasetName: datasets.name,
      sourceFilename: datasetImports.sourceFilename,
    })
    .from(datasetImports)
    .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
    .where(and(eq(datasets.domain, domain), eq(datasets.status, "importing"), eq(datasetImports.status, "in_progress")));
  return activeImport;
}

function activeImportPayload(activeImport: Awaited<ReturnType<typeof findActiveImport>>) {
  return {
    error: "DATASET_IMPORT_IN_PROGRESS",
    message: `Dataset "${activeImport?.datasetName}" đang import. Chờ hoàn tất trước khi import tiếp.`,
    datasetId: activeImport?.datasetId,
  };
}

function scaleValues(rawScale: string): string[] {
  try {
    const parsed = JSON.parse(rawScale) as Array<{ label?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item.label === "string" ? item.label.trim() : "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function getDatasetMetricsFromRubrics(domain: string): Promise<MetricConfigInput[]> {
  const rows = await db
    .select({
      rubricId: rubrics.id,
      rubricName: rubrics.name,
      criterionId: rubricCriteria.id,
      criterionName: rubricCriteria.name,
      description: rubricCriteria.description,
      scale: rubricCriteria.scale,
      required: rubricCriteria.required,
      createdAt: rubrics.createdAt,
      sortOrder: rubricCriteria.sortOrder,
    })
    .from(rubrics)
    .innerJoin(rubricCriteria, eq(rubricCriteria.rubricId, rubrics.id))
    .where(eq(rubrics.domain, domain))
    .orderBy(asc(rubrics.createdAt), asc(rubrics.id), asc(rubricCriteria.sortOrder));

  return rows.map((row: any, index: number): MetricConfigInput => ({
    key: row.criterionId,
    label: row.rubricName || row.criterionName,
    description: row.description ?? null,
    scale: { values: scaleValues(row.scale) },
    required: Boolean(row.required),
    sortOrder: index,
  }));
}

export const GET = requireAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const page = Math.max(Number(searchParams.get("page") ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50) || 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const [{ total: datasetTotal } = { total: 0 }] = await db.select({ total: count() }).from(datasets);
  const [{ total: rowTotal } = { total: 0 }] = await db.select({ total: count() }).from(datasetRows);
  const [{ total: metricTotal } = { total: 0 }] = await db.select({ total: count() }).from(annotationMetrics);
  const statusCounts = await db.select({ status: datasets.status, total: count() }).from(datasets).groupBy(datasets.status);

  const pagedDatasets = await db.select().from(datasets).orderBy(desc(datasets.createdAt)).limit(pageSize).offset(offset);
  const datasetIds = pagedDatasets.map((dataset: any) => dataset.id);
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
  let allImports: Array<{ datasetId: string; sourceFilename: string }> = [];
  if (datasetIds.length > 0) {
    const latestImportTimes = db
      .select({
        datasetId: datasetImports.datasetId,
        latestCreatedAt: max(datasetImports.createdAt).as("latest_created_at"),
      })
      .from(datasetImports)
      .where(inArray(datasetImports.datasetId, datasetIds))
      .groupBy(datasetImports.datasetId)
      .as("latest_import_times");
    allImports = await db
      .select({ datasetId: datasetImports.datasetId, sourceFilename: datasetImports.sourceFilename })
      .from(datasetImports)
      .innerJoin(
        latestImportTimes,
        and(eq(datasetImports.datasetId, latestImportTimes.datasetId), eq(datasetImports.createdAt, latestImportTimes.latestCreatedAt)),
      )
      .orderBy(desc(datasetImports.createdAt));
  }

  const rowCount = new Map<string, number>();
  for (const row of rowCounts) rowCount.set(row.datasetId, row.total);

  const metricCount = new Map<string, number>();
  for (const metric of metricCounts) metricCount.set(metric.datasetId, metric.total);

  const latestImport = new Map<string, string>();
  for (const item of allImports) {
    if (!latestImport.has(item.datasetId)) latestImport.set(item.datasetId, item.sourceFilename);
  }

  const statusCount = new Map<string, number>();
  for (const status of statusCounts) statusCount.set(status.status, status.total);

  return NextResponse.json({
    datasets: pagedDatasets.map((dataset: any) => ({
      id: dataset.id,
      name: dataset.name,
      domain: dataset.domain,
      status: dataset.status,
      rowCount: rowCount.get(dataset.id) ?? 0,
      metricCount: metricCount.get(dataset.id) ?? 0,
      latestImport: latestImport.get(dataset.id) ?? null,
      createdAt: dataset.createdAt,
    })),
    page,
    pageSize,
    total: datasetTotal,
    summary: {
      datasetCount: datasetTotal,
      rowCount: rowTotal,
      metricCount: metricTotal,
      readyCount: statusCount.get("ready") ?? 0,
      importingCount: statusCount.get("importing") ?? 0,
    },
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

  const totalImportRows = importRowCount(parsed.data.rows, parsed.data.totalRows);
  if (totalImportRows > MAX_DATASET_IMPORT_ROWS) {
    return NextResponse.json(
      { error: "IMPORT_ROW_LIMIT_EXCEEDED", message: `Một lần import tối đa ${MAX_DATASET_IMPORT_ROWS.toLocaleString("vi-VN")} dòng` },
      { status: 413 },
    );
  }

  const activeImport = await findActiveImport(parsed.data.domain);
  if (activeImport) {
    return NextResponse.json(activeImportPayload(activeImport), { status: 409 });
  }

  const metrics = await getDatasetMetricsFromRubrics(parsed.data.domain);
  const metricValidation = validateMetricConfig(metrics);
  if (!metricValidation.ok) {
    return NextResponse.json(
      { error: metrics.length === 0 ? "NO_RUBRIC_METRICS" : "INVALID_RUBRIC_METRICS", details: metricValidation },
      { status: 400 },
    );
  }

  const datasetId = createId();
  const importId = createId();
  const now = new Date();
  const requiredAppendFields = computeRequiredAppendFields(parsed.data.listFields, parsed.data.detailFields);
  const schemaFingerprint = parsed.data.schemaFingerprint ?? inspectDatasetRows(parsed.data.rows).fields;
  const totalRows = parsed.data.totalRows ?? parsed.data.rows.length;
  const isComplete = parsed.data.rows.length >= totalRows;

  let blockedImport: Awaited<ReturnType<typeof findActiveImport>> | null = null;

  await db.transaction(async (tx: any) => {
    await lockDatasetImportDomain(tx, parsed.data.domain);
    [blockedImport] = await tx
      .select({
        datasetId: datasets.id,
        datasetName: datasets.name,
        sourceFilename: datasetImports.sourceFilename,
      })
      .from(datasetImports)
      .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
      .where(and(eq(datasets.domain, parsed.data.domain), eq(datasets.status, "importing"), eq(datasetImports.status, "in_progress")));
    if (blockedImport) return;

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
      metrics.map((metric) => ({
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

  if (blockedImport) {
    return NextResponse.json(activeImportPayload(blockedImport), { status: 409 });
  }

  return NextResponse.json({ datasetId, importId, insertedRows: parsed.data.rows.length, status: isComplete ? "ready" : "importing" });
});
