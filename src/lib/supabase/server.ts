import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { isLocalDevelopment } from "@/lib/local-dev";
import { isAdminRole, normalizeRole, resolveEffectiveRole, type AppRole } from "@/lib/roles";
export type { AppRole } from "@/lib/roles";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * SSR Supabase client bound to the request cookie store.
 * Use inside Server Components, Route Handlers, and Server Actions.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // setAll called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client for privileged ops (admin user creation, bulk imports).
 * Bypasses RLS — never expose to the browser, never use for end-user requests.
 */
export function getSupabaseAdmin() {
  return createSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AppSession {
  userId: string;
  email: string;
  name: string | null;
  role: AppRole;
}

/** Returns the active session or null. Never throws. */
export async function getSession(): Promise<AppSession | null> {
  // ── Local SQLite dev bypass ──
  if (isLocalDevelopment()) {
    const cookieStore = await cookies();
    const cookieRole = normalizeRole(cookieStore.get("dev_role")?.value);
    if (cookieRole) {
      const devId =
        cookieRole === "annotator"
          ? "00000000-0000-0000-0000-000000000002"
          : cookieRole === "superadmin"
            ? "00000000-0000-0000-0000-000000000099"
            : "00000000-0000-0000-0000-000000000001";
      const devEmail =
        cookieRole === "annotator"
          ? "annotator@review-annotation.local"
          : cookieRole === "superadmin"
            ? "superadmin@review-annotation.local"
            : "admin@review-annotation.local";
      return { userId: devId, email: devEmail, name: null, role: cookieRole };
    }
    return null;
  }

  // ── Production: Supabase Auth ──
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role,email,name")
    .eq("id", user.id)
    .single();
  if (!profile) return null;
  return {
    userId: user.id,
    email: profile.email,
    name: (profile.name as string | null) ?? null,
    role: resolveEffectiveRole(profile.role, profile.email),
  };
}

/** Throws 401-equivalent (returns null) if no session — caller decides what to do. */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function requireRole(role: AppRole): Promise<AppSession> {
  const session = await requireSession();
  if (role === "admin" ? !isAdminRole(session.role) : session.role !== role) throw new Error("FORBIDDEN");
  return session;
}
