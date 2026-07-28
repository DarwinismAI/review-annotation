/**
 * Dev shortcut: hardcoded OTP "012345" mints a session for any existing
 * auth.users email. Skips real OTP delivery — service-role generates a
 * magic-link, then we exchange via SSR client so the cookie lands on
 * the response.
 *
 * Internal product, dev-only convenience. Security boundary = OTP literal.
 * Returns 401 if OTP wrong or email not in auth.users.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";

const DEV_OTP = "012345";

export async function POST(req: Request) {
  const { email, otp } = (await req.json().catch(() => ({}))) as {
    email?: string;
    otp?: string;
  };

  if (!email || otp !== DEV_OTP) {
    return NextResponse.json({ error: "Sai email hoặc mã" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link.properties?.hashed_token) {
    return NextResponse.json(
      { error: linkErr?.message ?? "Không tạo được phiên" },
      { status: 401 }
    );
  }

  const supabase = await getSupabaseServer();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr) {
    return NextResponse.json({ error: verifyErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
