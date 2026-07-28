"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatasetFieldSelector, type DatasetField } from "@/components/admin/dataset-field-selector";
import {
  DatasetMetricsEditor,
  SAFETY_COMPLIANCE_DEFAULT_METRICS,
  type DatasetMetricDraft,
} from "@/components/admin/dataset-metrics-editor";
import { parseDatasetFile } from "@/lib/datasets/client-file-import";
import { inspectDatasetRows } from "@/lib/datasets/import-validation";

const CLIENT_IMPORT_CHUNK_SIZE = 500;

interface InspectPayload {
  filename: string;
  rowCount: number;
  fields: DatasetField[];
  sampleRows: Record<string, unknown>[];
}

export default function NewDatasetPage() {
  const router = useRouter();
  const [name, setName] = useState("Humanity - An toàn - Tuân thủ");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [listFields, setListFields] = useState<string[]>([]);
  const [detailFields, setDetailFields] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<DatasetMetricDraft[]>(SAFETY_COMPLIANCE_DEFAULT_METRICS);
  const [status, setStatus] = useState("");
  const statusClassName = status.startsWith("Đang ") ? "text-slate-600" : "text-red-600";

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
      parsedRows = await parseDatasetFile(file);
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
    if (!inspect) return;
    const [firstChunk, ...remainingChunks] = chunkRows(rows);
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
        metrics,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error ?? "Không tạo được dataset");
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
      const importPayload = await importResponse.json();
      if (!importResponse.ok) {
        setStatus(importPayload.error ?? `Dataset đã tạo nhưng lỗi import phần ${index + 1}`);
        return;
      }
    }

    router.push(`/admin/datasets/${payload.datasetId}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tạo dataset</h1>
        <p className="text-sm text-slate-500">Upload JSON array hoặc JSONL, chọn field hiển thị trên list và detail.</p>
      </div>

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
            <DatasetMetricsEditor metrics={metrics} onMetricsChange={setMetrics} />
          </section>

          <Button type="button" onClick={createDataset} disabled={listFields.length === 0 || detailFields.length === 0 || metrics.length === 0}>
            Tạo dataset
          </Button>
        </>
      )}
    </div>
  );
}
