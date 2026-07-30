"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invalidateFastResource } from "@/hooks/use-fast-resource";
import { readJsonResponse } from "@/hooks/use-json-resource";
import { collectExtraFieldsResponsive, parseDatasetFile, validateAppendRowsResponsive } from "@/lib/datasets/client-file-import";
import { CLIENT_IMPORT_CHUNK_SIZE, MAX_DATASET_IMPORT_ROWS } from "@/lib/datasets/import-limits";
import { type JsonRecord } from "@/lib/datasets/import-validation";

type StatusKind = "idle" | "progress" | "success" | "error";

interface MissingField {
  path: string;
  missingRowIndexes: number[];
  missingCount: number;
}

interface DatasetAppendImportPanelProps {
  datasetId: string;
  requiredFields: string[];
  schemaFields: Array<{ path: string }>;
  onImported: () => void;
}

export function DatasetAppendImportPanel({ datasetId, requiredFields, schemaFields, onImported }: DatasetAppendImportPanelProps) {
  const [filename, setFilename] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [extraFields, setExtraFields] = useState<string[]>([]);
  const [missingFields, setMissingFields] = useState<MissingField[]>([]);
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<StatusKind>("idle");
  const [importing, setImporting] = useState(false);

  function showStatus(message: string, kind: StatusKind) {
    setStatus(message);
    setStatusKind(kind);
  }

  async function handleFile(file: File | null) {
    setStatus("");
    setStatusKind("idle");
    setRowCount(null);
    setExtraFields([]);
    setMissingFields([]);
    setRows([]);
    setFile(file);
    if (!file) return;

    setFilename(file.name);
    showStatus("Đang phân tích file...", "progress");

    let parsedRows: JsonRecord[];
    try {
      parsedRows = await parseDatasetFile(file, { maxRows: MAX_DATASET_IMPORT_ROWS });
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Import không hợp lệ", "error");
      return;
    }

    showStatus("Đang kiểm tra field bắt buộc...", "progress");
    const validation = await validateAppendRowsResponsive(parsedRows, requiredFields);
    if (!validation.ok) {
      showStatus("File thiếu field bắt buộc", "error");
      setMissingFields(validation.missingFields);
      return;
    }

    showStatus("Đang kiểm tra field thừa...", "progress");
    const initialFields = new Set(schemaFields.map((field) => field.path));
    const nextExtraFields = await collectExtraFieldsResponsive(parsedRows, initialFields);

    setRows(parsedRows);
    setRowCount(parsedRows.length);
    setExtraFields(nextExtraFields);
    showStatus("File hợp lệ để append", "success");
  }

  async function importRows() {
    if (!file || rows.length === 0 || importing) return;

    setImporting(true);
    let importId = "";
    try {
      for (let index = 0; index < rows.length; index += CLIENT_IMPORT_CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CLIENT_IMPORT_CHUNK_SIZE);
        const finalChunk = index + chunk.length >= rows.length;
        const response = await fetch(`/api/datasets/${datasetId}/imports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, rows: chunk, importId: importId || undefined, totalRows: rows.length, finalChunk }),
        });
        const payload = (await readJsonResponse(response)) as {
          importId?: string;
          message?: string;
          error?: string;
          missingFields?: MissingField[];
        };
        if (!response.ok) {
          showStatus(payload.message ?? payload.error ?? `Import thất bại tại dòng ${index + 1}`, "error");
          setMissingFields(payload.missingFields ?? []);
          return;
        }
        importId = payload.importId ?? importId;
        showStatus(`Đã import ${Math.min(index + chunk.length, rows.length)}/${rows.length} dòng`, "progress");
      }
      showStatus(`Đã thêm ${rows.length} dòng`, "success");
      setFile(null);
      setRows([]);
      setFilename("");
      setRowCount(null);
      invalidateFastResource("/api/datasets");
      invalidateFastResource(`/api/datasets/${datasetId}`);
      onImported();
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Import thất bại, vui lòng thử lại", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Append dataset</h2>
          <p className="text-xs text-slate-500">File mới được thừa field, không được thiếu field hiển thị. Tối đa {MAX_DATASET_IMPORT_ROWS.toLocaleString("vi-VN")} dòng/lần.</p>
        </div>
        <Upload className="h-4 w-4 text-slate-400" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="append-dataset-file" className="block text-sm font-medium text-slate-700">
          File JSON/JSONL append
        </label>
        <Input
          id="append-dataset-file"
          type="file"
          accept=".json,.jsonl,.ndjson,application/json,application/x-ndjson"
          onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
        />
      </div>
      {status && (
        <div className={`text-sm ${statusKind === "error" ? "text-red-600" : statusKind === "success" ? "text-green-700" : "text-slate-700"}`}>
          {status}
        </div>
      )}
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
      <Button type="button" onClick={importRows} disabled={importing || !file || missingFields.length > 0 || rowCount === null}>
        {importing ? "Đang import..." : "Import thêm dòng"}
      </Button>
    </div>
  );
}
