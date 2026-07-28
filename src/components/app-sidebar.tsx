"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  ClipboardList,
  FileText,
  UserCircle,
} from "lucide-react";

// ─── Nav item definitions ──────────────────────────────────────────

const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/batches", label: "Đợt upload", icon: Package },
  { href: "/admin/experts", label: "Chuyên gia", icon: Users },
  { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
];

const EXPERT_NAV = [
  { href: "/expert/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/expert/articles", label: "Bài viết của tôi", icon: FileText },
  { href: "/expert/profile", label: "Hồ sơ", icon: UserCircle },
];


// ─── Component ─────────────────────────────────────────────────────

interface AppSidebarProps {
  variant: "admin" | "expert";
}

export function AppSidebar({ variant }: AppSidebarProps) {
  const pathname = usePathname();
  const items = variant === "admin" ? ADMIN_NAV : EXPERT_NAV;

  return (
    <aside className="hidden lg:flex w-56 bg-white border-r border-slate-200 flex-col shrink-0">
      {/* Brand */}
      <div className="h-14 flex items-center px-4 border-b border-slate-200">
        <Link
          href={variant === "admin" ? "/admin/dashboard" : "/expert/dashboard"}
          className="text-sm font-bold text-slate-900 tracking-tight"
        >
          Expert Review
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

    </aside>
  );
}
