import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { datasetImports, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { parseDatasetRows, validateAppendRows, type JsonRecord } from "@/lib/datasets/import-validation";

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

  if (parsed.data.importId) {
    const existingImport = (
      await db
        .select({ id: datasetImports.id, status: datasetImports.status })
        .from(datasetImports)
        .where(and(eq(datasetImports.id, parsed.data.importId), eq(datasetImports.datasetId, datasetId)))
    )[0];
    if (!existingImport) return NextResponse.json({ error: "IMPORT_NOT_FOUND" }, { status: 404 });
    if (existingImport.status !== "in_progress") {
      return NextResponse.json({ error: "IMPORT_ALREADY_COMPLETED" }, { status: 409 });
    }
  }

  const [maxRow] = await db
    .select({ maxInternalRowId: sql<number>`coalesce(max(${datasetRows.internalRowId}), 0)` })
    .from(datasetRows)
    .where(eq(datasetRows.datasetId, datasetId));
  const startAt = Number(maxRow?.maxInternalRowId ?? 0) + 1;
  const importId = parsed.data.importId ?? createId();
  const now = new Date();
  const singleRequestImport = !parsed.data.importId && !parsed.data.totalRows && parsed.data.finalChunk === undefined;
  const requestCompletesImport = parsed.data.finalChunk ?? singleRequestImport;
  const firstRequestCompletesImport = parsed.data.totalRows ? rows.length >= parsed.data.totalRows : requestCompletesImport;
  let completed = false;

  await db.transaction(async (tx: any) => {
    if (!parsed.data.importId) {
      await tx.update(datasets).set({ status: firstRequestCompletesImport ? "ready" : "importing", updatedAt: now }).where(eq(datasets.id, datasetId));
      await tx.insert(datasetImports).values({
        id: importId,
        datasetId,
        sourceFilename: parsed.data.filename,
        status: firstRequestCompletesImport ? "completed" : "in_progress",
        rowCount: rows.length,
        missingFieldsReport: null,
        createdBy: session.user.id,
        createdAt: now,
      });
    }

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
    await tx
      .update(datasetImports)
      .set({ status: isComplete ? "completed" : "in_progress", rowCount: insertedRows })
      .where(eq(datasetImports.id, importId));
    if (isComplete) {
      await tx.update(datasets).set({ status: "ready", updatedAt: now }).where(eq(datasets.id, datasetId));
    }
  });

  return NextResponse.json({ importId, insertedRows: rows.length, status: completed ? "ready" : "importing" });
});
