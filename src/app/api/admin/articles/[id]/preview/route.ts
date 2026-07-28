// @ts-nocheck
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import {
  articles,
  articleParagraphs,
  articleSegments,
  rubrics,
  rubricCriteria,
  batches,
  assignments,
  profiles,
} from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { getSignedUrl } from "@/lib/supabase-storage";

/**
 * GET /api/admin/articles/[id]/preview
 *
 * Admin-only read-only view of an article + its metrics. Mirrors the shape of
 * /api/articles/[id]/review (used by the expert flow) but does not require an
 * assignment, never returns drafts, and never persists state. Used by the
 * admin "preview as expert" page so admin can see how the review form looks
 * without touching the assigned expert's data.
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
    .select()
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy bài viết" } },
      { status: 404 }
    );
  }

  // PDF signed URL only when this article actually has a PDF source.
  let pdfUrl: string | null = null;
  if (article.pdfStorageKey) {
    try {
      pdfUrl = await getSignedUrl(article.pdfStorageKey, 60 * 60);
    } catch {
      pdfUrl = null;
    }
  }

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
    paragraphs = rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

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
      const rubricOrder = new Map(domainRubrics.map((rubric, index) => [rubric.id, index]));
      const criteria = await db
        .select()
        .from(rubricCriteria)
        .where(inArray(rubricCriteria.rubricId, domainRubrics.map((rubric) => rubric.id)));

      rubricData = {
        id: domainRubrics[0].id,
        criteria: criteria
          .map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            scale: JSON.parse(c.scale),
            required: c.required === 1,
            sortOrder: c.sortOrder,
            rubricOrder: rubricOrder.get(c.rubricId) ?? 0,
          }))
          .sort(
            (a, b) =>
              (a.rubricOrder as number) - (b.rubricOrder as number) ||
              (a.sortOrder as number) - (b.sortOrder as number) ||
              String(a.id).localeCompare(String(b.id))
          )
          .map(({ rubricOrder, ...metric }) => metric),
      };
    }
  }

  // Surface assignment context so admin knows whose review they are previewing.
  const [assignment] = await db
    .select({
      id: assignments.id,
      status: assignments.status,
      expertId: assignments.expertId,
      expertName: profiles.name,
    })
    .from(assignments)
    .leftJoin(profiles, eq(assignments.expertId, profiles.id))
    .where(eq(assignments.articleId, articleId));

  return NextResponse.json({
    data: {
      article: {
        id: article.id,
        title: article.title,
        type: article.type,
        sourceFormat: article.sourceFormat,
        payloadJson: article.payloadJson,
        subDomainId: article.subDomainId,
        medicalMicroDomainId: article.medicalMicroDomainId,
        pdfUrl,
        textContent: article.textContent,
        paragraphs,
        segments,
      },
      rubric: rubricData,
      assignment: assignment ?? null,
      batch: batchFull
        ? { id: batchFull.id, name: batchFull.name, domain: batchFull.domain }
        : null,
    },
  });
});
