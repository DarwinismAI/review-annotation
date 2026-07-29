"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  FileText,
  UserCircle,
  TableProperties,
} from "lucide-react";

// ─── Nav item definitions ──────────────────────────────────────────

const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/datasets", label: "Datasets", icon: TableProperties },
  { href: "/admin/members", label: "Thành viên", icon: Users },
  { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
];

const ANNOTATOR_NAV = [
  { href: "/annotator/tasks", label: "Task của tôi", icon: FileText },
  { href: "/annotator/profile", label: "Hồ sơ", icon: UserCircle },
];


// ─── Component ─────────────────────────────────────────────────────

interface AppSidebarProps {
  variant: "admin" | "annotator";
  role?: string;
}

export function AppSidebar({ variant }: AppSidebarProps) {
  const pathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const items = variant === "admin" ? ADMIN_NAV : ANNOTATOR_NAV;
  const activePath = optimisticPath ?? pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [pathname]);

  return (
    <aside className="hidden lg:flex w-56 bg-white border-r border-slate-200 flex-col shrink-0">
      {/* Brand */}
      <div className="h-14 flex items-center px-4 border-b border-slate-200">
        <Link
          href={variant === "admin" ? "/admin/dashboard" : "/annotator/tasks"}
          className="text-sm font-bold text-slate-900 tracking-tight"
        >
          Review Annotation
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = activePath === href || activePath.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setOptimisticPath(href);
              }}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,opacity,transform] duration-100 ease-out motion-reduce:transition-none ${
                active
                  ? "translate-x-0.5 bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
