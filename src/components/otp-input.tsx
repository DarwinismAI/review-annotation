"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 6-cell OTP input with autopaste + arrow-key navigation.
 * Emits the joined string via `onChange` and triggers `onComplete` when all 6 cells have a digit.
 */
export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (full: string) => void;
  /** When true, paint cells with the danger ring (for "Mã không đúng" feedback). */
  hasError?: boolean;
  /** Disable input — use during verification request. */
  disabled?: boolean;
  /** ARIA label override; defaults to "Mã OTP {n}". */
  ariaLabelPrefix?: string;
}

const CELL_COUNT = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  hasError,
  disabled,
  ariaLabelPrefix = "Mã OTP",
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState<number | null>(0);

  // Autofocus first cell on mount
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function setDigit(index: number, digit: string) {
    const sanitized = digit.replace(/\D/g, "").slice(0, 1);
    const chars = value.padEnd(CELL_COUNT, " ").split("");
    chars[index] = sanitized || " ";
    const next = chars.join("").trimEnd();
    onChange(next);
    if (sanitized && index < CELL_COUNT - 1) {
      refs.current[index + 1]?.focus();
    }
    if (next.replace(/\s/g, "").length === CELL_COUNT) {
      onComplete?.(next);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CELL_COUNT);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    const last = Math.min(text.length, CELL_COUNT) - 1;
    refs.current[last]?.focus();
    if (text.length === CELL_COUNT) onComplete?.(text);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[index]) {
      // Step back to the previous cell when current is empty
      refs.current[Math.max(0, index - 1)]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < CELL_COUNT - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div className="flex gap-2 justify-between">
      {Array.from({ length: CELL_COUNT }, (_, i) => {
        const ch = value[i] ?? "";
        const isActive = focusIdx === i;
        const ringCls = hasError
          ? "border-red-400 focus:border-red-500 focus:ring-red-100"
          : isActive
          ? "border-blue-600 focus:border-blue-600 focus:ring-blue-100"
          : ch
          ? "border-slate-300"
          : "border-dashed border-slate-300";
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            disabled={disabled}
            aria-label={`${ariaLabelPrefix} ô ${i + 1}`}
            value={ch}
            onChange={(e) => setDigit(i, e.target.value)}
            onPaste={i === 0 ? handlePaste : undefined}
            onFocus={() => setFocusIdx(i)}
            onBlur={() => setFocusIdx(null)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={
              "w-12 h-14 text-center text-xl font-mono font-semibold rounded-lg border-2 outline-none focus:ring-4 transition-all bg-white text-slate-900 disabled:opacity-50 " +
              ringCls
            }
          />
        );
      })}
    </div>
  );
}
