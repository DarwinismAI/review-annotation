import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireAdminRead } from "@/lib/auth-middleware";
import { rowsFromResult } from "@/lib/datasets/admin-row-query";

type DashboardSnapshotRow = {
  datasetCount: number | string;
  rowTotal: number | string;
  metricTotal: number | string;
  readyDatasets: number | string;
  importingDatasets: number | string;
};

type ActiveAnnotatorsRow = {
  activeAnnotators: number | string;
};

type RecentDatasetRow = {
  id: string | null;
  name: string | null;
  domain: string | null;
  status: string | null;
  createdAt: Date | string | null;
  rowCount: number | string | null;
  metricCount: number | string | null;
  latestImport: string | null;
};

export const GET = requireAdminRead(async (req, _claims, context) => {
  const { searchParams } = new URL(req.url);
  const pageSize = Math.min(Math.max(Number(searchParams.get("pageSize") ?? 5) || 5, 1), 20);
  const bootstrapSuperadminEmails = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const bootstrapSuperadminExclusion =
    bootstrapSuperadminEmails.length > 0
      ? sql`and lower(p.email) not in (${sql.join(bootstrapSuperadminEmails.map((email) => sql`${email}`), sql`, `)})`
      : sql``;

  const queryDatasetTotals = async () =>
    await db.execute(sql`
      with dataset_status_totals as (
        select
          count(*) as dataset_count,
          coalesce(sum(case when status = 'ready' then 1 else 0 end), 0) as ready_datasets,
          coalesce(sum(case when status = 'importing' then 1 else 0 end), 0) as importing_datasets
        from datasets
      ),
      totals as (
        select
          dst.dataset_count as dataset_count,
          (select count(*) from dataset_rows) as row_total,
          (select count(*) from annotation_metrics) as metric_total,
          dst.ready_datasets as ready_datasets,
          dst.importing_datasets as importing_datasets
        from dataset_status_totals dst
      )
      select
        dataset_count as "datasetCount",
        row_total as "rowTotal",
        metric_total as "metricTotal",
        ready_datasets as "readyDatasets",
        importing_datasets as "importingDatasets"
      from totals
    `);

  const queryActiveAnnotators = async () =>
    await db.execute(sql`
      select count(*) as "activeAnnotators"
      from profiles p
      where p.role in ('annotator', 'expert')
      ${bootstrapSuperadminExclusion}
      and exists (
        select 1
        from expert_profiles ep
        where ep.user_id = p.id and ep.status = 'active'
      )
    `);

  const queryRecentDatasets = async () =>
    await db.execute(sql`
      with
      recent_datasets as (
        select id, name, domain, status, created_at
        from datasets
        order by created_at desc, id desc
        limit ${pageSize}
      ),
      page_row_counts as (
        select dataset_id, count(*) as total
        from dataset_rows
        where dataset_id in (select id from recent_datasets)
        group by dataset_id
      ),
      page_metric_counts as (
        select dataset_id, count(*) as total
        from annotation_metrics
        where dataset_id in (select id from recent_datasets)
        group by dataset_id
      ),
      latest_imports as (
        select dataset_id, source_filename
        from (
          select dataset_id, source_filename, row_number() over (partition by dataset_id order by created_at desc, id desc) as rank
          from dataset_imports
          where dataset_id in (select id from recent_datasets)
        ) ranked_imports
        where rank = 1
      )
      select
        rd.id,
        rd.name,
        rd.domain,
        rd.status,
        rd.created_at as "createdAt",
        coalesce(prc.total, 0) as "rowCount",
        coalesce(pmc.total, 0) as "metricCount",
        li.source_filename as "latestImport"
      from recent_datasets rd
      left join page_row_counts prc on prc.dataset_id = rd.id
      left join page_metric_counts pmc on pmc.dataset_id = rd.id
      left join latest_imports li on li.dataset_id = rd.id
    `);

  // Dashboard-only read model: totals, active annotators, and recent rows can come from concurrent snapshots;
  // no write path or mutation decision depends on these display aggregates.
  const [datasetTotalsResult, activeAnnotatorsResult, recentDatasetsResult] = await context.timing.measure("sql", () =>
    Promise.all([
      queryDatasetTotals(),
      queryActiveAnnotators(),
      queryRecentDatasets(),
    ]),
  );
  const totals = rowsFromResult<DashboardSnapshotRow>(datasetTotalsResult)[0];
  const activeAnnotators = rowsFromResult<ActiveAnnotatorsRow>(activeAnnotatorsResult)[0];
  const recentDatasets = rowsFromResult<RecentDatasetRow>(recentDatasetsResult);

  return NextResponse.json({
    totals: {
      datasets: Number(totals?.datasetCount ?? 0),
      rows: Number(totals?.rowTotal ?? 0),
      metrics: Number(totals?.metricTotal ?? 0),
      readyDatasets: Number(totals?.readyDatasets ?? 0),
      importingDatasets: Number(totals?.importingDatasets ?? 0),
      activeAnnotators: Number(activeAnnotators?.activeAnnotators ?? 0),
    },
    recentDatasets: recentDatasets
      .filter((dataset) => dataset.id)
      .map((dataset) => ({
        id: dataset.id,
        name: dataset.name,
        domain: dataset.domain,
        status: dataset.status,
        rowCount: Number(dataset.rowCount ?? 0),
        metricCount: Number(dataset.metricCount ?? 0),
        latestImport: dataset.latestImport ?? null,
        createdAt: dataset.createdAt,
      })),
  });
});
