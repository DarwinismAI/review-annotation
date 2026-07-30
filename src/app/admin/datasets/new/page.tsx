"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatasetFieldSelector, type DatasetField } from "@/components/admin/dataset-field-selector";
import { invalidateFastResource } from "@/hooks/use-fast-resource";
import { readJsonResponse } from "@/hooks/use-json-resource";
import { parseDatasetFile } from "@/lib/datasets/client-file-import";
import { CLIENT_IMPORT_CHUNK_SIZE, MAX_DATASET_IMPORT_ROWS } from "@/lib/datasets/import-limits";
import { inspectDatasetRows } from "@/lib/datasets/import-validation";

interface InspectPayload {
  filename: string;
  rowCount: number;
  fields: DatasetField[];
  sampleRows: Record<string, unknown>[];
}

interface RubricMetric {
  id: string;
  name: string;
  description: string;
  scale: Array<{ label: string }>;
}

export default function NewDatasetPage() {
  const router = useRouter();
  const [name, setName] = useState("Humanity - An toàn - Tuân thủ");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [listFields, setListFields] = useState<string[]>([]);
  const [detailFields, setDetailFields] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<RubricMetric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [activeImportCount, setActiveImportCount] = useState(0);
  const [activeImportLoading, setActiveImportLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const statusClassName = status.startsWith("Đang ") ? "text-slate-600" : "text-red-600";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/rubrics?domain=safety_compliance", { cache: "no-store" })
      .then((response) => readJsonResponse(response))
      .then((payload) => {
        if (!cancelled) setMetrics(((payload as { data?: RubricMetric[] }).data ?? []));
      })
      .catch(() => {
        if (!cancelled) setStatus("Không tải được metrics từ Rubric");
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/datasets?page=1&pageSize=1&summary=1", { cache: "no-store" })
      .then((response) => readJsonResponse(response))
      .then((payload) => {
        if (!cancelled) setActiveImportCount((payload as { summary?: { importingCount?: number } }).summary?.importingCount ?? 0);
      })
      .catch(() => {
        if (!cancelled) setStatus("Không kiểm tra được trạng thái import hiện tại");
      })
      .finally(() => {
        if (!cancelled) setActiveImportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function chunkRows<T>(items: T[]): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += CLIENT_IMPORT_CHUNK_SIZE) {
      chunks.push(items.slice(index, index + CLIENT_IMPORT_CHUNK_SIZE));
    }
    return chunks;
  }

  async function handleFile(file: File | null) {
    setStatus("");
    setInspect(null);
    setRows([]);
    setListFields([]);
    setDetailFields([]);
    if (!file) return;

    setFilename(file.name);
    setStatus("Đang phân tích file...");

    let parsedRows: Record<string, unknown>[];
    try {
      parsedRows = await parseDatasetFile(file, { maxRows: MAX_DATASET_IMPORT_ROWS });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "File JSON/JSONL không hợp lệ");
      return;
    }

    const payload = { filename: file.name, ...inspectDatasetRows(parsedRows) };
    setRows(parsedRows);
    setInspect(payload);
    setStatus("");
    const suggestedList = payload.fields
      .map((field: DatasetField) => field.path)
      .filter((path: string) => ["input", "prompt", "text", "label.sub_intent", "label.policy"].includes(path))
      .slice(0, 4);
    const suggestedDetail = payload.fields
      .map((field: DatasetField) => field.path)
      .filter((path: string) => ["input", "output", "label", "label.sub_intent", "label.policy"].includes(path));
    setListFields(suggestedList.length > 0 ? suggestedList : payload.fields.slice(0, 3).map((field: DatasetField) => field.path));
    setDetailFields(suggestedDetail.length > 0 ? suggestedDetail : payload.fields.slice(0, 5).map((field: DatasetField) => field.path));
  }

  async function createDataset() {
    setStatus("");
    if (!inspect) {
      setStatus("Chọn file JSON/JSONL trước khi tạo dataset");
      return;
    }
    if (metrics.length === 0) {
      setStatus("Chưa có metric Rubric cho lĩnh vực An toàn - Tuân thủ");
      return;
    }
    if (activeImportCount > 0) {
      setStatus("Đang có dataset khác import. Chờ import hiện tại hoàn tất trước khi tạo dataset mới");
      return;
    }
    if (listFields.length === 0 || detailFields.length === 0) {
      setStatus("Chọn field hiển thị trên list và detail trước khi tạo dataset");
      return;
    }
    setCreating(true);
    const [firstChunk, ...remainingChunks] = chunkRows(rows);
    try {
      const response = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          domain: "safety_compliance",
          sourceFilename: filename,
          rows: firstChunk,
          totalRows: rows.length,
          schemaFingerprint: inspect.fields,
          listFields,
          detailFields,
        }),
      });
      const payload = (await readJsonResponse(response)) as { datasetId: string; importId: string; message?: string; error?: string };
      if (!response.ok) {
        setStatus(payload.message ?? payload.error ?? "Không tạo được dataset");
        return;
      }

      for (let index = 0; index < remainingChunks.length; index++) {
        setStatus(`Đang import thêm phần ${index + 1}/${remainingChunks.length}`);
        const finalChunk = index === remainingChunks.length - 1;
        const importResponse = await fetch(`/api/datasets/${payload.datasetId}/imports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, rows: remainingChunks[index], importId: payload.importId, totalRows: rows.length, finalChunk }),
        });
        const importPayload = (await readJsonResponse(importResponse)) as { error?: string };
        if (!importResponse.ok) {
          setStatus(importPayload.error ?? `Dataset đã tạo nhưng lỗi import phần ${index + 1}`);
          return;
        }
      }

      invalidateFastResource("/api/datasets");
      invalidateFastResource(`/api/datasets/${payload.datasetId}`);
      router.push(`/admin/datasets/${payload.datasetId}`);
    } catch {
      setStatus("Không tạo được dataset");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tạo dataset</h1>
        <p className="text-sm text-slate-500">Upload JSON array hoặc JSONL, chọn field hiển thị trên list và detail.</p>
        <p className="mt-1 text-xs text-slate-500">Mỗi lần import tối đa {MAX_DATASET_IMPORT_ROWS.toLocaleString("vi-VN")} dòng.</p>
      </div>

      {activeImportCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Đang có {activeImportCount} dataset import. Tạm dừng tạo dataset mới để tránh trùng dữ liệu và tải nặng.
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="space-y-1.5">
            <label htmlFor="dataset-name" className="block text-sm font-medium text-slate-700">
              Tên dataset
            </label>
            <Input id="dataset-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="dataset-file" className="block text-sm font-medium text-slate-700">
              File JSON/JSONL
            </label>
            <Input
              id="dataset-file"
              type="file"
              accept=".json,.jsonl,.ndjson,application/json,application/x-ndjson"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        {inspect && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <Upload className="h-4 w-4" />
            {inspect.filename}: {inspect.rowCount} dòng, {inspect.fields.length} field
          </div>
        )}
        {status && <div className={`mt-3 text-sm ${statusClassName}`}>{status}</div>}
      </div>

      {inspect && (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Field hiển thị</h2>
            <DatasetFieldSelector
              fields={inspect.fields}
              listFields={listFields}
              detailFields={detailFields}
              onListFieldsChange={setListFields}
              onDetailFieldsChange={setDetailFields}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase text-slate-500">Metrics</h2>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              {metricsLoading ? (
                <p className="text-sm text-slate-500">Đang tải metrics từ Rubric...</p>
              ) : metrics.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-600">Chưa có metric Rubric cho lĩnh vực An toàn - Tuân thủ.</p>
                  <Button asChild variant="outline">
                    <Link href="/admin/rubrics/new">Tạo metric trong Rubric</Link>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {metrics.map((metric) => (
                    <div key={metric.id} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="text-sm font-medium text-slate-900">{metric.name}</div>
                      <div className="mt-1 text-xs text-slate-500">Scale: {metric.scale.map((item) => item.label).join(" / ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <Button
            type="button"
            onClick={createDataset}
            disabled={
              creating ||
              metricsLoading ||
              activeImportLoading ||
              activeImportCount > 0 ||
              listFields.length === 0 ||
              detailFields.length === 0 ||
              metrics.length === 0
            }
          >
            {creating ? "Đang tạo..." : "Tạo dataset"}
          </Button>
        </>
      )}
    </div>
  );
}
