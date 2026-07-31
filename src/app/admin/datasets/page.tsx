"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFastResource } from "@/hooks/use-fast-resource";
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

interface DatasetsPayload {
  datasets?: DatasetListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
}

const EMPTY_DATASETS: DatasetsPayload = { datasets: [] };
const PAGE_SIZE = 50;

export default function AdminDatasetsPage() {
  const [requestedPage, setRequestedPage] = useState(1);
  const { data, error, isInitialLoading, isRefreshing, reload } = useFastResource<DatasetsPayload>(`/api/datasets?page=${requestedPage}&pageSize=${PAGE_SIZE}&counts=1`, EMPTY_DATASETS);
  const datasets = data.datasets ?? [];
  const total = data.total ?? datasets.length;
  const totalPages = Math.max(Math.ceil(total / (data.pageSize ?? PAGE_SIZE)), 1);
  const displayedPage = data.page ?? requestedPage;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Datasets</h1>
          <p className="text-sm text-slate-500">Quản lý import, field hiển thị, metric và assign annotator. Hiển thị {datasets.length} / {total} dataset.</p>
        </div>
        <Button asChild>
          <Link href="/admin/datasets/new">
            <Plus className="h-4 w-4" />
            Tạo dataset
          </Link>
        </Button>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            Thử lại
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Metrics</TableHead>
              <TableHead>Import gần nhất</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isInitialLoading && datasets.length === 0 &&
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><div className="h-4 w-48 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-28 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-12 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-14 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-4 w-40 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="h-5 w-16 rounded bg-slate-100" /></TableCell>
                  <TableCell><div className="ml-auto h-8 w-14 rounded bg-slate-100" /></TableCell>
                </TableRow>
              ))}
            {!isInitialLoading && datasets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-slate-500">
                  Chưa có dataset.
                </TableCell>
              </TableRow>
            )}
            {datasets.map((dataset) => (
              <TableRow key={dataset.id}>
                <TableCell className="font-medium text-slate-900">{dataset.name}</TableCell>
                <TableCell>{labelForDomain(dataset.domain)}</TableCell>
                <TableCell>{dataset.rowCount}</TableCell>
                <TableCell>{dataset.metricCount}</TableCell>
                <TableCell className="max-w-[240px] truncate">{dataset.latestImport ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{dataset.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/datasets/${dataset.id}`}>Mở</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
          <span>Trang {displayedPage} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={displayedPage <= 1 || isRefreshing} onClick={() => setRequestedPage((current) => Math.max(1, current - 1))}>
              Trước
            </Button>
            <Button variant="outline" size="sm" disabled={displayedPage >= totalPages || isRefreshing} onClick={() => setRequestedPage((current) => current + 1)}>
              Sau
            </Button>
          </div>
        </div>
        {isRefreshing && datasets.length > 0 ? <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400">Đang cập nhật</div> : null}
      </div>
    </div>
  );
}
