import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth-middleware";
import { normalizeRole } from "@/lib/roles";

const MANAGED_ROLES = new Set(["admin", "annotator"]);

export const GET = requireSuperAdmin(async () => {
  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      name: profiles.name,
      role: profiles.role,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    })
    .from(profiles);

  return NextResponse.json({
    members: rows
      .map((row: any) => ({ ...row, role: normalizeRole(row.role) ?? row.role }))
      .sort((a: any, b: any) => String(a.email).localeCompare(String(b.email))),
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

  const [member] = await db.select({ id: profiles.id, role: profiles.role }).from(profiles).where(eq(profiles.id, userId));
  if (!member) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });
  if (normalizeRole(member.role) === "superadmin") {
    return NextResponse.json({ error: "CANNOT_CHANGE_SUPERADMIN" }, { status: 400 });
  }

  const now = new Date();
  await db
    .update(profiles)
    .set({ role, updatedAt: now })
    .where(eq(profiles.id, userId));

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

  return NextResponse.json({ member: { ...updated, role: normalizeRole(updated.role) ?? updated.role } });
});
