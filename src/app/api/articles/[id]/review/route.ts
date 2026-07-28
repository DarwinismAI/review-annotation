import { NextResponse } from "next/server";
import { z } from "zod";
import { requireExpert } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import {
  articles,
  articleParagraphs,
  articleSegments,
  assignments,
  rubrics,
  rubricCriteria,
  batches,
  claimRatings,
} from "@/db/schema";
import { reviews, reviewScores } from "@/db/reviews";
import { compensationSurveyResponses } from "@/db/compensation-survey";
import { eq, and, asc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getSignedUrl } from "@/lib/supabase-storage";

const claimRatingSchema = z.object({
  sectionId: z.string(),
  claimIdx: z.number().int().nonnegative(),
  verdict: z.enum(["correct", "incorrect", "unsure"]),
});

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

// ─── GET /api/articles/[id]/review ──────────────────────────────────────────

export const GET = requireExpert(async (req, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  // Verify expert is assigned to this article
  const [assignment] = await db
    .select()
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

  // Fetch article
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy bài viết" } },
      { status: 404 }
    );
  }

  // Supabase Storage: pdfStorageKey is `${batchId}/pdfs/${articleId}.pdf`.
  // Issue a 1-hour signed URL so the browser can render the PDF via iframe.
  // JSON-sourced articles do not carry a PDF; signed URL stays null.
  let pdfUrl: string | null = null;
  if (article.pdfStorageKey) {
    try {
      pdfUrl = await getSignedUrl(article.pdfStorageKey, 60 * 60);
    } catch {
      pdfUrl = null;
    }
  }

  // Paragraphs for paragraph-type articles
  let paragraphs: { id: string; index: number; text: string }[] | null = null;
  if (article.type === "paragraph") {
    const rows = await db
      .select({
        id: articleParagraphs.id,
        index: articleParagraphs.paragraphIndex,
        text: articleParagraphs.text,
      })
      .from(articleParagraphs)
      .where(eq(articleParagraphs.articleId, articleId));
    paragraphs = rows.sort((a: { index: number | null }, b: { index: number | null }) => (a.index ?? 0) - (b.index ?? 0));
  }

  // Colored segments (for color-annotated PDFs)
  const segmentRows = await db
    .select({
      id: articleSegments.id,
      order: articleSegments.order,
      text: articleSegments.text,
      color: articleSegments.color,
      type: articleSegments.type,
      scoreValue: articleSegments.scoreValue,
      pageIndex: articleSegments.pageIndex,
    })
    .from(articleSegments)
    .where(eq(articleSegments.articleId, articleId))
    .orderBy(asc(articleSegments.order));
  const segments = segmentRows.length > 0 ? segmentRows : null;

  // Fetch all metrics linked to this batch's domain.
  const [batchFull] = await db
    .select()
    .from(batches)
    .where(eq(batches.id, article.batchId));

  let rubricData: { id: string; criteria: unknown[] } | null = null;
  if (batchFull) {
    const domainRubrics = await db
      .select()
      .from(rubrics)
      .where(eq(rubrics.domain, batchFull.domain))
      .orderBy(asc(rubrics.createdAt), asc(rubrics.id));

    if (domainRubrics.length > 0) {
      const rubricOrder = new Map(domainRubrics.map((rubric: any, index: number) => [rubric.id, index]));
      const criteria = await db
        .select()
        .from(rubricCriteria)
        .where(inArray(rubricCriteria.rubricId, domainRubrics.map((rubric: any) => rubric.id)));

      rubricData = {
        id: domainRubrics[0].id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        criteria: criteria
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            scale: JSON.parse(c.scale),
            required: c.required === 1,
            sortOrder: c.sortOrder,
            rubricOrder: rubricOrder.get(c.rubricId) ?? 0,
          }))
          .sort((a: any, b: any) => a.rubricOrder - b.rubricOrder || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
          .map(({ rubricOrder, ...metric }: any) => metric),
      };
    }
  }

  // Fetch existing draft review (most recent, status=draft)
  const [existingReview] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.assignmentId, assignment.id),
        eq(reviews.articleId, articleId),
        eq(reviews.status, "draft")
      )
    );

  let draft: { scores: unknown[]; savedAt: string | null } | null = null;
  if (existingReview) {
    const scores = await db
      .select()
      .from(reviewScores)
      .where(eq(reviewScores.reviewId, existingReview.id));

    draft = {
      scores: scores.map((s: { criterionId: string; score: number; reason: string | null }) => ({
        criterionId: s.criterionId,
        score: s.score,
        reason: s.reason,
      })),
      savedAt: (() => {
          const v = existingReview.updatedAt;
          if (!v) return null;
          if (v instanceof Date) {
            const d = v.getTime();
            return isNaN(d) ? null : v.toISOString();
          }
          // SQLite returns text ISO string or numeric ms
          const n = Number(v);
          return new Date(isNaN(n) ? String(v) : n).toISOString();
        })(),
    };
  }

  const disabledAtIso =
    article.disabledAt instanceof Date
      ? article.disabledAt.toISOString()
      : (article.disabledAt as string | null);

  return NextResponse.json({
    data: {
      article: {
        id: article.id,
        title: article.title,
        type: article.type,
        sourceFormat: article.sourceFormat,
        payloadJson: article.payloadJson,
        domain: batchFull?.domain ?? null,
        pdfUrl,
        textContent: article.textContent,
        paragraphs,
        segments,
        enabled: article.enabled !== false,
        disabledAt: disabledAtIso,
      },
      rubric: rubricData,
      assignment: {
        id: assignment.id,
        payRate: assignment.payRate,
        status: assignment.status,
      },
      draft,
    },
  });
});

// ─── POST /api/articles/[id]/review ─────────────────────────────────────────

/**
 * Submit a completed review. Validates all required metrics are scored.
 * For paragraph mode: one POST per paragraph with paragraphId set.
 */
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
    status?: string;
    claimRatings?: { sectionId: string; claimIdx: number; verdict: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { scores = [], paragraphId = null, claimRatings: claimRatingsInput } = body;

  // Validate optional claimRatings array
  const parsedClaimRatings: { sectionId: string; claimIdx: number; verdict: "correct" | "incorrect" | "unsure" }[] = [];
  if (claimRatingsInput !== undefined) {
    if (!Array.isArray(claimRatingsInput)) {
      return NextResponse.json(
        { error: { code: "UNPROCESSABLE_ENTITY", message: "claimRatings phải là mảng" } },
        { status: 422 }
      );
    }
    for (const item of claimRatingsInput) {
      const result = claimRatingSchema.safeParse(item);
      if (!result.success) {
        return NextResponse.json(
          { error: { code: "UNPROCESSABLE_ENTITY", message: result.error.issues[0]?.message ?? "claimRatings không hợp lệ" } },
          { status: 422 }
        );
      }
      parsedClaimRatings.push(result.data);
    }
  }

  // Verify assignment
  const [assignment] = await db
    .select()
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

  // Check if locked
  const [lockedReview] = await db
    .select({ status: reviews.status })
    .from(reviews)
    .where(
      and(
        eq(reviews.assignmentId, assignment.id),
        eq(reviews.articleId, articleId)
      )
    );

  if (lockedReview?.status === "locked") {
    return NextResponse.json(
      { error: { code: "REVIEW_LOCKED", message: "Đánh giá đã bị khóa bởi admin" } },
      { status: 403 }
    );
  }

  // Enforce 24h grace window for disabled articles — block submit after window closes.
  const [articleGrace] = await db
    .select({
      disabledAt: articles.disabledAt,
      enabled: articles.enabled,
    })
    .from(articles)
    .where(eq(articles.id, articleId));
  if (articleGrace?.enabled === false && articleGrace.disabledAt) {
    const disabledTs =
      articleGrace.disabledAt instanceof Date
        ? articleGrace.disabledAt.getTime()
        : Date.parse(articleGrace.disabledAt as string);
    if (!isNaN(disabledTs) && Date.now() > disabledTs + 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        {
          error: {
            code: "GRACE_EXPIRED",
            message: "Bài đã bị tắt quá 24 giờ — chỉ đọc",
          },
        },
        { status: 403 }
      );
    }
  }

  // Validate required metrics
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
        .where(eq(rubrics.domain, batch.domain));

      if (domainRubrics.length > 0) {
        const allCriteria = await db
          .select({ id: rubricCriteria.id, required: rubricCriteria.required, scale: rubricCriteria.scale })
          .from(rubricCriteria)
          .where(inArray(rubricCriteria.rubricId, domainRubrics.map((rubric: any) => rubric.id)));

        const requiredIds = allCriteria
          .filter((c: { id: string; required: number | boolean | null }) => c.required === 1 || c.required === true)
          .map((c: { id: string }) => c.id);

        const scoredIds = new Set(scores.map((s) => s.criterionId));
        const missingIds = requiredIds.filter((id: string) => !scoredIds.has(id));

        if (missingIds.length > 0) {
          return NextResponse.json(
            {
              error: {
                code: "MISSING_REQUIRED_SCORES",
                message: "Thiếu điểm đánh giá cho các metric bắt buộc",
                missingCriterionIds: missingIds,
              },
            },
            { status: 400 }
          );
        }

        const allowedScoresByCriterion = new Map<string, Set<number>>(
          allCriteria.map((c: { id: string; scale: string | null }) => [c.id, allowedScoresFromScale(c.scale)])
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

  const now = new Date();

  // Upsert review record
  const [existing] = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.assignmentId, assignment.id),
        eq(reviews.articleId, articleId),
        paragraphId ? eq(reviews.paragraphId, paragraphId) : eq(reviews.status, "draft")
      )
    );

  let reviewId: string;

  if (existing) {
    reviewId = existing.id;
    await db
      .update(reviews)
      .set({ status: "completed", submittedAt: now, updatedAt: now })
      .where(eq(reviews.id, reviewId));
  } else {
    reviewId = createId();
    await db.insert(reviews).values({
      id: reviewId,
      assignmentId: assignment.id,
      articleId,
      expertId: session.user.id,
      paragraphId: paragraphId ?? null,
      status: "completed",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Replace scores: delete old, insert new
  if (existing) {
    // Delete existing scores via raw filter (drizzle doesn't have deleteWhere easily chained)
    const oldScores = await db
      .select({ id: reviewScores.id })
      .from(reviewScores)
      .where(eq(reviewScores.reviewId, reviewId));
    for (const s of oldScores) {
      await db.delete(reviewScores).where(eq(reviewScores.id, s.id));
    }
  }

  if (scores.length > 0) {
    await db.insert(reviewScores).values(
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

  // Upsert claim ratings — ON CONFLICT (assignment_id, section_id, claim_idx) DO UPDATE verdict + updated_at.
  // Pass explicit createdAt/updatedAt so the schema's .defaultNow() (which emits PG `now()`) doesn't fire on SQLite.
  if (parsedClaimRatings.length > 0) {
    for (const cr of parsedClaimRatings) {
      const ts = new Date();
      await db
        .insert(claimRatings)
        .values({
          id: createId(),
          assignmentId: assignment.id,
          expertId: session.user.id,
          sectionId: cr.sectionId,
          claimIdx: cr.claimIdx,
          verdict: cr.verdict,
          createdAt: ts,
          updatedAt: ts,
        })
        .onConflictDoUpdate({
          target: [claimRatings.assignmentId, claimRatings.sectionId, claimRatings.claimIdx],
          set: {
            verdict: sql`EXCLUDED.verdict`,
            updatedAt: ts,
          },
        });
    }
  }

  // Mark assignment as completed (and article)
  await db
    .update(assignments)
    .set({ status: "completed", completedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(assignments.id, assignment.id));

  await db
    .update(articles)
    .set({ status: "completed", updatedAt: Date.now() })
    .where(eq(articles.id, articleId));

  // ── Batch completion check (for compensation survey trigger) ──
  let batchCompleted = false;
  let surveyNeeded = false;
  try {
    if (article?.batchId) {
      const remaining = await db
        .select({ id: assignments.id })
        .from(assignments)
        .innerJoin(articles, eq(articles.id, assignments.articleId))
        .where(
          and(
            eq(articles.batchId, article.batchId),
            eq(assignments.expertId, session.user.id),
            sql`${assignments.status} <> 'completed'`
          )
        );

      if (remaining.length === 0) {
        batchCompleted = true;
        const [existing] = await db
          .select({ id: compensationSurveyResponses.id })
          .from(compensationSurveyResponses)
          .where(eq(compensationSurveyResponses.expertId, session.user.id));
        surveyNeeded = !existing;
      }
    }
  } catch {
    // Non-fatal: don't block submit if batch check fails
  }

  return NextResponse.json(
    {
      data: {
        reviewId,
        status: "completed",
        submittedAt: now.toISOString(),
        batchCompleted,
        surveyNeeded,
      },
    },
    { status: 201 }
  );
});
