// @ts-nocheck
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { articles } from "@/db/schema";
import { assignBroadcastForArticle } from "@/lib/auto-assign";

/**
 * PATCH /api/articles/:id/toggle
 *
 * Body: `{ enabled: boolean }`. Toggling to `false` stamps `disabled_at` so the expert
 * read-only grace banner can compute its 24h countdown. Toggling back to `true` clears the stamp.
 */
export const PATCH = requireAdmin(async (req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID bài" } },
      { status: 400 }
    );
  }

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Yêu cầu phải là JSON" } },
      { status: 400 }
    );
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: { code: "INVALID_PAYLOAD", message: "Trường 'enabled' phải là boolean" } },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select({ id: articles.id, enabled: articles.enabled })
    .from(articles)
    .where(eq(articles.id, id));

  if (!existing) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy bài" } },
      { status: 404 }
    );
  }

  // Idempotent - but always touch updatedAt so listeners can refresh.
  const now = Date.now();
  const disabledAt = body.enabled ? null : new Date(now);

  await db
    .update(articles)
    .set({
      enabled: body.enabled,
      disabledAt,
      updatedAt: now,
    })
    .where(eq(articles.id, id));

  // When (re-)enabling: fan out to matching-domain annotators (no-op for non-broadcast batches).
  let assigned = 0;
  if (body.enabled) {
    try {
      assigned = await assignBroadcastForArticle(id);
    } catch (err) {
      console.error("[articles/toggle] auto-assign failed:", err);
    }
  }

  return NextResponse.json({
    data: {
      id,
      enabled: body.enabled,
      disabledAt: disabledAt ? disabledAt.toISOString() : null,
      assigned,
    },
  });
});
