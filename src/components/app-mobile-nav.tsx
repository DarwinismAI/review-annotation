"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  ClipboardList,
  FileText,
  UserCircle,
  TableProperties,
} from "lucide-react";

const ADMIN_NAV = [
  { href: "/admin/datasets", label: "Datasets", icon: TableProperties },
  { href: "/admin/members", label: "Thành viên", icon: Users },
  { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
];

const ANNOTATOR_NAV = [
  { href: "/annotator/tasks", label: "Task", icon: FileText },
  { href: "/annotator/profile", label: "Hồ sơ", icon: UserCircle },
];

interface AppMobileNavProps {
  variant: "admin" | "annotator";
  role?: string;
}

export function AppMobileNav({ variant }: AppMobileNavProps) {
  const pathname = usePathname();
  const items = variant === "admin" ? ADMIN_NAV : ANNOTATOR_NAV;

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
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1 text-xs font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] ${
              active
                ? "bg-blue-50 text-blue-700"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? "text-blue-700" : ""}`} />
            <span className="max-w-full truncate">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
