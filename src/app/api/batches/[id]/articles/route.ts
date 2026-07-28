// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, profiles, batches } from "@/db/schema";
import { eq, and, count } from "drizzle-orm";

/** GET /api/batches/:id/articles — paginated article list with assignment info */
export const GET = requireAdmin(async (req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID batch" } },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  // Verify batch exists
  const [batch] = await db
    .select({ id: batches.id, payRatePerArticle: batches.payRatePerArticle })
    .from(batches)
    .where(eq(batches.id, id));

  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy batch" } },
      { status: 404 }
    );
  }

  const conditions = [eq(articles.batchId, id)];
  if (status) conditions.push(eq(articles.status, status));

  // Fetch articles with their latest assignment + expert info via subquery
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      type: articles.type,
      status: articles.status,
      pdfStorageKey: articles.pdfStorageKey,
      subDomainId: articles.subDomainId,
      medicalMicroDomainId: articles.medicalMicroDomainId,
      assignmentId: assignments.id,
      assignmentStatus: assignments.status,
      assignedExpertId: assignments.expertId,
      assignedExpertName: profiles.name,
      payRate: assignments.payRate,
    })
    .from(articles)
    .leftJoin(assignments, eq(assignments.articleId, articles.id))
    .leftJoin(profiles, eq(profiles.id, assignments.expertId))
    .where(and(...conditions))
    .limit(limit)
    .offset(offset);

  // Total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(articles)
    .where(and(...conditions));

  const data = rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    status: r.assignmentId ? r.assignmentStatus : r.status,
    subDomainId: r.subDomainId,
    medicalMicroDomainId: r.medicalMicroDomainId,
    assignmentId: r.assignmentId,
    pdfUrl: `/uploads/${id}/pdfs/${r.id}.pdf`,
    assignedTo: r.assignedExpertId
      ? { id: r.assignedExpertId, name: r.assignedExpertName }
      : null,
    payRate: r.payRate ?? batch.payRatePerArticle,
    paragraphCount: null, // populated in E3
  }));

  return NextResponse.json({
    data: { articles: data, total: Number(total), page, limit },
  });
});
