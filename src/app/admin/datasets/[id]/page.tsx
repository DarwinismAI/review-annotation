"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DatasetAppendImportPanel } from "@/components/admin/dataset-append-import-panel";
import { DatasetAssignModal } from "@/components/admin/dataset-assign-modal";
import { DatasetRowTable, type DatasetRow } from "@/components/admin/dataset-row-table";
import { labelForDomain } from "@/lib/labels";

interface DatasetDetail {
  dataset: {
    id: string;
    name: string;
    domain: string;
    status: string;
    displayConfig: { listFields: string[]; detailFields: string[] };
    requiredAppendFields: string[];
  };
  metrics: Array<{ id: string; key: string; label: string; description: string | null; scale: { values: string[] }; required: boolean; sortOrder: number }>;
  imports: Array<{ id: string; sourceFilename: string; status: string; rowCount: number; createdAt: string }>;
}

export default function DatasetDetailPage() {
  const params = useParams<{ id: string }>();
  const datasetId = params.id;
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [detailResponse, rowsResponse] = await Promise.all([
        fetch(`/api/datasets/${datasetId}`, { cache: "no-store" }),
        fetch(`/api/datasets/${datasetId}/rows?pageSize=200`, { cache: "no-store" }),
      ]);
      const [detailPayload, rowsPayload] = await Promise.all([detailResponse.json(), rowsResponse.json()]);
      if (!detailResponse.ok) throw new Error(detailPayload.error ?? "Không tải được dataset");
      if (!rowsResponse.ok) throw new Error(rowsPayload.error ?? "Không tải được rows");
      setDetail(detailPayload);
      setRows(rowsPayload.rows ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được dataset");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="text-sm text-slate-500">Đang tải dataset...</div>;
  }
  if (!detail) {
    return <div className="text-sm text-red-600">{loadError || "Không tải được dataset"}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.dataset.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{labelForDomain(detail.dataset.domain)}</Badge>
            <Badge variant="outline">{rows.length} dòng</Badge>
            <Badge variant="outline">{detail.metrics.length} metrics</Badge>
          </div>
        </div>
        <Button type="button" onClick={() => setAssignOpen(true)}>
          <Send className="h-4 w-4" />
          Assign
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Rows</h2>
            <span className="text-sm text-slate-500">{selectedRowIds.length} dòng đã chọn</span>
          </div>
          <DatasetRowTable
            rows={rows}
            listFields={detail.dataset.displayConfig.listFields}
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </div>
        <div className="space-y-4">
          <DatasetAppendImportPanel datasetId={datasetId} onImported={load} />
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Field bắt buộc khi append</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.dataset.requiredAppendFields.map((field) => (
                <Badge key={field} variant="outline">
                  {field}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      <DatasetAssignModal
        datasetId={datasetId}
        metrics={detail.metrics}
        selectedRowIds={selectedRowIds}
        open={assignOpen}
        onOpenChange={setAssignOpen}
        onAssigned={load}
      />
    </div>
  );
}
