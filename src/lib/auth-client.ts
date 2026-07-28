"use client";
/**
 * Browser auth helpers — passwordless OTP via Supabase (path A iter-3).
 *
 * Email OTP flow:
 *   1) `sendOtp({ email, mode })` — mode: "login" (no create) or "signup" (create user).
 *   2) `verifyOtp({ email, token })` — exchanges OTP for a session cookie.
 *   3) `signOut()` — clears session.
 *
 * `getSessionUser()` returns `{ id, email, role } | null` for client components
 * that need to render based on session state without an extra fetch.
 */
import { getSupabaseBrowser } from "@/lib/supabase/client";

export type SendOtpMode = "login" | "signup";

export async function sendOtp({ email, mode }: { email: string; mode: SendOtpMode }) {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: mode === "signup" },
  });
  if (error) throw new Error(error.message);
}

export async function verifyOtp({ email, token }: { email: string; token: string }) {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  const supabase = getSupabaseBrowser();
  await supabase.auth.signOut();
}

/** Email + password login — admin escape hatch, không lộ trên `/login` thường. */
export async function signInWithPassword({ email, password }: { email: string; password: string }) {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export interface ClientSessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "expert";
}

export async function getSessionUser(): Promise<ClientSessionUser | null> {
  // Server route is authoritative because middleware/layout auth is cookie-based.
  // Reading the browser Supabase cache first can show a stale previous user after
  // the admin shortcut mints a fresh server cookie.
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (res.ok) {
      const user = (await res.json()) as ClientSessionUser | null;
      if (user) return user;
    }
  } catch {}

  const supabase = getSupabaseBrowser();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,email,name")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return {
    id: user.id,
    email: profile.email,
    name: (profile.name as string | null) ?? null,
    role: profile.role as "admin" | "expert",
  };
}
