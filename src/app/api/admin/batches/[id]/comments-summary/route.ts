// @ts-nocheck
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, articleComments, claimRatings, batches } from "@/db/schema";
import { eq, count, inArray } from "drizzle-orm";

/**
 * GET /api/admin/batches/[id]/comments-summary
 *
 * Admin-only. Aggregates comment + claim verdict stats for a batch:
 * - totalComments, totalRatings
 * - correctRatio, incorrectRatio, unsureRatio
 * - Articles that contain inline comments, so admin UI can open them directly
 * - Top 5 articles by unsureRatio
 */
export const GET = requireAdmin(async (_req, _session, context) => {
  const batchId = context?.params?.id;
  if (!batchId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID đợt" } },
      { status: 400 }
    );
  }

  // Verify batch exists
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.id, batchId));

  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy đợt upload" } },
      { status: 404 }
    );
  }

  // Fetch all article IDs in this batch
  const articleRows = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(eq(articles.batchId, batchId));

  const articleIds = articleRows.map((r) => r.id);
  const articleTitleMap = new Map(articleRows.map((r) => [r.id, r.title]));

  if (articleIds.length === 0) {
    return NextResponse.json({
      data: {
        totalComments: 0,
        totalRatings: 0,
        correctRatio: 0,
        incorrectRatio: 0,
        unsureRatio: 0,
        commentedArticles: [],
        topUnsureArticles: [],
      },
    });
  }

  // Get assignment IDs for articles in this batch
  const assignmentRows = await db
    .select({ id: assignments.id, articleId: assignments.articleId })
    .from(assignments)
    .where(inArray(assignments.articleId, articleIds));

  const assignmentIds = assignmentRows.map((r) => r.id);
  const assignmentArticleMap = new Map(assignmentRows.map((r) => [r.id, r.articleId]));

  // Total comments in batch + article-level rollup for UI navigation.
  // Use article_id directly because comments already carry it; this keeps
  // comment-only articles visible even when no claim ratings exist.
  let totalComments = 0;
  let commentedArticles: Array<{
    articleId: string;
    title: string;
    commentCount: number;
  }> = [];

  if (articleIds.length > 0) {
    const commentCounts = await db
      .select({ articleId: articleComments.articleId, cnt: count() })
      .from(articleComments)
      .where(inArray(articleComments.articleId, articleIds))
      .groupBy(articleComments.articleId);

    commentedArticles = commentCounts
      .map((row) => {
        const commentCount = Number(row.cnt ?? 0);
        totalComments += commentCount;
        return {
          articleId: row.articleId,
          title: articleTitleMap.get(row.articleId) ?? row.articleId,
          commentCount,
        };
      })
      .filter((row) => row.commentCount > 0)
      .sort((a, b) => b.commentCount - a.commentCount || a.title.localeCompare(b.title));
  }

  // Claim rating aggregates across batch
  let totalRatings = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unsureCount = 0;

  if (assignmentIds.length > 0) {
    const verdictCounts = await db
      .select({ verdict: claimRatings.verdict, cnt: count() })
      .from(claimRatings)
      .where(inArray(claimRatings.assignmentId, assignmentIds))
      .groupBy(claimRatings.verdict);

    for (const row of verdictCounts) {
      const n = Number(row.cnt ?? 0);
      totalRatings += n;
      if (row.verdict === "correct") correctCount = n;
      else if (row.verdict === "incorrect") incorrectCount = n;
      else if (row.verdict === "unsure") unsureCount = n;
    }
  }

  const correctRatio = totalRatings > 0 ? correctCount / totalRatings : 0;
  const incorrectRatio = totalRatings > 0 ? incorrectCount / totalRatings : 0;
  const unsureRatio = totalRatings > 0 ? unsureCount / totalRatings : 0;

  // Top 5 articles by unsure ratio - calculated per article
  // For each article, count verdicts by verdict type from its assignments
  let topUnsureArticles: Array<{
    articleId: string;
    title: string;
    unsureRatio: number;
    totalRatings: number;
  }> = [];

  if (assignmentIds.length > 0) {
    // Get per-assignment verdict counts
    const perAssignmentVerdicts = await db
      .select({
        assignmentId: claimRatings.assignmentId,
        verdict: claimRatings.verdict,
        cnt: count(),
      })
      .from(claimRatings)
      .where(inArray(claimRatings.assignmentId, assignmentIds))
      .groupBy(claimRatings.assignmentId, claimRatings.verdict);

    // Roll up to article level
    const articleVerdicts = new Map<string, { unsure: number; total: number }>();

    for (const row of perAssignmentVerdicts) {
      const articleId = assignmentArticleMap.get(row.assignmentId);
      if (!articleId) continue;
      const n = Number(row.cnt ?? 0);
      const existing = articleVerdicts.get(articleId) ?? { unsure: 0, total: 0 };
      existing.total += n;
      if (row.verdict === "unsure") existing.unsure += n;
      articleVerdicts.set(articleId, existing);
    }

    topUnsureArticles = Array.from(articleVerdicts.entries())
      .filter(([, v]) => v.total > 0)
      .map(([articleId, v]) => ({
        articleId,
        title: articleTitleMap.get(articleId) ?? articleId,
        unsureRatio: v.unsure / v.total,
        totalRatings: v.total,
      }))
      .sort((a, b) => b.unsureRatio - a.unsureRatio)
      .slice(0, 5);
  }

  return NextResponse.json({
    data: {
      totalComments,
      totalRatings,
      correctRatio,
      incorrectRatio,
      unsureRatio,
      commentedArticles,
      topUnsureArticles,
    },
  });
});
