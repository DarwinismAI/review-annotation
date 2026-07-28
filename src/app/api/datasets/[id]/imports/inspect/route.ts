import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { flattenRecordPaths, parseDatasetRows, validateAppendRows } from "@/lib/datasets/import-validation";

const requestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

export const POST = requireAdmin(async (req: NextRequest, _session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = (await db.select().from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  try {
    const rows = parseDatasetRows(parsed.data.content);
    const requiredFields = dataset.requiredAppendFields as string[];
    const validation = validateAppendRows(rows, requiredFields);
    if (!validation.ok) {
      return NextResponse.json({ error: "MISSING_REQUIRED_FIELDS", missingFields: validation.missingFields }, { status: 400 });
    }

    const initialFields = new Set((dataset.schemaFingerprint as Array<{ path: string }>).map((field) => field.path));
    const extraFields = Array.from(new Set(rows.flatMap((row) => flattenRecordPaths(row).map((field) => field.path)))).filter(
      (path) => !initialFields.has(path),
    );

    return NextResponse.json({ ok: true, rowCount: rows.length, extraFields });
  } catch (error) {
    return NextResponse.json(
      { error: "INVALID_DATASET_JSON", message: error instanceof Error ? error.message : "Invalid dataset JSON" },
      { status: 400 },
    );
  }
});
