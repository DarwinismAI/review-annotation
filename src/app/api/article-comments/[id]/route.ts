import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articleComments } from "@/db/schema";
import { eq } from "drizzle-orm";

const patchCommentSchema = z
  .object({
    body: z.string().min(1).max(2000).optional(),
    status: z.enum(["open", "resolved"]).optional(),
  })
  .refine((data) => data.body !== undefined || data.status !== undefined, {
    message: "Cần cung cấp ít nhất một trường: body hoặc status",
  });

/**
 * PATCH /api/article-comments/[id]
 *
 * Updates body and/or status of an inline comment.
 * Auth: annotator only. Only the comment author can edit or resolve their own comment.
 */
export const PATCH = requireAnnotator(async (req: NextRequest, session, context) => {
  const commentId = context?.params?.id;
  if (!commentId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID nhận xét" } },
      { status: 400 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const parsed = patchCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "UNPROCESSABLE_ENTITY", message: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" } },
      { status: 422 }
    );
  }

  const { body, status } = parsed.data;

  // Fetch the comment to verify authorship
  const [comment] = await db
    .select({ id: articleComments.id, expertId: articleComments.expertId })
    .from(articleComments)
    .where(eq(articleComments.id, commentId));

  if (!comment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy nhận xét" } },
      { status: 404 }
    );
  }

  if (comment.expertId !== session.user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền chỉnh sửa nhận xét này" } },
      { status: 403 }
    );
  }

  const updateFields: Partial<{ body: string; status: string; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (body !== undefined) updateFields.body = body;
  if (status !== undefined) updateFields.status = status;

  const [updated] = await db
    .update(articleComments)
    .set(updateFields)
    .where(eq(articleComments.id, commentId))
    .returning();

  return NextResponse.json({ comment: updated });
});
