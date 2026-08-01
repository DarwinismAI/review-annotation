import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { annotationMetrics, datasetImports, datasetRows, datasets } from "@/db/datasets";
import { rubricCriteria, rubrics } from "@/db/schema";
import { requireAdmin, requireAdminRead } from "@/lib/auth-middleware";
import { rowsFromResult } from "@/lib/datasets/admin-row-query";
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

type DatasetListQueryRow = {
  id: string;
  name: string;
  domain: string;
  status: string;
  createdAt: Date | string;
  rowCount: number | string | null;
  metricCount: number | string | null;
  latestImport: string | null;
  datasetTotal: number | string;
  summaryDatasetCount?: number | string | null;
  summaryRowCount?: number | string | null;
  summaryMetricCount?: number | string | null;
  summaryReadyCount?: number | string | null;
  summaryImportingCount?: number | string | null;
};

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

export const GET = requireAdminRead(async (req, _claims, context) => {
  const { searchParams } = new URL(req.url);
  const page = Math.max(Number(searchParams.get("page") ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 50) || 50, 1), 200);
  const includeSummary = searchParams.get("summary") === "1";
  const includeImportCounts = searchParams.get("counts") === "1";
  const offset = (page - 1) * pageSize;

  const importCountCtes = includeImportCounts
    ? sql`,
      page_row_counts as (
        select dataset_id, count(*) as total
        from dataset_rows
        where dataset_id in (select id from page_datasets)
        group by dataset_id
      ),
      page_metric_counts as (
        select dataset_id, count(*) as total
        from annotation_metrics
        where dataset_id in (select id from page_datasets)
        group by dataset_id
      ),
      latest_imports as (
        select dataset_id, source_filename
        from (
          select dataset_id, source_filename, row_number() over (partition by dataset_id order by created_at desc, id desc) as rank
          from dataset_imports
          where dataset_id in (select id from page_datasets)
        ) ranked_imports
        where rank = 1
      )`
    : sql``;
  const importCountJoins = includeImportCounts
    ? sql`
      left join page_row_counts prc on prc.dataset_id = pd.id
      left join page_metric_counts pmc on pmc.dataset_id = pd.id
      left join latest_imports li on li.dataset_id = pd.id`
    : sql``;
  const rowCountSelect = includeImportCounts ? sql`coalesce(prc.total, 0)` : sql`0`;
  const metricCountSelect = includeImportCounts ? sql`coalesce(pmc.total, 0)` : sql`0`;
  const latestImportSelect = includeImportCounts ? sql`li.source_filename` : sql`null`;
  const summaryCte = includeSummary
    ? sql`,
      summary_totals as (
        select
          (select count(*) from datasets) as dataset_count,
          (select count(*) from dataset_rows) as row_count,
          (select count(*) from annotation_metrics) as metric_count,
          (select count(*) from datasets where status = 'ready') as ready_count,
          (select count(*) from datasets where status = 'importing') as importing_count
      )`
    : sql``;
  const summaryJoin = includeSummary ? sql`cross join summary_totals st` : sql``;
  const summarySelect = includeSummary
    ? sql`,
      st.dataset_count as "summaryDatasetCount",
      st.row_count as "summaryRowCount",
      st.metric_count as "summaryMetricCount",
      st.ready_count as "summaryReadyCount",
      st.importing_count as "summaryImportingCount"`
    : sql``;

  const queryDatasetList = async () =>
    await db.execute(sql`
      with page_datasets as (
        select id, name, domain, status, created_at
        from datasets
        order by created_at desc, id desc
        limit ${pageSize} offset ${offset}
      ),
      dataset_total as (
        select count(*) as total from datasets
      )
      ${importCountCtes}
      ${summaryCte}
      select
        pd.id,
        pd.name,
        pd.domain,
        pd.status,
        pd.created_at as "createdAt",
        ${rowCountSelect} as "rowCount",
        ${metricCountSelect} as "metricCount",
        ${latestImportSelect} as "latestImport",
        dt.total as "datasetTotal"
        ${summarySelect}
      from page_datasets pd
      cross join dataset_total dt
      ${summaryJoin}
      ${importCountJoins}
      union all
      select
        null as id,
        null as name,
        null as domain,
        null as status,
        null as "createdAt",
        0 as "rowCount",
        0 as "metricCount",
        null as "latestImport",
        dt.total as "datasetTotal"
        ${summarySelect}
      from dataset_total dt
      ${summaryJoin}
      where not exists (select 1 from page_datasets)
    `);
  const queryRows = rowsFromResult<DatasetListQueryRow>(
    await context.timing.measure("sql", queryDatasetList),
  );
  const datasetTotal = Number(queryRows[0]?.datasetTotal ?? 0);
  const datasetsPayload = queryRows.filter((dataset) => dataset.id);
  const summary =
    includeSummary && queryRows[0]
      ? {
          datasetCount: Number(queryRows[0].summaryDatasetCount ?? 0),
          rowCount: Number(queryRows[0].summaryRowCount ?? 0),
          metricCount: Number(queryRows[0].summaryMetricCount ?? 0),
          readyCount: Number(queryRows[0].summaryReadyCount ?? 0),
          importingCount: Number(queryRows[0].summaryImportingCount ?? 0),
        }
      : undefined;

  return NextResponse.json({
    datasets: datasetsPayload.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      domain: dataset.domain,
      status: dataset.status,
      rowCount: Number(dataset.rowCount ?? 0),
      metricCount: Number(dataset.metricCount ?? 0),
      latestImport: dataset.latestImport ?? null,
      createdAt: dataset.createdAt,
    })),
    page,
    pageSize,
    total: datasetTotal,
    ...(summary ? { summary } : {}),
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
