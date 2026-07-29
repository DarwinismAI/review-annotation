"use client";

import { useEffect, type ComponentType, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  TableProperties,
  UserCircle,
  Users,
} from "lucide-react";

type NavVariant = "admin" | "annotator";
type NavLayout = "sidebar" | "mobile";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: Record<NavVariant, NavItem[]> = {
  admin: [
    { href: "/admin/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/admin/datasets", label: "Datasets", icon: TableProperties },
    { href: "/admin/members", label: "Thành viên", icon: Users },
    { href: "/admin/rubrics", label: "Rubric", icon: ClipboardList },
  ],
  annotator: [
    { href: "/annotator/tasks", label: "Task của tôi", icon: FileText },
    { href: "/annotator/profile", label: "Hồ sơ", icon: UserCircle },
  ],
};

interface AppNavigationProps {
  activePath: string;
  layout: NavLayout;
  onOptimisticNavigate: (href: string) => void;
  variant: NavVariant;
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function isActivePath(activePath: string, href: string) {
  return activePath === href || activePath.startsWith(href + "/");
}

export function AppNavigation({ activePath, layout, onOptimisticNavigate, variant }: AppNavigationProps) {
  const router = useRouter();
  const items = NAV_ITEMS[variant];
  const containerClass =
    layout === "sidebar" ? "flex-1 px-2 py-3 space-y-0.5" : "flex h-16 items-center justify-around px-1";

  useEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
  }, [items, router]);

  return (
    <nav aria-label={layout === "sidebar" ? "Primary navigation" : "Mobile navigation"} className={containerClass}>
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(activePath, href);
        const linkClass =
          layout === "sidebar"
            ? `flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-[background-color,color,opacity,transform] duration-100 ease-out motion-reduce:transition-none ${
                active
                  ? "bg-blue-50 text-blue-700 motion-safe:translate-x-0.5"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`
            : `flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium transition-[background-color,color,opacity,transform] duration-100 ease-out motion-reduce:transition-none ${
                active ? "bg-blue-50 text-blue-700 motion-safe:-translate-y-0.5" : "text-slate-500 hover:text-slate-900"
              }`;

        return (
          <Link
            key={href}
            href={href}
            onClick={(event) => {
              if (isModifiedClick(event)) return;
              onOptimisticNavigate(href);
            }}
            onFocus={() => router.prefetch(href)}
            onMouseEnter={() => router.prefetch(href)}
            aria-current={active ? "page" : undefined}
            className={linkClass}
          >
            <Icon className={layout === "sidebar" ? "h-4 w-4 shrink-0" : `h-5 w-5 ${active ? "text-blue-700" : ""}`} />
            <span className={layout === "sidebar" ? undefined : "max-w-full truncate"}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
