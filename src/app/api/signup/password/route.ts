import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { expertProfiles, profiles } from "@/db/schema";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

const MIN_PASSWORD_LENGTH = 8;
const MAX_AUTH_USERS_TO_SCAN = 1000;

type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

class SignupHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly status: number,
  ) {
    super(userMessage);
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < MIN_PASSWORD_LENGTH) return null;
  return value;
}

async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: MAX_AUTH_USERS_TO_SCAN });
  if (error) throw error;
  return (data.users as AuthUser[]).find((user) => user.email?.toLowerCase() === email) ?? null;
}

async function assertSignupCanSetPassword(userId: string, email: string) {
  const [profile] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (profile?.role === "admin") {
    throw new SignupHttpError(
      "EMAIL_NOT_AVAILABLE",
      "Email này không dùng để đăng ký chuyên gia",
      409,
    );
  }

  const [existingExpertProfile] = await db
    .select({ id: expertProfiles.id })
    .from(expertProfiles)
    .where(eq(expertProfiles.userId, userId));

  if (existingExpertProfile) {
    throw new SignupHttpError(
      "EMAIL_ALREADY_REGISTERED",
      "Email này đã đăng ký. Vui lòng đăng nhập.",
      409,
    );
  }

  if (!profile) {
    await db.insert(profiles).values({ id: userId, email, role: "expert" });
  } else {
    await db.update(profiles).set({ email, role: "expert", updatedAt: new Date() }).where(eq(profiles.id, userId));
  }
}

async function createOrUpdateSignupUser(email: string, password: string): Promise<AuthUser> {
  const admin = getSupabaseAdmin();
  const existingUser = await findAuthUserByEmail(email);

  if (existingUser) {
    await assertSignupCanSetPassword(existingUser.id, email);

    const { data, error } = await admin.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: { ...(existingUser.user_metadata ?? {}), role: "expert" },
    });
    if (error || !data.user) throw error ?? new Error("Không cập nhật được tài khoản");
    return data.user as AuthUser;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "expert" },
  });
  if (error || !data.user) throw error ?? new Error("Không tạo được tài khoản");

  await assertSignupCanSetPassword(data.user.id, email);
  return data.user as AuthUser;
}

async function mintSessionCookie(email: string) {
  const admin = getSupabaseAdmin();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link.properties?.hashed_token) {
    throw linkErr ?? new Error("Không tạo được phiên đăng nhập");
  }

  const supabase = await getSupabaseServer();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr) throw verifyErr;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);

  if (!email) {
    return NextResponse.json(
      { error: { code: "INVALID_EMAIL", message: "Email không hợp lệ" } },
      { status: 400 }
    );
  }

  if (!password) {
    return NextResponse.json(
      { error: { code: "INVALID_PASSWORD", message: "Mật khẩu phải có ít nhất 8 ký tự" } },
      { status: 400 }
    );
  }

  try {
    await createOrUpdateSignupUser(email, password);
    await mintSessionCookie(email);
    return NextResponse.json({ data: { next: "/signup/profile" } });
  } catch (err) {
    if (err instanceof SignupHttpError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.userMessage } },
        { status: err.status },
      );
    }
    console.error("[signup/password] failed:", err);
    return NextResponse.json(
      { error: { code: "SIGNUP_FAILED", message: "Không đăng ký được, vui lòng thử lại" } },
      { status: 500 }
    );
  }
}
