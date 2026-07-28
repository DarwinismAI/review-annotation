"use client";

import { useCallback, useEffect, useState } from "react";
import { getSessionUser } from "@/lib/auth-client";

interface ArticleItem {
  id: string;
  title: string;
  status: "completed" | "in_review" | "assigned";
  payRate: number;
  timeSpentMinutes: number | null;
}

interface DashboardData {
  assigned: number;
  completed: number;
  remaining: number;
  totalEarnings: number;
  avgTimeMinutes: number;
  articles: ArticleItem[];
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Chưa bắt đầu", cls: "bg-amber-100 text-amber-700" },
  in_review: { label: "Đang review", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Hoàn thành", cls: "bg-green-100 text-green-700" },
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "buổi sáng";
  if (h < 18) return "buổi chiều";
  return "buổi tối";
}

export default function ExpertDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userName, setUserName] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/dashboard/annotator");
      if (!response.ok) throw new Error("dashboard_request_failed");

      const json = await response.json();
      if (!json.data) throw new Error("dashboard_payload_missing");

      setData(json.data);
    } catch {
      setData(null);
      setError("Không tải được dashboard. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    getSessionUser()
      .then((u) => setUserName(u?.name || u?.email || ""))
      .catch(() => {});
  }, []);

  const assigned = data?.assigned ?? 0;
  const completed = data?.completed ?? 0;
  const remaining = data?.remaining ?? 0;
  const recentArticles = data?.articles?.slice(0, 5) ?? [];

  const completedPct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
  const remainingPct = assigned > 0 ? Math.round((remaining / assigned) * 100) : 0;

  const STAT_CARDS = [
    { label: "Bài được giao", value: loading ? "…" : String(assigned), badge: `${assigned} tổng`, badgeCls: "bg-blue-100 text-blue-600" },
    { label: "Đã hoàn thành", value: loading ? "…" : String(completed), badge: `${completedPct}%`, badgeCls: "bg-green-100 text-green-600" },
    { label: "Còn lại",       value: loading ? "…" : String(remaining),  badge: `${remainingPct}%`, badgeCls: "bg-amber-100 text-amber-600" },
  ];

  return (
    <>
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">
            Chào {greeting()}{userName ? `, ${userName}` : ""}
          </h1>
          <p className="text-sm text-slate-500 mt-1">Đây là tổng quan hoạt động của bạn hôm nay.</p>
        </div>

        {/* 4 stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {STAT_CARDS.map((card) => (
            <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col gap-2">
              <p className="text-sm text-slate-500 font-medium">{card.label}</p>
              <p className="text-3xl font-bold text-slate-900">{card.value}</p>
              <span className={`self-start px-2 py-0.5 rounded text-xs font-medium ${card.badgeCls}`}>
                {card.badge}
              </span>
            </div>
          ))}
        </div>

        {/* Recent articles */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Bài viết gần đây</h2>
            <a
              href="/annotator/articles"
              className="text-sm text-amber-500 hover:text-amber-700 font-medium transition-colors"
            >
              Xem tất cả &rarr;
            </a>
          </div>

          {error && (
            <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  className="self-start rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 sm:self-auto"
                >
                  Thử lại
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Tiêu đề</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Thời gian</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                  <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-500 text-sm">
                      Đang tải…
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-500 text-sm">
                      Chưa có dữ liệu để hiển thị.
                    </td>
                  </tr>
                ) : recentArticles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-500 text-sm">
                      Chưa có bài viết nào được phân công.
                    </td>
                  </tr>
                ) : (
                  recentArticles.map((art) => {
                    const sc = STATUS_CFG[art.status] ?? STATUS_CFG.assigned;
                    const href = `/review/${art.id}`;
                    return (
                      <tr key={art.id} className="hover:bg-slate-50/70 transition-colors" style={{ height: "56px" }}>
                        <td className="px-5 py-3" style={{ maxWidth: "320px" }}>
                          <p className="text-sm font-medium text-slate-900 line-clamp-1">{art.title}</p>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600">
                            {art.timeSpentMinutes === null ? "-" : `${art.timeSpentMinutes} phút`}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.cls}`}>
                            {sc.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {art.status === "assigned" && (
                            <a href={href} className="inline-block px-3 py-1.5 bg-blue-500 text-white text-xs font-medium rounded-md hover:bg-blue-600 transition-colors">
                              Bắt đầu
                            </a>
                          )}
                          {art.status === "in_review" && (
                            <a href={href} className="inline-block px-3 py-1.5 border border-blue-500 text-blue-500 text-xs font-medium rounded-md hover:bg-blue-50 transition-colors">
                              Tiếp tục
                            </a>
                          )}
                          {art.status === "completed" && (
                            <a href={href} className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors" title="Xem lại">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </a>
                          )}
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
