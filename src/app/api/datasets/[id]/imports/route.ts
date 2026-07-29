import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { datasetImports, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { parseDatasetRows, validateAppendRows, type JsonRecord } from "@/lib/datasets/import-validation";
import { MAX_DATASET_IMPORT_ROWS } from "@/lib/datasets/import-limits";
import { lockDatasetImportDomain, lockDatasetImportRun } from "@/lib/datasets/import-locks";

const requestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1).optional(),
  rows: z.array(z.record(z.unknown())).min(1).optional(),
  importId: z.string().min(1).optional(),
  totalRows: z.number().int().min(1).optional(),
  finalChunk: z.boolean().optional(),
}).refine((value) => Boolean(value.content) || Boolean(value.rows), {
  message: "content or rows is required",
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

function importConflictPayload() {
  return {
    error: "DATASET_IMPORT_CONFLICT",
    message: "Import đang được xử lý bởi request khác. Tải lại dataset rồi thử lại.",
  };
}

function isInsertConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /dataset_rows_dataset_internal_row_unique|unique constraint|duplicate key|constraint failed/i.test(message);
}

export const POST = requireAdmin(async (req: NextRequest, session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });
  if (!parsed.data.importId && dataset.status !== "ready") {
    return NextResponse.json({ error: "DATASET_NOT_READY" }, { status: 409 });
  }
  if (!parsed.data.importId) {
    const activeImport = await findActiveImport(dataset.domain);
    if (activeImport) {
      return NextResponse.json(activeImportPayload(activeImport), { status: 409 });
    }
  }

  let rows: JsonRecord[];
  try {
    rows = parsed.data.rows ?? parseDatasetRows(parsed.data.content ?? "", { filename: parsed.data.filename });
  } catch (error) {
    return NextResponse.json(
      { error: "INVALID_DATASET_JSON", message: error instanceof Error ? error.message : "Invalid dataset JSON" },
      { status: 400 },
    );
  }

  const validation = validateAppendRows(rows, dataset.requiredAppendFields as string[]);
  if (!validation.ok) {
    return NextResponse.json({ error: "MISSING_REQUIRED_FIELDS", missingFields: validation.missingFields }, { status: 400 });
  }

  const totalImportRows = importRowCount(rows, parsed.data.totalRows);
  if (totalImportRows > MAX_DATASET_IMPORT_ROWS) {
    return NextResponse.json(
      { error: "IMPORT_ROW_LIMIT_EXCEEDED", message: `Một lần import tối đa ${MAX_DATASET_IMPORT_ROWS.toLocaleString("vi-VN")} dòng` },
      { status: 413 },
    );
  }

  const importId = parsed.data.importId ?? createId();
  const now = new Date();
  const singleRequestImport = !parsed.data.importId && !parsed.data.totalRows && parsed.data.finalChunk === undefined;
  const requestCompletesImport = parsed.data.finalChunk ?? singleRequestImport;
  const firstRequestCompletesImport = parsed.data.totalRows ? rows.length >= parsed.data.totalRows : requestCompletesImport;
  let completed = false;
  let blockedImport: Awaited<ReturnType<typeof findActiveImport>> | null = null;
  let importNotFound = false;
  let importAlreadyCompleted = false;
  let importLimitExceeded = false;

  try {
    await db.transaction(async (tx: any) => {
      if (parsed.data.importId) {
        await lockDatasetImportRun(tx, parsed.data.importId);
        const [existingImport] = await tx
          .select({ id: datasetImports.id, status: datasetImports.status, rowCount: datasetImports.rowCount })
          .from(datasetImports)
          .where(and(eq(datasetImports.id, parsed.data.importId), eq(datasetImports.datasetId, datasetId)));
        if (!existingImport) {
          importNotFound = true;
          return;
        }
        if (existingImport.status !== "in_progress") {
          importAlreadyCompleted = true;
          return;
        }
        if (existingImport.rowCount + rows.length > MAX_DATASET_IMPORT_ROWS) {
          importLimitExceeded = true;
          return;
        }
      }

      if (!parsed.data.importId) {
        await lockDatasetImportDomain(tx, dataset.domain);
        [blockedImport] = await tx
          .select({
            datasetId: datasets.id,
            datasetName: datasets.name,
          })
          .from(datasetImports)
          .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
          .where(and(eq(datasets.domain, dataset.domain), eq(datasets.status, "importing"), eq(datasetImports.status, "in_progress")));
        if (blockedImport) return;

        await tx.update(datasets).set({ status: firstRequestCompletesImport ? "ready" : "importing", updatedAt: now }).where(eq(datasets.id, datasetId));
        await tx.insert(datasetImports).values({
          id: importId,
          datasetId,
          sourceFilename: parsed.data.filename,
          status: firstRequestCompletesImport ? "completed" : "in_progress",
          rowCount: rows.length,
          targetRowCount: totalImportRows,
          errorMessage: null,
          missingFieldsReport: null,
          createdBy: session.user.id,
          startedAt: now,
          completedAt: firstRequestCompletesImport ? now : null,
          createdAt: now,
        });
      }

      const [maxRow] = await tx
        .select({ maxInternalRowId: sql<number>`coalesce(max(${datasetRows.internalRowId}), 0)` })
        .from(datasetRows)
        .where(eq(datasetRows.datasetId, datasetId));
      const startAt = Number(maxRow?.maxInternalRowId ?? 0) + 1;

      const rowValues = rows.map((row, index) => ({
        id: createId(),
        datasetId,
        importId,
        internalRowId: startAt + index,
        rawJson: row,
        sourceId: getSourceId(row),
        createdAt: now,
      }));
      for (const chunk of chunkRows(rowValues, ROW_INSERT_CHUNK_SIZE)) {
        await tx.insert(datasetRows).values(chunk);
      }

      const [{ total: insertedRows }] = await tx
        .select({ total: count() })
        .from(datasetRows)
        .where(and(eq(datasetRows.datasetId, datasetId), eq(datasetRows.importId, importId)));
      const isComplete = parsed.data.totalRows ? insertedRows >= parsed.data.totalRows : requestCompletesImport;
      completed = isComplete;
      const importUpdate: Record<string, unknown> = {
        status: isComplete ? "completed" : "in_progress",
        rowCount: insertedRows,
        completedAt: isComplete ? now : null,
        errorMessage: null,
      };
      if (parsed.data.totalRows) {
        importUpdate.targetRowCount = parsed.data.totalRows;
      }
      await tx
        .update(datasetImports)
        .set(importUpdate)
        .where(eq(datasetImports.id, importId));
      if (isComplete) {
        await tx.update(datasets).set({ status: "ready", updatedAt: now }).where(eq(datasets.id, datasetId));
      }
    });
  } catch (error) {
    if (isInsertConflict(error)) {
      return NextResponse.json(importConflictPayload(), { status: 409 });
    }
    await db
      .update(datasetImports)
      .set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() })
      .where(eq(datasetImports.id, importId));
    throw error;
  }

  if (blockedImport) {
    return NextResponse.json(activeImportPayload(blockedImport), { status: 409 });
  }
  if (importNotFound) {
    return NextResponse.json({ error: "IMPORT_NOT_FOUND" }, { status: 404 });
  }
  if (importAlreadyCompleted) {
    return NextResponse.json({ error: "IMPORT_ALREADY_COMPLETED" }, { status: 409 });
  }
  if (importLimitExceeded) {
    return NextResponse.json(
      { error: "IMPORT_ROW_LIMIT_EXCEEDED", message: `Một lần import tối đa ${MAX_DATASET_IMPORT_ROWS.toLocaleString("vi-VN")} dòng` },
      { status: 413 },
    );
  }

  return NextResponse.json({ importId, insertedRows: rows.length, status: completed ? "ready" : "importing" });
});
