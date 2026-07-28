import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { assignments, articleReviewSession } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { closeOpenSessions } from "@/lib/review-session-close";

type BeaconReason = "navigate" | "blur";

/**
 * POST /api/article-review-sessions/close-by-key
 * Used by navigator.sendBeacon — Content-Type is text/plain so body must be
 * parsed via req.text() then JSON.parse.
 *
 * Body: { sessionId: string, reason: 'navigate' | 'blur' }
 * Returns 204 (sendBeacon ignores response body).
 */
export async function POST(req: NextRequest) {
  // sendBeacon sends Content-Type: text/plain; parse manually
  let body: { sessionId?: string; reason?: BeaconReason };
  try {
    const raw = await req.text();
    body = JSON.parse(raw) as { sessionId?: string; reason?: BeaconReason };
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const { sessionId, reason } = body;
  if (!sessionId || !reason) {
    return new NextResponse(null, { status: 204 });
  }

  const validReasons: BeaconReason[] = ["navigate", "blur"];
  if (!validReasons.includes(reason)) {
    return new NextResponse(null, { status: 204 });
  }

  // Auth — beacon requests carry cookies; Supabase auth reads them automatically
  const session = await auth.api.getSession();
  if (!session?.user) {
    // Unauthenticated — watchdog will clean up within 90 min
    return new NextResponse(null, { status: 204 });
  }

  // Verify ownership
  const [row] = await db
    .select({ assignmentId: articleReviewSession.assignmentId })
    .from(articleReviewSession)
    .where(eq(articleReviewSession.id, sessionId));

  if (!row) {
    return new NextResponse(null, { status: 204 });
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
    return new NextResponse(null, { status: 204 });
  }

  // Idempotent close — only updates if still open
  await closeOpenSessions({ sessionId }, reason);

  return new NextResponse(null, { status: 204 });
}
