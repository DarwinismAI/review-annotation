"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArticleToggle } from "@/components/article-toggle";
import {
  domainForSubDomain,
  subDomainForMedicalMicroDomain,
  SUB_DOMAIN_LABELS,
  SUB_DOMAIN_HINTS,
  MEDICAL_MICRO_DOMAIN_LABELS,
} from "@/lib/labels";

interface Expert {
  id: string;
  name: string;
  email?: string | null;
  domains?: string[];
  sub_domains?: string[];
  medical_micro_domains?: string[];
}

interface Article {
  id: string;
  title: string;
  status: "unassigned" | "assigned" | "in_review" | "completed";
  assignmentId?: string | null;
  assignedTo: { id: string; name: string } | null;
  /** AI score 0–100, may be null if not yet computed */
  aiScore?: number | null;
  /** Article visible to annotators? Defaults to true. */
  enabled?: boolean;
  /** Sub-domain classification from ingestion (e.g. "med_01"). NULL → unclassified. */
  subDomainId?: string | null;
  /** Medical-only micro-domain classification below subDomainId. */
  medicalMicroDomainId?: string | null;
}

interface ArticleTableProps {
  articles: Article[];
  annotators: Expert[];
  batchDomain?: string;
}

interface QuickPreview {
  title: string;
  heading: string;
  excerpt: string;
  sectionCount: number;
}

const STATUS_CFG: Record<
  string,
  { label: string; dot: string; badge: string }
> = {
  unassigned: {
    label: "Chưa phân công",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-500",
  },
  assigned: {
    label: "Đã phân công",
    dot: "bg-blue-400",
    badge: "bg-blue-50 text-blue-700",
  },
  in_review: {
    label: "Đang chấm",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
  },
  completed: {
    label: "Hoàn thành",
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700",
  },
};

/** Deterministic avatar color from annotator name initial */
const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-pink-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-amber-500",
];
function avatarColor(name: string | null | undefined): string {
  const safe = name && name.length > 0 ? name : "?";
  const code = safe.charCodeAt(0) + (safe.charCodeAt(1) ?? 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-slate-300 text-xs">—</span>;
  const cls =
    score < 80
      ? "bg-amber-100 text-amber-600"
      : "bg-green-100 text-green-600";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs font-mono font-semibold ${cls}`}
    >
      {score}
    </span>
  );
}

function expertMatchesArticle(
  expert: Expert,
  batchDomain: string | undefined,
  subDomainId: string | null | undefined,
  medicalMicroDomainId: string | null | undefined
): boolean {
  if (!batchDomain) return true;
  if (expert.domains?.length && !expert.domains.includes(batchDomain)) return false;
  if (subDomainId) {
    const narrowedForDomain = (expert.sub_domains ?? []).filter(
      (subId) => domainForSubDomain(subId) === batchDomain
    );
    if (narrowedForDomain.length > 0 && !narrowedForDomain.includes(subDomainId)) return false;
  }

  if (batchDomain !== "medical" || !medicalMicroDomainId) return true;
  const parent = subDomainId ?? subDomainForMedicalMicroDomain(medicalMicroDomainId);
  const narrowedMicros = (expert.medical_micro_domains ?? []).filter(
    (microId) => subDomainForMedicalMicroDomain(microId) === parent
  );
  return narrowedMicros.length === 0 || narrowedMicros.includes(medicalMicroDomainId);
}

function expertSubDomainHint(expert: Expert, batchDomain: string | undefined): string {
  if (!batchDomain) return "";
  const subDomains = (expert.sub_domains ?? []).filter(
    (subId): subId is keyof typeof SUB_DOMAIN_LABELS =>
      domainForSubDomain(subId) === batchDomain && subId in SUB_DOMAIN_LABELS
  );
  if (subDomains.length === 0) return "mọi subdomain";
  return subDomains.map((subId) => SUB_DOMAIN_LABELS[subId]).join(", ");
}

function expertMedicalMicroHint(expert: Expert, subDomainId: string | null | undefined): string | null {
  if (!subDomainId) return null;
  const micros = (expert.medical_micro_domains ?? []).filter(
    (microId): microId is keyof typeof MEDICAL_MICRO_DOMAIN_LABELS =>
      subDomainForMedicalMicroDomain(microId) === subDomainId && microId in MEDICAL_MICRO_DOMAIN_LABELS
  );
  if (micros.length === 0) return null;
  return micros.map((microId) => MEDICAL_MICRO_DOMAIN_LABELS[microId]).join(", ");
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

function plainText(value: string): string {
  return value
    .replace(/\[src_[^\]]+\]/g, "")
    .replace(/[#*_`>~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuickPreview(data: {
  article?: {
    title?: string;
    payloadJson?: string | null;
    textContent?: string | null;
    paragraphs?: { text: string }[] | null;
  };
}): QuickPreview {
  const title = data.article?.title ?? "Bài viết";

  if (data.article?.payloadJson) {
    try {
      const payload = JSON.parse(data.article.payloadJson) as {
        sections?: unknown;
        content_json?: unknown;
        summary?: unknown;
        tldr?: unknown;
      };
      const sections = readArrayField(payload.sections).length > 0
        ? readArrayField(payload.sections)
        : readArrayField(payload.content_json);
      const firstSection = sections.find(
        (item): item is { heading?: unknown; content?: unknown } =>
          typeof item === "object" && item !== null
      );
      const excerptSource =
        typeof firstSection?.content === "string"
          ? firstSection.content
          : typeof payload.summary === "string"
            ? payload.summary
            : typeof payload.tldr === "string"
              ? payload.tldr
              : "";

      return {
        title,
        heading: typeof firstSection?.heading === "string" ? firstSection.heading : "Nội dung đầu bài",
        excerpt: plainText(excerptSource).slice(0, 360),
        sectionCount: sections.length,
      };
    } catch {
      // Fall through to text fallback.
    }
  }

  const paragraphText = data.article?.paragraphs?.map((paragraph) => paragraph.text).join(" ");
  const excerpt = plainText(paragraphText || data.article?.textContent || "").slice(0, 360);
  return {
    title,
    heading: "Nội dung đầu bài",
    excerpt,
    sectionCount: data.article?.paragraphs?.length ?? (excerpt ? 1 : 0),
  };
}

export function ArticleTable({
  articles: initialArticles,
  annotators,
  batchDomain,
}: ArticleTableProps) {
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>(initialArticles);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [selectedExpert, setSelectedExpert] = useState<
    Record<string, string>
  >({});
  const [showAssignModal, setShowAssignModal] = useState<string | null>(null);
  const [previewingArticleId, setPreviewingArticleId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, QuickPreview>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);

  useEffect(() => {
    setArticles(initialArticles);
  }, [initialArticles]);

  async function loadQuickPreview(articleId: string) {
    if (previewCache[articleId] || loadingPreviewId === articleId) return;

    setLoadingPreviewId(articleId);
    try {
      const res = await fetch(`/api/admin/articles/${articleId}/preview`);
      if (!res.ok) return;
      const json = (await res.json()) as { data?: Parameters<typeof buildQuickPreview>[0] };
      if (!json.data) return;
      setPreviewCache((prev) => ({ ...prev, [articleId]: buildQuickPreview(json.data!) }));
    } finally {
      setLoadingPreviewId((current) => (current === articleId ? null : current));
    }
  }

  async function handleAssign(articleId: string) {
    const expertId = selectedExpert[articleId];
    if (!expertId) return;

    setAssigning(articleId);
    try {
      const res = await fetch(`/api/articles/${articleId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expertId }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data: { id: string; expertId: string };
        };
        const expert = annotators.find((e) => e.id === data.data.expertId);
        setArticles((prev) =>
          prev.map((a) =>
            a.id === articleId
              ? {
                  ...a,
                  status: "assigned",
                  assignmentId: data.data.id,
                  assignedTo: expert
                    ? { id: expert.id, name: expert.name }
                    : null,
                }
              : a
          )
        );
        setShowAssignModal(null);
        router.refresh();
      }
    } finally {
      setAssigning(null);
    }
  }

  async function handleRevoke(article: Article) {
    if (!article.assignmentId) return;
    const ok = window.confirm(
      `Thu hồi bài khỏi ${article.assignedTo?.name ?? "annotator này"}? Sau đó bài có thể phân lại nếu không còn assignment khác.`
    );
    if (!ok) return;

    setRevoking(article.assignmentId);
    try {
      const res = await fetch(`/api/articles/${article.id}/revoke-assignment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: article.assignmentId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { articleStatus?: Article["status"]; remainingAssignments?: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        window.alert(json.error?.message ?? "Không thu hồi được phân công");
        return;
      }

      setArticles((prev) => {
        if ((json.data?.remainingAssignments ?? 0) > 0) {
          return prev.filter((row) => row.assignmentId !== article.assignmentId);
        }
        return prev.map((row) =>
          row.id === article.id
            ? {
                ...row,
                status: json.data?.articleStatus ?? "unassigned",
                assignmentId: null,
                assignedTo: null,
              }
            : row
        );
      });
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-center px-3 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-20">
                  Bật
                </th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Tiêu đề
                </th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-28">
                  Điểm AI
                </th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-44">
                  Trạng thái
                </th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-48">
                  Annotator được giao
                </th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider w-28">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {articles.map((a) => {
                const sc = STATUS_CFG[a.status] ?? STATUS_CFG.unassigned;
                const isEnabled = a.enabled !== false;
                return (
                  <tr
                    key={a.id}
                    className={
                      "hover:bg-blue-50/50 transition-colors " +
                      (isEnabled ? "" : "bg-slate-50/60")
                    }
                  >
                    {/* Bật/Tắt */}
                    <td className="px-3 py-3.5 text-center">
                      <ArticleToggle
                        articleId={a.id}
                        enabled={isEnabled}
                        onChange={(next) => {
                          setArticles((prev) =>
                            prev.map((row) =>
                              row.id === a.id ? { ...row, enabled: next } : row
                            )
                          );
                        }}
                      />
                    </td>

                    {/* Tiêu đề */}
                    <td className="px-5 py-3.5">
                      <button
                        type="button"
                        onMouseEnter={() => {
                          setPreviewingArticleId(a.id);
                          void loadQuickPreview(a.id);
                        }}
                        onMouseLeave={() => setPreviewingArticleId(null)}
                        onFocus={() => {
                          setPreviewingArticleId(a.id);
                          void loadQuickPreview(a.id);
                        }}
                        onBlur={() => setPreviewingArticleId(null)}
                        className={
                          "block max-w-[34rem] text-left font-medium line-clamp-1 outline-none focus:text-blue-700 " +
                          (isEnabled ? "text-slate-900" : "text-slate-400 line-through")
                        }
                        aria-label={`Preview nhanh: ${a.title}`}
                      >
                        {a.title}
                      </button>
                      {a.subDomainId && a.subDomainId in SUB_DOMAIN_LABELS ? (
                        <span
                          className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100"
                          title={SUB_DOMAIN_HINTS[a.subDomainId as keyof typeof SUB_DOMAIN_HINTS]}
                        >
                          {SUB_DOMAIN_LABELS[a.subDomainId as keyof typeof SUB_DOMAIN_LABELS]}
                        </span>
                      ) : null}
                      {a.medicalMicroDomainId && a.medicalMicroDomainId in MEDICAL_MICRO_DOMAIN_LABELS ? (
                        <span className="ml-1 inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {MEDICAL_MICRO_DOMAIN_LABELS[a.medicalMicroDomainId as keyof typeof MEDICAL_MICRO_DOMAIN_LABELS]}
                        </span>
                      ) : null}
                      {previewingArticleId === a.id && (
                        <div
                          onMouseEnter={() => setPreviewingArticleId(a.id)}
                          onMouseLeave={() => setPreviewingArticleId(null)}
                          className="mt-2 max-w-[34rem] rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg"
                        >
                          {loadingPreviewId === a.id && !previewCache[a.id] ? (
                            <p className="text-sm text-slate-400">Đang tải preview...</p>
                          ) : previewCache[a.id]?.excerpt ? (
                            <>
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                                Preview nhanh · {previewCache[a.id].sectionCount || 1} phần
                              </p>
                              <p className="mb-2 line-clamp-2 text-sm font-semibold text-slate-900">
                                {previewCache[a.id].heading}
                              </p>
                              <p className="line-clamp-6 text-sm leading-6 text-slate-600">
                                {previewCache[a.id].excerpt}
                              </p>
                              <p className="mt-3 text-[11px] text-slate-400">
                                Bấm “Xem” nếu cần mở bản read-only đầy đủ.
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-slate-400">Chưa có nội dung preview cho bài này.</p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Điểm AI */}
                    <td className="px-5 py-3.5 text-center">
                      <ScoreBadge score={a.aiScore} />
                    </td>

                    {/* Trạng thái */}
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${sc.badge}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}
                        />
                        {sc.label}
                      </span>
                    </td>

                    {/* Annotator được giao */}
                    <td className="px-5 py-3.5">
                      {a.assignedTo ? (
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 ${avatarColor(a.assignedTo.name)} rounded-full flex items-center justify-center flex-shrink-0`}
                          >
                            <span className="text-[10px] font-bold text-white">
                              {initials(a.assignedTo.name)}
                            </span>
                          </div>
                          <span className="font-medium text-slate-700 text-sm line-clamp-1">
                            {a.assignedTo.name ?? "Annotator"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-sm italic">
                          Chưa phân công
                        </span>
                      )}
                    </td>

                    {/* Hành động */}
                    <td className="px-5 py-3.5 text-center">
                      <div className="inline-flex items-center gap-3">
                        <a
                          href={`/admin/articles/${a.id}/preview`}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
                          title="Preview như annotator (read-only)"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          Xem
                        </a>
                        {a.status === "unassigned" && (
                          <button
                            type="button"
                            onClick={() => setShowAssignModal(a.id)}
                            className="border border-slate-200 bg-white text-blue-600 hover:border-blue-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                          >
                            Phân công
                          </button>
                        )}
                        {a.status === "assigned" && a.assignmentId && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(a)}
                            disabled={revoking === a.assignmentId}
                            className="border border-slate-200 bg-white text-red-600 hover:border-red-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                          >
                            {revoking === a.assignmentId ? "Đang thu hồi..." : "Thu hồi"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign modal */}
      {showAssignModal && (() => {
        const article = articles.find((a) => a.id === showAssignModal);
        const compatibleExperts = annotators.filter((expert) =>
          expertMatchesArticle(expert, batchDomain, article?.subDomainId, article?.medicalMicroDomainId)
        );
        const articleSubDomainLabel =
          article?.subDomainId && article.subDomainId in SUB_DOMAIN_LABELS
            ? SUB_DOMAIN_LABELS[article.subDomainId as keyof typeof SUB_DOMAIN_LABELS]
            : null;
        const articleMedicalMicroLabel =
          article?.medicalMicroDomainId && article.medicalMicroDomainId in MEDICAL_MICRO_DOMAIN_LABELS
            ? MEDICAL_MICRO_DOMAIN_LABELS[article.medicalMicroDomainId as keyof typeof MEDICAL_MICRO_DOMAIN_LABELS]
            : null;
        const selectedIsCompatible = compatibleExperts.some(
          (expert) => expert.id === selectedExpert[showAssignModal]
        );

        return (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowAssignModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 mb-4">
              Phân công annotator
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {articleSubDomainLabel || articleMedicalMicroLabel
                ? `Bài thuộc ${[
                    articleSubDomainLabel ? `subdomain: ${articleSubDomainLabel}` : null,
                    articleMedicalMicroLabel ? `nhánh nhỏ: ${articleMedicalMicroLabel}` : null,
                  ].filter(Boolean).join(" · ")}. Danh sách dưới đây chỉ hiển thị annotator phù hợp.`
                : "Bài chưa có subdomain, danh sách dưới đây lọc theo lĩnh vực của đợt upload."}
            </p>
            <select
              value={selectedExpert[showAssignModal] ?? ""}
              onChange={(e) =>
                setSelectedExpert((prev) => ({
                  ...prev,
                  [showAssignModal]: e.target.value,
                }))
              }
              disabled={compatibleExperts.length === 0}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-blue-400 outline-none mb-2 bg-white disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">-- Chọn annotator --</option>
              {compatibleExperts.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                  {ex.email ? ` <${ex.email}>` : ""} — {expertSubDomainHint(ex, batchDomain)}
                  {expertMedicalMicroHint(ex, article?.subDomainId) ? ` · ${expertMedicalMicroHint(ex, article?.subDomainId)}` : ""}
                </option>
              ))}
            </select>
            {compatibleExperts.length === 0 ? (
              <p className="mb-4 text-sm text-amber-700">
                Chưa có annotator active nào khớp lĩnh vực/subdomain này.
              </p>
            ) : (
              <p className="mb-4 text-xs text-slate-400">
                Annotator không chọn subdomain riêng được hiểu là nhận mọi subdomain trong lĩnh vực.
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAssignModal(null)}
                className="border border-slate-200 bg-white text-slate-600 hover:border-blue-300 rounded-lg px-3 py-2 text-sm transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={() => handleAssign(showAssignModal)}
                disabled={
                  !selectedExpert[showAssignModal] ||
                  !selectedIsCompatible ||
                  assigning === showAssignModal ||
                  compatibleExperts.length === 0
                }
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {assigning === showAssignModal
                  ? "Đang lưu..."
                  : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
