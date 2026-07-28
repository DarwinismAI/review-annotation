"use client";

import { use, useCallback, useEffect, useState } from "react";
import { ArticleTable } from "@/components/article-table";
import { ClaimVerdictSummary } from "@/components/admin/claim-verdict-summary";
import {
  ASSIGNMENT_MODE_LABELS,
  DOMAIN_LABELS as DOMAIN_LBLS,
  SUB_DOMAIN_LABELS,
  type AssignmentMode,
} from "@/lib/labels";

interface Expert {
  id: string;
  name: string;
  email?: string | null;
  domains: string[];
  sub_domains: string[];
  medical_micro_domains: string[];
}

interface Article {
  id: string;
  title: string;
  status: "unassigned" | "assigned" | "in_review" | "completed";
  assignmentId?: string | null;
  assignedTo: { id: string; name: string } | null;
  aiScore?: number | null;
  enabled?: boolean;
  subDomainId?: string | null;
  medicalMicroDomainId?: string | null;
}

interface BatchDetail {
  id: string;
  name: string;
  domain: string;
  status: string;
  createdAt: string;
  totalArticles: number;
  doneCount: number;
  enabledCount: number;
  assignmentMode: AssignmentMode;
  broadcastExpiresAt: string | null;
  claimedCount: number;
  subDomainCounts: Array<{ id: string | null; count: number }>;
}

const DOMAIN_LABELS: Record<string, string> = DOMAIN_LBLS;

const BATCH_STATUS_CFG: Record<
  string,
  { label: string; dot: string; cls: string }
> = {
  pending: {
    label: "Chờ xử lý",
    dot: "bg-amber-400",
    cls: "bg-amber-50 text-amber-700",
  },
  ready: {
    label: "Sẵn sàng",
    dot: "bg-blue-400",
    cls: "bg-blue-50 text-blue-700",
  },
  processing: {
    label: "Đang xử lý",
    dot: "bg-blue-400",
    cls: "bg-blue-50 text-blue-700",
  },
  done: {
    label: "Hoàn tất",
    dot: "bg-green-400",
    cls: "bg-green-50 text-green-700",
  },
  failed: {
    label: "Thất bại",
    dot: "bg-red-400",
    cls: "bg-red-50 text-red-700",
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function summarizeSubDomains(items: BatchDetail["subDomainCounts"]) {
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

export default function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [annotators, setAnnotators] = useState<Expert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [extendDate, setExtendDate] = useState("");
  const [extendOpen, setExtendOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }

  const loadBatchDetail = useCallback(async () => {
    try {
      // Load batch info, articles, and active annotators in parallel
      const [batchRes, articlesRes, expertsRes] = await Promise.all([
        fetch(`/api/batches/${id}`),
        fetch(`/api/batches/${id}/articles?limit=100`),
        fetch("/api/annotators?status=active"),
      ]);

      if (!batchRes.ok) {
        setError("Không tìm thấy đợt upload");
        return;
      }

      const batchData = (await batchRes.json()) as {
        data: {
          id: string;
          name: string;
          domain: string;
          status: string;
          createdAt: string;
          totalArticles: number;
          assignmentMode: AssignmentMode;
          broadcastExpiresAt: string | null;
          enabledCount: number;
          claimedCount: number;
          subDomainCounts?: Array<{ id: string | null; count: number }>;
        };
      };

      const articlesData = articlesRes.ok
        ? ((await articlesRes.json()) as {
            data: {
              articles: Array<{
                id: string;
                title: string;
                status: string;
                assignmentId?: string | null;
                enabled?: boolean;
                assignedTo: { id: string; name: string } | null;
                subDomainId?: string | null;
                medicalMicroDomainId?: string | null;
              }>;
              total: number;
            };
          })
        : null;

      const expertsData = expertsRes.ok
        ? ((await expertsRes.json()) as {
            data: Array<{
              userId: string;
              email?: string | null;
              name: string;
              domains?: string[];
              domain?: string;
              sub_domains?: string[];
              medical_micro_domains?: string[];
            }>;
          })
        : null;

      const rawArticles = articlesData?.data.articles ?? [];
      const doneCount = rawArticles.filter((a) => a.status === "completed").length;

      setBatch({
        id: batchData.data.id,
        name: batchData.data.name,
        domain: batchData.data.domain,
        status: batchData.data.status,
        createdAt: batchData.data.createdAt,
        totalArticles: batchData.data.totalArticles,
        doneCount,
        enabledCount: batchData.data.enabledCount ?? batchData.data.totalArticles,
        assignmentMode: batchData.data.assignmentMode ?? "manual",
        broadcastExpiresAt: batchData.data.broadcastExpiresAt,
        claimedCount: batchData.data.claimedCount ?? 0,
        subDomainCounts: batchData.data.subDomainCounts ?? [],
      });

      setArticles(
        rawArticles.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status as Article["status"],
          assignmentId: a.assignmentId ?? null,
          assignedTo: a.assignedTo,
          aiScore: null,
          enabled: a.enabled !== false,
          subDomainId: a.subDomainId ?? null,
          medicalMicroDomainId: a.medicalMicroDomainId ?? null,
        }))
      );

      setAnnotators(
        (expertsData?.data ?? []).map((e) => ({
          id: e.userId,
          name: e.name,
          email: e.email ?? null,
          domains: e.domains ?? (e.domain ? [e.domain] : []),
          sub_domains: e.sub_domains ?? [],
          medical_micro_domains: e.medical_micro_domains ?? [],
        }))
      );
      setError(null);
    } catch {
      setError("Đã xảy ra lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadBatchDetail();
  }, [loadBatchDetail]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Đang tải...</p>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error ?? "Không tìm thấy đợt upload"}</p>
      </div>
    );
  }

  const statusCfg =
    BATCH_STATUS_CFG[batch.status] ?? BATCH_STATUS_CFG.processing;

  const isBroadcast = batch.assignmentMode === "broadcast";
  const expiresAtMs = batch.broadcastExpiresAt
    ? new Date(batch.broadcastExpiresAt).getTime()
    : null;
  const expired = expiresAtMs != null && expiresAtMs < Date.now();
  const daysLeft =
    expiresAtMs != null ? Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 86400000)) : null;

  /** Min date for the extend picker = max(tomorrow, current expiresAt + 1 day). */
  function extendMinDate(): string {
    const minTomorrow = new Date();
    minTomorrow.setDate(minTomorrow.getDate() + 1);
    if (expiresAtMs != null) {
      const candidate = new Date(expiresAtMs);
      candidate.setDate(candidate.getDate() + 1);
      return (candidate > minTomorrow ? candidate : minTomorrow).toISOString().slice(0, 10);
    }
    return minTomorrow.toISOString().slice(0, 10);
  }

  function openExtend() {
    setExtendDate(extendMinDate());
    setExtendOpen(true);
  }

  async function submitExtend() {
    if (!extendDate) return;
    setExtending(true);
    try {
      const iso = new Date(extendDate + "T23:59:59").toISOString();
      const res = await fetch(`/api/batches/${id}/extend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broadcastExpiresAt: iso }),
      });
      const json = (await res.json()) as {
        data?: { broadcastExpiresAt: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        showToast(json.error?.message ?? "Không gia hạn được");
        return;
      }
      setBatch((prev) =>
        prev ? { ...prev, broadcastExpiresAt: json.data?.broadcastExpiresAt ?? iso } : prev
      );
      setExtendOpen(false);
      showToast("Đã gia hạn");
    } finally {
      setExtending(false);
    }
  }

  const assignableCount = articles.filter(
    (article) => article.status === "unassigned" && article.enabled !== false
  ).length;
  const subDomainSummary = summarizeSubDomains(batch.subDomainCounts);

  async function submitBulkAssign() {
    if (assignableCount === 0 || bulkAssigning) return;
    const ok = window.confirm(
      `Chia ${assignableCount} bài đang bật, chưa phân công cho annotator phù hợp? Mỗi bài chỉ được gán cho một annotator.`
    );
    if (!ok) return;

    setBulkAssigning(true);
    try {
      const res = await fetch(`/api/batches/${id}/assign-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });
      const json = (await res.json()) as {
        data?: { summary?: { assigned: number; skipped: number; annotators: number } };
        error?: { message?: string };
      };

      if (!res.ok) {
        showToast(json.error?.message ?? "Không chia được bài");
        return;
      }

      const summary = json.data?.summary;
      if (!summary || summary.assigned === 0) {
        showToast(summary?.annotators === 0 ? "Chưa có annotator phù hợp" : "Không có bài nào cần chia");
      } else {
        showToast(`Đã chia ${summary.assigned} bài cho annotator`);
      }
      await loadBatchDetail();
    } finally {
      setBulkAssigning(false);
    }
  }

  return (
    <>
        {/* Title row */}
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{batch.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500">
              <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                {DOMAIN_LABELS[batch.domain] ?? batch.domain}
              </span>
              <span>·</span>
              <span>{formatDate(batch.createdAt)}</span>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${statusCfg.cls}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
            {statusCfg.label}
          </span>
        </div>

        {/* 5-metric info-bar (tổng / đang bật / mode / claimed / hạn) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Metric label="Tổng số bài" value={String(batch.totalArticles)} />
          <Metric
            label="Đang bật"
            value={`${batch.enabledCount}/${batch.totalArticles}`}
            tone={batch.enabledCount < batch.totalArticles ? "warn" : "neutral"}
          />
          <Metric
            label="Cách phân công"
            value={ASSIGNMENT_MODE_LABELS[batch.assignmentMode]}
          />
          <Metric
            label="Tiến độ review"
            value={`${batch.doneCount}/${batch.totalArticles}`}
          />
          {isBroadcast ? (
            <div className="space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Hạn nhận bài</p>
              <p
                className={`text-base font-semibold ${
                  expired ? "text-red-600" : daysLeft != null && daysLeft <= 3 ? "text-amber-600" : "text-slate-900"
                }`}
              >
                {batch.broadcastExpiresAt ? formatDate(batch.broadcastExpiresAt) : "—"}
              </p>
              <div className="flex items-center gap-2">
                {expired ? (
                  <span className="text-xs text-red-600">Đã hết hạn</span>
                ) : daysLeft != null ? (
                  <span className="text-xs text-slate-500">Còn {daysLeft} ngày</span>
                ) : null}
                <button
                  type="button"
                  onClick={openExtend}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Gia hạn
                </button>
              </div>
            </div>
          ) : (
            <Metric label="Đã nhận" value="—" />
          )}
        </div>

        {isBroadcast ? (
          <div className="mb-4 text-sm text-slate-600">
            Đã có{" "}
            <span className="font-semibold text-slate-900">{batch.claimedCount}</span>{" "}
            lượt nhận bài tự động.
          </div>
        ) : null}

        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Phân bổ subdomain</h2>
              <p className="mt-1 text-sm text-slate-500">
                Dựa trên `sub_domain_id` trong payload JSON. Dùng mục này để kiểm tra trước khi chia bài cho annotator.
              </p>
            </div>
            {subDomainSummary.unknownCount > 0 ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                {subDomainSummary.unknownCount} bài chưa phân loại
              </span>
            ) : null}
          </div>
          {subDomainSummary.known.length === 0 && subDomainSummary.unknownCount === 0 ? (
            <p className="text-sm text-slate-400">Chưa có dữ liệu subdomain cho đợt này.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subDomainSummary.known.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {SUB_DOMAIN_LABELS[item.id]} · {item.count} bài
                </span>
              ))}
              {subDomainSummary.unknownCount > 0 ? (
                <span className="inline-flex items-center rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  Chưa phân loại · {subDomainSummary.unknownCount} bài
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Article table */}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Danh sách bài</h2>
            <p className="text-sm text-slate-500">
              Chia hàng loạt các bài đang bật, chưa phân công. Hệ thống chỉ gán mỗi bài cho một annotator.
            </p>
          </div>
          {!isBroadcast ? (
            <button
              type="button"
              onClick={submitBulkAssign}
              disabled={bulkAssigning || assignableCount === 0}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkAssigning ? "Đang chia bài..." : "Chia bài cho annotator"}
            </button>
          ) : null}
        </div>
        <ArticleTable articles={articles} annotators={annotators} batchDomain={batch.domain} />

        {/* Comments & verdict aggregation for this batch */}
        <div className="mt-6">
          <ClaimVerdictSummary batchId={id} showArticleLinks />
        </div>

      {extendOpen ? (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Gia hạn nhận bài</h2>
              <p className="text-sm text-slate-500 mt-1">
                Hạn mới phải muộn hơn hạn hiện tại. Sau khi cập nhật, các annotator có thêm thời gian để nhận các bài còn lại.
              </p>
            </div>
            <div>
              <label htmlFor="extend-date" className="block text-sm font-medium text-slate-700 mb-1.5">
                Hạn mới
              </label>
              <input
                id="extend-date"
                type="date"
                min={extendMinDate()}
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExtendOpen(false)}
                className="border border-slate-200 bg-white text-slate-600 rounded-lg px-4 py-2 text-sm font-medium hover:border-blue-300"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={submitExtend}
                disabled={extending || !extendDate}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {extending ? "Đang lưu..." : "Cập nhật"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50">
          {toast}
        </div>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p
        className={`text-base font-semibold ${
          tone === "warn" ? "text-amber-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
