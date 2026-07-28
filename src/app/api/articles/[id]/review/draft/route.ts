import { NextResponse } from "next/server";
import { requireExpert } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { assignments, articles, batches, rubricCriteria, rubrics } from "@/db/schema";
import { reviews, reviewScores } from "@/db/reviews";
import { eq, and, inArray, asc, lte, isNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

/**
 * POST /api/articles/[id]/review/draft
 * Auto-save endpoint — called every 30s from client on input change.
 * Accepts partial data; no required-metric validation.
 * Upserts a draft review and its scores.
 */
function allowedScoresFromScale(scale: string | null): Set<number> {
  try {
    const parsed = JSON.parse(scale ?? "[]") as { score?: unknown }[];
    const values = parsed
      .map((item) => item.score)
      .filter((score): score is number => typeof score === "number" && score > 0);
    return new Set(values);
  } catch {
    return new Set();
  }
}

export const POST = requireExpert(async (req, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  let body: {
    scores?: { criterionId: string; score: number; reason?: string }[];
    paragraphId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { scores = [], paragraphId = null } = body;

  // Verify assignment
  const [assignment] = await db
    .select({ id: assignments.id, createdAt: assignments.createdAt })
    .from(assignments)
    .where(
      and(
        eq(assignments.articleId, articleId),
        eq(assignments.expertId, session.user.id)
      )
    );

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền đánh giá bài viết này" } },
      { status: 403 }
    );
  }

  if (scores.length > 0) {
    const [article] = await db
      .select({ batchId: articles.batchId })
      .from(articles)
      .where(eq(articles.id, articleId));

    if (article) {
      const [batch] = await db
        .select({ domain: batches.domain })
        .from(batches)
      .where(eq(batches.id, article.batchId));

      if (batch) {
        const domainRubrics = await db
          .select({ id: rubrics.id })
          .from(rubrics)
          .where(
            and(
              eq(rubrics.domain, batch.domain),
              lte(rubrics.createdAt, assignment.createdAt)
            )
          )
          .orderBy(asc(rubrics.createdAt), asc(rubrics.id));

        if (domainRubrics.length > 0) {
          const criteria = await db
            .select({ id: rubricCriteria.id, scale: rubricCriteria.scale })
            .from(rubricCriteria)
            .where(
              inArray(
                rubricCriteria.rubricId,
                (domainRubrics as { id: string }[]).map((rubric) => rubric.id)
              )
            );

          const allowedScoresByCriterion = new Map(
            (criteria as { id: string; scale: string | null }[]).map((criterion) => [
              criterion.id,
              allowedScoresFromScale(criterion.scale),
            ])
          );
          const invalidScore = scores.find((s) => {
            const allowed = allowedScoresByCriterion.get(s.criterionId);
            return !allowed || !allowed.has(s.score);
          });
          if (invalidScore) {
            return NextResponse.json(
              {
                error: {
                  code: "INVALID_SCORE",
                  message: "Điểm đánh giá không nằm trong metric được khai báo",
                  criterionId: invalidScore.criterionId,
                },
              },
              { status: 400 }
            );
          }
        }
      }
    }
  }

  let reviewId: string;
  const now = new Date();

  await db.transaction(async (tx: any) => {
    const conditions = paragraphId
      ? and(
          eq(reviews.assignmentId, assignment.id),
          eq(reviews.articleId, articleId),
          eq(reviews.paragraphId, paragraphId),
          eq(reviews.status, "draft")
        )
      : and(
          eq(reviews.assignmentId, assignment.id),
          eq(reviews.articleId, articleId),
          isNull(reviews.paragraphId),
          eq(reviews.status, "draft")
        );

    const [existing] = await tx.select().from(reviews).where(conditions);

    if (existing) {
      reviewId = existing.id;
      await tx.update(reviews).set({ updatedAt: now }).where(eq(reviews.id, reviewId));
    } else {
      reviewId = createId();
      await tx.insert(reviews).values({
        id: reviewId,
        assignmentId: assignment.id,
        articleId,
        expertId: session.user.id,
        paragraphId: paragraphId ?? null,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
    }

    const oldScores = await tx.select({ id: reviewScores.id }).from(reviewScores).where(eq(reviewScores.reviewId, reviewId));
    for (const s of oldScores) {
      await tx.delete(reviewScores).where(eq(reviewScores.id, s.id));
    }

    if (scores.length > 0) {
      await tx.insert(reviewScores).values(
        scores.map((s) => ({
          id: createId(),
          reviewId,
          criterionId: s.criterionId,
          score: s.score,
          reason: s.reason ?? null,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    await tx
      .update(assignments)
      .set({ status: "in_review", updatedAt: Date.now() })
      .where(and(eq(assignments.id, assignment.id), eq(assignments.status, "assigned")));

    await tx
      .update(articles)
      .set({ status: "in_review", updatedAt: Date.now() })
      .where(and(eq(articles.id, articleId), eq(articles.status, "assigned")));
  });

  return NextResponse.json({
    data: { reviewId: reviewId!, savedAt: now.toISOString() },
  });
});
