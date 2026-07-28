// @ts-nocheck
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, articleComments, claimRatings, assignments, profiles } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

/**
 * GET /api/admin/articles/[id]/comments
 *
 * Admin-only. Returns all inline comments + claim ratings for an article
 * across all assignments (every expert who reviewed it).
 * Used by the admin article preview page.
 */
export const GET = requireAdmin(async (_req, _session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  const [article] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy bài viết" } },
      { status: 404 }
    );
  }

  // Fetch all comments for this article with expert name
  const comments = await db
    .select({
      id: articleComments.id,
      sectionId: articleComments.sectionId,
      anchorQuote: articleComments.anchorQuote,
      body: articleComments.body,
      status: articleComments.status,
      createdAt: articleComments.createdAt,
      expertId: articleComments.expertId,
      expertName: profiles.name,
    })
    .from(articleComments)
    .leftJoin(profiles, eq(profiles.id, articleComments.expertId))
    .where(eq(articleComments.articleId, articleId))
    .orderBy(asc(articleComments.createdAt));

  // Fetch assignments for this article to resolve claim ratings
  const assignmentRows = await db
    .select({
      id: assignments.id,
      expertId: assignments.expertId,
      expertName: profiles.name,
    })
    .from(assignments)
    .leftJoin(profiles, eq(profiles.id, assignments.expertId))
    .where(eq(assignments.articleId, articleId));

  const assignmentIds = assignmentRows.map((r) => r.id);
  const assignmentExpertMap = new Map(
    assignmentRows.map((r) => [r.id, { expertId: r.expertId, expertName: r.expertName }])
  );

  let ratings: Array<{
    id: string;
    sectionId: string;
    claimIdx: number;
    verdict: string;
    expertId: string;
    expertName: string | null;
  }> = [];

  if (assignmentIds.length > 0) {
    const ratingRows = await db
      .select({
        id: claimRatings.id,
        assignmentId: claimRatings.assignmentId,
        sectionId: claimRatings.sectionId,
        claimIdx: claimRatings.claimIdx,
        verdict: claimRatings.verdict,
      })
      .from(claimRatings)
      .where(inArray(claimRatings.assignmentId, assignmentIds));

    ratings = ratingRows.map((r) => {
      const expert = assignmentExpertMap.get(r.assignmentId);
      return {
        id: r.id,
        sectionId: r.sectionId,
        claimIdx: r.claimIdx,
        verdict: r.verdict,
        expertId: expert?.expertId ?? "",
        expertName: expert?.expertName ?? null,
      };
    });
  }

  return NextResponse.json({
    data: { comments, ratings },
  });
});
