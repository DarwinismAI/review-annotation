import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;

const PUBLIC_AUTH_PREFIXES = ["/login", "/signup"];

/**
 * Edge middleware — refreshes the Supabase session cookie on every request to
 * /admin/** and /expert/**, then redirects to /login if there's no valid user.
 * The role check happens server-side in the segment layouts.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow auth flow pages.
  if (PUBLIC_AUTH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const isAdmin = pathname.startsWith("/admin");
  const isExpert = pathname.startsWith("/expert");
  if (!isAdmin && !isExpert) return NextResponse.next();

  // ── Local SQLite dev bypass: skip Supabase auth check ──
  if (process.env.LOCAL_DB_PATH) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (user) return res;

  const redirectUrl = new URL("/login", req.url);
  redirectUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/expert/:path*"],
};
