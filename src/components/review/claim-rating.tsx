"use client";

export type Verdict = "correct" | "incorrect" | "unsure";

interface VerdictDef {
  id: Verdict;
  icon: string;
  label: string;
}

/** Ordered worst→best (Sai | Không chắc | Đúng) - matching prototype claim-rating.js */
const VERDICTS: VerdictDef[] = [
  { id: "incorrect", icon: "✗", label: "Sai" },
  { id: "unsure", icon: "?", label: "Không chắc" },
  { id: "correct", icon: "✓", label: "Đúng" },
];

interface ClaimRatingProps {
  /** Current verdict, or null when nothing is selected */
  value: Verdict | null;
  /** Called with new verdict (null = toggled off) */
  onChange: (v: Verdict | null) => void;
  /** Optional claim text for accessibility label */
  claimText?: string;
}

/**
 * Three-way verdict widget for individual factual claims.
 *
 * UX rule (prototype claim-rating.js):
 *  - Click active button → clear (null, toggle off)
 *  - Click inactive button → switch to that verdict
 *  - Non-active siblings dim to opacity 0.5 when one is active
 */
export function ClaimRating({ value, onChange, claimText }: ClaimRatingProps) {
  function handleClick(id: Verdict) {
    // Toggle off if clicking the already-active verdict
    onChange(value === id ? null : id);
  }

  const hasActive = value !== null;

  return (
    <div
      role="group"
      aria-label={claimText ? `Đánh giá claim: ${claimText}` : "Đánh giá claim"}
      className="flex flex-wrap items-center gap-1.5 pt-1.5"
    >
      <span className="text-xs font-semibold text-slate-500 mr-0.5">Câu này:</span>
      {VERDICTS.map((v) => {
        const isActive = value === v.id;
        const dimmed = hasActive && !isActive;

        return (
          <button
            key={v.id}
            type="button"
            data-verdict={v.id}
            aria-pressed={isActive}
            title={isActive ? "Bấm lại để bỏ chọn" : `Đánh dấu claim này là "${v.label}"`}
            onClick={() => handleClick(v.id)}
            style={{
              opacity: dimmed ? 0.5 : 1,
              transition: "opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              border: `1px solid ${isActive ? verdictActiveBorder(v.id) : "#cbd5e1"}`,
              borderRadius: 999,
              background: isActive ? verdictActiveBg(v.id) : "#fff",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              color: isActive ? "#fff" : "#64748b",
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? verdictActiveShadow(v.id) : "none",
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
              {v.icon}
            </span>
            <span>{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function verdictActiveBg(id: Verdict): string {
  switch (id) {
    case "correct":   return "#16a34a";
    case "incorrect": return "#dc2626";
    case "unsure":    return "#f59e0b";
  }
}

function verdictActiveBorder(id: Verdict): string {
  switch (id) {
    case "correct":   return "#15803d";
    case "incorrect": return "#b91c1c";
    case "unsure":    return "#d97706";
  }
}

function verdictActiveShadow(id: Verdict): string {
  switch (id) {
    case "correct":   return "0 1px 2px rgba(22,163,74,0.25)";
    case "incorrect": return "0 1px 2px rgba(220,38,38,0.25)";
    case "unsure":    return "0 1px 2px rgba(245,158,11,0.25)";
  }
}
