"use client";

import { cn } from "@/lib/utils";

interface JsonFieldValueProps {
  value: unknown;
  maxLength?: number;
  className?: string;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function JsonFieldValue({ value, maxLength = 120, className }: JsonFieldValueProps) {
  const text = stringifyValue(value);
  const clipped = text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;

  return (
    <span className={cn("block max-w-[360px] truncate text-sm text-slate-700", className)} title={text}>
      {clipped}
    </span>
  );
}
