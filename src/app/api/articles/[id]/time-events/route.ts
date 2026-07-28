// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireExpert } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { assignments } from "@/db/schema";
import { timeEvents } from "@/db/time-events";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const VALID_EVENT_TYPES = new Set([
  "reading_start",
  "reading_pause",
  "scoring_start",
  "scoring_pause",
  "tab_hidden",
  "tab_visible",
]);

/**
 * POST /api/articles/[id]/time-events
 * Batch-insert client-side time tracking events.
 * Client sends every 30s or on page unload.
 */
export const POST = requireExpert(async (req, session, context) => {
  const articleId = context?.params?.id;
  if (!articleId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài viết" } },
      { status: 400 }
    );
  }

  let body: {
    events?: {
      type: string;
      timestamp: string;
      paragraphId?: string | null;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { events = [] } = body;

  if (!Array.isArray(events)) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "events phải là mảng" } },
      { status: 400 }
    );
  }

  // Verify expert assignment
  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.articleId, articleId),
        eq(assignments.expertId, session.user.id)
      )
    );

  if (!assignment) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Bạn không có quyền ghi nhận thời gian cho bài viết này" } },
      { status: 403 }
    );
  }

  if (events.length === 0) {
    return NextResponse.json({ data: { inserted: 0 } });
  }

  // Filter out events with invalid type — silently skip rather than reject batch
  const validEvents = events.filter((e) => VALID_EVENT_TYPES.has(e.type));

  const now = new Date();

  if (validEvents.length > 0) {
    await db.insert(timeEvents).values(
      validEvents.map((e) => ({
        id: createId(),
        assignmentId: assignment.id,
        articleId,
        expertId: session.user.id,
        paragraphId: e.paragraphId ?? null,
        eventType: e.type,
        timestamp: new Date(e.timestamp),
        createdAt: now,
      }))
    );
  }

  return NextResponse.json({
    data: { inserted: validEvents.length },
  });
});
