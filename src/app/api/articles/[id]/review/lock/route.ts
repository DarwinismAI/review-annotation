// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { assignments } from "@/db/schema";
import { reviews } from "@/db/reviews";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/articles/[id]/review/lock
 * Admin-only. Locks all reviews for an article - expert can no longer edit.
 */
export const POST = requireAdmin(async (req, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  // Find the assignment for this article (any expert)
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.articleId, articleId));

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy phân công cho bài viết này" } },
      { status: 404 }
    );
  }

  const now = new Date();

  // Lock all reviews tied to this assignment
  const articleReviews = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.assignmentId, assignment.id),
        eq(reviews.articleId, articleId)
      )
    );

  if (articleReviews.length === 0) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Chưa có đánh giá nào cho bài viết này" } },
      { status: 404 }
    );
  }

  for (const review of articleReviews) {
    await db
      .update(reviews)
      .set({ status: "locked", lockedAt: now, updatedAt: now })
      .where(eq(reviews.id, review.id));
  }

  return NextResponse.json({
    data: {
      articleId,
      lockedAt: now.toISOString(),
      lockedCount: articleReviews.length,
    },
  });
});
