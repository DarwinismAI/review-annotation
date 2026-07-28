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
  TableProperties,
} from "lucide-react";

const ADMIN_NAV = [
  { href: "/admin/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/datasets", label: "Datasets", icon: TableProperties },
  { href: "/admin/batches", label: "Đợt upload", icon: Package },
  { href: "/admin/annotators", label: "Annotator", icon: Users },
  { href: "/admin/members", label: "Phân quyền", icon: Users },
  { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
];

const ANNOTATOR_NAV = [
  { href: "/annotator/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/annotator/tasks", label: "Task", icon: FileText },
  { href: "/annotator/profile", label: "Hồ sơ", icon: UserCircle },
];

interface AppMobileNavProps {
  variant: "admin" | "annotator";
  role?: string;
}

export function AppMobileNav({ variant, role }: AppMobileNavProps) {
  const pathname = usePathname();
  const items =
    variant === "admin" && role !== "superadmin"
      ? ADMIN_NAV.filter((item) => item.href !== "/admin/members")
      : variant === "admin"
        ? ADMIN_NAV
        : ANNOTATOR_NAV;

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 flex items-center justify-around h-16 px-1 safe-area-pb"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-1 px-3 py-1 rounded-lg text-xs transition-colors min-w-[56px] ${
              active
                ? "text-blue-700"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? "text-blue-700" : ""}`} />
            <span className={`font-medium truncate ${active ? "font-semibold" : ""}`}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
