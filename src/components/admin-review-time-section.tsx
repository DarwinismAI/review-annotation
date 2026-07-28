"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface BatchMetric {
  batchId: string;
  batchName: string;
  medianMinutes: number;
  p95Minutes: number;
  articleCount: number;
}

interface Outlier {
  title: string;
  minutes: number;
}

interface ReviewTimeData {
  since: string;
  metrics: BatchMetric[];
  top5Outliers: Outlier[];
}

function fmtMin(minutes: number): string {
  if (minutes < 1) return "<1 phút";
  return `${Math.round(minutes)} phút`;
}

/**
 * "Thời gian chấm" section for admin dashboard.
 * Per-batch median/P95 + top-5 outliers.
 */
export function AdminReviewTimeSection() {
  const [data, setData] = useState<ReviewTimeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/admin/review-time")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.data) setData(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sinceLabel = data?.since
    ? new Date(data.since).toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  const hasData =
    !loading && data && (data.metrics.length > 0 || data.top5Outliers.length > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-foreground">Thời gian chấm</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {loading ? "…" : `${data?.metrics.length ?? 0} đợt`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-6 py-10 flex justify-center">
            <Skeleton className="h-4 w-48" />
          </div>
        ) : !hasData ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu thời gian chấm trong 30 ngày gần nhất.
          </div>
        ) : (
          <>
            {/* Per-batch metrics table */}
            {data!.metrics.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Đợt</TableHead>
                    <TableHead className="text-center">Bài</TableHead>
                    <TableHead className="text-center">Trung vị</TableHead>
                    <TableHead className="text-center">P95</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.metrics.map((m) => (
                    <TableRow key={m.batchId}>
                      <TableCell className="font-medium">{m.batchName}</TableCell>
                      <TableCell className="text-center tabular-nums">
                        {m.articleCount}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {fmtMin(m.medianMinutes)}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">
                        {fmtMin(m.p95Minutes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Top-5 outliers */}
            {data!.top5Outliers.length > 0 && (
              <div className="px-6 py-4 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Top 5 bài tốn nhiều thời gian nhất
                </p>
                <ol className="space-y-1.5">
                  {data!.top5Outliers.map((o, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-muted-foreground font-mono text-xs w-4 shrink-0">
                        {i + 1}.
                      </span>
                      <span className="flex-1 line-clamp-1">{o.title}</span>
                      <span className="text-muted-foreground font-mono text-xs shrink-0 tabular-nums">
                        {fmtMin(o.minutes)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Footer */}
            {sinceLabel && (
              <div className="px-6 py-3 border-t bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Dữ liệu thời gian từ {sinceLabel}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
