"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export default function AdminDatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/datasets")
      .then((response) => response.json())
      .then((payload) => setDatasets(payload.datasets ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Datasets</h1>
          <p className="text-sm text-slate-500">Quản lý import, field hiển thị, metric và assign annotator.</p>
        </div>
        <Button asChild>
          <Link href="/admin/datasets/new">
            <Plus className="h-4 w-4" />
            Tạo dataset
          </Link>
        </Button>
      </div>

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
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-slate-500">
                  Đang tải...
                </TableCell>
              </TableRow>
            )}
            {!loading && datasets.length === 0 && (
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
      </div>
    </div>
  );
}
