import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { datasetImports, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";

export const POST = requireAdmin(async (_req, _session, context) => {
  const jobId = context?.params.jobId;
  if (!jobId) return NextResponse.json({ error: "MISSING_IMPORT_JOB_ID" }, { status: 400 });

  const job = (
    await db
      .select({
        id: datasetImports.id,
        datasetId: datasetImports.datasetId,
        status: datasetImports.status,
        rowCount: datasetImports.rowCount,
      })
      .from(datasetImports)
      .where(eq(datasetImports.id, jobId))
  )[0];
  if (!job) return NextResponse.json({ error: "IMPORT_JOB_NOT_FOUND" }, { status: 404 });

  if (job.status !== "in_progress" || job.rowCount !== 0) {
    return NextResponse.json(
      {
        error: "CANCEL_NOT_SAFE",
        message: "Only in-progress import jobs with zero inserted rows can be canceled.",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  await db.transaction(async (tx: any) => {
    await tx
      .update(datasetImports)
      .set({ status: "canceled", completedAt: now, errorMessage: "Canceled by admin" })
      .where(eq(datasetImports.id, job.id));
    await tx.update(datasets).set({ status: "ready", updatedAt: now }).where(eq(datasets.id, job.datasetId));
  });

  return NextResponse.json({ ok: true, status: "canceled" });
});
