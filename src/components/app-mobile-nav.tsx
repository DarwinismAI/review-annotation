"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";

interface AppMobileNavProps {
  variant: "admin" | "annotator";
  role?: string;
}

export function AppMobileNav({ variant }: AppMobileNavProps) {
  const pathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const activePath = optimisticPath ?? pathname;

  useEffect(() => {
    setOptimisticPath(null);
  }, [pathname]);

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white safe-area-pb"
    >
      <AppNavigation
        activePath={activePath}
        layout="mobile"
        onOptimisticNavigate={setOptimisticPath}
        variant={variant}
      />
    </div>
  );
}
