import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { expertProfiles, profiles } from "@/db/schema";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth-middleware";
import { isSuperAdminRole, normalizeRole, resolveEffectiveRole } from "@/lib/roles";

const MANAGED_ROLES = new Set(["admin", "annotator"]);

function isLegacyRoleConstraintError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  if (err.code === "23514" || err.cause?.code === "23514") return true;
  const message = String(err.message ?? err.cause?.message ?? "");
  return /role_check|profiles_role_check|check constraint|CHECK constraint/i.test(message);
}

export const GET = requireAdmin(async (_req, session) => {
  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      name: profiles.name,
      role: profiles.role,
      annotatorProfileId: expertProfiles.id,
      annotatorDomain: expertProfiles.domain,
      annotatorStatus: expertProfiles.status,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .leftJoin(expertProfiles, eq(expertProfiles.userId, profiles.id))
    .orderBy(asc(profiles.email));

  return NextResponse.json({
    canManageRoles: isSuperAdminRole(session.user.role),
    members: rows.map((row: any) => ({ ...row, role: resolveEffectiveRole(row.role, row.email) })),
  });
});

export const PATCH = requireSuperAdmin(async (req: NextRequest, session) => {
  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; role?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = normalizeRole(body.role);

  if (!userId || !role || !MANAGED_ROLES.has(role)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (userId === session.user.id) {
    return NextResponse.json({ error: "CANNOT_CHANGE_OWN_ROLE" }, { status: 400 });
  }

  const [member] = await db
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId));
  if (!member) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });
  if (resolveEffectiveRole(member.role, member.email) === "superadmin") {
    return NextResponse.json({ error: "CANNOT_CHANGE_SUPERADMIN" }, { status: 400 });
  }

  const now = new Date();
  try {
    await db
      .update(profiles)
      .set({ role, updatedAt: now })
      .where(eq(profiles.id, userId));
  } catch (error) {
    if (role !== "annotator" || !isLegacyRoleConstraintError(error)) throw error;
    await db
      .update(profiles)
      .set({ role: "expert", updatedAt: now })
      .where(eq(profiles.id, userId));
  }

  const [updated] = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      name: profiles.name,
      role: profiles.role,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));

  return NextResponse.json({ member: { ...updated, role: resolveEffectiveRole(updated.role, updated.email) } });
});
