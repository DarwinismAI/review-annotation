import { NextRequest, NextResponse } from "next/server";
import { eq, and, count, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, expertDomains, expertProfiles, profiles } from "@/db/schema";
import { reviewScores, reviews } from "@/db/reviews";
import { timeEvents } from "@/db/time-events";

/**
 * GET /api/dashboard/admin/annotators
 * Returns per-expert stats for admin dashboard table.
 * Role: admin
 */
export const GET = requireAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const batchFilter = batchId ? eq(articles.batchId, batchId) : undefined;
  const completedReviewFilter = batchFilter
    ? and(batchFilter, eq(reviews.status, "completed"))
    : eq(reviews.status, "completed");

  // ── Per-expert assignment counts ─────────────────────────────────────────────
  const assignmentStats = (await db
    .select({
      expertId: assignments.expertId,
      articlesAssigned: count(assignments.id),
      articlesCompleted: sql<number>`SUM(CASE WHEN ${assignments.status} = 'completed' THEN 1 ELSE 0 END)`,
      totalPay: sql<number>`SUM(CASE WHEN ${assignments.status} = 'completed' THEN ${assignments.payRate} ELSE 0 END)`,
    })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .where(batchFilter)
    .groupBy(assignments.expertId)) as AssignmentStatRow[];

  // ── Per-expert average total score ───────────────────────────────────────────
  // The dashboard should match the export: first sum rubric criteria per completed
  // review, then average those review totals per expert. Averaging raw criterion
  // rows would turn a 15-point rubric into a misleading 1–5 score.
  const scoreRows = (await db
    .select({
      reviewId: reviews.id,
      expertId: reviews.expertId,
      score: reviewScores.score,
    })
    .from(reviewScores)
    .innerJoin(reviews, eq(reviewScores.reviewId, reviews.id))
    .innerJoin(articles, eq(reviews.articleId, articles.id))
    .where(completedReviewFilter)) as ExpertScoreRow[];

  const scoreByExpert = computeAvgTotalScoreByExpert(scoreRows);

  // ── Per-expert average review time ───────────────────────────────────────────
  const eventRows = (await db
    .select({
      expertId: timeEvents.expertId,
      assignmentId: timeEvents.assignmentId,
      eventType: timeEvents.eventType,
      timestamp: timeEvents.timestamp,
    })
    .from(timeEvents)
    .innerJoin(articles, eq(timeEvents.articleId, articles.id))
    .where(batchFilter)
    .orderBy(timeEvents.expertId, timeEvents.assignmentId, timeEvents.timestamp)) as ExpertTimeEventRow[];

  const avgTimeByExpert = computeAvgTimeByExpert(eventRows);

  // ── Expert profile + user info ───────────────────────────────────────────────
  const expertIds = assignmentStats.map((r) => r.expertId);
  if (expertIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const expertInfoRows = (await db
    .select({
      userId: profiles.id,
      name: profiles.name,
      domain: expertProfiles.domain,
    })
    .from(profiles)
    .innerJoin(expertProfiles, eq(expertProfiles.userId, profiles.id))
    .where(inArray(profiles.id, expertIds))) as ExpertInfoRow[];

  const expertDomainRows = (await db
    .select({
      userId: expertDomains.userId,
      domain: expertDomains.domain,
    })
    .from(expertDomains)
    .where(inArray(expertDomains.userId, expertIds))) as ExpertDomainRow[];

  const profileByUserId = new Map(expertInfoRows.map((p) => [p.userId, p]));
  const domainsByUserId = new Map<string, string[]>();
  for (const row of expertDomainRows) {
    const domains = domainsByUserId.get(row.userId) ?? [];
    domains.push(row.domain);
    domainsByUserId.set(row.userId, domains);
  }

  // ── Merge ────────────────────────────────────────────────────────────────────
  const data = assignmentStats.map((stat) => {
    const profile = profileByUserId.get(stat.expertId);
    const domains = domainsByUserId.get(stat.expertId) ?? (profile?.domain ? [profile.domain] : []);
    return {
      expertId: stat.expertId,
      name: profile?.name ?? "—",
      domain: profile?.domain ?? "—",
      domains,
      articlesAssigned: stat.articlesAssigned,
      articlesCompleted: Number(stat.articlesCompleted),
      avgScore: Number((scoreByExpert.get(stat.expertId) ?? 0).toFixed(1)),
      avgTimeMinutes: avgTimeByExpert.get(stat.expertId) ?? 0,
      totalPay: Number(stat.totalPay),
    };
  });

  return NextResponse.json({ data });
});

interface AssignmentStatRow {
  expertId: string;
  articlesAssigned: number;
  articlesCompleted: number;
  totalPay: number | string | null;
}

interface ExpertInfoRow {
  userId: string;
  name: string | null;
  domain: string;
}

interface ExpertDomainRow {
  userId: string;
  domain: string;
}

interface ExpertScoreRow {
  reviewId: string;
  expertId: string;
  score: number;
}

function computeAvgTotalScoreByExpert(rows: ExpertScoreRow[]): Map<string, number> {
  const reviewTotals = new Map<string, { expertId: string; total: number }>();

  for (const row of rows) {
    const current = reviewTotals.get(row.reviewId) ?? { expertId: row.expertId, total: 0 };
    current.total += Number(row.score ?? 0);
    reviewTotals.set(row.reviewId, current);
  }

  const byExpert = new Map<string, { total: number; count: number }>();
  for (const review of reviewTotals.values()) {
    const current = byExpert.get(review.expertId) ?? { total: 0, count: 0 };
    current.total += review.total;
    current.count += 1;
    byExpert.set(review.expertId, current);
  }

  const result = new Map<string, number>();
  for (const [expertId, stat] of byExpert) {
    result.set(expertId, stat.count > 0 ? stat.total / stat.count : 0);
  }
  return result;
}

interface ExpertTimeEventRow {
  expertId: string;
  assignmentId: string;
  eventType: string;
  timestamp: Date | null;
}

/** Returns map of expertId → avg review time in minutes. */
function computeAvgTimeByExpert(rows: ExpertTimeEventRow[]): Map<string, number> {
  // Group by expertId → assignmentId → events
  const byExpert = new Map<string, Map<string, ExpertTimeEventRow[]>>();

  for (const row of rows) {
    let assignments = byExpert.get(row.expertId);
    if (!assignments) {
      assignments = new Map();
      byExpert.set(row.expertId, assignments);
    }
    const events = assignments.get(row.assignmentId) ?? [];
    events.push(row);
    assignments.set(row.assignmentId, events);
  }

  const result = new Map<string, number>();

  for (const [expertId, assignmentMap] of byExpert) {
    let totalMs = 0;
    let assignmentCount = 0;

    for (const [, events] of assignmentMap) {
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
        assignmentCount++;
      }
    }

    const avgMinutes = assignmentCount > 0 ? Math.round(totalMs / assignmentCount / 60_000) : 0;
    result.set(expertId, avgMinutes);
  }

  return result;
}
