import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { datasetImports, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { projectImportJobStatus } from "@/lib/datasets/task-groups";

function projectJob(job: any) {
  const status = projectImportJobStatus({
    status: job.status,
    rowCount: job.rowCount,
    targetRowCount: job.targetRowCount,
    errorMessage: job.errorMessage,
  });
  return {
    id: job.id,
    datasetId: job.datasetId,
    datasetName: job.datasetName,
    sourceFilename: job.sourceFilename,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    ...status,
    canCancel: job.status === "in_progress" && job.rowCount === 0,
  };
}

export const GET = requireAdmin(async (_req, _session, context) => {
  const jobId = context?.params.jobId;
  if (!jobId) return NextResponse.json({ error: "MISSING_IMPORT_JOB_ID" }, { status: 400 });

  const job = (
    await db
      .select({
        id: datasetImports.id,
        datasetId: datasetImports.datasetId,
        datasetName: datasets.name,
        sourceFilename: datasetImports.sourceFilename,
        status: datasetImports.status,
        rowCount: datasetImports.rowCount,
        targetRowCount: datasetImports.targetRowCount,
        errorMessage: datasetImports.errorMessage,
        startedAt: datasetImports.startedAt,
        completedAt: datasetImports.completedAt,
        createdAt: datasetImports.createdAt,
      })
      .from(datasetImports)
      .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
      .where(eq(datasetImports.id, jobId))
  )[0];
  if (!job) return NextResponse.json({ error: "IMPORT_JOB_NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ job: projectJob(job) });
});
