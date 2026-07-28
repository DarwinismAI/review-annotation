"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ModeRadioCard } from "@/components/mode-radio-card";
import { DOMAIN_LABELS, DOMAIN_KEYS, type AssignmentMode } from "@/lib/labels";

interface DroppedFile {
  name: string;
  size: number;
  file?: File;
}

/** Default broadcast deadline = today + 60 days, formatted as YYYY-MM-DD for <input type="date">. */
function defaultBroadcastDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().slice(0, 10);
}

/** Tomorrow as YYYY-MM-DD - minimum allowed broadcast deadline (PRD AC2). */
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function JsonIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
      />
    </svg>
  );
}

export default function BatchNewPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [batchName, setBatchName] = useState("");
  const [domain, setDomain] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("manual");
  const [broadcastExpiresAt, setBroadcastExpiresAt] = useState<string>(defaultBroadcastDate());
  const [files, setFiles] = useState<DroppedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dropzoneError, setDropzoneError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  /** Min date for broadcast deadline picker - must be at least tomorrow. */
  const minBroadcastDate = useMemo(() => tomorrowIso(), []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    setFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        const ext = getExt(f.name);
        if (!["zip", "json"].includes(ext)) continue;
        if (!next.find((existing) => existing.name === f.name)) {
          next.push({ name: f.name, size: f.size, file: f });
        }
      }
      return next;
    });
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, []);

  async function handleSubmit() {
    if (!batchName.trim()) {
      document.getElementById("batch-name")?.focus();
      return;
    }
    if (!domain) {
      document.getElementById("batch-domain")?.focus();
      return;
    }
    if (files.length === 0 || !files[0].file) {
      setDropzoneError(true);
      setTimeout(() => setDropzoneError(false), 1500);
      return;
    }
    if (assignmentMode === "broadcast") {
      const picked = new Date(broadcastExpiresAt + "T23:59:59");
      if (isNaN(picked.getTime()) || picked.getTime() <= Date.now()) {
        showToast("Hạn nhận bài broadcast phải ở tương lai");
        return;
      }
    }

    const sourceFile = files[0].file;
    const isJson = sourceFile.name.toLowerCase().endsWith(".json");
    const contentType = isJson ? "application/json" : "application/zip";
    setSubmitting(true);

    try {
      // Step 1: Get signed upload URL
      const urlRes = await fetch("/api/batches/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: sourceFile.name }),
      });
      if (!urlRes.ok) {
        const err = (await urlRes.json()) as { error?: { message?: string } };
        showToast(err.error?.message ?? "Không lấy được URL upload");
        return;
      }
      const { data: urlData } = (await urlRes.json()) as {
        data: { signedUrl: string; storageKey: string };
      };

      // Step 2: PUT file to signed URL
      const putRes = await fetch(urlData.signedUrl, {
        method: "PUT",
        body: sourceFile,
        headers: { "Content-Type": contentType },
      });
      if (!putRes.ok) {
        showToast("Upload file thất bại");
        return;
      }

      // Step 3: Create batch
      const createRes = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: batchName.trim(),
          domain,
          articleType: "full",
          storageKey: urlData.storageKey,
          filename: sourceFile.name,
          assignmentMode,
          broadcastExpiresAt:
            assignmentMode === "broadcast"
              ? new Date(broadcastExpiresAt + "T23:59:59").toISOString()
              : null,
        }),
      });
      if (!createRes.ok) {
        const err = (await createRes.json()) as { error?: { message?: string } };
        showToast(err.error?.message ?? "Tạo đợt thất bại");
        return;
      }

      showToast("Đợt upload đã được tạo thành công!");
      setTimeout(() => router.push("/admin/batches"), 1200);
    } catch {
      showToast("Đã xảy ra lỗi, vui lòng thử lại");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Tạo đợt upload mới</h1>

        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          {/* Tên đợt */}
          <div>
            <label
              htmlFor="batch-name"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Tên đợt <span className="text-red-500">*</span>
            </label>
            <input
              id="batch-name"
              type="text"
              placeholder="Ví dụ: Đợt pháp luật tháng 5/2026"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          {/* Lĩnh vực */}
          <div>
            <label
              htmlFor="batch-domain"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Lĩnh vực <span className="text-red-500">*</span>
            </label>
            <select
              id="batch-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            >
              <option value="" disabled>
                Chọn lĩnh vực...
              </option>
              {DOMAIN_KEYS.map((key) => (
                <option key={key} value={key}>
                  {DOMAIN_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {/* Cách phân công */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Cách phân công <span className="text-red-500">*</span>
            </label>
            <ModeRadioCard value={assignmentMode} onChange={setAssignmentMode} />
            {assignmentMode === "broadcast" ? (
              <div className="mt-3 flex items-center gap-3">
                <label
                  htmlFor="broadcast-deadline"
                  className="text-sm font-medium text-slate-700"
                >
                  Hạn nhận bài
                </label>
                <input
                  id="broadcast-deadline"
                  type="date"
                  min={minBroadcastDate}
                  value={broadcastExpiresAt}
                  onChange={(e) => setBroadcastExpiresAt(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <span className="inline-flex items-center px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full">
                  Mặc định 60 ngày
                </span>
              </div>
            ) : null}
          </div>

          {/* File dropzone */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              File bài viết <span className="text-red-500">*</span>
            </label>

            <div
              id="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer bg-white ${
                dragOver
                  ? "border-blue-400 bg-blue-50"
                  : dropzoneError
                  ? "border-red-400"
                  : "border-slate-300 hover:border-blue-400"
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-medium text-slate-700 mb-1">
                    Kéo thả file vào đây
                  </p>
                  <p className="text-sm text-slate-500">
                    hoặc{" "}
                    <span className="text-blue-600 font-medium">nhấn để chọn file</span>
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                    .json
                  </span>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                    .zip
                  </span>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.zip"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* File preview list */}
            {files.length > 0 && (
              <div className="mt-3 space-y-2">
                {files.map((f, i) => {
                  const ext = getExt(f.name);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      {ext === "json" ? <JsonIcon /> : <ZipIcon />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                        <p className="text-xs text-slate-400">{formatBytes(f.size)}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(i);
                        }}
                        className="text-slate-300 hover:text-red-400 transition-colors"
                        title="Xóa file"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 mt-6">
          <Link
            href="/admin/batches"
            className="border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Hủy
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {submitting ? "Đang tạo..." : "Tạo đợt"}
          </button>
        </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}
