import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { isAdminRole, isAnnotatorRole } from "@/lib/roles";
import { AppSidebar } from "./app-sidebar";
import { AppHeader } from "./app-header";
import { AppMobileNav } from "./app-mobile-nav";

// ─── Props ─────────────────────────────────────────────────────────

interface AppShellProps {
  children: React.ReactNode;
  /** Determines sidebar nav items and role gate. */
  variant: "admin" | "annotator";
}

// ─── Component ─────────────────────────────────────────────────────

/**
 * Shared layout shell for admin + annotator pages.
 *
 * - Server-side session check → redirects unauthenticated users to /login.
 * - Role gate → mismatched role redirects to the correct dashboard.
 * - Renders fixed sidebar (w-56) + top bar + scrollable content area.
 *
 * Pages that need full-viewport (e.g. the review split-panel) should NOT
 * use this shell - they live under `/review/` with their own layout.
 */
export async function AppShell({ children, variant }: AppShellProps) {
  const session = await getSession();

  if (!session) redirect("/login");

  // Role gate
  if (variant === "admin" && !isAdminRole(session.role)) {
    redirect("/annotator/dashboard");
  }
  if (variant === "annotator" && !isAnnotatorRole(session.role)) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex">
        <AppSidebar variant={variant} role={session.role} />
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader />
        <main className="min-w-0 flex-1 px-4 py-4 lg:px-6 lg:py-6 max-w-7xl w-full mx-auto pb-20 lg:pb-6">
          {children}
        </main>
      </div>
      <AppMobileNav variant={variant} role={session.role} />
    </div>
  );
}
