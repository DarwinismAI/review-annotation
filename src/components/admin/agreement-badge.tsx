"use client";

import { Progress } from "@/components/ui/progress";

interface AgreementBadgeProps {
  agreement: number | null;
}

export function AgreementBadge({ agreement }: AgreementBadgeProps) {
  if (agreement === null) {
    return <span className="text-sm text-slate-400">—</span>;
  }

  const color = agreement < 70 ? "text-red-600" : agreement < 85 ? "text-amber-700" : "text-slate-700";

  return (
    <div className="flex min-w-[92px] items-center gap-2">
      <Progress value={agreement} className="h-1.5 w-12" />
      <span className={`text-xs font-medium ${color}`}>{agreement}%</span>
    </div>
  );
}
