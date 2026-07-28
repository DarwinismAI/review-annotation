"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MissingField {
  path: string;
  missingRowIndexes: number[];
  missingCount: number;
}

interface DatasetAppendImportPanelProps {
  datasetId: string;
  onImported: () => void;
}

export function DatasetAppendImportPanel({ datasetId, onImported }: DatasetAppendImportPanelProps) {
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [extraFields, setExtraFields] = useState<string[]>([]);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [status, setStatus] = useState("");

  async function handleFile(file: File | null) {
    setStatus("");
    setRowCount(null);
    setExtraFields([]);
    setMissingFields([]);
    if (!file) return;

    const text = await file.text();
    setFilename(file.name);
    setContent(text);

    const response = await fetch(`/api/datasets/${datasetId}/imports/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, content: text }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.message ?? payload.error ?? "Import không hợp lệ");
      setMissingFields(payload.missingFields ?? []);
      return;
    }

    setRowCount(payload.rowCount);
    setExtraFields(payload.extraFields ?? []);
    setStatus("File hợp lệ để append");
  }

  async function importRows() {
    const response = await fetch(`/api/datasets/${datasetId}/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.message ?? payload.error ?? "Import thất bại");
      setMissingFields(payload.missingFields ?? []);
      return;
    }
    setStatus(`Đã thêm ${payload.insertedRows} dòng`);
    setContent("");
    setFilename("");
    setRowCount(null);
    onImported();
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Append dataset</h2>
          <p className="text-xs text-slate-500">File mới được thừa field, nhưng không được thiếu field đã chọn để hiển thị.</p>
        </div>
        <Upload className="h-4 w-4 text-slate-400" />
      </div>
      <Input type="file" accept=".json,application/json" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
      {status && <div className="text-sm text-slate-700">{status}</div>}
      {rowCount !== null && <Badge variant="success">{rowCount} dòng hợp lệ</Badge>}
      {extraFields.length > 0 && <div className="text-xs text-slate-500">Field thừa: {extraFields.slice(0, 8).join(", ")}</div>}
      {missingFields.length > 0 && (
        <div className="space-y-1 text-sm text-red-600">
          {missingFields.map((field) => (
            <div key={field.path}>
              {field.path}: thiếu {field.missingCount} dòng
            </div>
          ))}
        </div>
      )}
      <Button type="button" onClick={importRows} disabled={!content || missingFields.length > 0 || rowCount === null}>
        Import thêm dòng
      </Button>
    </div>
  );
}
