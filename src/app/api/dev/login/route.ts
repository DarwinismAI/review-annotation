import { NextRequest, NextResponse } from "next/server";
import { isLocalDevelopment } from "@/lib/local-dev";
import type { AppRole } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/roles";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePassword(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveLocalRole(email: string): Promise<AppRole | null> {
  if (email === "superadmin@local.dev") return "superadmin";
  if (email === "admin@local.dev") return "admin";
  if (email === "expert@local.dev" || email === "annotator@local.dev") return "annotator";

  const [{ eq }, { db }, { profiles }] = await Promise.all([
    import("drizzle-orm"),
    import("@/db/client"),
    import("@/db/schema.sqlite"),
  ]);
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.email, email));

  return normalizeRole(profile?.role);
}

export async function POST(req: NextRequest) {
  if (!isLocalDevelopment()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  if (!email || !password) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không hợp lệ" }, { status: 400 });
  }

  const role = await resolveLocalRole(email);
  const expectedPassword =
    role === "superadmin"
      ? process.env.SUPERADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD
      : role === "admin"
      ? process.env.ADMIN_PASSWORD
      : role === "annotator"
        ? process.env.EXPERT_PASSWORD
        : null;
  if (!role) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
  }
  if (!expectedPassword) {
    return NextResponse.json({ error: "LOCAL_AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (password !== expectedPassword) {
    return NextResponse.json({ error: "Email hoặc mật khẩu không đúng" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role });
  response.cookies.set("dev_role", role, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
  return response;
}
