"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Download, Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatasetAppendImportPanel } from "@/components/admin/dataset-append-import-panel";
import { DatasetAssignModal } from "@/components/admin/dataset-assign-modal";
import { DatasetImportJobsPanel } from "@/components/admin/dataset-import-jobs-panel";
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

interface RowsPayload {
  rows?: DatasetRow[];
  total?: number;
  page?: number;
  pageSize?: number;
}

const ROW_PAGE_SIZE = 50;

export default function DatasetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const datasetId = params.id;
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPage, setRowPage] = useState(1);
  const [rowSearchInput, setRowSearchInput] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [completionFilter, setCompletionFilter] = useState("all");
  const [assignOpen, setAssignOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/datasets/${datasetId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Không tải được dataset");
      setDetail(payload);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được dataset");
    } finally {
      setLoadingDetail(false);
    }
  }, [datasetId]);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    setLoadError("");
    const params = new URLSearchParams({
      page: String(rowPage),
      pageSize: String(ROW_PAGE_SIZE),
      fields: "list",
    });
    if (rowSearch) params.set("q", rowSearch);
    if (completionFilter !== "all") params.set("completion", completionFilter);

    try {
      const response = await fetch(`/api/datasets/${datasetId}/rows?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as RowsPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Không tải được rows");
      setRows(payload.rows ?? []);
      setRowTotal(payload.total ?? payload.rows?.length ?? 0);
      setSelectedRowIds([]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được rows");
    } finally {
      setLoadingRows(false);
    }
  }, [completionFilter, datasetId, rowPage, rowSearch]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  if (loadingDetail && !detail) {
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
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="flex gap-4 border-b border-slate-100 py-3 last:border-b-0">
                <div className="h-4 w-4 rounded bg-slate-100" />
                <div className="h-4 flex-1 rounded bg-slate-100" />
                <div className="h-4 w-40 rounded bg-slate-100" />
              </div>
            ))}
          </div>
          <div className="h-48 rounded-md border border-slate-200 bg-white p-4" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return <div className="text-sm text-red-600">{loadError || "Không tải được dataset"}</div>;
  }

  const datasetReady = detail.dataset.status === "ready";
  const downloadUrl = `/api/datasets/${datasetId}/export?format=jsonl`;
  const rowTotalPages = Math.max(Math.ceil(rowTotal / ROW_PAGE_SIZE), 1);
  const currentSearch = new URLSearchParams();
  currentSearch.set("page", String(rowPage));
  if (rowSearch) currentSearch.set("q", rowSearch);
  if (completionFilter !== "all") currentSearch.set("completion", completionFilter);

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
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { window.location.href = downloadUrl; }} disabled={rowTotal === 0}>
            <Download className="h-4 w-4" />
            Download JSONL
          </Button>
          <Button type="button" onClick={() => setAssignOpen(true)} disabled={!datasetReady}>
            <Send className="h-4 w-4" />
            Assign
          </Button>
        </div>
      </div>
      {!datasetReady && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Dataset đang import, chưa thể assign task.</div>}
      {loadError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase text-slate-500">Rows</h2>
              <p className="text-sm text-slate-500">{selectedRowIds.length} dòng đã chọn</p>
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setRowPage(1);
                setRowSearch(rowSearchInput.trim());
              }}
            >
              <div className="w-56">
                <label htmlFor="row-search" className="mb-1 block text-xs font-medium text-slate-600">
                  Search rows
                </label>
                <Input id="row-search" value={rowSearchInput} onChange={(event) => setRowSearchInput(event.target.value)} placeholder="ID hoặc field" />
              </div>
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium text-slate-600">Completion</label>
                <Select
                  value={completionFilter}
                  onValueChange={(value) => {
                    setRowPage(1);
                    setCompletionFilter(value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All rows</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="incomplete">Incomplete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" variant="outline">
                <Search className="h-4 w-4" />
                Search
              </Button>
            </form>
          </div>

          {loadingRows ? (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="flex gap-4 border-b border-slate-100 py-3 last:border-b-0">
                  <div className="h-4 w-4 rounded bg-slate-100" />
                  <div className="h-4 flex-1 rounded bg-slate-100" />
                  <div className="h-4 w-40 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : (
            <DatasetRowTable
              rows={rows}
              listFields={detail.dataset.displayConfig.listFields}
              selectedRowIds={selectedRowIds}
              onSelectedRowIdsChange={setSelectedRowIds}
              onRowOpen={(row) => router.push(`/admin/datasets/${datasetId}/rows/${row.id}?from=${encodeURIComponent(currentSearch.toString())}`)}
            />
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <span>Trang {rowPage} / {rowTotalPages}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={rowPage <= 1 || loadingRows} onClick={() => setRowPage((current) => Math.max(1, current - 1))}>
                Trước
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={rowPage >= rowTotalPages || loadingRows} onClick={() => setRowPage((current) => current + 1)}>
                Sau
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <DatasetAppendImportPanel
            datasetId={datasetId}
            requiredFields={detail.dataset.requiredAppendFields}
            schemaFields={detail.dataset.schemaFingerprint}
            onImported={() => {
              loadRows();
              loadDetail();
            }}
          />
          <DatasetImportJobsPanel datasetId={datasetId} />
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
        onAssigned={() => loadRows()}
      />
    </div>
  );
}
