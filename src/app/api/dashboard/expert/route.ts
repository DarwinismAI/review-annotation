// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, batches } from "@/db/schema";
import { timeEvents } from "@/db/time-events";

/**
 * GET /api/dashboard/expert
 * - expert role: returns only the caller's assignments.
 * - admin role: returns a system-wide, read-only preview of every article
 *   (powers the "Xem góc nhìn Chuyên gia" toggle in the admin sidebar).
 */
export const GET = requireAuth(async (req: NextRequest, session) => {
  if (session.user.role === "admin") {
    return adminPreview();
  }

  const expertId = session.user.id;

  // ── All assignments for this expert ──────────────────────────────────────────
  const rows = await db
    .select({
      assignmentId: assignments.id,
      assignmentStatus: assignments.status,
      payRate: assignments.payRate,
      articleId: articles.id,
      articleTitle: articles.title,
      articleStatus: articles.status,
    })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .where(eq(assignments.expertId, expertId))
    .orderBy(desc(assignments.assignedAt));

  // ── Time events for this expert (to compute per-article time) ────────────────
  const eventRows = await db
    .select({
      assignmentId: timeEvents.assignmentId,
      articleId: timeEvents.articleId,
      eventType: timeEvents.eventType,
      timestamp: timeEvents.timestamp,
    })
    .from(timeEvents)
    .where(eq(timeEvents.expertId, expertId))
    .orderBy(timeEvents.assignmentId, timeEvents.timestamp);

  const timeByAssignment = computeTimeByAssignment(eventRows);

  // ── Aggregate stats ──────────────────────────────────────────────────────────
  const assigned = rows.length;
  const completed = rows.filter((r) => r.assignmentStatus === "completed").length;
  const remaining = assigned - completed;

  const totalEarnings = rows
    .filter((r) => r.assignmentStatus === "completed")
    .reduce((sum, r) => sum + r.payRate, 0);

  // avgTimeMinutes across assignments that have recorded time
  const times = [...timeByAssignment.values()].filter((t) => t > 0);
  const avgTimeMinutes =
    times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 60_000) : 0;

  // ── Per-article list ─────────────────────────────────────────────────────────
  const articlesList = rows.map((r) => {
    const rawMs = timeByAssignment.get(r.assignmentId) ?? 0;
    const timeSpentMinutes = rawMs > 0 ? Math.round(rawMs / 60_000) : null;
    return {
      id: r.articleId,
      title: r.articleTitle,
      status: r.assignmentStatus as "completed" | "in_review" | "assigned",
      payRate: r.payRate,
      timeSpentMinutes,
    };
  });

  return NextResponse.json({
    data: {
      assigned,
      completed,
      remaining,
      totalEarnings,
      avgTimeMinutes,
      articles: articlesList,
    },
  });
});

interface TimeEventRow {
  assignmentId: string;
  articleId: string;
  eventType: string;
  timestamp: Date | null;
}

/** Returns map of assignmentId → total active milliseconds. */
function computeTimeByAssignment(rows: TimeEventRow[]): Map<string, number> {
  // Group by assignmentId
  const grouped = new Map<string, TimeEventRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.assignmentId) ?? [];
    list.push(row);
    grouped.set(row.assignmentId, list);
  }

  const result = new Map<string, number>();

  for (const [assignmentId, events] of grouped) {
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

    result.set(assignmentId, activeMs);
  }

  return result;
}

/**
 * Admin preview: return every article in the system with batch-level payRate.
 * Status mirrors the article row (can include "unassigned"); no time tracking
 * since there's no specific assignment to attribute it to.
 */
async function adminPreview() {
  const rows = await db
    .select({
      articleId: articles.id,
      articleTitle: articles.title,
      articleType: articles.type,
      articleStatus: articles.status,
      payRate: batches.payRatePerArticle,
    })
    .from(articles)
    .innerJoin(batches, eq(articles.batchId, batches.id))
    .orderBy(desc(articles.createdAt));

  const articlesList = rows.map((r) => ({
    id: r.articleId,
    title: r.articleTitle,
    type: r.articleType as "full" | "paragraph",
    status: r.articleStatus as "unassigned" | "assigned" | "in_review" | "completed",
    payRate: r.payRate,
    timeSpentMinutes: null,
  }));

  const assigned = articlesList.length;
  const completed = articlesList.filter((a) => a.status === "completed").length;
  const remaining = assigned - completed;
  const totalEarnings = articlesList
    .filter((a) => a.status === "completed")
    .reduce((sum, a) => sum + a.payRate, 0);

  return NextResponse.json({
    data: {
      assigned,
      completed,
      remaining,
      totalEarnings,
      avgTimeMinutes: 0,
      articles: articlesList,
      preview: true,
    },
  });
}
