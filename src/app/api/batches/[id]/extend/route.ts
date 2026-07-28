// @ts-nocheck
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { batches } from "@/db/schema";

/**
 * PATCH /api/batches/:id/extend
 *
 * Bumps `broadcast_expires_at` for a broadcast-mode batch. Body: `{ broadcastExpiresAt: ISO }`.
 * Rejects when batch is not broadcast mode or new date is not strictly later than current.
 */
export const PATCH = requireAdmin(async (req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID batch" } },
      { status: 400 }
    );
  }

  let body: { broadcastExpiresAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Yêu cầu phải là JSON" } },
      { status: 400 }
    );
  }

  if (!body.broadcastExpiresAt) {
    return NextResponse.json(
      { error: { code: "DEADLINE_REQUIRED", message: "Cần truyền hạn mới (broadcastExpiresAt)" } },
      { status: 400 }
    );
  }

  const newTs = Date.parse(body.broadcastExpiresAt);
  if (isNaN(newTs) || newTs <= Date.now()) {
    return NextResponse.json(
      { error: { code: "DEADLINE_INVALID", message: "Hạn mới phải là ngày hợp lệ ở tương lai" } },
      { status: 400 }
    );
  }

  const [batch] = await db.select().from(batches).where(eq(batches.id, id));
  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy batch" } },
      { status: 404 }
    );
  }

  if (batch.assignmentMode !== "broadcast") {
    return NextResponse.json(
      {
        error: {
          code: "MODE_MISMATCH",
          message: "Chỉ batch chế độ Tự động mới có hạn nhận bài để gia hạn",
        },
      },
      { status: 400 }
    );
  }

  const currentTs = batch.broadcastExpiresAt
    ? new Date(batch.broadcastExpiresAt).getTime()
    : 0;
  if (newTs <= currentTs) {
    return NextResponse.json(
      {
        error: {
          code: "DEADLINE_NOT_LATER",
          message: "Hạn mới phải muộn hơn hạn hiện tại",
        },
      },
      { status: 400 }
    );
  }

  await db
    .update(batches)
    .set({
      broadcastExpiresAt: new Date(newTs),
      updatedAt: Date.now(),
    })
    .where(eq(batches.id, id));

  return NextResponse.json({
    data: {
      id,
      broadcastExpiresAt: new Date(newTs).toISOString(),
    },
  });
});
