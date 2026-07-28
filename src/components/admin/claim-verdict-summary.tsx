"use client";

import { useEffect, useState } from "react";

interface CommentsSummary {
  totalComments: number;
  totalRatings: number;
  correctRatio: number;
  incorrectRatio: number;
  unsureRatio: number;
  commentedArticles: Array<{
    articleId: string;
    title: string;
    commentCount: number;
  }>;
  topUnsureArticles: Array<{
    articleId: string;
    title: string;
    unsureRatio: number;
    totalRatings: number;
  }>;
}

function pct(ratio: number): string { return `${Math.round(ratio * 100)}%`; }

interface Props {
  batchId: string;
  showArticleLinks?: boolean;
}

export function ClaimVerdictSummary({ batchId, showArticleLinks = true }: Props) {
  const [data, setData] = useState<CommentsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/batches/${batchId}/comments-summary`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setData(json.data);
        else setError("Không tải được dữ liệu đánh giá");
      })
      .catch(() => setError("Lỗi kết nối"))
      .finally(() => setLoading(false));
  }, [batchId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm text-slate-400">Đang tải đánh giá claim…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm text-red-500">{error ?? "Không có dữ liệu"}</p>
      </div>
    );
  }

  const hasRatings = data.totalRatings > 0;
  const commentedArticles = data.commentedArticles ?? [];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900">Nhận xét &amp; đánh giá claim</h2>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">
            {data.totalComments} bình luận
          </span>
          <span className="px-2.5 py-0.5 bg-blue-100 text-blue-600 rounded-full text-xs">
            {data.totalRatings} đánh giá claim
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
        <VerdictCell
          label="Đúng"
          ratio={data.correctRatio}
          count={Math.round(data.correctRatio * data.totalRatings)}
          colorCls="text-green-600"
          badgeCls="bg-green-100 text-green-600"
          hasRatings={hasRatings}
        />
        <VerdictCell
          label="Sai"
          ratio={data.incorrectRatio}
          count={Math.round(data.incorrectRatio * data.totalRatings)}
          colorCls="text-red-600"
          badgeCls="bg-red-100 text-red-600"
          hasRatings={hasRatings}
        />
        <VerdictCell
          label="Không chắc"
          ratio={data.unsureRatio}
          count={Math.round(data.unsureRatio * data.totalRatings)}
          colorCls="text-amber-600"
          badgeCls="bg-amber-100 text-amber-600"
          hasRatings={hasRatings}
        />
      </div>

      {commentedArticles.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Bài có bình luận inline
          </p>
          <ol className="space-y-2">
            {commentedArticles.map((a, i) => (
              <li key={a.articleId} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-slate-400 w-4 shrink-0">{i + 1}.</span>
                  {showArticleLinks ? (
                    <a
                      href={`/admin/articles/${a.articleId}/preview`}
                      className="text-sm text-blue-600 hover:underline truncate"
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="text-sm text-slate-700 truncate">{a.title}</span>
                  )}
                </div>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium shrink-0">
                  {a.commentCount} bình luận
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.topUnsureArticles.length > 0 ? (
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Top bài có nhiều claim &ldquo;không chắc&rdquo; nhất
          </p>
          <ol className="space-y-2">
            {data.topUnsureArticles.map((a, i) => (
              <li key={a.articleId} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-slate-400 w-4 shrink-0">{i + 1}.</span>
                  {showArticleLinks ? (
                    <a
                      href={`/admin/articles/${a.articleId}/preview`}
                      className="text-sm text-blue-600 hover:underline truncate"
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="text-sm text-slate-700 truncate">{a.title}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">{a.totalRatings} đánh giá</span>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                    {pct(a.unsureRatio)} không chắc
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="px-6 py-4 text-sm text-slate-400">
          Chưa có đánh giá claim nào trong đợt này.
        </div>
      )}
    </div>
  );
}

function VerdictCell({
  label,
  ratio,
  count,
  colorCls,
  badgeCls,
  hasRatings,
}: {
  label: string;
  ratio: number;
  count: number;
  colorCls: string;
  badgeCls: string;
  hasRatings: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <p className={`text-2xl font-bold ${hasRatings ? colorCls : "text-slate-900"}`}>{hasRatings ? pct(ratio) : "—"}</p>
      <span className={`px-2 py-0.5 rounded text-xs ${badgeCls}`}>{label}</span>
      {hasRatings && <p className="text-xs text-slate-400">{count} claim</p>}
    </div>
  );
}
