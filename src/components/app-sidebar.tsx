"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";

interface AppSidebarProps {
  variant: "admin" | "annotator";
  role?: string;
}

export function AppSidebar({ variant }: AppSidebarProps) {
  const pathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
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

      <AppNavigation
        activePath={activePath}
        layout="sidebar"
        onOptimisticNavigate={setOptimisticPath}
        variant={variant}
      />
    </aside>
  );
}
