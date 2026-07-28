import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { assignments, articleComments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const createCommentSchema = z.object({
  articleId: z.string(),
  assignmentId: z.string(),
  sectionId: z.string(),
  anchorQuote: z.string().min(1).max(2000),
  anchorPrefix: z.string().max(60).optional(),
  anchorSuffix: z.string().max(60).optional(),
  anchorOffsetStart: z.number().int().nonnegative().optional(),
  anchorOffsetEnd: z.number().int().nonnegative().optional(),
  body: z.string().min(1).max(2000),
});

/**
 * POST /api/article-comments
 *
 * Creates an inline comment anchored to a text selection within an article section.
 * Auth: annotator only. Caller must own the assignment referenced in the body.
 */
export const POST = requireAnnotator(async (req: NextRequest, session) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "UNPROCESSABLE_ENTITY", message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" } },
      { status: 422 }
    );
  }

  const {
    articleId,
    assignmentId,
    sectionId,
    anchorQuote,
    anchorPrefix,
    anchorSuffix,
    anchorOffsetStart,
    anchorOffsetEnd,
    body,
  } = parsed.data;

  // Verify the caller owns this assignment AND the assignment covers the given article
  const [assignment] = await db
    .select({ id: assignments.id, expertId: assignments.expertId, articleId: assignments.articleId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy assignment" } },
      { status: 404 }
    );
  }

  if (assignment.expertId !== session.user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền thêm nhận xét cho assignment này" } },
      { status: 403 }
    );
  }

  if (assignment.articleId !== articleId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Assignment không thuộc bài viết này" } },
      { status: 403 }
    );
  }

  try {
    const id = createId();
    const [inserted] = await db
      .insert(articleComments)
      .values({
        id,
        articleId,
        assignmentId,
        expertId: session.user.id,
        sectionId,
        anchorQuote,
        anchorPrefix: anchorPrefix ?? null,
        anchorSuffix: anchorSuffix ?? null,
        anchorOffsetStart: anchorOffsetStart ?? null,
        anchorOffsetEnd: anchorOffsetEnd ?? null,
        body,
      })
      .returning();

    return NextResponse.json({ comment: inserted }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_SERVER_ERROR", message: "Không thể tạo nhận xét" } },
      { status: 500 }
    );
  }
});
