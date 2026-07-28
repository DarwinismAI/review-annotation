"use client";

import { useState } from "react";
import { RubricItem } from "./rubric-item";

const STAR_LABELS: Record<number, string> = {
  1: "Sai hoàn toàn",
  2: "Phần lớn sai",
  3: "Không rõ",
  4: "Phần lớn đúng",
  5: "Đúng hoàn toàn",
};

function claimStarLabelCls(rating: number): string {
  if (rating >= 4) return "text-green-600";
  if (rating <= 2) return "text-red-500";
  return "text-slate-400";
}

export interface RubricScores {
  accuracy: number;
  completeness: number;
  source_quality: number;
}

export interface ClaimAnnotation {
  rating: number;
}

export interface SectionAnnotation {
  rubric: RubricScores;
  reason: string;
  claims: Record<number, ClaimAnnotation>;
}

interface Claim {
  claim_text: string;
  source_ids?: string[];
}

interface Source {
  source_id: string;
  title: string;
  publisher: string;
  url: string;
}

interface ScoringPanelProps {
  sectionIdx: number;
  annotation: SectionAnnotation;
  claims: Claim[];
  sources: Source[];
  isFirst: boolean;
  isLast: boolean;
  onAnnotationChange: (idx: number, ann: SectionAnnotation) => void;
  onNavigate: (delta: number) => void;
}

function ClaimStars({
  rating,
  onChange,
}: {
  rating: number;
  onChange: (r: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5 shrink-0">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          aria-label={`${i} sao`}
          onClick={() => onChange(i)}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(0)}
          style={{ fontSize: 18, lineHeight: 1, padding: 1 }}
          className={`cursor-pointer transition-transform hover:scale-125 ${
            i <= (hovered || rating) ? "text-amber-400" : "text-slate-200"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function ScoringPanel({
  sectionIdx,
  annotation,
  claims,
  sources,
  isFirst,
  isLast,
  onAnnotationChange,
  onNavigate,
}: ScoringPanelProps) {
  const sourceMap = Object.fromEntries(sources.map((s) => [s.source_id, s]));

  function updateRubric(key: keyof RubricScores, rating: number) {
    onAnnotationChange(sectionIdx, {
      ...annotation,
      rubric: { ...annotation.rubric, [key]: rating },
    });
  }

  function updateReason(val: string) {
    onAnnotationChange(sectionIdx, { ...annotation, reason: val });
  }

  function updateClaimRating(clIdx: number, rating: number) {
    onAnnotationChange(sectionIdx, {
      ...annotation,
      claims: {
        ...annotation.claims,
        [clIdx]: { rating },
      },
    });
  }

  const scoredCount = Object.values(annotation.claims).filter((c) => c.rating > 0).length;

  return (
    <div id="right-panel" className="w-2/5 overflow-y-auto bg-slate-50 flex flex-col">
      {/* Scrollable scoring area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Section A: Rubric scoring */}
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-bold text-slate-700">Chấm điểm Section</p>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-600 text-xs rounded-full">
              Bắt buộc
            </span>
          </div>

          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-0">
            <RubricItem
              label="Tính chính xác"
              description="Nội dung phản ánh đúng thực tế, không sai lệch"
              rating={annotation.rubric.accuracy}
              onChange={(r) => updateRubric("accuracy", r)}
            />
            <div className="border-t border-slate-200" />
            <RubricItem
              label="Tính đầy đủ"
              description="Bao quát đủ khía cạnh, không thiếu thông tin quan trọng"
              rating={annotation.rubric.completeness}
              onChange={(r) => updateRubric("completeness", r)}
            />
            <div className="border-t border-slate-200" />
            <RubricItem
              label="Chất lượng nguồn"
              description="Nguồn trích dẫn đáng tin cậy, có thể xác minh"
              rating={annotation.rubric.source_quality}
              onChange={(r) => updateRubric("source_quality", r)}
            />
          </div>
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
            value={annotation.reason}
            onChange={(e) => updateReason(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-slate-400"
          />
        </div>

        {/* Section C: Claims */}
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-bold text-slate-700">Claims trong đoạn</p>
            <span
              id="claims-badge"
              className="px-2.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full"
            >
              {scoredCount}/{claims.length} đã chấm
            </span>
          </div>
          <div id="claims-section" className="space-y-3">
            {claims.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Không có claim nào trong phần này.
              </p>
            ) : (
              claims.map((cl, clIdx) => {
                const claimAnn = annotation.claims[clIdx];
                const rating = claimAnn?.rating ?? 0;
                const isScored = rating > 0;

                return (
                  <div
                    key={clIdx}
                    className={`rounded-lg border p-3 space-y-2.5 ${
                      isScored
                        ? "bg-green-50 border-green-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Claim {clIdx + 1}
                      </span>
                      {isScored && (
                        <span className="w-4 h-4 flex items-center justify-center">
                          <svg
                            className="w-3.5 h-3.5 text-green-500"
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
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-700 leading-relaxed">
                      {cl.claim_text}
                    </p>

                    {/* Star rating row */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-600">Độ chính xác</p>
                        <div className="mt-0.5">
                          {rating > 0 ? (
                            <span
                              className={`text-xs font-medium ${claimStarLabelCls(rating)}`}
                            >
                              {STAR_LABELS[rating]}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">Chưa chấm</span>
                          )}
                        </div>
                      </div>
                      <ClaimStars
                        rating={rating}
                        onChange={(r) => updateClaimRating(clIdx, r)}
                      />
                    </div>

                    {cl.source_ids && cl.source_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className="text-xs text-slate-400">Nguồn:</span>
                        {cl.source_ids.map((id) => {
                          const src = sourceMap[id];
                          return src ? (
                            <span
                              key={id}
                              title={`${src.title}\n${src.publisher}\n${src.url}`}
                              className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-200 cursor-pointer"
                            >
                              {id}
                            </span>
                          ) : (
                            <span
                              key={id}
                              className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full border border-blue-200"
                            >
                              {id}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Section D: Navigation bar (sticky bottom) */}
      <div className="border-t border-slate-200 bg-white px-4 py-3 flex gap-2 shrink-0">
        <button
          onClick={() => onNavigate(-1)}
          disabled={isFirst}
          id="panel-btn-prev"
          className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Section trước
        </button>
        <button
          onClick={() => onNavigate(1)}
          disabled={isLast}
          id="panel-btn-next"
          className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Section tiếp →
        </button>
      </div>
    </div>
  );
}
