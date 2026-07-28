import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles, assignments, profiles } from "@/db/schema";

function deriveArticleStatus(rows: { status: string }[]) {
  if (rows.length === 0) return "unassigned";
  if (rows.some((row) => row.status === "in_review")) return "in_review";
  if (rows.every((row) => row.status === "completed")) return "completed";
  return "assigned";
}

/** POST /api/articles/:id/revoke-assignment — revoke one not-yet-started assignment. */
export const POST = requireAdmin(async (req, _session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài" } },
      { status: 400 }
    );
  }

  let body: { assignmentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  if (!body.assignmentId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID phân công" } },
      { status: 400 }
    );
  }

  const [assignment] = await db
    .select({
      id: assignments.id,
      status: assignments.status,
      expertId: assignments.expertId,
      expertName: profiles.name,
    })
    .from(assignments)
    .innerJoin(profiles, eq(profiles.id, assignments.expertId))
    .where(and(eq(assignments.id, body.assignmentId), eq(assignments.articleId, articleId)));

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy phân công" } },
      { status: 404 }
    );
  }

  if (assignment.status !== "assigned") {
    return NextResponse.json(
      {
        error: {
          code: "ASSIGNMENT_ALREADY_STARTED",
          message: "Chỉ thu hồi được bài chưa bắt đầu chấm. Bài đang chấm hoặc đã hoàn thành cần xử lý riêng.",
        },
      },
      { status: 409 }
    );
  }

  await db.delete(assignments).where(eq(assignments.id, assignment.id));

  const remainingRows = await db
    .select({ status: assignments.status })
    .from(assignments)
    .where(eq(assignments.articleId, articleId));
  const articleStatus = deriveArticleStatus(remainingRows);

  await db
    .update(articles)
    .set({ status: articleStatus, updatedAt: Date.now() })
    .where(eq(articles.id, articleId));

  return NextResponse.json({
    data: {
      articleId,
      revokedAssignmentId: assignment.id,
      revokedExpertId: assignment.expertId,
      revokedExpertName: assignment.expertName,
      remainingAssignments: remainingRows.length,
      articleStatus,
    },
  });
});
