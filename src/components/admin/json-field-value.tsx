"use client";

import { cn } from "@/lib/utils";

interface JsonFieldValueProps {
  value: unknown;
  maxLength?: number;
  className?: string;
  wrap?: boolean;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function JsonFieldValue({ value, maxLength = 120, className, wrap = false }: JsonFieldValueProps) {
  const text = stringifyValue(value);
  const clipped = text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

  return (
    <span
      className={cn(
        "block text-sm text-slate-700",
        wrap ? "max-w-none whitespace-normal break-words leading-5" : "max-w-[360px] truncate",
        className,
      )}
      title={text}
    >
      {clipped}
    </span>
  );
}
