import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { batches, expertProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assignBatchArticlesToExperts, claimArticleForExpert } from "@/lib/batch-auto-assign";

interface AssignmentInput {
  articleId: string;
  expertId: string;
}

/** POST /api/batches/:id/assign-bulk — bulk assign articles to annotators. */
export const POST = requireAdmin(async (req: Request, _session: unknown, context?: { params?: { id?: string } }) => {
  const batchId = context?.params?.id;
  if (!batchId) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Thiếu ID batch" } }, { status: 400 });
  }

  let body: { mode?: "auto"; assignments?: AssignmentInput[]; payRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } }, { status: 400 });
  }

  const [batch] = await db
    .select({ id: batches.id, domain: batches.domain, payRatePerArticle: batches.payRatePerArticle })
    .from(batches)
    .where(eq(batches.id, batchId));

  if (!batch) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Không tìm thấy batch" } }, { status: 404 });
  }

  if (body.mode === "auto") {
    const data = await assignBatchArticlesToExperts(batch);
    return NextResponse.json({ data }, { status: 201 });
  }

  const inputs = body.assignments ?? [];
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Danh sách phân công không được để trống" } },
      { status: 400 }
    );
  }

  const now = Date.now();
  const effectivePayRate = body.payRate || batch.payRatePerArticle;
  const results = [];

  for (const { articleId, expertId } of inputs) {
    const [profile] = await db
      .select({ status: expertProfiles.status, domain: expertProfiles.domain })
      .from(expertProfiles)
      .where(eq(expertProfiles.userId, expertId));

    if (!profile || profile.status !== "active") {
      results.push({ articleId, expertId, status: "skipped", reason: "Annotator chưa kích hoạt tài khoản" });
      continue;
    }

    const result = await claimArticleForExpert({ articleId, expertId, batchId, payRate: effectivePayRate, now });
    results.push({ articleId, expertId, domainMismatch: profile.domain !== batch.domain, ...result });
  }

  if (results.some((result) => result.status === "assigned")) {
    await db.update(batches).set({ status: "in_progress", updatedAt: now }).where(eq(batches.id, batchId));
  }

  return NextResponse.json({ data: results }, { status: 201 });
});
