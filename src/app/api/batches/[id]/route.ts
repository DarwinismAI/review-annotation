// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import {
  batches,
  articles,
  articleParagraphs,
  assignments,
} from "@/db/schema";
import { reviews, reviewScores } from "@/db/reviews";
import { timeEvents } from "@/db/time-events";
import { eq, and, count, inArray } from "drizzle-orm";
import { deleteFolder } from "@/lib/supabase-storage";

/** GET /api/batches/:id — batch detail with article status counts */
export const GET = requireAdmin(async (_req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID batch" } },
      { status: 400 }
    );
  }

  const [batch] = await db
    .select()
    .from(batches)
    .where(eq(batches.id, id));

  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy batch" } },
      { status: 404 }
    );
  }

  // Count articles by status
  const statusCounts = await db
    .select({ status: articles.status, count: count() })
    .from(articles)
    .where(eq(articles.batchId, id))
    .groupBy(articles.status);

  const countsByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r.count])
  );

  // Broadcast claim total = articles in this batch that already have an assignment.
  const articleRows = await db
    .select({
      id: articles.id,
      enabled: articles.enabled,
      subDomainId: articles.subDomainId,
      medicalMicroDomainId: articles.medicalMicroDomainId,
    })
    .from(articles)
    .where(eq(articles.batchId, id));
  const articleIds = articleRows.map((r) => r.id);
  const enabledCount = articleRows.filter((r) => r.enabled !== false).length;
  const subDomainCountMap = new Map<string | null, number>();
  const medicalMicroDomainCountMap = new Map<string | null, number>();
  for (const article of articleRows) {
    const key = article.subDomainId ?? null;
    subDomainCountMap.set(key, (subDomainCountMap.get(key) ?? 0) + 1);
    if (article.medicalMicroDomainId) {
      medicalMicroDomainCountMap.set(
        article.medicalMicroDomainId,
        (medicalMicroDomainCountMap.get(article.medicalMicroDomainId) ?? 0) + 1
      );
    }
  }

  let claimedCount = 0;
  if (articleIds.length > 0) {
    const [{ value }] = await db
      .select({ value: count() })
      .from(assignments)
      .where(inArray(assignments.articleId, articleIds));
    claimedCount = Number(value ?? 0);
  }

  return NextResponse.json({
    data: {
      ...batch,
      errorFiles: batch.errorFiles ? JSON.parse(batch.errorFiles) : [],
      articleCounts: {
        unassigned: countsByStatus["unassigned"] ?? 0,
        assigned: countsByStatus["assigned"] ?? 0,
        in_review: countsByStatus["in_review"] ?? 0,
        completed: countsByStatus["completed"] ?? 0,
      },
      enabledCount,
      claimedCount,
      subDomainCounts: [...subDomainCountMap.entries()].map(([subDomainId, total]) => ({
        id: subDomainId,
        count: total,
      })),
      medicalMicroDomainCounts: [...medicalMicroDomainCountMap.entries()].map(([microDomainId, total]) => ({
        id: microDomainId,
        count: total,
      })),
    },
  });
});

/**
 * DELETE /api/batches/:id — remove a batch plus every derived row and storage object.
 *
 * Derived tables (reviews, review_scores, time_events) only carry text FKs so they
 * wouldn't cascade from the batch drop; we clean them up in dependency order first.
 * Supabase Storage cleanup uses the canonical `{batchId}/` prefix.
 */
export const DELETE = requireAdmin(async (_req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID batch" } },
      { status: 400 }
    );
  }

  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(eq(batches.id, id));

  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy batch" } },
      { status: 404 }
    );
  }

  const articleRows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.batchId, id));
  const articleIds = articleRows.map((r) => r.id);

  if (articleIds.length > 0) {
    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(inArray(reviews.articleId, articleIds));
    const reviewIds = reviewRows.map((r) => r.id);

    if (reviewIds.length > 0) {
      await db.delete(reviewScores).where(inArray(reviewScores.reviewId, reviewIds));
    }
    await db.delete(reviews).where(inArray(reviews.articleId, articleIds));
    await db.delete(timeEvents).where(inArray(timeEvents.articleId, articleIds));
    await db.delete(articleParagraphs).where(inArray(articleParagraphs.articleId, articleIds));
    await db.delete(assignments).where(inArray(assignments.articleId, articleIds));
  }

  await db.delete(articles).where(eq(articles.batchId, id));
  await db.delete(batches).where(eq(batches.id, id));

  // Best-effort storage cleanup — DB truth is already committed.
  try {
    await deleteFolder(`${id}/`);
  } catch (err) {
    console.warn(`[DELETE /api/batches/${id}] storage cleanup failed:`, err);
  }

  return NextResponse.json({ data: { id, deleted: true } });
});
