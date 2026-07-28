"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SUB_DOMAIN_LABELS, SUB_DOMAIN_HINTS, MEDICAL_MICRO_DOMAIN_LABELS } from "@/lib/labels";
import { renderSectionHtml, type SourceItem } from "@/lib/markdown-render";

interface ScaleItem {
  score: number;
  label: string;
  description: string;
}

interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  required: boolean;
  scale: ScaleItem[];
}

interface ArticleSection {
  heading: string;
  content: string;
  claims?: { claim_text: string; confidence?: number; source_ids?: string[] }[];
}

interface PreviewData {
  article: {
    id: string;
    title: string;
    type: string;
    sourceFormat: string;
    payloadJson: string | null;
    pdfUrl: string | null;
    textContent: string | null;
    paragraphs: { id: string; index: number; text: string }[] | null;
    subDomainId?: string | null;
    medicalMicroDomainId?: string | null;
  };
  rubric: { id: string; criteria: RubricCriterion[] } | null;
  assignment: { id: string; status: string; expertId: string; expertName: string | null } | null;
  batch: { id: string; name: string; domain: string } | null;
}

interface InlineComment {
  id: string;
  sectionId: string;
  anchorQuote: string;
  body: string;
  status: string;
  createdAt: string;
  expertId: string;
  expertName: string | null;
}

interface ClaimRating {
  id: string;
  sectionId: string;
  claimIdx: number;
  verdict: string;
  expertId: string;
  expertName: string | null;
}

const VERDICT_CFG: Record<string, { label: string; cls: string }> = {
  correct: { label: "Đúng", cls: "bg-green-100 text-green-700" },
  incorrect: { label: "Sai", cls: "bg-red-100 text-red-700" },
  unsure: { label: "Không chắc", cls: "bg-amber-100 text-amber-700" },
};

function readArrayField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSections(rawSections: unknown[]): ArticleSection[] {
  return rawSections
    .filter((item): item is { heading?: unknown; content?: unknown; claims?: unknown } =>
      typeof item === "object" && item !== null
    )
    .map((s, i) => ({
      heading: typeof s.heading === "string" && s.heading.trim() ? s.heading.trim() : `Phần ${i + 1}`,
      content: typeof s.content === "string" ? s.content : "",
      claims: Array.isArray(s.claims) ? (s.claims as ArticleSection["claims"]) : [],
    }));
}

function normalizeSources(rawSources: unknown[]): SourceItem[] {
  return rawSources
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((s, i) => ({
      source_id: typeof s.source_id === "string" && s.source_id ? s.source_id : `src_${i + 1}`,
      title: typeof s.title === "string" ? s.title : undefined,
      publisher: typeof s.publisher === "string" ? s.publisher : undefined,
      url: typeof s.url === "string" ? s.url : undefined,
    }));
}

/**
 * Build display sections from whichever source the article carries.
 * sourceFormat='json' → parse payloadJson, prefer payload.sections[], then payload.content_json.
 * sourceFormat='pdf'  → fall back to paragraphs / textContent split.
 */
function buildSections(data: PreviewData): ArticleSection[] {
  if (data.article.sourceFormat === "json" && data.article.payloadJson) {
    try {
      const payload = JSON.parse(data.article.payloadJson) as { sections?: unknown; content_json?: unknown };
      const secs = normalizeSections(readArrayField(payload.sections));
      if (secs.length > 0) return secs;

      const contentJsonSecs = normalizeSections(readArrayField(payload.content_json));
      if (contentJsonSecs.length > 0) return contentJsonSecs;
    } catch {
      // fall through to text-based fallback
    }
  }

  if (data.article.paragraphs && data.article.paragraphs.length > 0) {
    return data.article.paragraphs.map((p, i) => ({
      heading: `Đoạn ${i + 1}`,
      content: p.text,
    }));
  }

  const text = data.article.textContent ?? "";
  const chunks = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length === 0) return [{ heading: data.article.title, content: text }];
  return chunks.map((c, i) => ({
    heading: i === 0 ? data.article.title : `Phần ${i + 1}`,
    content: c,
  }));
}

/**
 * Extract `sources[]` from the article payload so [src_xxx] citation tokens
 * resolve to numbered pills with hover tooltips. Mirrors the annotator review's
 * source resolution. Falls back to the `sources_json` variant used by older
 * medical seed files.
 */
function buildSources(data: PreviewData): SourceItem[] {
  if (data.article.sourceFormat !== "json" || !data.article.payloadJson) return [];
  try {
    const payload = JSON.parse(data.article.payloadJson) as { sources?: unknown; sources_json?: unknown };
    const primary = normalizeSources(readArrayField(payload.sources));
    if (primary.length > 0) return primary;
    return normalizeSources(readArrayField(payload.sources_json));
  } catch {
    return [];
  }
}

function metricLabelCls(rating: number, scale: ScaleItem[]): string {
  const label = scale.find((item) => item.score === rating)?.label.toLowerCase() ?? "";
  if (/(pass|passed|đạt)/i.test(label)) return "text-green-600";
  if (/(fail|failed|không đạt|trượt)/i.test(label)) return "text-red-500";
  if (scale.length <= 2) return rating === Math.max(...scale.map((item) => item.score)) ? "text-green-600" : "text-red-500";
  if (rating >= 4) return "text-green-600";
  if (rating <= 2) return "text-red-500";
  return "text-amber-500";
}

function metricButtonClass(item: ScaleItem, scale: ScaleItem[], selected: boolean): string {
  const color = metricLabelCls(item.score, scale);
  const selectedClass = color.includes("green")
    ? "border-green-500 bg-green-50 text-green-700"
    : color.includes("red")
      ? "border-red-500 bg-red-50 text-red-700"
      : "border-amber-500 bg-amber-50 text-amber-700";

  return selected
    ? selectedClass
    : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700";
}

function MetricPreviewControl({
  rating,
  scale,
  onChange,
}: {
  rating: number;
  scale: ScaleItem[];
  onChange: (rating: number) => void;
}) {
  return (
    <div className="flex max-w-[260px] shrink-0 flex-wrap justify-end gap-1.5">
      {scale.map((item) => {
        const selected = item.score === rating;
        return (
          <button
            key={item.score}
            type="button"
            title={item.description}
            aria-label={item.label}
            onClick={() => onChange(selected ? 0 : item.score)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${metricButtonClass(item, scale, selected)}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Stars that look + feel exactly like the annotator's rubric stars (hover, click,
 * fill state) but never call any persistence - admin preview is throwaway.
 */
function PreviewStars({
  rating,
  onChange,
  size = 18,
  ariaPrefix = "sao",
}: {
  rating: number;
  onChange: (rating: number) => void;
  size?: number;
  ariaPrefix?: string;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5 shrink-0 pt-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i} ${ariaPrefix}`}
          onClick={() => onChange(i === rating ? 0 : i)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(0)}
          style={{ fontSize: size, lineHeight: 1, padding: 1, transition: "transform 0.1s" }}
          className={`cursor-pointer hover:scale-125 ${
            i <= (hovered || rating) ? "text-amber-400" : "text-slate-200"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function AdminPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [data, setData] = useState<PreviewData | null>(null);
  const [sections, setSections] = useState<ArticleSection[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [infoBarOpen, setInfoBarOpen] = useState(true);

  // Inline comments + claim ratings from DB
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [ratings, setRatings] = useState<ClaimRating[]>([]);
  const [showOnlyUnsure, setShowOnlyUnsure] = useState(false);
  const [activeTab, setActiveTab] = useState<"rubric" | "comments">("rubric");

  // Throwaway local ratings - admin can play with stars but nothing persists.
  const [criteriaRatings, setCriteriaRatings] = useState<Record<string, number>>({});
  const [claimRatingsLocal, setClaimRatingsLocal] = useState<Record<string, number>>({});

  function setCriterionRating(sectionIdx: number, criterionId: string, rating: number) {
    setCriteriaRatings((prev) => ({ ...prev, [`${sectionIdx}:${criterionId}`]: rating }));
  }
  function setClaimRatingLocal(sectionIdx: number, claimIdx: number, rating: number) {
    setClaimRatingsLocal((prev) => ({ ...prev, [`${sectionIdx}:${claimIdx}`]: rating }));
  }

  useEffect(() => {
    async function load() {
      try {
        const [previewRes, commentsRes] = await Promise.all([
          fetch(`/api/admin/articles/${id}/preview`),
          fetch(`/api/admin/articles/${id}/comments`),
        ]);

        if (!previewRes.ok) {
          const err = (await previewRes.json()) as { error?: { message?: string } };
          setError(err.error?.message ?? "Không tải được bài viết");
          return;
        }

        const json = (await previewRes.json()) as { data: PreviewData };
        setData(json.data);
        setSections(buildSections(json.data));
        setSources(buildSources(json.data));

        if (commentsRes.ok) {
          const commentsJson = (await commentsRes.json()) as {
            data: { comments: InlineComment[]; ratings: ClaimRating[] };
          };
          setComments(commentsJson.data?.comments ?? []);
          setRatings(commentsJson.data?.ratings ?? []);
        }
      } catch {
        setError("Đã xảy ra lỗi khi tải bài viết");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const criteria = data?.rubric?.criteria ?? [];
  const activeSection = sections[activeSectionIdx];
  const backHref = data?.batch ? `/admin/batches/${data.batch.id}` : "/admin/batches";

  // Memoize so React doesn't rebuild innerHTML object every render.
  // Must stay before early returns so the hook order is stable while loading.
  const sectionContentHtml = useMemo(
    () => ({ __html: renderSectionHtml(activeSection?.content ?? "", sources) }),
    [activeSection?.content, sources]
  );

  if (loading) {
    return (
      <div
        className="bg-slate-50"
        style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <p className="text-slate-400 text-sm">Đang tải bài viết...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="bg-slate-50"
        style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}
      >
        <p className="text-red-500 text-sm">{error ?? "Không tìm thấy bài viết"}</p>
        <Link href="/admin/batches" className="text-blue-600 text-sm hover:underline">
          Quay lại danh sách đợt upload
        </Link>
      </div>
    );
  }

  // Section ID used in DB is "sec-{idx}"
  const activeSectionId = `sec-${activeSectionIdx}`;

  // Comments for the active section
  const sectionComments = comments.filter((c) => c.sectionId === activeSectionId);

  // Claim ratings for the active section, optionally filtered to unsure only
  const sectionRatings = ratings.filter(
    (r) =>
      r.sectionId === activeSectionId &&
      (!showOnlyUnsure || r.verdict === "unsure")
  );

  // Group ratings by claimIdx for display
  const ratingsByClaimIdx = new Map<number, ClaimRating[]>();
  for (const r of sectionRatings) {
    const existing = ratingsByClaimIdx.get(r.claimIdx) ?? [];
    existing.push(r);
    ratingsByClaimIdx.set(r.claimIdx, existing);
  }

  const totalComments = comments.length;
  const totalRatings = ratings.length;
  const unsureCount = ratings.filter((r) => r.verdict === "unsure").length;

  return (
    <div
      className="bg-slate-50 overflow-hidden"
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      {/* ── Read-only banner ── */}
      <div className="bg-amber-100 border-b border-amber-300 h-11 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-amber-800">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-semibold">
            Đang preview như annotator - Read-only mode. Mọi thay đổi sẽ không được lưu.
            {data.assignment?.expertName && (
              <span className="font-normal ml-1">
                (Đang xem assignment của <strong>{data.assignment.expertName}</strong>)
              </span>
            )}
          </span>
        </div>
        <Link
          href={backHref}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-400 rounded-md text-amber-800 text-xs font-semibold hover:bg-amber-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Đóng preview
        </Link>
      </div>

      {/* ── Header ── */}
      <header className="bg-slate-900 h-14 px-6 flex items-center gap-3 z-20 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            href={backHref}
            aria-label="Quay lại batch"
            className="text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="text-white font-bold text-base shrink-0">Admin Preview</span>
          <span className="text-slate-600 shrink-0">/</span>
          <h1 className="text-slate-300 text-sm truncate">{data.article.title}</h1>
          {data.article.subDomainId && data.article.subDomainId in SUB_DOMAIN_LABELS ? (
            <span
              className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 shrink-0"
              title={SUB_DOMAIN_HINTS[data.article.subDomainId as keyof typeof SUB_DOMAIN_HINTS]}
            >
              {SUB_DOMAIN_LABELS[data.article.subDomainId as keyof typeof SUB_DOMAIN_LABELS]}
            </span>
          ) : null}
          {data.article.medicalMicroDomainId && data.article.medicalMicroDomainId in MEDICAL_MICRO_DOMAIN_LABELS ? (
            <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 shrink-0">
              {MEDICAL_MICRO_DOMAIN_LABELS[data.article.medicalMicroDomainId as keyof typeof MEDICAL_MICRO_DOMAIN_LABELS]}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-slate-400 text-sm">
            {sections.length > 0 ? `${activeSectionIdx + 1}/${sections.length}` : "-"}
          </span>
          {totalComments > 0 && (
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-[11px] rounded-full">
              {totalComments} bình luận
            </span>
          )}
          {unsureCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[11px] rounded-full">
              {unsureCount} không chắc
            </span>
          )}
          <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 text-[11px] font-semibold rounded-full uppercase tracking-wide">
            read-only
          </span>
        </div>
      </header>

      {/* ── Info bar ── */}
      <div className="bg-slate-50 border-b border-slate-200 shrink-0">
        <button
          onClick={() => setInfoBarOpen((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-100 transition-colors text-left"
        >
          <span className="text-sm font-semibold text-slate-500">Thông tin bài viết</span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${infoBarOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {infoBarOpen && (
          <div className="px-6 pb-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Tiêu đề</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{data.article.title}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Nguồn ({data.article.sourceFormat === "json" ? "JSON" : "PDF"})
                  </p>
                  <p className="text-xs text-slate-500">
                    {sections.length} phần · loại: {data.article.type === "paragraph" ? "Đoạn" : "Toàn bài"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Trạng thái review
                </p>
                <div className="space-y-1.5 text-xs text-slate-600">
                  {data.assignment ? (
                    <>
                      <p>
                        Annotator: <strong>{data.assignment.expertName ?? "-"}</strong>
                      </p>
                      <p>
                        Status: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{data.assignment.status}</code>
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-400 italic">Bài chưa được phân công.</p>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs text-slate-500">{totalComments} bình luận inline</span>
                  <span className="text-xs text-slate-500">{totalRatings} đánh giá claim</span>
                  {unsureCount > 0 && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                      {unsureCount} không chắc
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section stepper ── */}
      <div className="bg-white border-b border-slate-200 h-12 flex items-center justify-center shrink-0 px-5 gap-2">
        {sections.map((s, idx) => {
          const active = idx === activeSectionIdx;
          const secId = `sec-${idx}`;
          const hasUnsure = ratings.some((r) => r.sectionId === secId && r.verdict === "unsure");
          const hasComments = comments.some((c) => c.sectionId === secId);
          return (
            <div key={idx} className="flex items-center">
              {idx > 0 && (
                <div
                  style={{
                    height: 2,
                    width: 60,
                    background: "#e2e8f0",
                  }}
                />
              )}
              <div className="relative">
                <button
                  title={s.heading}
                  onClick={() => setActiveSectionIdx(idx)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    ...(active
                      ? {
                          background: "#3b82f6",
                          color: "white",
                          border: "2px solid #3b82f6",
                          boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
                        }
                      : {
                          background: "#f1f5f9",
                          color: "#94a3b8",
                          border: "2px solid #e2e8f0",
                        }),
                  }}
                >
                  {idx + 1}
                </button>
                {/* Indicator dots for comments/unsure */}
                {(hasComments || hasUnsure) && (
                  <span
                    className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-white ${hasUnsure ? "bg-amber-400" : "bg-blue-400"}`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Split panel ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: section content */}
        <div className="w-3/5 overflow-y-auto bg-white border-r border-slate-200 p-6">
          <div className="max-w-[65ch]">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                Phần {activeSectionIdx + 1} / {sections.length}
              </span>
              {sectionComments.length > 0 && (
                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">
                  {sectionComments.length} bình luận trong phần này
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-4 leading-snug">
              {activeSection?.heading ?? "-"}
            </h2>
            <div
              className="content-text text-[15px] text-slate-700 leading-7"
              dangerouslySetInnerHTML={sectionContentHtml}
            />

            {/* Inline comments for this section */}
            {sectionComments.length > 0 && (
              <div className="mt-6 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Bình luận inline ({sectionComments.length})
                </p>
                {sectionComments.map((c) => (
                  <div
                    key={c.id}
                    className={`border rounded-lg p-3 ${c.status === "resolved" ? "border-slate-200 bg-slate-50 opacity-70" : "border-blue-200 bg-blue-50"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs font-semibold text-slate-600">
                        {c.expertName ?? "Annotator"}
                      </p>
                      {c.status === "resolved" && (
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 text-[10px] rounded">
                          Đã giải quyết
                        </span>
                      )}
                    </div>
                    <blockquote className="text-xs text-slate-500 italic border-l-2 border-slate-300 pl-2 mb-2 line-clamp-2">
                      &ldquo;{c.anchorQuote}&rdquo;
                    </blockquote>
                    <p className="text-sm text-slate-700">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: rubric + claims + DB verdicts */}
        <div className="w-2/5 bg-slate-50 flex flex-col">
          {/* Tab switcher */}
          <div className="flex border-b border-slate-200 bg-white shrink-0">
            <button
              onClick={() => setActiveTab("rubric")}
              className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === "rubric" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 hover:text-slate-700"}`}
            >
              Rubric & Claim
            </button>
            <button
              onClick={() => setActiveTab("comments")}
              className={`flex-1 py-3 text-xs font-semibold transition-colors ${activeTab === "comments" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 hover:text-slate-700"}`}
            >
              Đánh giá thực tế
              {(sectionComments.length > 0 || sectionRatings.length > 0) && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full text-[10px]">
                  {sectionComments.length + sectionRatings.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeTab === "rubric" ? (
              <>
                {/* Metric checks */}
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-sm font-bold text-slate-700">Chấm điểm Section</p>
                    <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                      Không lưu
                    </span>
                  </div>
                  {criteria.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      Chưa có metric cho lĩnh vực {data.batch?.domain ?? "-"}.
                    </p>
                  ) : (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-0">
                      {criteria.map((c, i) => {
                        const rating = criteriaRatings[`${activeSectionIdx}:${c.id}`] ?? 0;
                        return (
                          <div key={c.id}>
                            {i > 0 && <div className="border-t border-slate-200" />}
                            <div className="flex items-start gap-3 py-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-700">{c.name}</p>
                                {c.description && (
                                  <p className="text-xs text-slate-400 leading-snug mt-0.5">
                                    {c.description}
                                  </p>
                                )}
                                <div className="mt-1">
                                  {rating > 0 ? (
                                    <span className={`text-xs font-medium ${metricLabelCls(rating, c.scale)}`}>
                                      {c.scale.find((item) => item.score === rating)?.label ?? rating}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-300">Chưa chấm</span>
                                  )}
                                </div>
                              </div>
                              <MetricPreviewControl
                                rating={rating}
                                scale={c.scale}
                                onChange={(r) => setCriterionRating(activeSectionIdx, c.id, r)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Claims with DB verdicts */}
                {activeSection?.claims && activeSection.claims.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-sm font-bold text-slate-700">Claims trong đoạn</p>
                      <span className="px-2.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full">
                        {activeSection.claims.length} claim
                      </span>
                    </div>
                    <div className="space-y-3">
                      {activeSection.claims.map((claim, idx) => {
                        const rating = claimRatingsLocal[`${activeSectionIdx}:${idx}`] ?? 0;
                        const dbRatings = ratingsByClaimIdx.get(idx) ?? [];
                        return (
                          <div
                            key={idx}
                            className="bg-white border border-slate-200 rounded-lg p-3"
                          >
                            <p className="text-sm text-slate-700 leading-relaxed">
                              {claim.claim_text}
                            </p>
                            <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                              <span>
                                Confidence: <strong>{claim.confidence ?? "-"}</strong>
                                {claim.source_ids && claim.source_ids.length > 0 && (
                                  <> · Nguồn: {claim.source_ids.join(", ")}</>
                                )}
                              </span>
                              <PreviewStars
                                rating={rating}
                                onChange={(r) => setClaimRatingLocal(activeSectionIdx, idx, r)}
                                size={14}
                              />
                            </div>
                            {/* DB verdicts from annotators */}
                            {dbRatings.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                                {dbRatings.map((dr) => {
                                  const cfg = VERDICT_CFG[dr.verdict] ?? { label: dr.verdict, cls: "bg-slate-100 text-slate-600" };
                                  return (
                                    <span
                                      key={dr.id}
                                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${cfg.cls}`}
                                      title={dr.expertName ?? "Annotator"}
                                    >
                                      {cfg.label} · {dr.expertName ?? "CG"}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* "Đánh giá thực tế" tab - DB comments + verdicts */
              <>
                {/* Filter toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Phần {activeSectionIdx + 1}
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-slate-500">Chỉ hiện &ldquo;không chắc&rdquo;</span>
                    <button
                      onClick={() => setShowOnlyUnsure((v) => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${showOnlyUnsure ? "bg-amber-400" : "bg-slate-200"}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${showOnlyUnsure ? "translate-x-4" : ""}`}
                      />
                    </button>
                  </label>
                </div>

                {/* Claim verdicts for this section */}
                {ratingsByClaimIdx.size > 0 ? (
                  <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
                    <p className="text-sm font-bold text-slate-700 mb-2">Verdict theo claim</p>
                    {Array.from(ratingsByClaimIdx.entries())
                      .sort(([a], [b]) => a - b)
                      .map(([claimIdx, claimRatingsList]) => {
                        const claim = activeSection?.claims?.[claimIdx];
                        return (
                          <div key={claimIdx} className="border border-slate-100 rounded-lg p-3">
                            {claim && (
                              <p className="text-xs text-slate-500 italic mb-2 line-clamp-2">
                                {claim.claim_text}
                              </p>
                            )}
                            {!claim && (
                              <p className="text-xs text-slate-400 mb-2">Claim #{claimIdx}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {claimRatingsList.map((dr) => {
                                const cfg = VERDICT_CFG[dr.verdict] ?? { label: dr.verdict, cls: "bg-slate-100 text-slate-600" };
                                return (
                                  <span
                                    key={dr.id}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${cfg.cls}`}
                                  >
                                    {cfg.label} · {dr.expertName ?? "CG"}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-100 p-4">
                    <p className="text-sm text-slate-400">
                      {showOnlyUnsure ? "Không có claim nào bị đánh dấu \"không chắc\" trong phần này." : "Chưa có đánh giá claim nào trong phần này."}
                    </p>
                  </div>
                )}

                {/* Inline comments for this section */}
                {sectionComments.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
                    <p className="text-sm font-bold text-slate-700 mb-2">
                      Bình luận inline ({sectionComments.length})
                    </p>
                    {sectionComments.map((c) => (
                      <div
                        key={c.id}
                        className={`border rounded-lg p-3 ${c.status === "resolved" ? "border-slate-200 bg-slate-50" : "border-blue-200 bg-blue-50"}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold text-slate-700">
                            {c.expertName ?? "Annotator"}
                          </p>
                          {c.status === "resolved" && (
                            <span className="px-1.5 py-0.5 bg-slate-200 text-slate-500 text-[10px] rounded">
                              Đã giải quyết
                            </span>
                          )}
                        </div>
                        <blockquote className="text-[11px] text-slate-500 italic border-l-2 border-slate-300 pl-2 mb-1.5 line-clamp-1">
                          &ldquo;{c.anchorQuote}&rdquo;
                        </blockquote>
                        <p className="text-sm text-slate-700">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {sectionComments.length === 0 && ratingsByClaimIdx.size === 0 && (
                  <p className="text-sm text-slate-400 text-center py-6">
                    Chưa có bình luận hay đánh giá nào trong phần này.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Bottom nav - mirrors the expert-view layout. "Nộp bài" stays
              disabled because admin preview is read-only. */}
          <div className="border-t border-slate-200 bg-white px-4 py-3 flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveSectionIdx((i) => Math.max(0, i - 1))}
              disabled={activeSectionIdx === 0}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Section trước
            </button>
            {activeSectionIdx === sections.length - 1 ? (
              <button
                type="button"
                disabled
                title="Read-only - admin preview không thể nộp"
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white opacity-40 cursor-not-allowed"
              >
                ✓ Nộp bài
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveSectionIdx((i) => Math.min(sections.length - 1, i + 1))}
                disabled={activeSectionIdx === sections.length - 1}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Section tiếp →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
