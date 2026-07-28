import { NextRequest, NextResponse } from "next/server";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { datasetImports, datasetRows, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { parseDatasetRows, validateAppendRows, type JsonRecord } from "@/lib/datasets/import-validation";

const requestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

function getSourceId(row: JsonRecord): string | null {
  const candidate = row.id ?? row._id ?? row.uuid;
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : null;
}

export const POST = requireAdmin(async (req: NextRequest, session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  let rows: JsonRecord[];
  try {
    rows = parseDatasetRows(parsed.data.content);
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

  const existingRows = await db.select({ internalRowId: datasetRows.internalRowId }).from(datasetRows).where(eq(datasetRows.datasetId, datasetId));
  const startAt = existingRows.reduce((max: number, row: any) => Math.max(max, row.internalRowId), 0) + 1;
  const importId = createId();
  const now = new Date();

  await db.transaction(async (tx: any) => {
    await tx.insert(datasetImports).values({
      id: importId,
      datasetId,
      sourceFilename: parsed.data.filename,
      status: "completed",
      rowCount: rows.length,
      missingFieldsReport: null,
      createdBy: session.user.id,
      createdAt: now,
    });

    await tx.insert(datasetRows).values(
      rows.map((row, index) => ({
        id: createId(),
        datasetId,
        importId,
        internalRowId: startAt + index,
        rawJson: row,
        sourceId: getSourceId(row),
        createdAt: now,
      })),
    );
  });

  return NextResponse.json({ importId, insertedRows: rows.length });
});
