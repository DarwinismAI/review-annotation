"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Activity, ClipboardList, Database, Gauge, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { preloadFastResource, useFastResource } from "@/hooks/use-fast-resource";
import { labelForDomain } from "@/lib/labels";

interface DatasetListItem {
  id: string;
  name: string;
  domain: string;
  status: string;
  rowCount: number;
  metricCount: number;
  latestImport: string | null;
  createdAt: string;
}

interface AdminDashboardSnapshot {
  totals: {
    datasets: number;
    rows: number;
    metrics: number;
    activeAnnotators: number;
    readyDatasets?: number;
    importingDatasets?: number;
  };
  recentDatasets: DatasetListItem[];
}

const EMPTY_DASHBOARD: AdminDashboardSnapshot = {
  totals: {
    datasets: 0,
    rows: 0,
    metrics: 0,
    activeAnnotators: 0,
    readyDatasets: 0,
    importingDatasets: 0,
  },
  recentDatasets: [],
};

export function DashboardDataRegion() {
  const dashboardResource = useFastResource<AdminDashboardSnapshot>("/api/admin/dashboard", EMPTY_DASHBOARD);
  const stats = dashboardResource.data;
  const error = dashboardResource.error;

  useEffect(() => {
    void preloadFastResource("/api/admin/members");
  }, []);

  return (
    <>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard icon={Database} label="Dataset" value={stats.totals.datasets} loading={dashboardResource.isInitialLoading} helper={`${stats.totals.readyDatasets ?? 0} ready`} />
        <OverviewCard icon={Activity} label="Dòng dữ liệu" value={stats.totals.rows} loading={dashboardResource.isInitialLoading} helper={`${stats.totals.importingDatasets ?? 0} đang import`} />
        <OverviewCard icon={ClipboardList} label="Metric" value={stats.totals.metrics} loading={dashboardResource.isInitialLoading} helper="Đang dùng để chấm" />
        <OverviewCard icon={Users} label="Annotator active" value={stats.totals.activeAnnotators} loading={dashboardResource.isInitialLoading} helper="Có thể nhận task" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dataset gần đây</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Metrics</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboardResource.isInitialLoading && stats.recentDatasets.length === 0 &&
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-14" /></TableCell>
                  </TableRow>
                ))}
              {!dashboardResource.isInitialLoading && stats.recentDatasets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-slate-500">
                    Chưa có dataset.
                  </TableCell>
                </TableRow>
              )}
              {stats.recentDatasets.map((dataset) => (
                <TableRow key={dataset.id}>
                  <TableCell className="font-medium text-slate-900">{dataset.name}</TableCell>
                  <TableCell>{labelForDomain(dataset.domain)}</TableCell>
                  <TableCell>{dataset.rowCount}</TableCell>
                  <TableCell>{dataset.metricCount}</TableCell>
                  <TableCell>
                    <Badge variant={dataset.status === "ready" ? "success" : "secondary"}>{dataset.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/datasets/${dataset.id}`}>Mở</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {dashboardResource.isRefreshing && stats.recentDatasets.length > 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-xs text-slate-400">
                    Đang cập nhật
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Lối tắt</h2>
            <p className="mt-1 text-sm text-slate-500">Đi nhanh tới các màn vận hành chính.</p>
          </div>
          <QuickLink href="/admin/datasets" icon={Database} label="Datasets" description="Import, append, assign data" />
          <QuickLink href="/admin/members" icon={Users} label="Thành viên" description="Role, domain, trạng thái annotator" />
          <QuickLink href="/admin/rubrics" icon={Gauge} label="Rubric" description="Metric gắn với lĩnh vực" />
        </div>
      </div>
    </>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  helper,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  helper: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          {loading ? <Skeleton className="mt-1 h-7 w-16" /> : <p className="text-2xl font-semibold text-slate-900">{value.toLocaleString("vi-VN")}</p>}
          <p className="truncate text-xs text-slate-500">{helper}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 transition-[background-color,color,transform] duration-100 ease-out hover:bg-slate-50 motion-reduce:transition-none"
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block truncate text-xs text-slate-500">{description}</span>
      </span>
    </Link>
  );
}
