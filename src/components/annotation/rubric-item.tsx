"use client";

import { useState } from "react";

const RUBRIC_STAR_LABELS: Record<number, string> = {
  1: "Rất kém",
  2: "Kém",
  3: "Trung bình",
  4: "Tốt",
  5: "Rất tốt",
};

function starLabelCls(rating: number): string {
  if (rating >= 4) return "text-green-600";
  if (rating <= 2) return "text-red-500";
  return "text-amber-500";
}

interface RubricItemProps {
  label: string;
  description: string;
  rating: number;
  onChange: (rating: number) => void;
}

export function RubricItem({ label, description, rating, onChange }: RubricItemProps) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-400 leading-snug mt-0.5">{description}</p>
        <div className="mt-1">
          {rating > 0 ? (
            <span className={`text-xs font-medium ${starLabelCls(rating)}`}>
              {RUBRIC_STAR_LABELS[rating]}
            </span>
          ) : (
            <span className="text-xs text-slate-300">Chưa chấm</span>
          )}
        </div>
      </div>
      <div className="flex gap-0.5 shrink-0 pt-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            aria-label={`${i} sao`}
            onClick={() => onChange(i)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(0)}
            style={{ fontSize: 18, lineHeight: 1, padding: 1, transition: "transform 0.1s" }}
            className={`cursor-pointer hover:scale-125 ${
              i <= (hovered || rating) ? "text-amber-400" : "text-slate-200"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
