import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
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
    sourceFilename: job.sourceFilename,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    ...status,
    canCancel: job.status === "in_progress" && job.rowCount === 0,
  };
}

export const GET = requireAdmin(async (req: NextRequest, _session, context) => {
  const datasetId = context?.params.id;
  if (!datasetId) return NextResponse.json({ error: "MISSING_DATASET_ID" }, { status: 400 });

  const dataset = (await db.select({ id: datasets.id }).from(datasets).where(eq(datasets.id, datasetId)))[0];
  if (!dataset) return NextResponse.json({ error: "DATASET_NOT_FOUND" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(Number(searchParams.get("page") ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 20), 1), 50);

  const [{ total }] = await db.select({ total: count() }).from(datasetImports).where(eq(datasetImports.datasetId, datasetId));
  const jobs = await db
    .select()
    .from(datasetImports)
    .where(eq(datasetImports.datasetId, datasetId))
    .orderBy(desc(datasetImports.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({
    jobs: jobs.map(projectJob),
    total,
    page,
    pageSize,
  });
});
