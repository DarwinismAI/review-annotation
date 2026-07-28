// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { expertProfiles, profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isDomainKey } from "@/lib/labels";

/** PATCH /api/experts/:id — update domain or status (admin only) */
export const PATCH = requireAdmin(async (req, _session, context) => {
  const id = context?.params?.id;
  if (!id) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Thiếu ID chuyên gia" } },
      { status: 400 }
    );
  }

  let body: { domain?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const { domain, status } = body;

  if (domain && !isDomainKey(domain)) {
    return NextResponse.json(
      { error: { code: "INVALID_DOMAIN", message: "Lĩnh vực không hợp lệ" } },
      { status: 400 }
    );
  }

  if (status && !["active", "inactive"].includes(status)) {
    return NextResponse.json(
      { error: { code: "INVALID_STATUS", message: "Trạng thái không hợp lệ" } },
      { status: 400 }
    );
  }

  const [profile] = await db
    .select()
    .from(expertProfiles)
    .where(eq(expertProfiles.id, id));

  if (!profile) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Không tìm thấy chuyên gia" } },
      { status: 404 }
    );
  }

  const updates: Partial<typeof expertProfiles.$inferInsert> = {
    updatedAt: Date.now(),
  };
  if (domain) updates.domain = domain;
  if (status) updates.status = status;

  await db.update(expertProfiles).set(updates).where(eq(expertProfiles.id, id));

  const [updated] = await db
    .select({
      id: expertProfiles.id,
      email: profiles.email,
      name: profiles.name,
      domain: expertProfiles.domain,
      status: expertProfiles.status,
      invitedAt: expertProfiles.invitedAt,
      activatedAt: expertProfiles.activatedAt,
    })
    .from(expertProfiles)
    .innerJoin(profiles, eq(expertProfiles.userId, profiles.id))
    .where(eq(expertProfiles.id, id));

  return NextResponse.json({ data: updated });
});
