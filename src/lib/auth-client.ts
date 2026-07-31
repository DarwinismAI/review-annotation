"use client";
/** Browser auth helpers for pre-created Supabase accounts. */
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { normalizeRole, type AppRole } from "@/lib/roles";
import { clearFastResourceCache, setFastResourceSession } from "@/hooks/use-fast-resource";

export async function signOut() {
  const supabase = getSupabaseBrowser();
  clearFastResourceCache();
  setFastResourceSession(null);
  try {
    await supabase.auth.signOut();
  } finally {
    clearFastResourceCache();
    setFastResourceSession(null);
  }
}

export async function signInWithPassword({ email, password }: { email: string; password: string }) {
  clearFastResourceCache();
  setFastResourceSession(null);
  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (isLocalhost) {
    const localRes = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (localRes.status !== 404) {
      if (localRes.ok) {
        clearFastResourceCache();
        return;
      }
      const body = (await localRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Email hoặc mật khẩu không đúng");
    }
  }

  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  clearFastResourceCache();
}

export interface ClientSessionUser {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
}

export async function getSessionUser(): Promise<ClientSessionUser | null> {
  // Server route is authoritative because middleware/layout auth is cookie-based.
  // Reading the browser Supabase cache first can show a stale previous user after
  // the admin shortcut mints a fresh server cookie.
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.ok) {
      const user = (await res.json()) as ClientSessionUser | null;
      if (user) {
        setFastResourceSession(user.id);
        return user;
      }
    }
  } catch {}

  const supabase = getSupabaseBrowser();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    setFastResourceSession(null);
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,email,name")
    .eq("id", user.id)
    .single();

  if (!profile) {
    setFastResourceSession(null);
    return null;
  }
  const role = normalizeRole(profile.role);
  if (!role) {
    setFastResourceSession(null);
    return null;
  }
  setFastResourceSession(user.id);
  return {
    id: user.id,
    email: profile.email,
    name: (profile.name as string | null) ?? null,
    role,
  };
}
