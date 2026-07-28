"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, ArrowLeft, Search } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminReviewTimeSection } from "@/components/admin-review-time-section";
import { ClaimVerdictDashboardSection } from "@/components/admin/claim-verdict-dashboard-section";
import { DOMAIN_LABELS, type DomainKey, labelForDomain } from "@/lib/labels";

// ─── Types ──────────────────────────────────────────────────────────

interface DashboardData {
  totalArticles: number;
  completed: number;
  inReview: number;
  unassigned: number;
  overdue: number;
  avgReviewTimeMinutes: number;
}

interface ExpertApiRow {
  expertId: string;
  name: string;
  domain: string;
  domains?: string[];
  articlesAssigned: number;
  articlesCompleted: number;
  avgScore: number;
  avgTimeMinutes: number;
  totalPay: number;
}

interface ExpertStat {
  id: string;
  name: string;
  assigned: number;
  completed: number;
  avgTimeMinutes: number;
  avgScore: number;
  domain: string;
  domains: string[];
  isActive: boolean;
  initials: string;
  avatarCls: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-green-500",
  "bg-indigo-500",
  "bg-rose-500",
];

function makeInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function pickAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function toExpertStat(row: ExpertApiRow): ExpertStat {
  const assigned = row.articlesAssigned ?? 0;
  const completed = row.articlesCompleted ?? 0;
  return {
    id: row.expertId,
    name: row.name && row.name !== "-" ? row.name : "Annotator",
    assigned,
    completed,
    avgTimeMinutes: row.avgTimeMinutes ?? 0,
    avgScore: Number(row.avgScore ?? 0),
    domain: row.domain ?? "-",
    domains: row.domains?.length ? row.domains : row.domain && row.domain !== "-" ? [row.domain] : [],
    isActive: completed > 0 || assigned > 0,
    initials: makeInitials(row.name && row.name !== "-" ? row.name : "Annotator"),
    avatarCls: pickAvatarColor(row.expertId),
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function domainLabelsForExpert(expert: ExpertStat): string[] {
  return expert.domains.length > 0
    ? expert.domains.map((domain) => labelForDomain(domain))
    : [labelForDomain(expert.domain)];
}

function formatUpdatedLabel(): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

// ─── Sub-components ─────────────────────────────────────────────────

/** Single KPI stat card with label, value, and percentage badge. */
function StatCard({
  label,
  value,
  pct,
  loading,
  tone = "neutral",
}: {
  label: string;
  value: string;
  pct: number;
  loading: boolean;
  tone?: "success" | "info" | "danger" | "neutral";
}) {
  const toneVariants: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
    success: "success",
    info: "secondary",
    danger: "destructive",
    neutral: "outline",
  };

  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
        )}
        {loading ? (
          <Skeleton className="h-5 w-12" />
        ) : (
          <Badge variant={toneVariants[tone]} className="self-start text-xs">
            {pct}%
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

/** Skeleton row for table loading state. */
function TableSkeleton({ cols }: { cols: number }) {
  return (
    <TableRow>
      {Array.from({ length: cols }).map((_, i) => (
        <TableCell key={i}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [annotators, setAnnotators] = useState<ExpertStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [domainFilter, setDomainFilter] = useState<"all" | DomainKey>("all");

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/admin")
        .then((r) => r.json())
        .catch(() => ({})),
      fetch("/api/dashboard/admin/annotators")
        .then((r) => r.json())
        .catch(() => ({})),
    ])
      .then(([statsJson, expertsJson]) => {
        if (statsJson.data) setData(statsJson.data);
        const rows: ExpertApiRow[] = expertsJson.data ?? [];
        setAnnotators(rows.map(toExpertStat));
      })
      .finally(() => setLoading(false));
  }, []);

  const completedCount = data?.completed ?? 0;
  const totalCount = data?.totalArticles ?? 0;
  const inReviewCount = data?.inReview ?? 0;
  const overdueCount = data?.overdue ?? 0;

  const completedPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const inReviewPct = totalCount > 0 ? Math.round((inReviewCount / totalCount) * 100) : 0;
  const overduePct = totalCount > 0 ? Math.round((overdueCount / totalCount) * 100) : 0;
  const filteredExperts = useMemo(() => {
    const query = normalizeText(searchTerm);
    return annotators.filter((expert) => {
      const domainLabels = domainLabelsForExpert(expert);
      const matchesDomain = domainFilter === "all" || expert.domains.includes(domainFilter);
      const matchesQuery =
        query.length === 0 ||
        normalizeText([expert.name, expert.domain, ...expert.domains, ...domainLabels].join(" ")).includes(query);
      return matchesDomain && matchesQuery;
    });
  }, [domainFilter, annotators, searchTerm]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Dashboard - Đợt review Q3/2026
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cập nhật: {formatUpdatedLabel()}
          </p>
        </div>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Xuất kết quả
        </Button>
      </div>

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Đã hoàn thành"
          value={loading ? "" : `${completedCount} / ${totalCount}`}
          pct={completedPct}
          loading={loading}
          tone="success"
        />
        <StatCard
          label="Đang chờ review"
          value={loading ? "" : String(inReviewCount)}
          pct={inReviewPct}
          loading={loading}
          tone="info"
        />
        <StatCard
          label="Quá hạn"
          value={loading ? "" : String(overdueCount)}
          pct={overduePct}
          loading={loading}
          tone={overdueCount > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* ── Annotator Stats Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-foreground">Thống kê theo annotator</CardTitle>
            {!loading && (
              <Badge variant="secondary" className="text-xs">
                {filteredExperts.length}/{annotators.length} annotator
              </Badge>
            )}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Tìm tên annotator hoặc lĩnh vực..."
                className="pl-9"
              />
            </div>
            <Select value={domainFilter} onValueChange={(value) => setDomainFilter(value as "all" | DomainKey)}>
              <SelectTrigger aria-label="Lọc theo lĩnh vực">
                <SelectValue placeholder="Tất cả lĩnh vực" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả lĩnh vực</SelectItem>
                {Object.entries(DOMAIN_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Annotator</TableHead>
                <TableHead>Lĩnh vực</TableHead>
                <TableHead className="text-center">Đã review</TableHead>
                <TableHead className="text-center">Tiến độ</TableHead>
                <TableHead className="text-center">TB thời gian</TableHead>
                <TableHead className="text-center">Điểm TB</TableHead>
                <TableHead className="text-center">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <>
                  <TableSkeleton cols={7} />
                  <TableSkeleton cols={7} />
                  <TableSkeleton cols={7} />
                  <TableSkeleton cols={7} />
                </>
              ) : annotators.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Chưa có annotator nào nhận bài.
                  </TableCell>
                </TableRow>
              ) : filteredExperts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Không có annotator phù hợp bộ lọc.
                  </TableCell>
                </TableRow>
              ) : (
                filteredExperts.map((ex) => {
                  const progressPct =
                    ex.assigned > 0 ? Math.round((ex.completed / ex.assigned) * 100) : 0;
                  const scoreColor =
                    ex.avgScore >= 7
                      ? "text-green-600"
                      : ex.avgScore >= 5
                        ? "text-amber-600"
                        : "text-red-600";
                  return (
                    <TableRow key={ex.id}>
                      {/* Name + Avatar */}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={`${ex.avatarCls} text-white text-xs font-semibold`}>
                              {ex.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">{ex.name}</span>
                        </div>
                      </TableCell>
                      {/* Domain labels */}
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {domainLabelsForExpert(ex).map((label) => (
                            <Badge key={label} variant="outline" className="text-xs">
                              {label}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      {/* Reviewed count */}
                      <TableCell className="text-center tabular-nums">
                        {ex.completed}/{ex.assigned}
                      </TableCell>
                      {/* Progress bar */}
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <Progress value={progressPct} className="w-20" />
                          <span className="text-xs text-muted-foreground w-8 tabular-nums">
                            {progressPct}%
                          </span>
                        </div>
                      </TableCell>
                      {/* Avg time */}
                      <TableCell className="text-center text-muted-foreground tabular-nums">
                        {ex.avgTimeMinutes} phút
                      </TableCell>
                      {/* Avg score */}
                      <TableCell className="text-center">
                        <span className={`font-semibold tabular-nums ${scoreColor}`}>
                          {ex.avgScore.toFixed(1)}
                        </span>
                      </TableCell>
                      {/* Status */}
                      <TableCell className="text-center">
                        <Badge
                          variant={ex.isActive ? "success" : "secondary"}
                          className="text-xs"
                        >
                          {ex.isActive ? "Hoạt động" : "Chưa nhận bài"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Detail Sections ── */}
      <AdminReviewTimeSection />
      <ClaimVerdictDashboardSection />

      {/* ── Back Link ── */}
      <Button variant="ghost" className="gap-1.5 text-muted-foreground" asChild>
        <Link href="/admin/batches">
          <ArrowLeft className="h-4 w-4" />
          Quản lý bài viết
        </Link>
      </Button>
    </div>
  );
}
