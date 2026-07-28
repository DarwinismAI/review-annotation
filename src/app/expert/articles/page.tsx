"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DOMAIN_ICONS,
  DOMAIN_LABELS,
  type DomainKey,
} from "@/lib/labels";

interface MineItem {
  id: string;
  title: string;
  status: "assigned" | "in_review" | "completed";
  domain: DomainKey;
  batchId: string;
  batchName: string;
  payRate: number;
  enabled: boolean;
  disabledAt: string | null;
  source: "manual" | "broadcast-claimed";
  /** Total seconds spent reviewing from closed sessions. null = no sessions yet. */
  totalSeconds: number | null;
}

interface ApiResponse {
  data: {
    domains: DomainKey[];
    mine: MineItem[];
    page: number;
    pageSize: number;
    total: number;
  };
}

const PAGE_SIZE = 20;

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Chưa bắt đầu", cls: "bg-amber-100 text-amber-700" },
  in_review: { label: "Đang review", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Hoàn thành", cls: "bg-green-100 text-green-700" },
};

/**
 * Format total review seconds into a human-readable Vietnamese string.
 * null / 0 → "—"; < 60s → "<1 phút"; < 3600s → "Xm"; ≥ 3600s → "Xh Ym"
 */
function formatReviewTime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  if (seconds < 60) return "<1 phút";
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ExpertArticlesPage() {
  const [data, setData] = useState<ApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState<DomainKey | "all">("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (activeDomain !== "all") params.set("domain", activeDomain);
    fetch(`/api/expert/articles?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ApiResponse | null) => {
        if (cancelled || !json) return;
        setData(json.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, activeDomain]);

  // Domain change resets pagination so the user lands on page 1 of the filtered list.
  function changeDomain(d: DomainKey | "all") {
    setActiveDomain(d);
    setPage(1);
  }

  const domains = data?.domains ?? [];
  const mine = data?.mine ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(page * PAGE_SIZE, total);

  return (
    <>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Bài của tôi</h1>
          {domains.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Lĩnh vực:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => changeDomain("all")}
                  className={
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors " +
                    (activeDomain === "all"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300")
                  }
                >
                  Tất cả
                </button>
                {domains.map((d) => (
                  <button
                    key={d}
                    onClick={() => changeDomain(d)}
                    className={
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 " +
                      (activeDomain === d
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300")
                    }
                  >
                    <span>{DOMAIN_ICONS[d]}</span>
                    {DOMAIN_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {loading && !data ? (
          <p className="text-sm text-slate-500">Đang tải...</p>
        ) : (
          <>
            <MineList items={mine} />
            {total > 0 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                fromIdx={fromIdx}
                toIdx={toIdx}
                total={total}
                loading={loading}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
    </>
  );
}

function Pagination({
  page,
  totalPages,
  fromIdx,
  toIdx,
  total,
  loading,
  onChange,
}: {
  page: number;
  totalPages: number;
  fromIdx: number;
  toIdx: number;
  total: number;
  loading: boolean;
  onChange: (p: number) => void;
}) {
  const canPrev = page > 1 && !loading;
  const canNext = page < totalPages && !loading;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <p>
        Hiện <span className="font-medium text-slate-700">{fromIdx}</span>–
        <span className="font-medium text-slate-700">{toIdx}</span> / {total} bài
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => canPrev && onChange(page - 1)}
          disabled={!canPrev}
          className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Trước
        </button>
        <span className="text-xs text-slate-600">
          Trang <span className="font-semibold text-slate-900">{page}</span> / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => canNext && onChange(page + 1)}
          disabled={!canNext}
          className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:border-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Sau →
        </button>
      </div>
    </div>
  );
}

function MineList({ items }: { items: MineItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
        Bạn chưa có bài nào. Khi có đợt mới phù hợp lĩnh vực, bài sẽ tự động xuất hiện ở đây.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Tiêu đề
            </th>
            <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">
              Lĩnh vực
            </th>
            <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">
              Trạng thái
            </th>
            <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">
              Thời gian
            </th>
            <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">
              Hành động
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((a) => {
            const sc = STATUS_CFG[a.status] ?? STATUS_CFG.assigned;
            const href = `/review/${a.id}`;
            return (
              <tr key={a.id} className="hover:bg-slate-50/70 transition-colors">
                <td className="px-5 py-3.5">
                  <Link href={href} className="block">
                    <p
                      className={
                        "text-sm font-medium line-clamp-1 hover:text-blue-600 transition-colors " +
                        (a.enabled ? "text-slate-900" : "text-slate-500")
                      }
                    >
                      {a.title}
                    </p>
                    {!a.enabled ? (
                      <p className="text-xs text-amber-600 mt-1">Bài đã bị tắt — còn 24h để hoàn thành</p>
                    ) : null}
                  </Link>
                </td>
                <td className="px-5 py-3.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    {DOMAIN_ICONS[a.domain]} {DOMAIN_LABELS[a.domain]}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span
                    className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${sc.cls}`}
                  >
                    {sc.label}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-center text-xs text-slate-500 font-mono">
                  {formatReviewTime(a.totalSeconds)}
                </td>
                <td className="px-5 py-3.5 text-center">
                  {a.status === "completed" ? (
                    <Link
                      href={href}
                      className="inline-block text-slate-500 hover:text-slate-900 text-xs"
                    >
                      Xem lại
                    </Link>
                  ) : (
                    <Link
                      href={href}
                      className="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                    >
                      {a.status === "assigned" ? "Bắt đầu" : "Tiếp tục"}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
