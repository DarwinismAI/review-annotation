import { NextRequest, NextResponse } from "next/server";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { assignments, articleReviewSession } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { closeOpenSessions } from "@/lib/review-session-close";

/**
 * POST /api/article-review-sessions/start
 * Body: { assignmentId: string }
 *
 * Opens a new review session for the calling expert.
 * Any existing open sessions for the same assignment are closed first
 * (closed_reason = 'reopen', end_at clamped to max 90 min from start_at).
 * Returns { sessionId }.
 */
export const POST = requireAnnotator(async (req: NextRequest, session) => {
  let body: { assignmentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { assignmentId } = body;
  if (!assignmentId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu assignmentId" } },
      { status: 400 }
    );
  }

  // Verify the calling expert owns this assignment
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.expertId, session.user.id)
      )
    );

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền truy cập assignment này" } },
      { status: 403 }
    );
  }

  // 1. Close any existing open sessions for this assignment (reopen).
  await closeOpenSessions({ assignmentId }, "reopen");

  // 2. Insert new session — pass explicit timestamps so schema's defaultNow() (PG `now()`) doesn't fire on SQLite.
  const now = new Date();
  const sessionId = createId();
  await db.insert(articleReviewSession).values({
    id: sessionId,
    assignmentId,
    startAt: now,
    createdAt: now,
  });

  return NextResponse.json({ sessionId }, { status: 201 });
});
