import { NextRequest, NextResponse } from "next/server";
import { requireAnnotator } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { assignments, articleReviewSession } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { closeOpenSessions } from "@/lib/review-session-close";

type CloseReason = "navigate" | "blur" | "submit";

/**
 * PATCH /api/article-review-sessions/close
 * Body: { sessionId: string, reason: 'navigate' | 'blur' | 'submit' }
 *
 * Closes an open session. Idempotent - only updates rows where end_at IS NULL.
 * end_at is clamped via LEAST(now(), start_at + interval '90 minutes') on the server.
 * Returns { ok: true }.
 */
export const PATCH = requireAnnotator(async (req: NextRequest, session) => {
  let body: { sessionId?: string; reason?: CloseReason };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { sessionId, reason } = body;
  if (!sessionId || !reason) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu sessionId hoặc reason" } },
      { status: 400 }
    );
  }

  const validReasons: CloseReason[] = ["navigate", "blur", "submit"];
  if (!validReasons.includes(reason)) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "reason không hợp lệ" } },
      { status: 400 }
    );
  }

  // Verify ownership: session → assignment → expert
  const [row] = await db
    .select({ assignmentId: articleReviewSession.assignmentId })
    .from(articleReviewSession)
    .where(eq(articleReviewSession.id, sessionId));

  if (!row) {
    // Session not found - treat as already closed (idempotent)
    return NextResponse.json({ ok: true });
  }

  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, row.assignmentId),
        eq(assignments.expertId, session.user.id)
      )
    );

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền đóng session này" } },
      { status: 403 }
    );
  }

  // Idempotent close - only updates if still open
  await closeOpenSessions({ sessionId }, reason);

  return NextResponse.json({ ok: true });
});
