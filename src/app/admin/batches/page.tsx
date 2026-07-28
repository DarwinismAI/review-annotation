"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { labelForDomain, SUB_DOMAIN_LABELS } from "@/lib/labels";

interface Batch {
  id: string;
  name: string;
  domain: string;
  totalArticles: number;
  status: string;
  createdAt: number | string;
  subDomainCounts?: Array<{ id: string | null; count: number }>;
}

const STATUS_CFG: Record<string, { label: string; dot: string; cls: string }> = {
  pending:    { label: "Chờ xử lý",  dot: "bg-amber-400", cls: "bg-amber-50 text-amber-700"  },
  processing: { label: "Đang xử lý", dot: "bg-blue-400",  cls: "bg-blue-50 text-blue-700"    },
  ready:      { label: "Hoàn tất",   dot: "bg-green-400", cls: "bg-green-50 text-green-700"   },
  done:       { label: "Hoàn tất",   dot: "bg-green-400", cls: "bg-green-50 text-green-700"   },
  failed:     { label: "Thất bại",   dot: "bg-red-400",   cls: "bg-red-50 text-red-700"       },
};

const DOMAIN_CLS: Record<string, string> = {
  law:     "bg-blue-50 text-blue-700",
  medical: "bg-emerald-50 text-emerald-700",
  tourism: "bg-amber-50 text-amber-700",
  safety_compliance: "bg-violet-50 text-violet-700",
};

function formatDate(raw: number | string): string {
  const d = new Date(typeof raw === "number" ? raw : raw);
  const day   = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const year  = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatSubDomainSummary(items: Batch["subDomainCounts"]) {
  const sorted = (items ?? [])
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const known = sorted.filter(
    (item): item is { id: keyof typeof SUB_DOMAIN_LABELS; count: number } =>
      typeof item.id === "string" && item.id in SUB_DOMAIN_LABELS
  );
  const unknownCount = sorted
    .filter((item) => item.id == null || !(item.id in SUB_DOMAIN_LABELS))
    .reduce((sum, item) => sum + item.count, 0);

  return { known, unknownCount };
}

export default function AdminBatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/batches")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setBatches(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Title row */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Đợt upload bài viết</h1>
          <Link
            href="/admin/batches/new"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Tạo đợt mới
          </Link>
        </div>

        {/* Batches table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tên đợt</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Số bài</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Lĩnh vực</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Subdomain</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Trạng thái</th>
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Ngày tạo</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center">
                      <p className="text-slate-500 text-sm">Đang tải...</p>
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                      Chưa có đợt upload nào.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => {
                    const st = STATUS_CFG[b.status] ?? STATUS_CFG.pending;
                    const domainCls = DOMAIN_CLS[b.domain] ?? "bg-slate-100 text-slate-600";
                    const domainLabel = labelForDomain(b.domain);
                    const subSummary = formatSubDomainSummary(b.subDomainCounts);
                    return (
                      <tr key={b.id} className="hover:bg-blue-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/admin/batches/${b.id}`}
                            className="font-medium text-slate-900 hover:text-blue-600 transition-colors line-clamp-1"
                          >
                            {b.name}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <span className="text-slate-700 font-mono text-sm">{b.totalArticles}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${domainCls}`}>
                            {domainLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          {subSummary.known.length === 0 && subSummary.unknownCount === 0 ? (
                            <span className="text-xs text-slate-400">Chưa có dữ liệu</span>
                          ) : (
                            <div className="flex max-w-[280px] flex-wrap gap-1.5">
                              {subSummary.known.slice(0, 3).map((item) => (
                                <span
                                  key={item.id}
                                  className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                                  title={`${SUB_DOMAIN_LABELS[item.id]}: ${item.count} bài`}
                                >
                                  {SUB_DOMAIN_LABELS[item.id]} · {item.count}
                                </span>
                              ))}
                              {subSummary.known.length > 3 ? (
                                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  +{subSummary.known.length - 3} nhóm
                                </span>
                              ) : null}
                              {subSummary.unknownCount > 0 ? (
                                <span
                                  className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                                  title="Bài không có sub_domain_id hợp lệ"
                                >
                                  Chưa phân loại · {subSummary.unknownCount}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${st.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">
                          {formatDate(b.createdAt)}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-3">
                            <Link
                              href={`/admin/batches/${b.id}`}
                              className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                            >
                              Xem
                            </Link>
                            {b.status === "pending" && (
                              <button className="text-sm text-slate-400 hover:text-red-500 font-medium transition-colors">
                                Xóa
                              </button>
                            )}
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
    </>
  );
}
