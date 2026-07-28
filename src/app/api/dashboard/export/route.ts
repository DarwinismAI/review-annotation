// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, expertProfiles, rubricCriteria, profiles } from "@/db/schema";
import { reviews, reviewScores } from "@/db/reviews";
import { timeEvents } from "@/db/time-events";

/**
 * GET /api/dashboard/export
 * Streams a CSV file containing all review data for admin export.
 * Role: admin
 *
 * Columns: article_title, expert_name, domain, [criterion_N_score...],
 *          total_score, reading_time_min, scoring_time_min, total_time_min,
 *          pay_rate, status, completed_at
 */
export const GET = requireAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const batchFilter = batchId ? eq(articles.batchId, batchId) : undefined;

  // ── Load all completed assignments with article + expert info ────────────────
  const assignmentRows = await db
    .select({
      assignmentId: assignments.id,
      assignmentStatus: assignments.status,
      payRate: assignments.payRate,
      completedAt: assignments.completedAt,
      articleId: articles.id,
      articleTitle: articles.title,
      expertId: profiles.id,
      expertName: profiles.name,
    })
    .from(assignments)
    .innerJoin(articles, eq(assignments.articleId, articles.id))
    .innerJoin(profiles, eq(assignments.expertId, profiles.id))
    .where(batchFilter);

  if (assignmentRows.length === 0) {
    const csv = "Không có dữ liệu để xuất.\n";
    return csvResponse(csv);
  }

  // ── Load review scores ────────────────────────────────────────────────────────
  const articleIds = [...new Set(assignmentRows.map((r) => r.articleId))];
  const reviewRows =
    articleIds.length > 0
      ? await db
          .select({
            reviewId: reviews.id,
            articleId: reviews.articleId,
            expertId: reviews.expertId,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.status, "completed"),
              inArray(reviews.articleId, articleIds)
            )
          )
      : [];

  // Map articleId+expertId → reviewId
  const reviewKey = (articleId: string, expertId: string) => `${articleId}::${expertId}`;
  const reviewIdMap = new Map<string, string>();
  for (const r of reviewRows) {
    reviewIdMap.set(reviewKey(r.articleId, r.expertId), r.reviewId);
  }

  // Load all scores
  const allScores = await db
    .select({
      reviewId: reviewScores.reviewId,
      criterionId: reviewScores.criterionId,
      score: reviewScores.score,
    })
    .from(reviewScores);

  // Map reviewId → Map<criterionId, score>
  const scoresByReview = new Map<string, Map<string, number>>();
  for (const s of allScores) {
    let criteriaMap = scoresByReview.get(s.reviewId);
    if (!criteriaMap) {
      criteriaMap = new Map();
      scoresByReview.set(s.reviewId, criteriaMap);
    }
    criteriaMap.set(s.criterionId, s.score);
  }

  // ── Load all rubric criteria (for column headers) ────────────────────────────
  const allCriteria = await db
    .select({
      id: rubricCriteria.id,
      name: rubricCriteria.name,
      rubricId: rubricCriteria.rubricId,
      sortOrder: rubricCriteria.sortOrder,
    })
    .from(rubricCriteria)
    .orderBy(rubricCriteria.rubricId, rubricCriteria.sortOrder);

  // Deduplicate criteria by id for column order
  const criteriaOrder = allCriteria;

  // ── Load time events for all relevant assignments ────────────────────────────
  const assignmentIds = assignmentRows.map((r) => r.assignmentId);
  const timeEventRows = await db
    .select({
      assignmentId: timeEvents.assignmentId,
      eventType: timeEvents.eventType,
      timestamp: timeEvents.timestamp,
    })
    .from(timeEvents)
    .orderBy(timeEvents.assignmentId, timeEvents.timestamp);

  const timeMap = computeTimesPerAssignment(
    timeEventRows.filter((e) => assignmentIds.includes(e.assignmentId))
  );

  // ── Build CSV ─────────────────────────────────────────────────────────────────
  const criteriaHeaders = criteriaOrder.map((_, i) => `criterion_${i + 1}_score`);
  const headers = [
    "article_title",
    "expert_name",
    "domain",
    ...criteriaHeaders,
    "total_score",
    "reading_time_min",
    "scoring_time_min",
    "total_time_min",
    "pay_rate",
    "status",
    "completed_at",
  ];

  const lines: string[] = [headers.join(",")];

  // Load expert profiles for domain lookup
  const profileDomains = await db
    .select({ userId: expertProfiles.userId, domain: expertProfiles.domain })
    .from(expertProfiles);
  const domainByUserId = new Map(profileDomains.map((p) => [p.userId, p.domain]));

  for (const row of assignmentRows) {
    const reviewId = reviewIdMap.get(reviewKey(row.articleId, row.expertId)) ?? null;
    const scoreMap = reviewId ? (scoresByReview.get(reviewId) ?? new Map()) : new Map();

    const criterionScores = criteriaOrder.map((c) => {
      const s = scoreMap.get(c.id);
      return s !== undefined ? String(s) : "";
    });

    const totalScore = criterionScores
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0)
      .reduce((a, b) => a + b, 0);

    const times = timeMap.get(row.assignmentId) ?? {
      readingMs: 0,
      scoringMs: 0,
      totalMs: 0,
    };

    const completedAt = row.completedAt
      ? new Date(row.completedAt).toISOString()
      : "";

    const cells = [
      csvEscape(row.articleTitle),
      csvEscape(row.expertName ?? ""),
      csvEscape(domainByUserId.get(row.expertId) ?? ""),
      ...criterionScores,
      String(totalScore),
      String(Math.round(times.readingMs / 60_000)),
      String(Math.round(times.scoringMs / 60_000)),
      String(Math.round(times.totalMs / 60_000)),
      String(row.payRate),
      csvEscape(row.assignmentStatus),
      csvEscape(completedAt),
    ];

    lines.push(cells.join(","));
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `export-${date}.csv`;
  return csvResponse(lines.join("\n"), filename);
});

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvResponse(body: string, filename = "export.csv"): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

interface TimeRow {
  assignmentId: string;
  eventType: string;
  timestamp: Date | null;
}

interface TimeSplit {
  readingMs: number;
  scoringMs: number;
  totalMs: number;
}

/** Compute reading/scoring/total ms per assignmentId from time events. */
function computeTimesPerAssignment(rows: TimeRow[]): Map<string, TimeSplit> {
  const grouped = new Map<string, TimeRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.assignmentId) ?? [];
    list.push(row);
    grouped.set(row.assignmentId, list);
  }

  const result = new Map<string, TimeSplit>();

  for (const [assignmentId, events] of grouped) {
    let readingMs = 0;
    let scoringMs = 0;
    let lastStart: { ts: number; type: "reading" | "scoring" } | null = null;

    for (const ev of events) {
      const ts = ev.timestamp instanceof Date ? ev.timestamp.getTime() : Number(ev.timestamp);

      if (ev.eventType === "reading_start") {
        lastStart = { ts, type: "reading" };
      } else if (ev.eventType === "scoring_start") {
        lastStart = { ts, type: "scoring" };
      } else if (
        (ev.eventType === "reading_pause" ||
          ev.eventType === "scoring_pause" ||
          ev.eventType === "tab_hidden") &&
        lastStart !== null
      ) {
        const duration = ts - lastStart.ts;
        if (lastStart.type === "reading") readingMs += duration;
        else scoringMs += duration;
        lastStart = null;
      } else if (ev.eventType === "tab_visible" && lastStart === null) {
        // Resume — treat as same type as last known context; skip for simplicity.
      }
    }

    result.set(assignmentId, {
      readingMs,
      scoringMs,
      totalMs: readingMs + scoringMs,
    });
  }

  return result;
}
