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

interface BatchRow {
  id: string;
  name: string;
  domain: string;
  status: string;
  createdAt: string;
}

interface BatchSummary {
  batchId: string;
  batchName: string;
  totalComments: number;
  totalRatings: number;
  unsureRatio: number;
  incorrectRatio: number;
  correctRatio: number;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function unsureBadge(ratio: number): "warning" | "secondary" {
  return ratio >= 0.3 ? "warning" : "secondary";
}

// ─── Sub-components ─────────────────────────────────────────────

function VerdictCard({
  label,
  ratio,
  valueCls,
  badgeVariant,
}: {
  label: string;
  ratio: number;
  valueCls: string;
  badgeVariant: "success" | "destructive" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={`text-3xl font-bold text-foreground ${valueCls}`}>{pct(ratio)}</p>
        <Badge variant={badgeVariant} className="self-start text-xs">
          tỷ lệ verdict
        </Badge>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────

/**
 * Dashboard section: cross-batch aggregation of claim verdicts
 * (correct / incorrect / unsure ratios) with top-5 highest-unsure batches.
 */
export function ClaimVerdictDashboardSection() {
  const [summaries, setSummaries] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalComments, setTotalComments] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [globalUnsure, setGlobalUnsure] = useState(0);
  const [globalIncorrect, setGlobalIncorrect] = useState(0);
  const [globalCorrect, setGlobalCorrect] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const batchesRes = await fetch("/api/batches");
        if (!batchesRes.ok) return;
        const batchesJson = (await batchesRes.json()) as { data: BatchRow[] };
        const batches: BatchRow[] = batchesJson.data ?? [];
        if (batches.length === 0) {
          setLoading(false);
          return;
        }

        const results = await Promise.all(
          batches.map(async (b) => {
            try {
              const res = await fetch(`/api/admin/batches/${b.id}/comments-summary`);
              if (!res.ok) return null;
              const json = (await res.json()) as {
                data: {
                  totalComments: number;
                  totalRatings: number;
                  correctRatio: number;
                  incorrectRatio: number;
                  unsureRatio: number;
                };
              };
              return { batchId: b.id, batchName: b.name, ...json.data };
            } catch {
              return null;
            }
          })
        );

        const valid = results.filter(Boolean) as BatchSummary[];

        let comments = 0;
        let ratings = 0;
        let unsure = 0;
        let incorrect = 0;
        let correct = 0;

        for (const s of valid) {
          comments += s.totalComments;
          ratings += s.totalRatings;
          unsure += Math.round(s.unsureRatio * s.totalRatings);
          incorrect += Math.round(s.incorrectRatio * s.totalRatings);
          correct += Math.round(s.correctRatio * s.totalRatings);
        }

        setTotalComments(comments);
        setTotalRatings(ratings);
        setGlobalUnsure(ratings > 0 ? unsure / ratings : 0);
        setGlobalIncorrect(ratings > 0 ? incorrect / ratings : 0);
        setGlobalCorrect(ratings > 0 ? correct / ratings : 0);

        setSummaries(valid.sort((a, b) => b.unsureRatio - a.unsureRatio));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ─── Loading ─────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 flex items-center gap-3">
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (totalRatings === 0 && totalComments === 0) return null;

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Section header + badges */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight text-foreground">
          Tổng quan đánh giá claim
        </h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {totalComments} bình luận
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {totalRatings} đánh giá
          </Badge>
        </div>
      </div>

      {/* Global verdict cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <VerdictCard
          label="Đúng (tất cả đợt)"
          ratio={globalCorrect}
          valueCls="text-green-600"
          badgeVariant="success"
        />
        <VerdictCard
          label="Sai (tất cả đợt)"
          ratio={globalIncorrect}
          valueCls="text-red-600"
          badgeVariant="destructive"
        />
        <VerdictCard
          label="Không chắc (tất cả đợt)"
          ratio={globalUnsure}
          valueCls="text-amber-600"
          badgeVariant="warning"
        />
      </div>

      {/* Top batches table */}
      {summaries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">
              Các đợt có tỷ lệ &ldquo;không chắc&rdquo; cao nhất
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Đợt upload</TableHead>
                  <TableHead className="text-center">Bình luận</TableHead>
                  <TableHead className="text-center">Đánh giá</TableHead>
                  <TableHead className="text-center">Đúng</TableHead>
                  <TableHead className="text-center">Sai</TableHead>
                  <TableHead className="text-center">Không chắc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.slice(0, 5).map((s) => (
                  <TableRow key={s.batchId}>
                    <TableCell>
                      <a
                        href={`/admin/batches/${s.batchId}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {s.batchName}
                      </a>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {s.totalComments}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {s.totalRatings}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-green-600 font-medium tabular-nums">
                        {pct(s.correctRatio)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-red-600 font-medium tabular-nums">
                        {pct(s.incorrectRatio)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={unsureBadge(s.unsureRatio)}
                        className="text-xs"
                      >
                        {pct(s.unsureRatio)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
