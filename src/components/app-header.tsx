"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSessionUser, signOut, type ClientSessionUser } from "@/lib/auth-client";
import { ROLE_LABELS } from "@/lib/labels";

// ─── Helpers ───────────────────────────────────────────────────────

function initials(u: ClientSessionUser): string {
  const src = u.name ?? u.email ?? "?";
  return src
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatarBg(role: string): string {
  if (role === "superadmin") return "bg-violet-600";
  return role === "admin" ? "bg-blue-500" : "bg-amber-500";
}

function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

// ─── Component ─────────────────────────────────────────────────────

export function AppHeader() {
  const router = useRouter();
  const [user, setUser] = useState<ClientSessionUser | null>(null);

  useEffect(() => {
    getSessionUser().then(setUser).catch(() => setUser(null));
  }, []);

  async function handleLogout() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-end px-6 shrink-0 gap-3">
      {user && (
        <>
          <span className="text-sm text-slate-500 mr-auto">
            {roleLabel(user.role)}
          </span>
          <div
            className={`w-8 h-8 ${avatarBg(user.role)} rounded-full flex items-center justify-center`}
          >
            <span className="text-xs font-bold text-white">
              {initials(user)}
            </span>
          </div>
        </>
      )}
      <button
        onClick={handleLogout}
        className="text-slate-400 hover:text-red-500 transition-colors"
        title="Đăng xuất"
        aria-label="Đăng xuất"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
