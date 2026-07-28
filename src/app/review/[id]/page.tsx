"use client";

import { use, useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { DisabledBanner } from "@/components/disabled-banner";
import { useReviewSession } from "@/hooks/use-review-session";
import { useTextSelection } from "@/hooks/use-text-selection";
import { InlineCommentComposer } from "@/components/review/inline-comment-composer";
import { resolveAnchor, buildAnchorDataFromQuote, wrapRangeWithMark, clearMarks } from "@/lib/anchor-resolver";
import { CompensationSurveyModal } from "@/components/review/compensation-survey-modal";
import { renderSectionHtml } from "@/lib/markdown-render";

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface SourceItem {
  source_id: string;
  title?: string;
  publisher?: string;
  url?: string;
}

interface ParsedPayload {
  sections: ArticleSection[];
  sources: SourceItem[];
}

interface ReviewData {
  article: {
    id: string;
    title: string;
    type: string;
    sourceFormat?: string;
    payloadJson?: string | null;
    domain?: string | null;
    textContent: string | null;
    paragraphs: { id: string; index: number; text: string }[] | null;
    enabled?: boolean;
    disabledAt?: string | null;
  };
  rubric: { id: string; criteria: RubricCriterion[] } | null;
  assignment: { id: string; status: string };
  draft: { scores: { criterionId: string; score: number; reason?: string }[]; savedAt: string | null } | null;
}

interface SectionScore {
  /** criterionId → metric score declared by the rubric scale */
  ratings: Record<string, number>;
  reason: string;
}

/** Inline comment as returned by GET /api/articles/[id]/comments */
interface ArticleComment {
  id: string;
  articleId: string;
  assignmentId: string;
  sectionId: string;
  anchorQuote: string;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  anchorOffsetStart: number | null;
  anchorOffsetEnd: number | null;
  body: string;
  status: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metricLabelCls(rating: number, scale: ScaleItem[]) {
  const label = scale.find((s) => s.score === rating)?.label.toLowerCase() ?? "";
  if (/(pass|passed|đạt)/i.test(label)) return "text-green-600";
  if (/(fail|failed|không đạt|trượt)/i.test(label)) return "text-red-500";
  if (scale.length <= 2) return rating === Math.max(...scale.map((s) => s.score)) ? "text-green-600" : "text-red-500";
  if (rating >= 4) return "text-green-600";
  if (rating <= 2) return "text-red-500";
  return "text-amber-500";
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
    .filter((item): item is { heading?: unknown; content?: unknown } =>
      typeof item === "object" && item !== null
    )
    .map((s, i) => ({
      heading: typeof s.heading === "string" && s.heading.trim() ? s.heading.trim() : `Phần ${i + 1}`,
      content: typeof s.content === "string" ? s.content : "",
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
 * Parse the article payload into the artifacts the review screen needs.
 * JSON seed files are not fully uniform: legal/tourism use native arrays while
 * medical may store equivalent data under *_json keys as arrays or JSON strings.
 */
function parsePayload(data: ReviewData): ParsedPayload {
  const empty: ParsedPayload = {
    sections: [],
    sources: [],
  };

  if (data.article.sourceFormat === "json" && data.article.payloadJson) {
    try {
      const payload = JSON.parse(data.article.payloadJson) as Record<string, unknown>;
      const sections = normalizeSections(readArrayField(payload.sections));
      const contentJsonSections = normalizeSections(readArrayField(payload.content_json));
      const secs = sections.length > 0 ? sections : contentJsonSections;

      if (secs.length > 0) {
        const sources = normalizeSources(readArrayField(payload.sources));
        const jsonSources = normalizeSources(readArrayField(payload.sources_json));

        return {
          sections: secs,
          sources: sources.length > 0 ? sources : jsonSources,
        };
      }
    } catch {
      // fall through to text-based fallback
    }
  }

  if (data.article.paragraphs && data.article.paragraphs.length > 0) {
    return {
      ...empty,
      sections: data.article.paragraphs.map((p, i) => ({
        heading: `Đoạn ${i + 1}`,
        content: p.text,
      })),
    };
  }
  const text = data.article.textContent ?? "";
  const chunks = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length === 0) {
    return { ...empty, sections: [{ heading: data.article.title, content: text }] };
  }
  const groupSize = Math.ceil(chunks.length / Math.min(8, Math.max(1, Math.ceil(chunks.length / 3))));
  const sections: ArticleSection[] = [];
  for (let i = 0; i < chunks.length; i += groupSize) {
    const group = chunks.slice(i, i + groupSize);
    sections.push({
      heading: i === 0 ? data.article.title : `Phần ${sections.length + 1}`,
      content: group.join("\n\n"),
    });
  }
  return { ...empty, sections };
}

function emptyScore(criteria: RubricCriterion[]): SectionScore {
  return {
    ratings: Object.fromEntries(criteria.map((c) => [c.id, 0])),
    reason: "",
  };
}

function isSectionDone(score: SectionScore, criteria: RubricCriterion[]): boolean {
  const required = criteria.filter((c) => c.required);
  if (required.length === 0) {
    if (criteria.length === 0) return false;
    return Object.values(score.ratings).some((r) => r > 0);
  }
  return required.every((c) => (score.ratings[c.id] ?? 0) > 0);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricWidget({
  rating,
  scale,
  onChange,
}: {
  rating: number;
  scale: ScaleItem[];
  onChange: (r: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  if (scale.length === 2) {
    return (
      <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
        {scale.map((item) => {
          const selected = item.score === rating;
          const selectedClass = metricLabelCls(item.score, scale).includes("green")
            ? "border-green-500 bg-green-50 text-green-700"
            : "border-red-500 bg-red-50 text-red-700";
          return (
            <button
              key={item.score}
              type="button"
              aria-label={item.label}
              title={item.description || item.label}
              onClick={() => onChange(item.score)}
              className={`h-8 min-w-20 rounded-md border px-3 text-xs font-semibold transition-colors ${
                selected ? selectedClass : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex gap-0.5 shrink-0 pt-0.5">
      {(scale.length > 0 ? scale : [1, 2, 3, 4, 5].map((score) => ({ score, label: `${score}`, description: "" }))).map((item) => (
        <button
          key={item.score}
          aria-label={item.label || `${item.score} sao`}
          title={item.description || item.label}
          onClick={() => onChange(item.score)}
          onMouseEnter={() => setHovered(item.score)}
          onMouseLeave={() => setHovered(0)}
          className={`cursor-pointer transition-transform hover:scale-125 ${
            item.score <= (hovered || rating) ? "text-amber-400" : "text-slate-200"
          }`}
          style={{ fontSize: 18, lineHeight: 1, padding: 1 }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // ── Data ──
  const [data, setData] = useState<ReviewData | null>(null);
  const [sections, setSections] = useState<ArticleSection[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Navigation ──
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);

  // ── Scoring state: one SectionScore per section ──
  const [scores, setScores] = useState<SectionScore[]>([]);

  // ── Review session time tracking ──
  // assignmentId becomes available after load; hook is skipped (no-op) until then.
  const assignmentId = data?.assignment.id ?? "";
  const { sessionId: reviewSessionId } = useReviewSession(assignmentId);

  // ── Timer ──
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Toast ──
  const [toast, setToast] = useState<string | null>(null);

  // ── Save state ──
  const [completed, setCompleted] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);

  // ── Disabled-grace state ──
  const [graceExpired, setGraceExpired] = useState(false);

  // ── Inline comments ──
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  /** Ref to the left panel article content container for mark rendering */
  const contentPanelRef = useRef<HTMLDivElement>(null);

  // ── Text selection hook ──
  const { selection, isActive: composerOpen, openComposer, closeComposer } = useTextSelection();

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ── Load ──
  useEffect(() => {
    async function load() {
      try {
        try {
          const sessionRes = await fetch("/api/auth/me");
          const session = sessionRes.ok
            ? ((await sessionRes.json()) as { role?: string } | null)
            : null;
          if (session?.role === "admin" || session?.role === "superadmin") {
            window.location.replace(`/admin/articles/${id}/preview`);
            return;
          }
        } catch {
          // Fall through to the annotator review loader.
        }

        const res = await fetch(`/api/articles/${id}/review`);
        if (!res.ok) {
          const err = (await res.json()) as { error?: { message?: string } };
          setError(err.error?.message ?? "Không tải được bài viết");
          return;
        }
        const json = (await res.json()) as { data: ReviewData };
        const reviewData = json.data;
        setData(reviewData);
        setCompleted(reviewData.assignment.status === "completed");

        const parsed = parsePayload(reviewData);
        setSections(parsed.sections);
        setSources(parsed.sources);

        const criteria = reviewData.rubric?.criteria ?? [];
        const initialScores = parsed.sections.map(() => emptyScore(criteria));

        // Load inline comments
        try {
          const cRes = await fetch(`/api/articles/${reviewData.article.id}/comments`);
          if (cRes.ok) {
            const cJson = (await cRes.json()) as { comments: ArticleComment[] };
            setComments(cJson.comments ?? []);
          }
        } catch {
          // Non-fatal - comments load is best-effort
        }

        // Restore draft if present
        if (reviewData.draft?.scores) {
          for (const s of initialScores) {
            for (const ds of reviewData.draft.scores) {
              if (ds.criterionId in s.ratings) {
                s.ratings[ds.criterionId] = ds.score;
              }
            }
          }
        }
        setScores(initialScores);
      } catch {
        setError("Đã xảy ra lỗi khi tải bài viết");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  // ── Timer ──
  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Render comment marks after content renders ──
  // Depend on `loading` too: comments may be populated before the DOM that
  // hosts [data-anchor-root] mounts (the loading-skeleton branch returns
  // different JSX). Without loading in deps, the effect runs once with ref=null
  // and never re-runs after mount, so marks never render.
  useEffect(() => {
    if (loading || !contentPanelRef.current) return;

    // Clear old marks first
    clearMarks(contentPanelRef.current);

    // Only render marks for the current section
    const sectionId = `sec-${activeSectionIdx}`;
    const sectionComments = comments.filter((c) => c.sectionId === sectionId);

    for (const comment of sectionComments) {
      // The section content is inside [data-anchor-root] inside contentPanelRef
      const anchorRoot = contentPanelRef.current.querySelector("[data-anchor-root]");
      if (!anchorRoot) continue;

      const range = resolveAnchor(
        {
          quote: comment.anchorQuote,
          prefix: comment.anchorPrefix,
          suffix: comment.anchorSuffix,
          offsetStart: comment.anchorOffsetStart,
          offsetEnd: comment.anchorOffsetEnd,
        },
        anchorRoot
      );
      if (!range) continue;

      const markEl = wrapRangeWithMark(range, comment.id);
      if (markEl) {
        const cId = comment.id;
        markEl.addEventListener("click", () => {
          setActiveCommentId(cId);
        });
      }
    }
  }, [comments, activeSectionIdx, loading]);

  // ── Save a new inline comment ──
  const saveComment = useCallback(
    async (body: string) => {
      if (!data || !selection) return;
      // Use the cached selection text (from useTextSelection). Re-reading
      // window.getSelection() at submit-time fails because the textarea has
      // focus and the document range is collapsed → quote ends up empty.
      if (!selection.text || !selection.containerEl) return;
      const anchorData = buildAnchorDataFromQuote(selection.text, selection.containerEl);

      const payload = {
        articleId: data.article.id,
        assignmentId: data.assignment.id,
        sectionId: selection.sectionId,
        anchorQuote: anchorData.quote,
        anchorPrefix: anchorData.prefix ?? undefined,
        anchorSuffix: anchorData.suffix ?? undefined,
        anchorOffsetStart: anchorData.offsetStart ?? undefined,
        anchorOffsetEnd: anchorData.offsetEnd ?? undefined,
        body,
      };

      try {
        const res = await fetch("/api/article-comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          showToast("Không thể lưu comment");
          return;
        }
        const json = (await res.json()) as { comment: ArticleComment };
        setComments((prev) => [json.comment, ...prev]);
        closeComposer();
        showToast("Đã thêm comment");
      } catch {
        showToast("Lỗi khi lưu comment");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selection, closeComposer]
  );

  // ── Auto-save to /api/articles/[id]/review/draft ──
  const autoSave = useCallback(
    async (currentScores: SectionScore[]) => {
      if (!data) return;
      const criteria = data.rubric?.criteria ?? [];
      const flatScores = criteria
        .map((c) => {
          // Use the score from the currently active section
          const rating = currentScores[activeSectionIdx]?.ratings[c.id] ?? 0;
          return rating > 0
            ? { criterionId: c.id, score: rating, reason: currentScores[activeSectionIdx]?.reason }
            : null;
        })
        .filter(Boolean) as { criterionId: string; score: number; reason?: string }[];

      try {
        await fetch(`/api/articles/${id}/review/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores: flatScores }),
        });
      } catch {
        // Non-fatal - autosave is best-effort
      }
    },
    [data, id, activeSectionIdx]
  );

  // ── Update score ──
  function updateRating(criterionId: string, rating: number) {
    if (readOnly) {
      showToast("Bài đang ở chế độ chỉ đọc");
      return;
    }
    setScores((prev) => {
      const next = prev.map((s, i) =>
        i === activeSectionIdx
          ? { ...s, ratings: { ...s.ratings, [criterionId]: rating } }
          : s
      );
      autoSave(next);
      return next;
    });
  }

  function updateReason(val: string) {
    if (readOnly) return;
    setScores((prev) =>
      prev.map((s, i) => (i === activeSectionIdx ? { ...s, reason: val } : s))
    );
  }

  // ── Navigation ──
  function navigateSection(delta: number) {
    setActiveSectionIdx((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= sections.length) return prev;
      return next;
    });
  }

  // ── Save draft (manual) ──
  async function saveDraft() {
    await autoSave(scores);
    showToast("Đã lưu nháp thành công!");
  }

  // ── Complete review ──
  async function completeReview() {
    if (!data || completing) return;
    setCompleting(true);
    const criteria = data.rubric?.criteria ?? [];

    // Close session before submitting (best-effort - failure does not block submit)
    if (reviewSessionId) {
      try {
        await fetch("/api/article-review-sessions/close", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: reviewSessionId, reason: "submit" }),
          credentials: "include",
        });
      } catch {
        // Non-fatal
      }
    }

    // Collect scores from first section (flat review model)
    const flatScores = criteria
      .map((c) => {
        const rating = scores[0]?.ratings[c.id] ?? 0;
        return rating > 0
          ? { criterionId: c.id, score: rating, reason: scores[0]?.reason }
          : null;
      })
      .filter(Boolean) as { criterionId: string; score: number; reason?: string }[];

    try {
      const res = await fetch(`/api/articles/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: flatScores }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        showToast(err.error?.message ?? "Gửi đánh giá thất bại");
        return;
      }
      const json = (await res.json()) as {
        data?: { batchCompleted?: boolean; surveyNeeded?: boolean };
      };
      setCompleted(true);

      const skipped =
        typeof window !== "undefined" &&
        sessionStorage.getItem("compensation-survey-skipped") === "1";

      if (json.data?.batchCompleted && json.data?.surveyNeeded && !skipped) {
        showToast("Hoàn thành đánh giá!");
        setShowSurvey(true);
        return;
      }
      showToast("Hoàn thành đánh giá! Đang gửi...");
      setTimeout(() => (window.location.href = "/annotator/articles"), 2000);
    } catch {
      setCompleting(false);
      showToast("Đã xảy ra lỗi, vui lòng thử lại");
    }
  }

  // ── Derived ──
  const criteria = data?.rubric?.criteria ?? [];
  const activeSection = sections[activeSectionIdx];
  const activeScore = scores[activeSectionIdx] ?? emptyScore(criteria);

  // Stable dangerouslySetInnerHTML payload - without memoization React rebuilds
  // the object every render, which makes it re-apply innerHTML on the section
  // content div and wipe out the <mark> tags inserted by the comment effect.
  const sectionContentHtml = useMemo(
    () => ({ __html: renderSectionHtml(activeSection?.content ?? "", sources) }),
    [activeSection?.content, sources]
  );
  const doneSections = scores.filter((s) => isSectionDone(s, criteria)).length;
  const allDone = sections.length > 0 && doneSections === sections.length;

  /** Article disabled by admin AND 24h grace already elapsed → fully read-only. */
  const readOnly = graceExpired || completed;
  const isDisabled = data?.article.enabled === false;

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="bg-slate-50"
        style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
      >
        <p className="text-slate-400 text-sm">Đang tải bài viết...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="bg-slate-50"
        style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
      >
        <p className="text-red-500 text-sm">{error ?? "Không tìm thấy bài viết"}</p>
        <Link href="/annotator/articles" className="text-blue-600 text-sm mt-3 hover:underline">
          Quay lại danh sách
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-[100dvh] flex flex-col">
      {/* ── Header ── */}
      <header className="bg-slate-900 h-14 px-6 flex items-center gap-3 z-20 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            href="/annotator/articles"
            aria-label="Quay lại danh sách"
            className="text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <span className="text-white font-bold text-base shrink-0">Review Annotation</span>
          <span className="text-slate-600 shrink-0">/</span>
          <h1
            id="header-title"
            className="text-slate-300 text-sm truncate"
          >
            {data.article.title}
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="flex items-center gap-1.5 text-slate-400 font-mono text-sm">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span id="header-timer">{formatTimer(elapsed)}</span>
          </span>
          <span id="header-section-count" className="text-slate-400 text-sm">
            {activeSectionIdx + 1}/{sections.length}
          </span>
          {!completed && !readOnly && (
            <button
              onClick={saveDraft}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Lưu
            </button>
          )}
        </div>
      </header>

      {/* ── Disabled grace banner (24h countdown / read-only after) ── */}
      {isDisabled && data?.article.disabledAt ? (
        <DisabledBanner
          disabledAt={data.article.disabledAt}
          onExpire={() => setGraceExpired(true)}
        />
      ) : null}

      {/* ── Section stepper ── */}
      <div className="bg-white border-b border-slate-200 h-12 flex items-center justify-center shrink-0 px-5">
        <div id="section-stepper" className="flex items-center overflow-x-auto">
          {sections.map((_, idx) => {
            const done = isSectionDone(scores[idx] ?? emptyScore(criteria), criteria);
            const active = idx === activeSectionIdx;


            return (
              <div key={idx} className="flex items-center">
                {idx > 0 && (
                  <div
                    style={{
                      height: 2,
                      width: 60,
                      flexShrink: 0,
                      background: isSectionDone(scores[idx - 1] ?? emptyScore(criteria), criteria)
                        ? "#86efac"
                        : "#e2e8f0",
                    }}
                  />
                )}
                <button
                  title={sections[idx].heading}
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
                    flexShrink: 0,
                    transition: "all 0.15s",
                    ...(active
                      ? {
                          background: "#3b82f6",
                          color: "white",
                          border: "2px solid #3b82f6",
                          boxShadow: "0 0 0 3px rgba(59,130,246,0.2)",
                        }
                      : done
                      ? {
                          background: "#22c55e",
                          color: "white",
                          border: "2px solid #22c55e",
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
              </div>
            );
          })}
        </div>
        {allDone && !completed && !readOnly && (
          <button
            onClick={completeReview}
            disabled={completing}
            id="btn-complete"
            className="ml-4 px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {completing ? "Đang gửi..." : "Hoàn thành"}
          </button>
        )}
        <button
          id="btn-prev"
          onClick={() => navigateSection(-1)}
          className="sr-only"
        />
        <button
          id="btn-next"
          onClick={() => navigateSection(1)}
          className="sr-only"
        />
      </div>

      {/* ── Main work panels ── */}
      <div id="work-panels" className="flex flex-1" style={{ position: "relative" }}>
        {/* LEFT: Current section content */}
        <div
          ref={contentPanelRef}
          id="left-panel"
          className="w-3/5 bg-white border-r border-slate-200 p-6"
          style={{ position: "relative" }}
        >
          <div className="max-w-[65ch]">
            <div className="flex items-center justify-between mb-4">
              <span
                id="section-label"
                className="text-xs font-semibold text-blue-600 uppercase tracking-wider"
              >
                Phần {activeSectionIdx + 1} / {sections.length}
              </span>
              <span id="section-status" className="text-xs">
                {isSectionDone(activeScore, criteria) ? (
                  <span className="inline-flex items-center gap-1 text-green-600 font-medium text-xs">
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Đã chấm
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">Chưa chấm</span>
                )}
              </span>
            </div>
            <h2
              id="section-heading"
              className="text-xl font-bold text-slate-900 mb-4 leading-snug"
            >
              {activeSection?.heading ?? ""}
            </h2>
            <div
              id="section-content"
              data-anchor-root
              data-section-id={`sec-${activeSectionIdx}`}
              className="content-text text-[15px] text-slate-700 leading-7"
              dangerouslySetInnerHTML={sectionContentHtml}
            />
            {/* Selection hint: absolute-positioned within left-panel (position:relative) */}
            {selection && !composerOpen && !readOnly && (
              <button
                type="button"
                aria-label="Mở ô comment cho đoạn đã chọn"
                onMouseDown={(e) => e.preventDefault()} // preserve selection
                onClick={() => openComposer(selection)}
                style={{
                  position: "fixed",
                  top: selection.rect.bottom - window.scrollY + 8,
                  left: Math.max(8, selection.rect.right - window.scrollX - 70),
                  background: "#1e293b",
                  color: "#f1f5f9",
                  fontSize: 12,
                  fontWeight: 500,
                  padding: "6px 14px",
                  border: "none",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                  zIndex: 999,
                  pointerEvents: "auto",
                }}
              >
                Comment <kbd style={{ display: "inline-block", background: "#334155", border: "1px solid #475569", borderRadius: 3, padding: "0 5px", fontSize: 11, fontFamily: "monospace", margin: "0 2px" }}>c</kbd>
              </button>
            )}
          </div>
        </div>

        {/* RIGHT: Scoring form */}
        <div id="right-panel" className="w-2/5 bg-slate-50 flex flex-col">
          {/* Scoring area */}
          <div className="p-5 space-y-4">

            {/* Section A: Metric scoring */}
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-bold text-slate-700">Chấm điểm Section</p>
                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-600 text-xs rounded-full">
                  Bắt buộc
                </span>
              </div>

              {criteria.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  Chưa có metric cho lĩnh vực này.
                </p>
              ) : (
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-0">
                  {criteria.map((c, ci) => {
                    const rating = activeScore.ratings[c.id] ?? 0;
                    return (
                      <div key={c.id}>
                        {ci > 0 && <div className="border-t border-slate-200" />}
                        <div className="flex items-start gap-3 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-700">{c.name}</p>
                            <p className="text-xs text-slate-400 leading-snug mt-0.5">
                              {c.description}
                            </p>
                            <div className="mt-1">
                              {rating > 0 ? (
                                <span
                                  className={`text-xs font-medium ${metricLabelCls(rating, c.scale)}`}
                                >
                                  {c.scale.find((item) => item.score === rating)?.label ?? rating}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-300">Chưa chấm</span>
                              )}
                            </div>
                          </div>
                          <MetricWidget
                            rating={rating}
                            scale={c.scale}
                            onChange={(r) => updateRating(c.id, r)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section B: Reason textarea */}
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <p className="text-sm font-bold text-slate-700 mb-2">
                Lý do{" "}
                <span className="text-slate-400 font-normal text-sm">(tùy chọn)</span>
              </p>
              <textarea
                id="section-reason"
                rows={3}
                placeholder="Nhận xét chung về section này..."
                value={activeScore.reason}
                onChange={(e) => updateReason(e.target.value)}
                onBlur={() => autoSave(scores)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-slate-400"
              />
            </div>

            {/* Section D: Inline comments for current section */}
            {(() => {
              const sectionComments = comments.filter(
                (c) => c.sectionId === `sec-${activeSectionIdx}`
              );
              if (sectionComments.length === 0) return null;
              return (
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-sm font-bold text-slate-700">Nhận xét inline</p>
                    <span className="px-2.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-semibold">
                      {sectionComments.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {sectionComments.map((c) => {
                      const isActive = c.id === activeCommentId;
                      return (
                        <div
                          key={c.id}
                          id={`comment-sidebar-${c.id}`}
                          onClick={() => {
                            setActiveCommentId(c.id);
                            // Scroll the mark in the article text into view
                            const markEl = contentPanelRef.current?.querySelector(
                              `mark[data-comment-id="${c.id}"]`
                            );
                            if (markEl) {
                              markEl.scrollIntoView({ behavior: "smooth", block: "center" });
                              markEl.classList.add("flash");
                              setTimeout(() => markEl.classList.remove("flash"), 1000);
                            }
                          }}
                          className={`rounded-lg border p-2.5 cursor-pointer transition-all ${
                            isActive
                              ? "border-blue-300 bg-blue-50 ring-2 ring-blue-200"
                              : "border-slate-200 hover:border-blue-200 hover:bg-slate-50"
                          }`}
                        >
                          <p className="text-xs text-slate-500 italic truncate mb-1">
                            &ldquo;{c.anchorQuote.length > 60 ? c.anchorQuote.substring(0, 60) + "…" : c.anchorQuote}&rdquo;
                          </p>
                          <p className="text-sm text-slate-700 leading-snug">{c.body}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Section E: Navigation bar (sticky bottom) */}
          <div className="border-t border-slate-200 bg-white px-4 py-3 flex gap-2 shrink-0">
            <button
              onClick={() => navigateSection(-1)}
              disabled={activeSectionIdx === 0}
              id="panel-btn-prev"
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Section trước
            </button>
            {activeSectionIdx === sections.length - 1 && !completed && !readOnly ? (
              <button
                onClick={allDone ? completeReview : undefined}
                disabled={!allDone || completing}
                id="panel-btn-submit"
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {completing ? "Đang gửi..." : allDone ? "✓ Nộp bài" : "Đánh giá hết để nộp"}
              </button>
            ) : (
              <button
                onClick={() => navigateSection(1)}
                disabled={activeSectionIdx === sections.length - 1}
                id="panel-btn-next"
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Section tiếp →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline comment composer popover */}
      {composerOpen && selection && !readOnly && (
        <InlineCommentComposer
          selection={selection}
          onSave={saveComment}
          onClose={closeComposer}
        />
      )}

      {/* Compensation survey modal (shown once after batch completion) */}
      <CompensationSurveyModal
        open={showSurvey}
        onClose={(skipped) => {
          if (skipped && typeof window !== "undefined") {
            sessionStorage.setItem("compensation-survey-skipped", "1");
          }
          setShowSurvey(false);
          window.location.href = "/annotator/articles";
        }}
      />

      {/* Toast */}
      {toast && (
        <div
          id="toast"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-50 flex items-center gap-2 whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span id="toast-msg">{toast}</span>
        </div>
      )}
    </div>
  );
}
