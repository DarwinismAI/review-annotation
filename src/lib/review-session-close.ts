/**
 * Helper for closing review sessions in a driver-agnostic way.
 *
 * Production schema (Postgres) used `LEAST(now(), start_at + interval '90 minutes')`
 * inline in UPDATE; SQLite has neither `now()` nor `interval`. We compute the
 * cap in JS and pass an explicit Date - works on both drivers.
 */
import { db } from "@/db/client";
import { articleReviewSession } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const NINETY_MINUTES_MS = 90 * 60 * 1000;

export async function closeOpenSessions(
  filter: { sessionId?: string; assignmentId?: string },
  reason: "navigate" | "blur" | "submit" | "reopen" | "watchdog"
): Promise<void> {
  const now = new Date();

  const whereClauses = [isNull(articleReviewSession.endAt)];
  if (filter.sessionId) whereClauses.push(eq(articleReviewSession.id, filter.sessionId));
  if (filter.assignmentId) whereClauses.push(eq(articleReviewSession.assignmentId, filter.assignmentId));

  const openRows = await db
    .select({ id: articleReviewSession.id, startAt: articleReviewSession.startAt })
    .from(articleReviewSession)
    .where(and(...whereClauses));

  for (const row of openRows) {
    const startMs =
      row.startAt instanceof Date
        ? row.startAt.getTime()
        : Date.parse(row.startAt as unknown as string);
    const cap = Number.isFinite(startMs)
      ? Math.min(now.getTime(), startMs + NINETY_MINUTES_MS)
      : now.getTime();
    await db
      .update(articleReviewSession)
      .set({ endAt: new Date(cap), closedReason: reason })
      .where(eq(articleReviewSession.id, row.id));
  }
}
