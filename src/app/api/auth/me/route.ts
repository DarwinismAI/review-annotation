import { NextResponse } from "next/server";
import { getSession } from "@/lib/supabase/server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json(null);
  return NextResponse.json({
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
  });
}
