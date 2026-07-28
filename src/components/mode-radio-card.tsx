"use client";

import {
  ASSIGNMENT_MODE_LABELS,
  ASSIGNMENT_MODE_DESCRIPTIONS,
  type AssignmentMode,
} from "@/lib/labels";

const MODES: AssignmentMode[] = ["manual", "broadcast"];

/**
 * 2-card radio for batch assignment mode.
 * UI shows "Thủ công" / "Tự động" — internal value remains DB enum (`manual` / `broadcast`).
 */
export interface ModeRadioCardProps {
  value: AssignmentMode;
  onChange: (next: AssignmentMode) => void;
  disabled?: boolean;
}

export function ModeRadioCard({ value, onChange, disabled }: ModeRadioCardProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Cách phân công bài">
      {MODES.map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={
              "text-left p-4 rounded-xl border-2 transition-all focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:opacity-50 " +
              (active
                ? "border-blue-600 bg-blue-50 ring-2 ring-blue-200"
                : "border-slate-200 bg-white hover:border-blue-300")
            }
          >
            <div className="flex items-start justify-between mb-2">
              <p className="text-sm font-semibold text-slate-900">
                {ASSIGNMENT_MODE_LABELS[mode]}
              </p>
              <span
                className={
                  "inline-flex items-center justify-center w-4 h-4 rounded-full border-2 transition-colors " +
                  (active ? "border-blue-600 bg-blue-600" : "border-slate-300")
                }
              >
                {active ? <span className="w-1.5 h-1.5 bg-white rounded-full" /> : null}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {ASSIGNMENT_MODE_DESCRIPTIONS[mode]}
            </p>
          </button>
        );
      })}
    </div>
  );
}
