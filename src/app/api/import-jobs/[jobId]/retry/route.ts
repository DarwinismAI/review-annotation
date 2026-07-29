import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { datasetImports } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";

export const POST = requireAdmin(async (_req, _session, context) => {
  const jobId = context?.params.jobId;
  if (!jobId) return NextResponse.json({ error: "MISSING_IMPORT_JOB_ID" }, { status: 400 });

  const job = (await db.select({ id: datasetImports.id }).from(datasetImports).where(eq(datasetImports.id, jobId)))[0];
  if (!job) return NextResponse.json({ error: "IMPORT_JOB_NOT_FOUND" }, { status: 404 });

  return NextResponse.json(
    {
      error: "RETRY_NOT_SUPPORTED",
      message: "Import retry requires persisted source content, which this job does not store.",
    },
    { status: 409 },
  );
});
