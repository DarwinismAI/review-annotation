import { NextResponse } from "next/server";
import { isLocalDevelopment } from "@/lib/local-dev";

export async function POST() {
  if (!isLocalDevelopment()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("dev_role", "", {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 0,
  });
  return response;
}
