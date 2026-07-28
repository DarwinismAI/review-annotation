import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: "SIGNUP_DISABLED",
        message: "Tạo tài khoản công khai đã tắt. Admin sẽ tạo tài khoản và phân quyền cho từng thành viên.",
      },
    },
    { status: 410 },
  );
}
