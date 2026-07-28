import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "PASSWORD_LOGIN_REQUIRED",
        message: "Đường đăng nhập này đã tắt. Vui lòng dùng email và mật khẩu.",
      },
    },
    { status: 410 },
  );
}
