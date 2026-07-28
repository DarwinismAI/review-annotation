// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import {
  assignments,
  articles,
  expertProfiles,
  expertDomains,
  expertSubDomains,
  expertMedicalMicroDomains,
  batches,
  profiles,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { domainForSubDomain, subDomainForMedicalMicroDomain } from "@/lib/labels";

/** POST /api/articles/:id/assign - assign a single article to an expert */
export const POST = requireAdmin(async (req, _session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  let body: { expertId?: string; payRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { expertId, payRate = 0 } = body;

  if (!expertId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID annotator" } },
      { status: 400 }
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

  // Check already assigned
  if (article.status !== "unassigned") {
    const [existing] = await db
      .select({ id: assignments.id, expertId: assignments.expertId, expertName: profiles.name })
      .from(assignments)
      .innerJoin(profiles, eq(profiles.id, assignments.expertId))
      .where(eq(assignments.articleId, articleId));

    return NextResponse.json(
      {
        error: {
          code: "ALREADY_ASSIGNED",
          message: "Bài viết đã được phân công",
          currentAssignee: existing
            ? { id: existing.expertId, name: existing.expertName }
            : null,
        },
      },
      { status: 409 }
    );
  }

  // Fetch expert profile
  const [profile] = await db
    .select({ status: expertProfiles.status, domain: expertProfiles.domain })
    .from(expertProfiles)
    .where(eq(expertProfiles.userId, expertId));

  if (!profile || profile.status !== "active") {
    return NextResponse.json(
      { error: { code: "EXPERT_NOT_ACTIVE", message: "Annotator chưa kích hoạt tài khoản" } },
      { status: 400 }
    );
  }

  // Batch domain for mismatch check
  const [batch] = await db
    .select({ domain: batches.domain })
    .from(batches)
    .where(eq(batches.id, article.batchId));

  if (batch) {
    const domainRows = await db
      .select({ domain: expertDomains.domain })
      .from(expertDomains)
      .where(eq(expertDomains.userId, expertId));
    const expertDomainsSet = new Set(domainRows.map((r) => r.domain));
    if (expertDomainsSet.size === 0 && profile.domain) expertDomainsSet.add(profile.domain);
    if (!expertDomainsSet.has(batch.domain)) {
      return NextResponse.json(
        { error: { code: "DOMAIN_MISMATCH", message: "Annotator không thuộc lĩnh vực của bài" } },
        { status: 400 }
      );
    }

    if (article.subDomainId) {
      const subRows = await db
        .select({ subDomainId: expertSubDomains.subDomainId })
        .from(expertSubDomains)
        .where(eq(expertSubDomains.userId, expertId));
      const narrowedForDomain = subRows
        .map((r) => r.subDomainId)
        .filter((subId) => domainForSubDomain(subId) === batch.domain);
      if (narrowedForDomain.length > 0 && !narrowedForDomain.includes(article.subDomainId)) {
        return NextResponse.json(
          { error: { code: "SUB_DOMAIN_MISMATCH", message: "Annotator không thuộc subdomain của bài" } },
          { status: 400 }
        );
      }
    }

    if (batch.domain === "medical" && article.medicalMicroDomainId) {
      const parent = subDomainForMedicalMicroDomain(article.medicalMicroDomainId);
      const microRows = await db
        .select({ microDomainId: expertMedicalMicroDomains.microDomainId })
        .from(expertMedicalMicroDomains)
        .where(eq(expertMedicalMicroDomains.userId, expertId));
      const narrowedForParent = microRows
        .map((r) => r.microDomainId)
        .filter((microId) => (parent ? subDomainForMedicalMicroDomain(microId) === parent : false));
      if (narrowedForParent.length > 0 && !narrowedForParent.includes(article.medicalMicroDomainId)) {
        return NextResponse.json(
          {
            error: {
              code: "MEDICAL_MICRO_DOMAIN_MISMATCH",
              message: "Annotator không thuộc nhánh nhỏ y tế của bài",
            },
          },
          { status: 400 }
        );
      }
    }
  }

  const now = Date.now();
  const assignmentId = createId();

  await db.insert(assignments).values({
    id: assignmentId,
    articleId,
    expertId,
    payRate,
    status: "assigned",
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(articles)
    .set({ status: "assigned", updatedAt: now })
    .where(eq(articles.id, articleId));

  return NextResponse.json(
    {
      data: {
        id: assignmentId,
        articleId,
        expertId,
        payRate,
        domainMismatch: false,
        status: "assigned",
      },
    },
    { status: 201 }
  );
});
