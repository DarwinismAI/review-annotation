"use client";

import { Badge } from "@/components/ui/badge";

interface OverlapBadgeProps {
  overlapLabel: string;
  missingCount: number;
}

export function OverlapBadge({ overlapLabel, missingCount }: OverlapBadgeProps) {
  if (missingCount > 0) {
    return <Badge variant="warning">thiếu {missingCount}</Badge>;
  }

  return <Badge variant="secondary">{overlapLabel}</Badge>;
}
