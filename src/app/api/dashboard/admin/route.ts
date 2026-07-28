// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, count, sum } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, batches } from "@/db/schema";
import { reviews } from "@/db/reviews";
import { timeEvents } from "@/db/time-events";

/**
 * GET /api/dashboard/admin
 * Returns aggregate stats for all batches or a specific batch.
 * Role: admin
 */
export const GET = requireAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const batchFilter = batchId ? eq(articles.batchId, batchId) : undefined;

  // ── Article counts by status ────────────────────────────────────────────────
  const statusCounts = await db
    .select({ status: articles.status, cnt: count() })
    .from(articles)
    .where(batchFilter)
    .groupBy(articles.status);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.status] = row.cnt;

  const totalArticles =
    (byStatus["unassigned"] ?? 0) +
    (byStatus["assigned"] ?? 0) +
    (byStatus["in_review"] ?? 0) +
    (byStatus["completed"] ?? 0);

  const completed = byStatus["completed"] ?? 0;
  const inReview = byStatus["in_review"] ?? 0;
  const unassigned = byStatus["unassigned"] ?? 0;

  // ── Overdue: assignments with no completed_at older than 7 days ─────────────
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const overdueRows = await db
    .select({ cnt: count() })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .where(
      and(
        batchFilter,
        sql`${assignments.status} != 'completed'`,
        sql`${assignments.assignedAt} < ${sevenDaysAgo}`
      )
    );
  const overdue = overdueRows[0]?.cnt ?? 0;

  // ── Cost estimates ───────────────────────────────────────────────────────────
  // totalCostEstimate = sum of pay_rate_per_article for all articles in scope
  const batchRates = await db
    .select({
      payRatePerArticle: batches.payRatePerArticle,
      cnt: count(articles.id),
    })
    .from(articles)
    .innerJoin(batches, eq(articles.batchId, batches.id))
    .where(batchFilter)
    .groupBy(batches.id, batches.payRatePerArticle);

  let totalCostEstimate = 0;
  for (const row of batchRates) {
    totalCostEstimate += row.payRatePerArticle * row.cnt;
  }

  // totalCostActual = sum of pay_rate on completed assignments
  const actualCostRows = await db
    .select({ total: sum(assignments.payRate) })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .where(
      and(batchFilter, eq(assignments.status, "completed"))
    );
  const totalCostActual = Number(actualCostRows[0]?.total ?? 0);

  // ── Average review time ──────────────────────────────────────────────────────
  // Compute per-assignment total active time from time_events pairs, then average.
  // Using SQL to aggregate: sum durations between start/pause pairs grouped by assignment.
  // Simplified approach: fetch all events, compute in JS.
  const eventRows = await db
    .select({
      assignmentId: timeEvents.assignmentId,
      eventType: timeEvents.eventType,
      timestamp: timeEvents.timestamp,
    })
    .from(timeEvents)
    .innerJoin(articles, eq(timeEvents.articleId, articles.id))
    .where(batchFilter)
    .orderBy(timeEvents.assignmentId, timeEvents.timestamp);

  const avgReviewTimeMinutes = computeAvgReviewTime(eventRows);

  return NextResponse.json({
    data: {
      totalArticles,
      completed,
      inReview,
      unassigned,
      overdue,
      totalCostEstimate,
      totalCostActual,
      avgReviewTimeMinutes,
    },
  });
});

interface TimeEventRow {
  assignmentId: string;
  eventType: string;
  timestamp: Date | null;
}

/**
 * Compute average review time in minutes across all assignments.
 * Pairs reading_start/reading_pause and scoring_start/scoring_pause events.
 * tab_hidden acts as an implicit pause for both.
 */
function computeAvgReviewTime(rows: TimeEventRow[]): number {
  // Group events by assignmentId
  const byAssignment = new Map<string, TimeEventRow[]>();
  for (const row of rows) {
    const list = byAssignment.get(row.assignmentId) ?? [];
    list.push(row);
    byAssignment.set(row.assignmentId, list);
  }

  let totalMs = 0;
  let count = 0;

  for (const [, events] of byAssignment) {
    let activeMs = 0;
    let lastStart: number | null = null;

    for (const ev of events) {
      const ts = ev.timestamp instanceof Date ? ev.timestamp.getTime() : Number(ev.timestamp);
      const isStart =
        ev.eventType === "reading_start" ||
        ev.eventType === "scoring_start" ||
        ev.eventType === "tab_visible";
      const isPause =
        ev.eventType === "reading_pause" ||
        ev.eventType === "scoring_pause" ||
        ev.eventType === "tab_hidden";

      if (isStart) {
        lastStart = ts;
      } else if (isPause && lastStart !== null) {
        activeMs += ts - lastStart;
        lastStart = null;
      }
    }

    if (activeMs > 0) {
      totalMs += activeMs;
      count++;
    }
  }

  if (count === 0) return 0;
  return Math.round(totalMs / count / 60_000);
}
