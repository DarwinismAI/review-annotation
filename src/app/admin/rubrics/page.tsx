"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { labelForDomain } from "@/lib/labels";

interface Rubric {
  id: string;
  name: string;
  domain: string;
  description: string;
  required: boolean;
  scale: { label: string }[];
  createdAt: number | string;
}

function formatDate(raw: number | string): string {
  const d = new Date(typeof raw === "number" ? raw : raw);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AdminRubricsPage() {
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [loading, setLoading] = useState(true);

  // Delete confirm dialog
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    fetch("/api/rubrics")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setRubrics(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/rubrics/${deleteId}`, { method: "DELETE" });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        setDeleteError(json.error?.message ?? "Không thể xóa metric");
        return;
      }
      setRubrics((prev) => prev.filter((r) => r.id !== deleteId));
      setDeleteId(null);
    } catch {
      setDeleteError("Không thể xóa metric");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
        {/* Title row + create button */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Quản lý metrics</h1>
          <Link
            href="/admin/rubrics/new"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo metric mới
          </Link>
        </div>

        {/* Rubric table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tên metric</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Lĩnh vực</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Thông số</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Bắt buộc</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ngày tạo</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center">
                      <p className="text-slate-500 text-sm">Đang tải...</p>
                    </td>
                  </tr>
                ) : rubrics.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">
                      Chưa có metric nào. Hãy tạo metric đầu tiên.
                    </td>
                  </tr>
                ) : (
                  rubrics.map((r) => (
                      <tr key={r.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <span className="font-medium text-slate-900">{r.name}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                            {labelForDomain(r.domain)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {r.scale?.map((item) => item.label).join(" / ") ?? "-"}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {r.required ? "Có" : "Không"}
                        </td>
                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(r.createdAt)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex items-center justify-center gap-3">
                            <Link
                              href={`/admin/rubrics/${r.id}`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Xem
                            </Link>
                            <button
                              onClick={() => {
                                setDeleteError("");
                                setDeleteId(r.id);
                              }}
                              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* Delete confirm dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-base font-semibold text-slate-900 mb-2">Xóa metric?</h2>
            <p className="text-sm text-slate-500 mb-6">
              Hành động này không thể hoàn tác. Metric sẽ bị xóa vĩnh viễn.
            </p>
            {deleteError && <p className="mb-4 text-sm text-red-600">{deleteError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteError("");
                  setDeleteId(null);
                }}
                className="border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-3 py-2 text-sm transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {deleting ? "Đang xóa…" : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
