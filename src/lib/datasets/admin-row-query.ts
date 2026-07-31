import { sql, type SQL } from "drizzle-orm";

export type CompletionFilter = "all" | "complete" | "incomplete";

export interface DatasetRowFilters {
  search: string;
  completion: CompletionFilter;
}

export interface RowProgressCounts {
  completedCount: number;
  targetOverlap: number;
}

export function normalizeDatasetRowFilters(searchParams: URLSearchParams): DatasetRowFilters {
  const search = (searchParams.get("q") ?? searchParams.get("search") ?? "").trim().toLowerCase();
  const completion = searchParams.get("completion");

  if (completion === "complete" || completion === "completed") return { search, completion: "complete" };
  if (completion === "incomplete") return { search, completion };
  return { search, completion: "all" };
}

export function isRowComplete(row: RowProgressCounts): boolean {
  return row.targetOverlap > 0 && row.completedCount >= row.targetOverlap;
}

export function buildCompletionPredicate(completion: CompletionFilter): string {
  if (completion === "complete") return "completed_count >= target_overlap AND target_overlap > 0";
  if (completion === "incomplete") return "completed_count < target_overlap";
  return "1 = 1";
}

export function buildCompletionSql(completion: CompletionFilter): SQL {
  if (completion === "complete") {
    return sql`and coalesce(ap.completed_count, 0) >= coalesce(ap.target_overlap, 0) and coalesce(ap.target_overlap, 0) > 0`;
  }
  if (completion === "incomplete") {
    return sql`and coalesce(ap.completed_count, 0) < coalesce(ap.target_overlap, 0)`;
  }
  return sql``;
}

export function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
