// @ts-nocheck
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { requireExpert } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import {
  articles,
  batches,
  assignments,
  expertDomains,
  expertSubDomains,
  expertMedicalMicroDomains,
} from "@/db/schema";
import { domainForSubDomain, subDomainForMedicalMicroDomain, type DomainKey } from "@/lib/labels";

/**
 * POST /api/articles/:id/claim
 *
 * Expert self-claims a broadcast-mode article. Race-safe via UNIQUE index on
 * `assignments.article_id` — concurrent claims collapse to one winner; losers get 409.
 *
 * Validation order:
 * 1. Article exists + enabled
 * 2. Batch is broadcast mode + not expired
 * 3. Caller's expert_domains overlaps batch.domain
 * 4. Insert assignment (UNIQUE catches the race) + flip article.status → assigned
 */
export const POST = requireExpert(async (_req, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài" } },
      { status: 400 }
    );
  }

  const expertId = session.user.id;

  const [article] = await db
    .select({
      id: articles.id,
      batchId: articles.batchId,
      status: articles.status,
      enabled: articles.enabled,
      subDomainId: articles.subDomainId,
      medicalMicroDomainId: articles.medicalMicroDomainId,
    })
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy bài" } },
      { status: 404 }
    );
  }
  if (article.enabled === false) {
    return NextResponse.json(
      { error: { code: "ARTICLE_DISABLED", message: "Bài đã bị tắt, không thể nhận" } },
      { status: 409 }
    );
  }
  if (article.status !== "unassigned") {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_CLAIMED",
          message: "Bài đã có người nhận hoặc đang chấm",
        },
      },
      { status: 409 }
    );
  }

  const [batch] = await db
    .select({
      id: batches.id,
      domain: batches.domain,
      assignmentMode: batches.assignmentMode,
      broadcastExpiresAt: batches.broadcastExpiresAt,
    })
    .from(batches)
    .where(eq(batches.id, article.batchId));

  if (!batch) {
    return NextResponse.json(
      { error: { code: "BATCH_NOT_FOUND", message: "Không tìm thấy đợt" } },
      { status: 404 }
    );
  }
  if (batch.assignmentMode !== "broadcast") {
    return NextResponse.json(
      {
        error: {
          code: "MODE_MISMATCH",
          message: "Chỉ batch chế độ Tự động mới cho phép tự nhận bài",
        },
      },
      { status: 403 }
    );
  }
  if (
    batch.broadcastExpiresAt &&
    new Date(batch.broadcastExpiresAt).getTime() <= Date.now()
  ) {
    return NextResponse.json(
      { error: { code: "BROADCAST_EXPIRED", message: "Đã hết hạn nhận bài" } },
      { status: 409 }
    );
  }

  const expertDomainRows = await db
    .select({ domain: expertDomains.domain })
    .from(expertDomains)
    .where(eq(expertDomains.userId, expertId));

  const expertDomainSet = new Set(expertDomainRows.map((r) => r.domain));
  if (!expertDomainSet.has(batch.domain)) {
    return NextResponse.json(
      {
        error: {
          code: "DOMAIN_MISMATCH",
          message: "Bài thuộc lĩnh vực ngoài chuyên môn của bạn",
        },
      },
      { status: 403 }
    );
  }

  // Sub-domain narrowing: if the expert opted into specific sub-domains for this batch's
  // parent domain, the article must match. Article with NULL sub_domain_id passes through
  // (it's not classified — fall back to the parent-domain match above).
  if (article.subDomainId) {
    const expertSubRows = await db
      .select({ subDomainId: expertSubDomains.subDomainId })
      .from(expertSubDomains)
      .where(eq(expertSubDomains.userId, expertId));
    const subsForBatchDomain = expertSubRows
      .map((r) => r.subDomainId)
      .filter((s) => domainForSubDomain(s) === (batch.domain as DomainKey));
    if (subsForBatchDomain.length > 0 && !subsForBatchDomain.includes(article.subDomainId)) {
      return NextResponse.json(
        {
          error: {
            code: "SUB_DOMAIN_MISMATCH",
            message: "Bài thuộc chuyên ngành con ngoài hồ sơ của bạn",
          },
        },
        { status: 403 }
      );
    }
  }

  if (batch.domain === "medical" && article.medicalMicroDomainId) {
    const parent = subDomainForMedicalMicroDomain(article.medicalMicroDomainId);
    const expertMicroRows = await db
      .select({ microDomainId: expertMedicalMicroDomains.microDomainId })
      .from(expertMedicalMicroDomains)
      .where(eq(expertMedicalMicroDomains.userId, expertId));
    const microsForParent = expertMicroRows
      .map((r) => r.microDomainId)
      .filter((microId) => (parent ? subDomainForMedicalMicroDomain(microId) === parent : false));
    if (microsForParent.length > 0 && !microsForParent.includes(article.medicalMicroDomainId)) {
      return NextResponse.json(
        {
          error: {
            code: "MEDICAL_MICRO_DOMAIN_MISMATCH",
            message: "Bài thuộc nhánh nhỏ y tế ngoài hồ sơ của bạn",
          },
        },
        { status: 403 }
      );
    }
  }

  // Race-safe insert. Postgres UNIQUE on assignments.article_id rejects duplicates.
  const now = Date.now();
  const assignmentId = createId();
  try {
    await db.insert(assignments).values({
      id: assignmentId,
      articleId,
      expertId,
      payRate: 0,
      status: "assigned",
      assignedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    // 23505 = unique_violation in Postgres.
    if (err?.code === "23505" || /unique/i.test(err?.message ?? "")) {
      return NextResponse.json(
        {
          error: {
            code: "RACE_LOST",
            message: "Bài vừa được người khác nhận. Vui lòng chọn bài khác.",
          },
        },
        { status: 409 }
      );
    }
    throw err;
  }

  await db
    .update(articles)
    .set({ status: "assigned", updatedAt: now })
    .where(and(eq(articles.id, articleId), eq(articles.status, "unassigned")));

  return NextResponse.json(
    {
      data: {
        id: assignmentId,
        articleId,
        expertId,
        status: "assigned",
      },
    },
    { status: 201 }
  );
});
