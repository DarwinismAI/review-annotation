import { count, eq, inArray, sql } from "drizzle-orm";
import { annotationAssignments, annotationMetrics, datasets } from "@/db/datasets";

type TaskGroupRow = {
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  metricIds: string[];
  status: string;
  totalCount: number;
  skippedCount: number;
  assignedAt: Date | string;
  metricLabels?: unknown;
};

type TaskGroupSummary = {
  assignmentRunId: string;
  datasetId: string;
  datasetName: string;
  metricIds: string[];
  totalCount: number;
  submittedCount: number;
  skippedCount: number;
  startedCount: number;
  assignedAt: string;
  metricLabels: string[];
};

export type TaskGroupsPayload = {
  taskGroups: Array<{
    id: string;
    assignmentRunId: string;
    datasetId: string;
    datasetName: string;
    metricLabels: string[];
    totalCount: number;
    submittedCount: number;
    remainingCount: number;
    skippedCount: number;
    status: "completed" | "in_progress" | "not_started";
    assignedAt: string;
  }>;
};

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizeMetricLabels(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function labelsForMetricIds(metricIds: string[], labelsById: Map<string, string>): string[] {
  return metricIds.map((metricId) => labelsById.get(metricId)).filter((label): label is string => Boolean(label));
}

export function projectTaskGroups(groupRows: TaskGroupRow[], labelsById = new Map<string, string>()): TaskGroupsPayload {
  const groups = new Map<string, TaskGroupSummary>();
  for (const row of groupRows) {
    const existing = groups.get(row.assignmentRunId);
    const total = Number(row.totalCount);
    const submitted = row.status === "completed" ? total : 0;
    const started = row.status === "completed" || row.status === "in_progress" ? total : 0;
    const assignedAt = toIso(row.assignedAt);
    const metricLabels = row.metricLabels === undefined
      ? labelsForMetricIds(row.metricIds, labelsById)
      : normalizeMetricLabels(row.metricLabels);
    if (!existing) {
      groups.set(row.assignmentRunId, {
        assignmentRunId: row.assignmentRunId,
        datasetId: row.datasetId,
        datasetName: row.datasetName,
        metricIds: row.metricIds,
        totalCount: total,
        submittedCount: submitted,
        skippedCount: Number(row.skippedCount),
        startedCount: started,
        assignedAt,
        metricLabels,
      });
      continue;
    }
    existing.totalCount += total;
    existing.submittedCount += submitted;
    existing.skippedCount += Number(row.skippedCount);
    existing.startedCount += started;
    if (assignedAt < existing.assignedAt) existing.assignedAt = assignedAt;
    if (existing.metricLabels.length === 0) existing.metricLabels = metricLabels;
  }

  return {
    taskGroups: [...groups.values()].sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)).map((group) => ({
      id: group.assignmentRunId,
      assignmentRunId: group.assignmentRunId,
      datasetId: group.datasetId,
      datasetName: group.datasetName,
      metricLabels: group.metricLabels,
      totalCount: group.totalCount,
      submittedCount: group.submittedCount,
      remainingCount: group.totalCount - group.submittedCount,
      skippedCount: group.skippedCount,
      status: group.totalCount === group.submittedCount ? "completed" : group.startedCount > 0 ? "in_progress" : "not_started",
      assignedAt: group.assignedAt,
    })),
  };
}

async function queryGroupedRows(db: any, annotatorId: string): Promise<TaskGroupRow[]> {
  return await db
    .select({
      assignmentRunId: annotationAssignments.assignmentRunId,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      metricIds: annotationAssignments.metricIds,
      metricKey: annotationAssignments.metricKey,
      status: annotationAssignments.status,
      totalCount: count(),
      skippedCount: sql<number>`sum(case when ${annotationAssignments.status} <> 'completed' and ${annotationAssignments.skippedAt} is not null then 1 else 0 end)`,
      assignedAt: sql<Date | string>`min(${annotationAssignments.assignedAt})`,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .where(eq(annotationAssignments.annotatorId, annotatorId))
    .groupBy(
      annotationAssignments.assignmentRunId,
      annotationAssignments.datasetId,
      datasets.name,
      annotationAssignments.metricIds,
      annotationAssignments.metricKey,
      annotationAssignments.status,
    )
    .orderBy(sql`min(${annotationAssignments.assignedAt})`);
}

async function queryPostgresGroupedRows(db: any, annotatorId: string): Promise<TaskGroupRow[]> {
  return await db
    .select({
      assignmentRunId: annotationAssignments.assignmentRunId,
      datasetId: annotationAssignments.datasetId,
      datasetName: datasets.name,
      metricIds: annotationAssignments.metricIds,
      metricKey: annotationAssignments.metricKey,
      status: annotationAssignments.status,
      totalCount: count(),
      skippedCount: sql<number>`sum(case when ${annotationAssignments.status} <> 'completed' and ${annotationAssignments.skippedAt} is not null then 1 else 0 end)`,
      assignedAt: sql<Date | string>`min(${annotationAssignments.assignedAt})`,
      metricLabels: sql<unknown>`coalesce((
        select jsonb_agg(am.label order by metric_item.ordinality)
        from jsonb_array_elements_text(${annotationAssignments.metricIds}) with ordinality as metric_item(metric_id, ordinality)
        inner join annotation_metrics am on am.id = metric_item.metric_id
      ), '[]'::jsonb)`,
    })
    .from(annotationAssignments)
    .innerJoin(datasets, eq(annotationAssignments.datasetId, datasets.id))
    .where(eq(annotationAssignments.annotatorId, annotatorId))
    .groupBy(
      annotationAssignments.assignmentRunId,
      annotationAssignments.datasetId,
      datasets.name,
      annotationAssignments.metricIds,
      annotationAssignments.metricKey,
      annotationAssignments.status,
    )
    .orderBy(sql`min(${annotationAssignments.assignedAt})`);
}

async function queryMetricLabels(db: any, groupRows: TaskGroupRow[]): Promise<Map<string, string>> {
  const allMetricIds = Array.from(new Set(groupRows.flatMap((group) => group.metricIds)));
  const metrics =
    allMetricIds.length > 0
      ? await db.select({ id: annotationMetrics.id, label: annotationMetrics.label }).from(annotationMetrics).where(inArray(annotationMetrics.id, allMetricIds))
      : [];
  return new Map(metrics.map((metric: any) => [metric.id, metric.label]));
}

export async function listTaskGroupsForAnnotator(
  db: any,
  annotatorId: string,
  { isSqlite = Boolean(process.env.LOCAL_DB_PATH) }: { isSqlite?: boolean } = {},
): Promise<TaskGroupsPayload> {
  if (!isSqlite) return projectTaskGroups(await queryPostgresGroupedRows(db, annotatorId));

  const groupRows = await queryGroupedRows(db, annotatorId);
  return projectTaskGroups(groupRows, await queryMetricLabels(db, groupRows));
}
