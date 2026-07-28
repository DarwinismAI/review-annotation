"use client";

import { useEffect, useState } from "react";

interface Rubric {
  id: string;
  name: string;
  domain: string;
  createdAt: number | string;
  criteria: { id: string }[];
}

const DOMAIN_LABEL: Record<string, string> = {
  law:     "Pháp luật",
  medical: "Y tế",
  tourism: "Du lịch",
};

const DOMAIN_BADGE: Record<string, string> = {
  law:     "bg-blue-100 text-blue-700",
  medical: "bg-green-100 text-green-700",
  tourism: "bg-amber-100 text-amber-700",
};

function formatDate(raw: number | string): string {
  const d = new Date(typeof raw === "number" ? raw : raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AdminRubricsPage() {
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [loading, setLoading] = useState(true);

  // Delete confirm dialog
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    try {
      await fetch(`/api/rubrics/${deleteId}`, { method: "DELETE" });
      setRubrics((prev) => prev.filter((r) => r.id !== deleteId));
    } catch {
      // non-fatal — optimistic removal already done if needed
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }

  return (
    <>
        {/* Title row + create button */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Quản lý rubric</h1>
          <a
            href="/admin/rubrics/new"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo rubric mới
          </a>
        </div>

        {/* Rubric table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tên rubric</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Lĩnh vực</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Số tiêu chí</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ngày tạo</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center">
                      <p className="text-slate-500 text-sm">Đang tải...</p>
                    </td>
                  </tr>
                ) : rubrics.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">
                      Chưa có rubric nào. Hãy tạo rubric đầu tiên.
                    </td>
                  </tr>
                ) : (
                  rubrics.map((r) => {
                    const domainLabel = DOMAIN_LABEL[r.domain] ?? r.domain;
                    const domainCls   = DOMAIN_BADGE[r.domain]  ?? "bg-slate-100 text-slate-600";
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <span className="font-medium text-slate-900">{r.name}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${domainCls}`}>
                            {domainLabel}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="text-slate-700 font-mono">
                            {r.criteria?.length ?? 0}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(r.createdAt)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <div className="flex items-center justify-center gap-3">
                            <a
                              href={`/admin/rubrics/${r.id}`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              Xem
                            </a>
                            <button
                              onClick={() => setDeleteId(r.id)}
                              className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      {/* Delete confirm dialog */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl border border-slate-200 p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-base font-semibold text-slate-900 mb-2">Xóa rubric?</h2>
            <p className="text-sm text-slate-500 mb-6">
              Hành động này không thể hoàn tác. Rubric sẽ bị xóa vĩnh viễn.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
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
