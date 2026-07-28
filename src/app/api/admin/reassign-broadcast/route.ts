/**
 * Ops endpoint — re-run the broadcast fan-out for every currently-active expert.
 *
 * Use when the matching logic changes (new sub-domain filter, expert toggles a
 * preference outside the standard admin/profile flow, etc.) and we want existing
 * articles to be re-evaluated against the latest taxonomy.
 *
 * The helper is idempotent (UNIQUE constraint on assignments collapses dupes),
 * so this can be re-run safely. We process annotators sequentially to avoid hammering
 * the connection pool — each call is a single SQL with CTE.
 *
 * Not marked temporary; kept around for ops convenience.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { expertProfiles } from "@/db/schema";
import { assignBroadcastForExpert } from "@/lib/auto-assign";

export const POST = requireAdmin(async () => {
  try {
    const rows = await db
      .select({ userId: expertProfiles.userId })
      .from(expertProfiles)
      .where(eq(expertProfiles.status, "active"));

    let totalAssigned = 0;
    const perExpert: { userId: string; assigned: number }[] = [];

    for (const row of rows) {
      try {
        const n = await assignBroadcastForExpert(row.userId);
        totalAssigned += n;
        perExpert.push({ userId: row.userId, assigned: n });
      } catch (err) {
        console.error(`[reassign-broadcast] failed for ${row.userId}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      annotators: rows.length,
      totalAssigned,
      perExpert,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
