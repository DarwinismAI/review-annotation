import { NextRequest, NextResponse } from "next/server";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { assignments, articleComments } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

/**
 * GET /api/articles/[id]/comments
 *
 * Returns all inline comments for an article scoped to the calling annotator's assignment.
 * Auth: annotator only. Expert must have an open assignment for this article.
 */
export const GET = requireAnnotator(async (_req: NextRequest, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  // Verify the expert has an assignment for this article
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.articleId, articleId),
        eq(assignments.expertId, session.user.id)
      )
    );

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền xem bài viết này" } },
      { status: 403 }
    );
  }

  const comments = await db
    .select()
    .from(articleComments)
    .where(
      and(
        eq(articleComments.articleId, articleId),
        eq(articleComments.assignmentId, assignment.id)
      )
    )
    .orderBy(desc(articleComments.createdAt));

  return NextResponse.json({ comments });
});
