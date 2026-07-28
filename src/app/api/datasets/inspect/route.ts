import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-middleware";
import { inspectDatasetRows, parseDatasetRows } from "@/lib/datasets/import-validation";

const inspectRequestSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

export const POST = requireAdmin(async (req: NextRequest) => {
  const parsed = inspectRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const rows = parseDatasetRows(parsed.data.content);
    return NextResponse.json({
      filename: parsed.data.filename,
      ...inspectDatasetRows(rows),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "INVALID_DATASET_JSON", message: error instanceof Error ? error.message : "Invalid dataset JSON" },
      { status: 400 },
    );
  }
});
