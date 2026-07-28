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
    schemaFingerprint: Array<{ path: string }>;
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
  const [rowTotal, setRowTotal] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (options?: { preserveView?: boolean }) => {
    if (!options?.preserveView) setLoading(true);
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
      setRowTotal(rowsPayload.total ?? rowsPayload.rows?.length ?? 0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được dataset");
    } finally {
      if (!options?.preserveView) setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-3">
            <div className="h-7 w-72 rounded bg-slate-100" />
            <div className="flex gap-2">
              <div className="h-5 w-28 rounded bg-slate-100" />
              <div className="h-5 w-20 rounded bg-slate-100" />
              <div className="h-5 w-24 rounded bg-slate-100" />
            </div>
          </div>
          <div className="h-9 w-24 rounded bg-slate-100" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="h-4 w-20 rounded bg-slate-100" />
            <div className="rounded-md border border-slate-200 bg-white p-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="flex gap-4 border-b border-slate-100 py-3 last:border-b-0">
                  <div className="h-4 w-4 rounded bg-slate-100" />
                  <div className="h-4 flex-1 rounded bg-slate-100" />
                  <div className="h-4 w-40 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-48 rounded-md border border-slate-200 bg-white p-4">
              <div className="h-4 w-36 rounded bg-slate-100" />
              <div className="mt-4 h-10 rounded bg-slate-100" />
              <div className="mt-3 h-9 w-32 rounded bg-slate-100" />
            </div>
            <div className="h-28 rounded-md border border-slate-200 bg-white p-4">
              <div className="h-4 w-44 rounded bg-slate-100" />
              <div className="mt-4 flex gap-2">
                <div className="h-5 w-16 rounded bg-slate-100" />
                <div className="h-5 w-20 rounded bg-slate-100" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!detail) {
    return <div className="text-sm text-red-600">{loadError || "Không tải được dataset"}</div>;
  }
  const datasetReady = detail.dataset.status === "ready";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.dataset.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{labelForDomain(detail.dataset.domain)}</Badge>
            <Badge variant="outline">{rowTotal} dòng</Badge>
            <Badge variant="outline">{detail.metrics.length} metrics</Badge>
            {!datasetReady && <Badge variant="warning">Đang import</Badge>}
          </div>
        </div>
        <Button type="button" onClick={() => setAssignOpen(true)} disabled={!datasetReady}>
          <Send className="h-4 w-4" />
          Assign
        </Button>
      </div>
      {!datasetReady && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Dataset đang import, chưa thể assign task.</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
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
          <DatasetAppendImportPanel
            datasetId={datasetId}
            requiredFields={detail.dataset.requiredAppendFields}
            schemaFields={detail.dataset.schemaFingerprint}
            onImported={() => load({ preserveView: true })}
          />
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
        onAssigned={() => load({ preserveView: true })}
      />
    </div>
  );
}
