import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { datasetImports, datasets } from "@/db/datasets";
import { requireAdmin } from "@/lib/auth-middleware";
import { canFailStaleImportJob } from "@/lib/datasets/import-stale-recovery";
import { lockDatasetImportDomain, lockDatasetImportRun } from "@/lib/datasets/import-locks";

function parseAction(req: NextRequest) {
  return req.json().catch(() => null) as Promise<{ action?: unknown } | null>;
}

function blockedResponse(code: string, message: string) {
  return NextResponse.json({ error: code, message }, { status: 409 });
}

export const POST = requireAdmin(async (req, _session, context) => {
  const jobId = context?.params.jobId;
  if (!jobId) return NextResponse.json({ error: "MISSING_IMPORT_JOB_ID" }, { status: 400 });

  const body = await parseAction(req);
  if (body?.action !== "fail_stale") {
    return NextResponse.json(
      { error: "INVALID_RECOVERY_ACTION", message: "Explicit action fail_stale is required." },
      { status: 400 },
    );
  }

  const now = new Date();
  const result: {
    notFound?: true;
    blocked?: { code: string; message: string };
    recovered?: { datasetId: string; importId: string; status: "failed" };
  } = {};

  await db.transaction(async (tx: any) => {
    await lockDatasetImportRun(tx, jobId);
    const [initialJob] = await tx
      .select({
        id: datasetImports.id,
        datasetId: datasetImports.datasetId,
        datasetStatus: datasets.status,
        domain: datasets.domain,
      })
      .from(datasetImports)
      .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
      .where(eq(datasetImports.id, jobId));

    if (!initialJob) {
      result.notFound = true;
      return;
    }

    await lockDatasetImportDomain(tx, initialJob.domain);

    const [job] = await tx
      .select({
        id: datasetImports.id,
        datasetId: datasetImports.datasetId,
        datasetStatus: datasets.status,
        domain: datasets.domain,
        status: datasetImports.status,
        rowCount: datasetImports.rowCount,
        createdAt: datasetImports.createdAt,
      })
      .from(datasetImports)
      .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
      .where(eq(datasetImports.id, jobId));

    if (!job) {
      result.notFound = true;
      return;
    }

    const [activeImport] = await tx
      .select({ id: datasetImports.id })
      .from(datasetImports)
      .innerJoin(datasets, eq(datasetImports.datasetId, datasets.id))
      .where(and(eq(datasets.id, initialJob.datasetId), eq(datasets.status, "importing"), eq(datasetImports.status, "in_progress")));

    const decision = canFailStaleImportJob(
      {
        id: job.id,
        datasetId: job.datasetId,
        datasetStatus: job.datasetStatus,
        status: job.status,
        rowCount: job.rowCount,
        createdAt: job.createdAt,
        activeImportId: activeImport?.id ?? null,
      },
      now,
    );

    if (!decision.ok) {
      result.blocked = { code: decision.code, message: decision.message };
      return;
    }

    await tx
      .update(datasetImports)
      .set({ status: decision.importStatus, completedAt: now, errorMessage: decision.errorMessage })
      .where(and(eq(datasetImports.id, jobId), eq(datasetImports.status, "in_progress")));
    await tx
      .update(datasets)
      .set({ status: decision.datasetStatus, updatedAt: now })
      .where(and(eq(datasets.id, job.datasetId), eq(datasets.status, "importing")));

    result.recovered = { datasetId: job.datasetId, importId: job.id, status: decision.importStatus };
  });

  if (result.notFound) return NextResponse.json({ error: "IMPORT_JOB_NOT_FOUND" }, { status: 404 });
  if (result.blocked) return blockedResponse(result.blocked.code, result.blocked.message);
  if (!result.recovered) return blockedResponse("IMPORT_RECOVERY_CONFLICT", "Import job recovery did not complete.");

  return NextResponse.json({ ok: true, ...result.recovered });
});
