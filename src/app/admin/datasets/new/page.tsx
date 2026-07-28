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

interface InspectPayload {
  filename: string;
  rowCount: number;
  fields: DatasetField[];
  sampleRows: Record<string, unknown>[];
}

export default function NewDatasetPage() {
  const router = useRouter();
  const [name, setName] = useState("Humanity — An toàn - Tuân thủ");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [listFields, setListFields] = useState<string[]>([]);
  const [detailFields, setDetailFields] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<DatasetMetricDraft[]>(SAFETY_COMPLIANCE_DEFAULT_METRICS);
  const [status, setStatus] = useState("");

  async function handleFile(file: File | null) {
    setStatus("");
    setInspect(null);
    setRows([]);
    setListFields([]);
    setDetailFields([]);
    if (!file) return;

    const content = await file.text();
    setFilename(file.name);

    let parsedRows: Record<string, unknown>[];
    try {
      parsedRows = JSON.parse(content);
    } catch {
      setStatus("JSON không hợp lệ");
      return;
    }
    if (!Array.isArray(parsedRows)) {
      setStatus("File phải là JSON array");
      return;
    }

    const response = await fetch("/api/datasets/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, content }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.message ?? payload.error ?? "Không inspect được file");
      return;
    }

    setRows(parsedRows);
    setInspect(payload);
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
    const response = await fetch("/api/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        domain: "safety_compliance",
        sourceFilename: filename,
        rows,
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
    router.push(`/admin/datasets/${payload.datasetId}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tạo dataset</h1>
        <p className="text-sm text-slate-500">Upload JSON array, chọn field hiển thị trên list và detail.</p>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Dataset name" />
          <Input type="file" accept=".json,application/json" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
        </div>
        {inspect && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <Upload className="h-4 w-4" />
            {inspect.filename}: {inspect.rowCount} dòng, {inspect.fields.length} field
          </div>
        )}
        {status && <div className="mt-3 text-sm text-red-600">{status}</div>}
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
